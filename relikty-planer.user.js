// ==UserScript==
// @name         Relikty – planer rozmieszczenia
// @namespace    plemiona-roker
// @version      1.8.0
// @updateURL    https://raw.githubusercontent.com/Rokerio/noweRepo/main/relikty-planer.user.js
// @downloadURL  https://raw.githubusercontent.com/Rokerio/noweRepo/main/relikty-planer.user.js
// @description  Podpowiada, gdzie założyć relikty zależnie od celu: atak, obrona albo szybsza rekrutacja w wybranej grupie wiosek
// @author       Roker
// @match        https://*.plemiona.pl/game.php*
// @grant        none
// ==/UserScript==
// rejestr wersji dla Sprawdzacza skryptów (localStorage, osobny na każdym urządzeniu)
try{var __r=JSON.parse(localStorage.getItem('gdp_registry')||'{}');__r['relikty-planer']={v:'1.8.0',t:Date.now()};localStorage.setItem('gdp_registry',JSON.stringify(__r));}catch(e){}


(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  Stałe
   * ------------------------------------------------------------------ */
  const STORE_KEY = 'relikty_planer_v1';

  // klucz, nazwa PL, siła ataku, siła obrony ogólnej
  const UNITS = [
    ['spear', 'Pikinier', 10, 15],
    ['sword', 'Miecznik', 25, 50],
    ['axe', 'Topornik', 40, 10],
    ['archer', 'Łucznik', 15, 50],
    ['spy', 'Zwiadowca', 0, 2],
    ['light', 'Lekki kawalerzysta', 130, 30],
    ['marcher', 'Łucznik na koniu', 120, 40],
    ['heavy', 'Ciężki kawalerzysta', 150, 200],
    ['ram', 'Taran', 2, 20],
    ['catapult', 'Katapulta', 100, 100],
    ['knight', 'Rycerz', 150, 250],
    ['snob', 'Szlachcic', 30, 100],
  ];
  const UNIT_BY_NAME = {};
  const UNIT_INFO = {};
  UNITS.forEach(([k, n, a, d]) => { UNIT_BY_NAME[n.toLowerCase()] = k; UNIT_INFO[k] = { name: n, att: a, def: d }; });

  const BUILDINGS = { koszary: 'barracks', stajnia: 'stable', warsztat: 'garage' };
  const BUILDING_LABEL = { barracks: 'koszary', stable: 'stajnia', garage: 'warsztat' };

  const MODES = {
    rec: 'Szybsza rekrutacja',
    att: 'Atak (siła ataku)',
    def: 'Obrona (siła obrony)',
  };

  /* ------------------------------------------------------------------ *
   *  Narzędzia
   * ------------------------------------------------------------------ */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (s) => parseFloat(String(s).replace(',', '.')) || 0;
  const intOf = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0;

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveSettings(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* brak storage */ }
  }

  /* ------------------------------------------------------------------ *
   *  Parsowanie reliktów
   * ------------------------------------------------------------------ */
  function parseStat(name) {
    let m = name.match(/^(.+?):\s*\+(\d+(?:[.,]\d+)?)%\s*siła\s+(w ataku i w obronie|napadu|obrony)/i);
    if (m) {
      const unit = UNIT_BY_NAME[m[1].trim().toLowerCase()];
      if (!unit) return null;
      const v = num(m[2]);
      const kind = m[3].toLowerCase();
      return { type: 'unit', unit, att: kind !== 'obrony' ? v : 0, def: kind !== 'napadu' ? v : 0 };
    }
    m = name.match(/\+(\d+(?:[.,]\d+)?)%\s*(Koszary|Stajnia|Warsztat)\s*Prędkość rekrutacji/i);
    if (m) return { type: 'rec', building: BUILDINGS[m[2].toLowerCase()], v: num(m[1]) };
    return null;
  }

  function relicFromRaw(raw) {
    const stats = [raw.main_stat].concat(raw.sub_stats || []).filter(Boolean);
    const att = {}, def = {}, rec = {};
    const labels = [];
    stats.forEach((s) => {
      const p = parseStat(s.name || '');
      if (!p) return;
      if (p.type === 'unit') {
        if (p.att) att[p.unit] = (att[p.unit] || 0) + p.att;
        if (p.def) def[p.unit] = (def[p.unit] || 0) + p.def;
      } else {
        rec[p.building] = (rec[p.building] || 0) + p.v;
      }
    });
    stats.forEach((s) => labels.push(s.name));
    return {
      id: raw.id,
      name: raw.name,
      quality: raw.quality,
      range: raw.range,
      att, def, rec,
      statsText: labels,
      villageId: raw.village_id || null,
      cooldown: raw.remaining_removal_cooldown || null,
      inactive: !!raw.inactive_until,
      locked: !!raw.locked_state,
      lockedText: raw.locked_state || (raw.inactive_until ? 'nieaktywny do ' + raw.inactive_until : ''),
    };
  }

  function extractInventory(html) {
    const i = html.indexOf('RelicSystem.Inventory.init(');
    if (i < 0) throw new Error('Nie znaleziono listy reliktów na stronie.');
    const s = html.indexOf('[', i);
    let depth = 0, inStr = false, esc_ = false;
    for (let j = s; j < html.length; j++) {
      const c = html[j];
      if (inStr) {
        if (esc_) esc_ = false;
        else if (c === '\\') esc_ = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) return JSON.parse(html.slice(s, j + 1));
      }
    }
    throw new Error('Nie udało się odczytać listy reliktów.');
  }

  /* ------------------------------------------------------------------ *
   *  Parsowanie wiosek i wojsk
   * ------------------------------------------------------------------ */
  function villageFromCell(root) {
    const vn = root.querySelector('.quickedit-vn');
    if (!vn) return null;
    const id = parseInt(vn.getAttribute('data-id'), 10);
    const label = (vn.querySelector('.quickedit-label') || vn).textContent.replace(/\s+/g, ' ').trim();
    const m = label.match(/^(.*?)\s*\((\d+)\|(\d+)\)/);
    if (!m) return null;
    return { id, name: m[1].trim(), x: +m[2], y: +m[3] };
  }

  function parseProd(doc) {
    const out = [];
    doc.querySelectorAll('#production_table tr').forEach((tr) => {
      const v = villageFromCell(tr);
      if (!v) return;
      let pop = null, max = null;
      tr.querySelectorAll('td').forEach((td) => {
        if (pop !== null || td.querySelector('a')) return;
        const m = td.textContent.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
        if (m && +m[2] >= 240) { pop = +m[1]; max = +m[2]; }
      });
      v.pop = pop; v.popMax = max;
      out.push(v);
    });
    return out;
  }

  function parseGroups(doc) {
    const out = [];
    doc.querySelectorAll('.group-menu-item[data-group-id]').forEach((el) => {
      const id = el.getAttribute('data-group-id');
      if (id === '0') return;
      const name = el.textContent.replace(/[\[\]<>]/g, '').trim();
      if (name) out.push({ id, name });
    });
    return out;
  }

  function parseUnits(doc) {
    const table = doc.querySelector('#units_table');
    const res = {};
    if (!table) return res;
    const keys = [];
    table.querySelectorAll('thead th img').forEach((img) => {
      const m = (img.getAttribute('src') || '').match(/unit_([a-z]+)\./);
      if (m) keys.push(m[1]);
    });
    const labels = { 'własne': 'own', 'w wiosce': 'home', 'razem': 'total' };
    table.querySelectorAll('tbody').forEach((tb) => {
      const v = villageFromCell(tb);
      if (!v) return;
      const rec = { own: {}, home: {}, total: {} };
      tb.querySelectorAll('tr').forEach((tr) => {
        const tds = Array.from(tr.querySelectorAll('td'));
        const li = tds.findIndex((td) => labels[td.textContent.trim().toLowerCase()]);
        if (li < 0) return;
        const which = labels[tds[li].textContent.trim().toLowerCase()];
        keys.forEach((k, i) => {
          const td = tds[li + 1 + i];
          if (td) rec[which][k] = intOf(td.textContent);
        });
      });
      res[v.id] = rec;
    });
    return res;
  }

  /* ------------------------------------------------------------------ *
   *  Model problemu: współczynniki per wioska/klucz
   * ------------------------------------------------------------------ */
  function buildProblem(S, data) {
    const vills = data.villages;
    const N = vills.length;
    const idxById = new Map(vills.map((v, i) => [v.id, i]));

    let keys; // [{id, label}]
    if (S.mode === 'rec') {
      keys = ['barracks', 'stable', 'garage'].filter((b) => S.build[b]).map((b) => ({ id: b, label: BUILDING_LABEL[b] }));
    } else {
      keys = UNITS.filter((u) => (S.mode === 'att' ? u[2] > 0 : u[3] > 0)).map((u) => ({ id: u[0], label: u[1] }));
    }
    const K = keys.length;
    const keyIdx = new Map(keys.map((k, i) => [k.id, i]));

    // wagi wiosek (informacyjnie) i współczynniki
    const coef = new Float64Array(N * K);
    const weight = new Float64Array(N);
    const targets = new Uint8Array(N);
    vills.forEach((v, i) => {
      const on = S.targetIds.has(v.id);
      targets[i] = on ? 1 : 0;
      const prio = S.prio[v.id] != null ? S.prio[v.id] : 1;
      const un = data.units[v.id];
      if (S.mode === 'rec') {
        const free = v.popMax != null ? Math.max(0, v.popMax - v.pop) : 0;
        v.free = free;
        const f = free >= S.minFree ? Math.min(free, S.freeCap) / 1000 : 0;
        weight[i] = free;
        if (on) keys.forEach((k, ki) => { coef[i * K + ki] = prio * f; });
      } else if (un) {
        const src = S.mode === 'att' ? un.total : un.home;
        let w = 0;
        keys.forEach((k, ki) => {
          const power = (src[k.id] || 0) * (S.mode === 'att' ? UNIT_INFO[k.id].att : UNIT_INFO[k.id].def) / 1000;
          w += power;
          if (on) coef[i * K + ki] = prio * power;
        });
        weight[i] = w;
      }
    });

    // wektor relikt -> klucze
    const vecOf = (r) => {
      const vec = new Float64Array(K);
      const src = S.mode === 'rec' ? r.rec : S.mode === 'att' ? r.att : r.def;
      for (const k in src) if (keyIdx.has(k)) vec[keyIdx.get(k)] = src[k];
      return vec;
    };

    const nbCache = new Map();
    const nb = (h, range) => {
      const key = h * 16 + range;
      let a = nbCache.get(key);
      if (!a) {
        a = [];
        const r2 = range * range, hv = vills[h];
        for (let i = 0; i < N; i++) {
          const dx = vills[i].x - hv.x, dy = vills[i].y - hv.y;
          if (dx * dx + dy * dy <= r2) a.push(i);
        }
        nbCache.set(key, a);
      }
      return a;
    };

    return { vills, N, K, keys, keyIdx, coef, weight, targets, vecOf, nb, idxById };
  }

  /* ------------------------------------------------------------------ *
   *  Optymalizacja (restarty + wspinaczka)
   * ------------------------------------------------------------------ */
  function makeEvaluator(P, cap, fixedList) {
    const { N, K, coef, nb } = P;
    // baza: aktywne relikty zablokowane na miejscu
    const base = new Float64Array(N * K);
    fixedList.forEach(({ vec, range, host }) => {
      nb(host, range).forEach((vi) => { for (let k = 0; k < K; k++) base[vi * K + k] += vec[k]; });
    });
    const tmp = new Float64Array(N * K);
    const mark = new Int32Array(N);
    let stamp = 0;

    function gain(assign, relics) {
      stamp++;
      const touched = [];
      for (let a = 0; a < assign.length; a++) {
        const R = relics[assign[a][0]];
        const list = nb(assign[a][1], R.range);
        for (let t = 0; t < list.length; t++) {
          const vi = list[t];
          if (mark[vi] !== stamp) {
            mark[vi] = stamp; touched.push(vi);
            for (let k = 0; k < K; k++) tmp[vi * K + k] = base[vi * K + k];
          }
          for (let k = 0; k < K; k++) tmp[vi * K + k] += R.vec[k];
        }
      }
      let total = 0;
      for (let t = 0; t < touched.length; t++) {
        const vi = touched[t];
        for (let k = 0; k < K; k++) {
          const c = coef[vi * K + k];
          if (c) total += c * (Math.min(cap, tmp[vi * K + k]) - Math.min(cap, base[vi * K + k]));
        }
      }
      return total;
    }
    return { gain, base };
  }

  // Przydział flag: flagi działają osobno od reliktów (bez wspólnego limitu), więc zysk z flagi
  // = jej % × suma współczynników wioski. Największe flagi do wiosek o największej wadze (optymalne).
  function assignFlags(P, flags, blockedVi) {
    const { N, K, coef } = P;
    const w = [];
    for (let vi = 0; vi < N; vi++) {
      if (!P.targets[vi] || (blockedVi && blockedVi.has(vi))) continue;
      let sum = 0;
      for (let k = 0; k < K; k++) sum += coef[vi * K + k];
      if (sum > 0) w.push({ vi, sum });
    }
    w.sort((x, y) => y.sum - x.sum);
    const fl = flags.slice().sort((x, y) => y.pct - x.pct);
    const n = Math.min(fl.length, w.length);
    const slots = w.slice(0, n).map((x) => x.vi);
    const sumOf = new Map(w.map((x) => [x.vi, x.sum]));
    const out = [];
    // w obrębie tej samej wartości % najpierw zostaw flagi tam, gdzie już wiszą
    for (let i = 0; i < n;) {
      let j = i;
      while (j < n && fl[j].pct === fl[i].pct) j++;
      const group = fl.slice(i, j), vs = slots.slice(i, j);
      const left = [], free = vs.slice();
      group.forEach((f) => {
        const at = free.indexOf(f.from);
        if (f.from != null && at >= 0) { out.push({ flag: f, vi: f.from, gain: f.pct * sumOf.get(f.from) }); free.splice(at, 1); }
        else left.push(f);
      });
      left.forEach((f, k) => out.push({ flag: f, vi: free[k], gain: f.pct * sumOf.get(free[k]) }));
      i = j;
    }
    return out;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function climb(state, ctx) {
    const { relics, hosts, gain } = ctx;
    let best = gain(state, relics);
    let improved = true;
    while (improved) {
      improved = false;
      const usedH = new Set(state.map((s) => s[1]));
      const usedR = new Set(state.map((s) => s[0]));
      // 1. zmiana wioski dla reliktu
      for (let i = 0; i < state.length; i++) {
        const oldH = state[i][1];
        for (const h of shuffle(hosts.slice())) {
          if (usedH.has(h)) continue;
          state[i][1] = h;
          const g = gain(state, relics);
          if (g > best + 1e-9) { best = g; usedH.delete(oldH); usedH.add(h); improved = true; break; }
          state[i][1] = oldH;
        }
        if (state[i][1] !== oldH) continue;
      }
      // 2. podmiana reliktu w tej samej wiosce
      for (let i = 0; i < state.length; i++) {
        const oldR = state[i][0];
        for (let r = 0; r < relics.length; r++) {
          if (usedR.has(r)) continue;
          state[i][0] = r;
          const g = gain(state, relics);
          if (g > best + 1e-9) { best = g; usedR.delete(oldR); usedR.add(r); improved = true; break; }
          state[i][0] = oldR;
        }
      }
      // 3. podmiana reliktu + wioski jednocześnie (próbkowanie)
      for (let t = 0; t < 250 && state.length; t++) {
        const i = (Math.random() * state.length) | 0;
        const r = (Math.random() * relics.length) | 0;
        const h = hosts[(Math.random() * hosts.length) | 0];
        const [oR, oH] = state[i];
        if ((usedR.has(r) && r !== oR) || (usedH.has(h) && h !== oH)) continue;
        state[i] = [r, h];
        const g = gain(state, relics);
        if (g > best + 1e-9) { best = g; usedR.delete(oR); usedR.add(r); usedH.delete(oH); usedH.add(h); improved = true; }
        else state[i] = [oR, oH];
      }
    }
    return best;
  }

  function greedyStart(ctx, slots) {
    const { relics, hosts, gain } = ctx;
    const state = [];
    const usedR = new Set(), usedH = new Set();
    for (let s = 0; s < slots; s++) {
      let bestG = -1, bestRH = null;
      for (let r = 0; r < relics.length; r++) {
        if (usedR.has(r)) continue;
        for (const h of hosts) {
          if (usedH.has(h)) continue;
          const g = gain(state.concat([[r, h]]), relics);
          if (g > bestG) { bestG = g; bestRH = [r, h]; }
        }
      }
      if (!bestRH || bestG <= 0) break;
      state.push(bestRH); usedR.add(bestRH[0]); usedH.add(bestRH[1]);
    }
    return state;
  }

  function solve(ctx, slots, onProgress, done, limit) {
    const { relics, hosts } = ctx;
    const maxN = Math.min(slots, relics.length, hosts.length);
    let bestState = greedyStart(ctx, maxN);
    let bestVal = climb(bestState, ctx);
    const t0 = Date.now();
    const LIMIT = limit || 3500;
    let it = 0;
    (function step() {
      const stop = Date.now() - t0 > LIMIT || it >= 120;
      if (stop) { done({ state: bestState, value: bestVal }); return; }
      for (let c = 0; c < 4 && it < 120; c++, it++) {
        const rs = shuffle(relics.map((_, i) => i)).slice(0, maxN);
        const hs = shuffle(hosts.slice()).slice(0, maxN);
        const st = rs.map((r, i) => [r, hs[i]]);
        const v = climb(st, ctx);
        if (v > bestVal + 1e-9) { bestVal = v; bestState = st; }
      }
      onProgress(Math.min(100, Math.round(((Date.now() - t0) / LIMIT) * 100)));
      setTimeout(step, 0);
    })();
  }

  /* ------------------------------------------------------------------ *
   *  Pobieranie danych
   * ------------------------------------------------------------------ */
  const gameUrl = (q) => {
    const vid = (window.game_data && window.game_data.village && window.game_data.village.id) || '';
    return `/game.php?village=${vid}&${q}`;
  };
  async function fetchText(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' dla ' + url);
    return r.text();
  }
  const parseDoc = (html) => new DOMParser().parseFromString(html, 'text/html');

  // typ flagi: 2 = czas rekrutacji, 3 = siła ataku, 4 = siła obrony
  const FLAG_TYPE = { rec: 2, att: 3, def: 4 };

  function parseFlags(html) {
    const pct = {};
    const re = /id="flag_box_(\d+)_(\d+)"[^>]*title="[^"]*?(\d+(?:[.,]\d+)?)%/g;
    let m;
    while ((m = re.exec(html))) {
      (pct[m[1]] = pct[m[1]] || {})[m[2]] = num(m[3]);
    }
    const i = html.indexOf('FlagsScreen.setFlagCounts(');
    let stock = {};
    if (i >= 0) {
      const a = html.indexOf('{', i);
      let depth = 0;
      for (let j = a; j < html.length; j++) {
        if (html[j] === '{') depth++;
        else if (html[j] === '}') { depth--; if (!depth) { try { stock = JSON.parse(html.slice(a, j + 1)); } catch (e) { stock = {}; } break; } }
      }
    }
    return { pct, stock };
  }

  // flagi już przypisane do wiosek (przegląd "Technologia" ma kolumnę Flaga)
  function parseAssignedFlags(doc) {
    const out = {};
    doc.querySelectorAll('td.flag_info').forEach((td) => {
      const id = parseInt((td.id || '').replace('flag_info_', ''), 10);
      const pr = td.querySelector('.flag_present');
      if (!id || !pr || /display-none/.test(pr.className)) return;
      const txt = (pr.querySelector('span') || pr).textContent.replace(/\s+/g, ' ').trim();
      const m = txt.match(/([+-]?\d+(?:[.,]\d+)?)%\s*(.*)/);
      if (!m) return;
      let type = 0;
      if (/Prędkość rekrutacji/i.test(txt)) type = 2;
      else if (/siła ataku/i.test(txt)) type = 3;
      else if (/siła obrony/i.test(txt)) type = 4;
      out[id] = { pct: num(m[1]), type, text: txt };
    });
    return out;
  }

  // lista dostępnych flag danego typu: [{level, pct}] malejąco
  function flagList(flags, type) {
    const out = [];
    if (!flags) return out;
    const st = flags.stock[type] || {};
    for (const lvl in st) {
      const n = parseInt(st[lvl], 10) || 0;
      const p = flags.pct[type] && flags.pct[type][lvl];
      for (let i = 0; i < n; i++) if (p) out.push({ level: +lvl, pct: p });
    }
    return out.sort((a, b) => b.pct - a.pct);
  }

  // pula flag do rozdzielenia: nieprzypisane + (opcjonalnie) już przypisane danego typu
  function flagPool(data, type, includeAssigned) {
    const pool = flagList(data.flags, type).map((f) => Object.assign({ from: null }, f));
    if (includeAssigned) {
      for (const vid in data.assignedFlags) {
        const a = data.assignedFlags[vid];
        if (a.type !== type) continue;
        let level = null;
        const lv = data.flags && data.flags.pct[type];
        if (lv) for (const l in lv) if (lv[l] === a.pct) level = +l;
        pool.push({ level, pct: a.pct, from: +vid });
      }
    }
    return pool.sort((a, b) => b.pct - a.pct);
  }

  async function loadAll(setStatus) {
    setStatus('Pobieram relikty…');
    const relicHtml = await fetchText(gameUrl('screen=relic_system'));
    const relics = extractInventory(relicHtml).map(relicFromRaw);

    setStatus('Pobieram wioski…');
    const prodDoc = parseDoc(await fetchText(gameUrl('screen=overview_villages&mode=prod&group=0&page=-1')));
    const villages = parseProd(prodDoc);
    const groups = parseGroups(prodDoc);

    setStatus('Pobieram wojska…');
    const unitsDoc = parseDoc(await fetchText(gameUrl('screen=overview_villages&mode=units&group=0&page=-1')));
    const units = parseUnits(unitsDoc);

    let flags = null;
    try {
      setStatus('Pobieram flagi…');
      flags = parseFlags(await fetchText(gameUrl('screen=flags&mode=index')));
    } catch (e) { flags = null; }

    let assignedFlags = {};
    try {
      assignedFlags = parseAssignedFlags(parseDoc(await fetchText(gameUrl('screen=overview_villages&mode=tech&group=0&page=-1'))));
    } catch (e) { assignedFlags = {}; }

    return { relics, villages, groups, units, flags, assignedFlags, groupMembers: {} };
  }

  // blokady 24 h zmiany flagi: strona flag każdej wioski pokazuje „Czas, który pozostał…”
  async function loadFlagCooldowns(data, vids, setStatus) {
    data.flagCd = data.flagCd || {};
    const t0 = Date.now();
    let i = 0;
    for (const vid of vids) {
      i++;
      if (data.flagCdAt && data.flagCdAt[vid] && t0 - data.flagCdAt[vid] < 120000) continue; // świeże
      setStatus(`Sprawdzam blokady flag… ${i}/${vids.length}`);
      try {
        const doc = parseDoc(await fetchText(`/game.php?village=${vid}&screen=flags&mode=index`));
        const e = doc.querySelector('#cooldown_container .timer, #cooldown_container .cooldown');
        const m = e && /(\d+):(\d{2}):(\d{2})/.exec(e.textContent || '');
        data.flagCd[vid] = m ? Date.now() + ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000 : 0;
        (data.flagCdAt = data.flagCdAt || {})[vid] = Date.now();
      } catch (err) { /* pomiń */ }
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  async function loadGroupMembers(data, gid) {
    if (!gid || gid === '0') return null;
    if (data.groupMembers[gid]) return data.groupMembers[gid];
    const doc = parseDoc(await fetchText(gameUrl(`screen=overview_villages&mode=prod&group=${gid}&page=-1`)));
    const ids = new Set(parseProd(doc).map((v) => v.id));
    data.groupMembers[gid] = ids;
    return ids;
  }

  /* ------------------------------------------------------------------ *
   *  UI
   * ------------------------------------------------------------------ */
  const PLAN_KEY = 'relikty_planer_plan_v1';
  function loadPlan() { try { return JSON.parse(localStorage.getItem(PLAN_KEY)) || null; } catch (e) { return null; } }
  function savePlan(p) { try { localStorage.setItem(PLAN_KEY, JSON.stringify(p)); } catch (e) { /* brak storage */ } }

  const CSS = `
  .rp-hl-green{outline:4px solid #1a9c1a !important;outline-offset:2px;box-shadow:0 0 12px 4px rgba(26,156,26,.7) !important}
  .rp-hl-red{outline:3px solid #d02020 !important;background:#ffd6d6 !important;padding:3px 8px;font-weight:bold;border-radius:3px}
  #rp-banner{background:#fff3c4;border:2px solid #b8860b;border-radius:4px;padding:8px 10px;margin:8px 0;font:13px/1.4 Verdana,sans-serif;color:#2b1d07}
  #rp-banner button{background:#7d510f;color:#fff;border:0;border-radius:3px;padding:6px 10px;margin-left:8px;font-weight:bold}
  #rp-banner .g{color:#0b6b0b;font-weight:bold}#rp-banner .r{color:#a02020;font-weight:bold}
  #rp-btn{position:fixed;left:8px;bottom:8px;z-index:99998;background:#7d510f;color:#fff;border:2px solid #f4e4bc;border-radius:20px;padding:8px 14px;font:bold 13px Verdana,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.5)}
  #rp-panel{position:fixed;inset:0;z-index:99999;background:#f4e4bc;color:#2b1d07;overflow:auto;font:13px/1.35 Verdana,sans-serif;padding:10px 14px 60px;display:none;-webkit-overflow-scrolling:touch}
  #rp-panel h2{margin:0;font-size:16px}
  #rp-panel h3{margin:14px 0 6px;font-size:14px;border-bottom:1px solid #c1a264}
  #rp-panel .rp-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0}
  #rp-panel label{display:flex;align-items:center;gap:4px}
  #rp-panel select,#rp-panel input[type=text],#rp-panel input[type=number]{font-size:14px;padding:5px;border:1px solid #92773b;border-radius:3px;background:#fff8e4;max-width:100%}
  #rp-panel input[type=number]{width:70px}
  #rp-panel button{background:#7d510f;color:#fff;border:0;border-radius:4px;padding:9px 14px;font:bold 13px Verdana,sans-serif}
  #rp-panel button.sec{background:#b99a52}
  #rp-panel table{border-collapse:collapse;width:100%;margin:4px 0}
  #rp-panel th,#rp-panel td{border:1px solid #c1a264;padding:4px 6px;text-align:left;vertical-align:top}
  #rp-panel th{background:#dcc891}
  #rp-panel .rp-scroll{max-height:260px;overflow:auto;border:1px solid #c1a264;background:#fff8e4}
  #rp-panel .rp-muted{color:#6b5a2e;font-size:12px}
  #rp-panel .rp-good{color:#0b6b0b;font-weight:bold}
  #rp-panel .rp-warn{color:#a02020}
  #rp-panel .rp-bar{height:6px;background:#dcc891;border-radius:3px;overflow:hidden}
  #rp-panel .rp-bar>div{height:100%;background:#7d510f;width:0}
  #rp-panel a{color:#5a3a05}
  @media(prefers-color-scheme:dark){}
  `;

  function el(html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstChild;
  }

  /* ------------------------------------------------------------------ *
   *  Zapisany plan: lista zadań w panelu + podpowiedzi na stronach wiosek
   * ------------------------------------------------------------------ */
  // kolejka kroków: najpierw wszystkie zdjęcia/usunięcia, potem zakładanie (flaga musi być wolna, zanim trafi gdzie indziej)
  function planQueue(pl, only) {
    const q = [];
    const ids = Object.keys(pl.tasks).sort((x, y) => String(pl.names[x] || x).localeCompare(String(pl.names[y] || y), 'pl'));
    const add = (op, kind, test) => ids.forEach((id) => {
      if (test(pl.tasks[id])) q.push({ vid: +id, kind, op, key: `${id}:${kind}:${op}` });
    });
    add('remove', 'flag', (t) => t.flagRemove != null);
    add('place', 'flag', (t) => t.flagPlace != null);
    add('remove', 'relic', (t) => !!t.relicRemove);
    add('place', 'relic', (t) => !!t.relicPlace);
    return only ? q.filter((x) => x.kind === only) : q;
  }
  const taskUrl = (t) => `/game.php?village=${t.vid}&screen=${t.kind === 'flag' ? 'flags' : 'relic_system'}`;
  const isBlocked = (pl, t) => t.kind === 'flag' && pl.blocked && pl.blocked[t.vid] > Date.now(); // 24 h blokady zmiany flagi w wiosce
  const nextTask = (pl, kind, skipVid) => planQueue(pl, kind).find((t) => !pl.done[t.key] && t.vid !== skipVid && !isBlocked(pl, t));
  const hhmm = (ms) => new Date(ms).toLocaleString('pl-PL', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const AUTO_KEY = 'relikty_planer_auto';
  const autoOn = () => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch (e) { return true; } };
  const taskText = (pl, t) => {
    const x = pl.tasks[t.vid];
    if (t.kind === 'flag') return t.op === 'remove' ? `usuń flagę +${x.flagRemove}%` : `załóż flagę +${x.flagPlace}%`;
    return t.op === 'remove' ? `zdejmij ${x.relicRemove}` : `załóż ${x.relicPlace}`;
  };

  function savedPlanHtml() {
    const pl = loadPlan();
    if (!pl) return '';
    const when = new Date(pl.created).toLocaleString('pl-PL');
    const sect = (kind, title, hint) => {
      const q = planQueue(pl, kind);
      if (!q.length) return '';
      const left = q.filter((t) => !pl.done[t.key]).length;
      const rows = q.map((t, i) => `<tr><td>${i + 1}.</td><td>${esc(pl.names[t.vid] || t.vid)}</td>
        <td><label><input type="checkbox" data-done="${t.key}" ${pl.done[t.key] ? 'checked' : ''}> ${esc(taskText(pl, t))}</label>${!pl.done[t.key] && isBlocked(pl, t) ? ' <b class="r" style="color:#a02020">⏳ blokada do ' + hhmm(pl.blocked[t.vid]) + '</b>' : ''}
        <a href="${taskUrl(t)}" target="_blank">nowa karta</a></td></tr>`).join('');
      return `<h4>${title}</h4><div class="rp-muted">${hint}</div>
        <div class="rp-row"><button id="rp-start-${kind}" data-start="${kind}" type="button">${left ? (left < q.length ? 'Kontynuuj (' + left + ' z ' + q.length + ')' : 'Start (' + left + ' kroków)') : 'Zakończone ✓'}</button></div>
        <div class="rp-scroll" style="max-height:240px"><table><tr><th>#</th><th>Wioska</th><th>Krok</th></tr>${rows}</table></div>`;
    };
    const f = sect('flag', 'Flagi', 'Najpierw usuwanie flag (tych, które trafią gdzie indziej), potem zakładanie. Skrypt podświetla i sam klika – Ty tylko potwierdzasz.');
    const r = sect('relic', 'Relikty', 'Najpierw zdejmowanie, potem zakładanie.');
    if (!f && !r) return '';
    return `<h3>Zapisany plan (${esc(when)})</h3>${f}${r}
      <div class="rp-row"><label><input type="checkbox" id="rp-auto" ${autoOn() ? 'checked' : ''}> automatycznie klikaj flagi</label>
      <button class="sec" id="rp-clearplan" type="button">Wyczyść plan</button></div>`;
  }

  function pageHints() {
    const gd = window.game_data;
    if (!gd || !gd.village || (gd.screen !== 'flags' && gd.screen !== 'relic_system')) return;
    const pl0 = loadPlan();
    if (!pl0) return;
    const vid = gd.village.id;
    const kind = gd.screen === 'flags' ? 'flag' : 'relic';
    const t = pl0.tasks[vid] || {};
    const host = document.getElementById('content_value');
    if (!host || document.getElementById('rp-banner')) return;

    const mine = planQueue(pl0, kind).filter((x) => x.vid === vid); // zadania tej wioski na tej stronie
    const banner = document.createElement('div');
    banner.id = 'rp-banner';
    host.insertBefore(banner, host.firstChild);

    let redirectTimer = null;
    const go = (task) => { location.href = taskUrl(task); };
    const render = (note) => {
      const pl = loadPlan() || pl0;
      const total = planQueue(pl, kind).length, doneN = planQueue(pl, kind).filter((x) => pl.done[x.key]).length;
      const lines = [];
      if (kind === 'flag') {
        if (t.flagRemove != null) lines.push(`<span class="r">Usuń flagę +${t.flagRemove}%</span> ${pl.done[vid + ':flag:remove'] ? '✓' : '(czerwony przycisk)'}`);
        if (t.flagPlace != null) lines.push(`<span class="g">Załóż flagę +${t.flagPlace}%</span> ${pl.done[vid + ':flag:place'] ? '✓' : '(zielona ramka)'}`);
        if (t.flagKeep != null) lines.push(`Flaga +${t.flagKeep}% zostaje`);
      } else {
        if (t.relicRemove) lines.push(`<span class="r">Zdejmij relikt:</span> ${esc(t.relicRemove)} ${pl.done[vid + ':relic:remove'] ? '✓' : ''}`);
        if (t.relicPlace) lines.push(`<span class="g">Załóż relikt:</span> ${esc(t.relicPlace)} ${pl.done[vid + ':relic:place'] ? '✓' : ''}`);
        if (t.relicKeep) lines.push(`Relikt zostaje: ${esc(t.relicKeep)}`);
      }
      const pending = mine.filter((x) => !pl.done[x.key]);
      const nxt = nextTask(pl, kind, vid);
      let btns = '';
      if (kind === 'relic' && pending.length) btns += '<button type="button" id="rp-ok">Zrobione → dalej</button>';
      if (nxt) btns += `<button type="button" id="rp-next">${pending.length ? 'Pomiń → ' : 'Dalej → '}${esc(pl.names[nxt.vid] || nxt.vid)}: ${esc(taskText(pl, nxt))}</button>`;
      else if (!pending.length) btns += '<span class="g">Plan zakończony ✓</span>';
      if (redirectTimer) btns += ' <button type="button" id="rp-stay">Zostań tu</button>';
      banner.innerHTML = `<b>${kind === 'flag' ? 'Flagi' : 'Relikty'} (${doneN}/${total})</b> – ${lines.length ? lines.join('<br>') : 'brak zadań w tej wiosce'}`
        + (note ? `<div>${note}</div>` : '') + `<div style="margin-top:6px">${btns}</div>`;
      const ok = banner.querySelector('#rp-ok'), nx = banner.querySelector('#rp-next'), st = banner.querySelector('#rp-stay');
      if (ok) ok.onclick = () => { pending.forEach((x) => markDone(x.key)); const n2 = nextTask(loadPlan(), kind, vid); if (n2) go(n2); else render(); };
      if (nx) nx.onclick = () => go(nxt);
      if (st) st.onclick = () => { clearTimeout(redirectTimer); redirectTimer = null; render(); };
    };
    const markDone = (key) => { const p2 = loadPlan() || pl0; p2.done[key] = true; savePlan(p2); };
    const finish = (key) => {
      markDone(key);
      const nxt = nextTask(loadPlan(), kind, vid);
      const stillHere = mine.some((x) => !(loadPlan().done[x.key]));
      if (nxt && !stillHere) {
        redirectTimer = setTimeout(() => go(nxt), 2000);
        render('<span class="g">✓ Zrobione.</span> Przechodzę do następnej wioski za 2 s…');
      } else render('<span class="g">✓ Zrobione.</span>');
    };
    render();
    if (kind === 'relic') return;

    // --- strona flag: podświetlenia + automatyczne wykrywanie wykonania kroku ---
    const curState = () => {
      const cf = document.getElementById('current_flag');
      const vis = !!cf && cf.style.display !== 'none' && getComputedStyle(cf).display !== 'none';
      return { vis, txt: cf ? cf.textContent : '' };
    };
    const hl = () => {
      const pl = loadPlan() || pl0;
      if (t.flagRemove != null && !pl.done[vid + ':flag:remove']) {
        const a = document.querySelector('#current_flag a[onclick*="unassignFlag"]');
        if (a) a.classList.add('rp-hl-red');
      }
      if (t.flagPlace != null && !pl.done[vid + ':flag:place']) {
        const want = '+' + t.flagPlace + '%';
        const boxes = Array.from(document.querySelectorAll(`#flags_container .flag_box[id^="flag_box_${pl0.flagType}_"]`))
          .filter((b) => (b.getAttribute('title') || '').trim().startsWith(want));
        boxes.forEach((b) => b.classList.add('rp-hl-green'));
        if (boxes[0] && !hl.scrolled) { hl.scrolled = true; if (boxes[0].scrollIntoView) boxes[0].scrollIntoView({ block: 'center' }); }
      }
    };
    hl(); setTimeout(hl, 600); setTimeout(hl, 1800);

    // blokada 24 h: gra nie pozwala zdjąć/zmienić flagi w wiosce przez dobę od ostatniej zmiany
    const cooldownSecs = () => {
      const e = document.querySelector('#cooldown_container .timer, #cooldown_container .cooldown');
      const m = e && /(\d+):(\d{2}):(\d{2})/.exec(e.textContent || '');
      return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0;
    };
    const blockedCheck = () => {
      const pl = loadPlan() || pl0;
      const pend = mine.filter((x) => !pl.done[x.key]);
      const cd = cooldownSecs();
      if (!pend.length || !cd) return false;
      pl.blocked = pl.blocked || {}; pl.blocked[vid] = Date.now() + cd * 1000; savePlan(pl);
      const nxt = nextTask(pl, kind, vid);
      render(`<span class="r">⏳ Gra blokuje zmianę flagi w tej wiosce do ${hhmm(pl.blocked[vid])}.</span> Krok wróci do kolejki po tym czasie.`);
      if (nxt && !redirectTimer) redirectTimer = setTimeout(() => go(nxt), 3000);
      return true;
    };
    let blockedFlag = false;

    // automatyczny klik: raz na ~6 s, tylko gdy włączony; potwierdzenie w oknie gry robi użytkownik
    let lastClick = 0;
    const autoClick = (what) => {
      if (blockedFlag || !autoOn() || Date.now() - lastClick < 6000) return;
      let target = null;
      if (what === 'a') target = document.querySelector('#current_flag a[onclick*="unassignFlag"]');
      else {
        const want = '+' + t.flagPlace + '%';
        const boxes = Array.from(document.querySelectorAll(`#flags_container .flag_box[id^="flag_box_${pl0.flagType}_"]`))
          .filter((b) => (b.getAttribute('title') || '').trim().startsWith(want));
        const stock = (b) => parseInt(((b.querySelector('.flag_count') || {}).textContent || '').replace(/\D/g, ''), 10) || 0;
        target = boxes.find((b) => stock(b) > 0) || (boxes.every((b) => !stock(b) && !((b.querySelector('.flag_count') || {}).textContent || '').trim()) ? boxes[0] : null);
        if (!target && boxes.length) { render('<span class="r">Brak takiej flagi w magazynie (+' + t.flagPlace + '%).</span>'); lastClick = Date.now(); return; }
      }
      if (!target) return;
      lastClick = Date.now();
      target.click();
      render('Kliknięto automatycznie – <b>potwierdź w oknie gry</b>, jeśli się pojawi.');
    };

    let initial = null;
    const poll = setInterval(() => {
      if (initial === null) return; // czekamy, aż FlagsScreen się zainicjuje
      if (blockedFlag) return;
      if (blockedCheck()) { blockedFlag = true; return; }
      const pl = loadPlan() || pl0;
      const st = curState();
      const wantRemove = t.flagRemove != null && !pl.done[vid + ':flag:remove'];
      const wantPlace = t.flagPlace != null && !pl.done[vid + ':flag:place'];
      if (wantRemove) {
        if (st.vis) autoClick('a');
        if (initial.vis && !st.vis) { document.querySelectorAll('.rp-hl-red').forEach((e) => e.classList.remove('rp-hl-red')); finish(vid + ':flag:remove'); }
        else if (!initial.vis && !st.vis) { markDone(vid + ':flag:remove'); render('Flagi już nie ma – krok zaliczony.'); }
      } else if (wantPlace) {
        const want = '+' + t.flagPlace + '%';
        const has = st.vis && st.txt.indexOf(want) >= 0;
        if (st.vis && !has) autoClick('a'); // inna flaga wisi – najpierw ją zdejmij
        else if (!has) autoClick('box');
        if (has && initial.vis && initial.txt.indexOf(want) >= 0) { markDone(vid + ':flag:place'); render('Ta flaga już jest założona – krok zaliczony.'); }
        else if (has) { document.querySelectorAll('.rp-hl-green').forEach((e) => e.classList.remove('rp-hl-green')); finish(vid + ':flag:place'); }
      }
      hl();
    }, 700);
    setTimeout(() => { initial = curState(); }, 1200); // stan po inicjalizacji FlagsScreen
  }

  function init() {
    if (document.getElementById('rp-btn')) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const btn = el('<button id="rp-btn" type="button">Relikty</button>');
    const panel = el('<div id="rp-panel"></div>');
    document.body.appendChild(btn);
    document.body.appendChild(panel);

    const saved = loadSettings();
    const S = {
      mode: saved.mode || 'rec',
      group: saved.group || '0',
      regex: saved.regex || '',
      slots: saved.slots || 8,
      cap: saved.cap || 20,
      minFree: saved.minFree != null ? saved.minFree : 1500,
      freeCap: saved.freeCap != null ? saved.freeCap : 24000,
      build: saved.build || { barracks: true, stable: true, garage: false },
      ignoreCd: !!saved.ignoreCd,
      lockedSlot: !!saved.lockedSlot,
      useFlags: saved.useFlags !== false,
      reuseFlags: saved.reuseFlags !== false,
      checkCd: saved.checkCd !== false,
      prio: saved.prio || {},
      offVill: new Set(saved.offVill || []),   // ręcznie odznaczone wioski
      offRelic: new Set(saved.offRelic || []), // ręcznie odznaczone relikty
      targetIds: new Set(),
    };
    let data = null;

    const persist = () => saveSettings({
      mode: S.mode, group: S.group, regex: S.regex, slots: S.slots, cap: S.cap, minFree: S.minFree, freeCap: S.freeCap,
      build: S.build, ignoreCd: S.ignoreCd, lockedSlot: S.lockedSlot, useFlags: S.useFlags, reuseFlags: S.reuseFlags, checkCd: S.checkCd, prio: S.prio,
      offVill: Array.from(S.offVill), offRelic: Array.from(S.offRelic),
    });

    btn.addEventListener('click', () => {
      panel.style.display = 'block';
      if (!data) refresh();
      else render();
    });

    async function refresh() {
      panel.innerHTML = '<h2>Relikty – planer</h2><p id="rp-status">Wczytuję…</p>';
      try {
        data = await loadAll((t) => { const s = panel.querySelector('#rp-status'); if (s) s.textContent = t; });
        await applyGroup();
        render();
      } catch (e) {
        panel.innerHTML = `<h2>Relikty – planer</h2><p class="rp-warn">Błąd: ${esc(e.message)}</p><button id="rp-close">Zamknij</button><button id="rp-retry" class="sec">Spróbuj ponownie</button>`;
        panel.querySelector('#rp-close').onclick = () => (panel.style.display = 'none');
        panel.querySelector('#rp-retry').onclick = refresh;
      }
    }

    async function applyGroup() {
      const members = await loadGroupMembers(data, S.group);
      let re = null;
      try { re = S.regex ? new RegExp(S.regex, 'i') : null; } catch (e) { re = null; }
      S.targetIds = new Set();
      data.villages.forEach((v) => {
        if (members && !members.has(v.id)) return;
        if (re && !re.test(v.name)) return;
        if (S.offVill.has(v.id)) return;
        S.targetIds.add(v.id);
      });
    }

    function relicRelevant(r) {
      const src = S.mode === 'rec' ? r.rec : S.mode === 'att' ? r.att : r.def;
      if (S.mode === 'rec') return Object.keys(src).some((b) => S.build[b]);
      return Object.keys(src).length > 0;
    }

    function relicShort(r) {
      return r.statsText.join('; ');
    }

    function render() {
      const vById = new Map(data.villages.map((v) => [v.id, v]));
      const P = buildProblem(S, data);

      const groupOpts = ['<option value="0">wszystkie wioski</option>']
        .concat(data.groups.map((g) => `<option value="${esc(g.id)}"${g.id === S.group ? ' selected' : ''}>${esc(g.name)}</option>`)).join('');
      const flagStock = flagList(data.flags, FLAG_TYPE[S.mode]);
      const flagAssigned = Object.values(data.assignedFlags || {}).filter((a) => a.type === FLAG_TYPE[S.mode]);
      const flagSummary = data.flags
        ? (flagStock.length ? flagStock.length + ' szt.: ' + flagStock.map((f) => '+' + f.pct + '%').join(', ') : 'brak nieprzypisanych flag tego typu')
        : 'nie udało się pobrać flag';
      const eqAll = data.relics.filter((r) => r.villageId);
      const eqLocked = eqAll.filter((r) => r.locked || r.inactive).length;
      const eqCd = eqAll.filter((r) => r.cooldown && !r.locked && !r.inactive).length;
      const modeOpts = Object.keys(MODES).map((m) => `<option value="${m}"${m === S.mode ? ' selected' : ''}>${MODES[m]}</option>`).join('');

      // tabela wiosek docelowych
      const vrows = data.villages
        .map((v, i) => ({ v, i }))
        .filter(({ v }) => {
          // pokaż wioski z grupy/filtra (S.targetIds) oraz ręcznie odznaczone
          return S.targetIds.has(v.id) || S.offVill.has(v.id);
        })
        .sort((a, b) => P.weight[b.i] - P.weight[a.i])
        .map(({ v, i }) => {
          const on = S.targetIds.has(v.id);
          const w = S.mode === 'rec'
            ? `${(v.popMax != null ? v.popMax - v.pop : 0).toLocaleString('pl-PL')} wolne` + (v.popMax != null && v.popMax - v.pop < S.minFree ? ' <span class="rp-warn">(zagroda prawie pełna)</span>' : '')
            : `${Math.round(P.weight[i])}`;
          return `<tr><td><input type="checkbox" data-vid="${v.id}" ${on ? 'checked' : ''}></td>
            <td>${esc(v.name)} <span class="rp-muted">(${v.x}|${v.y})</span></td><td>${w}</td>
            <td><input type="number" step="0.1" min="0" data-prio="${v.id}" value="${S.prio[v.id] != null ? S.prio[v.id] : 1}"></td></tr>`;
        }).join('');

      // relikty
      const relRows = data.relics
        .map((r) => ({ r, rel: relicRelevant(r) }))
        .filter((o) => o.rel || o.r.villageId)
        .sort((a, b) => (b.r.villageId ? 1 : 0) - (a.r.villageId ? 1 : 0) || b.r.range - a.r.range)
        .map(({ r, rel }) => {
          const host = r.villageId ? (vById.get(r.villageId) ? vById.get(r.villageId).name : 'wioska #' + r.villageId) : null;
          const fixed = r.locked || r.inactive || (r.cooldown && !S.ignoreCd);
          let st = host ? `założony: ${esc(host)}` : 'w magazynie';
          if (r.locked || r.inactive) st += ` <span class="rp-warn">(zablokowany: ${esc(r.lockedText)})</span>`;
          else if (r.cooldown) st += ` <span class="${S.ignoreCd ? 'rp-muted' : 'rp-warn'}">(cooldown zdjęcia ${esc(r.cooldown)})</span>`;
          if (!rel) st += ' <span class="rp-muted">– nie dotyczy celu, zdejmę</span>';
          return `<tr><td><input type="checkbox" data-rid="${r.id}" ${!S.offRelic.has(r.id) && !fixed ? 'checked' : ''} ${r.locked || r.inactive ? 'disabled' : ''}></td>
            <td>${esc(r.name)} <span class="rp-muted">r${r.range}</span><br><span class="rp-muted">${esc(relicShort(r))}</span></td><td>${st}</td></tr>`;
        }).join('');

      panel.innerHTML = `
        <div class="rp-row" style="justify-content:space-between"><h2>Relikty – planer rozmieszczenia</h2><button id="rp-close" class="sec" type="button">Zamknij</button></div>
        <div class="rp-muted">Wioski: ${data.villages.length}, relikty: ${data.relics.length}. Dane z chwili otwarcia – <a href="#" id="rp-reload">odśwież</a>.</div>

        ${savedPlanHtml()}
        <h3>1. Cel</h3>
        <div class="rp-row"><label>Cel: <select id="rp-mode">${modeOpts}</select></label>
          <label>Grupa wiosek: <select id="rp-group">${groupOpts}</select></label></div>
        <div class="rp-row"><label>Filtr nazwy (regex): <input type="text" id="rp-regex" value="${esc(S.regex)}" placeholder="np. Taxi|Impreza"></label></div>
        <div class="rp-row">
          <label>Sloty łącznie: <input type="number" id="rp-slots" min="1" max="20" value="${S.slots}"></label>
          <label>Limit bonusu %: <input type="number" id="rp-cap" min="1" max="100" value="${S.cap}"></label>
          <label><input type="checkbox" id="rp-cd" ${S.ignoreCd ? 'checked' : ''}> ignoruj cooldown zdjęcia</label>
        </div>
        ${S.mode === 'rec' ? `<div class="rp-row">
          <label><input type="checkbox" data-b="barracks" ${S.build.barracks ? 'checked' : ''}> koszary</label>
          <label><input type="checkbox" data-b="stable" ${S.build.stable ? 'checked' : ''}> stajnia</label>
          <label><input type="checkbox" data-b="garage" ${S.build.garage ? 'checked' : ''}> warsztat</label>
          <label>Min. wolnej zagrody: <input type="number" id="rp-minfree" min="0" step="100" value="${S.minFree}"></label>
          <label>Pełna waga od: <input type="number" id="rp-freecap" min="1000" step="1000" value="${S.freeCap}"> wolnych miejsc</label>
        </div><div class="rp-muted">Wioska z mniejszą wolną zagrodą dostaje wagę 0 (nie wykorzysta przyspieszenia). Waga rośnie liniowo z liczbą wolnych miejsc (czyli im mniej wojska w wiosce, tym większy priorytet) aż do ${S.freeCap.toLocaleString('pl-PL')}. Wyższy próg = większa przewaga dla wiosek prawie pustych (np. offów po stratach).</div>` : `<div class="rp-muted">Waga wioski = liczba jednostek × ich siła ${S.mode === 'att' ? 'ataku (razem, wraz z jednostkami w drodze)' : 'obrony (w wiosce)'}. Bonus jest liczony osobno dla każdego typu jednostki.</div>`}

        <h3>2. Wioski docelowe (${S.targetIds.size})</h3>
        <details><summary>Pokaż / zmień listę i priorytety</summary>
          <div class="rp-scroll"><table><tr><th></th><th>Wioska</th><th>${S.mode === 'rec' ? 'Zagroda' : 'Siła'}</th><th>Priorytet</th></tr>${vrows}</table></div>
        </details>

        <h3>3. Relikty do użycia</h3>
        <div class="rp-muted">Założone: ${eqAll.length} (zablokowane/zdobyte: ${eqLocked}, z cooldownem zdjęcia: ${eqCd}). Odznaczone relikty zostają na miejscu i zajmują slot.</div>
        <div class="rp-row"><label><input type="checkbox" id="rp-lslot" ${S.lockedSlot ? 'checked' : ''}> zablokowane (zdobyte) relikty zajmują slot</label></div>
        <details><summary>Pokaż / odznacz relikty (odznaczone zostają tam, gdzie są)</summary>
          <div class="rp-scroll"><table><tr><th></th><th>Relikt</th><th>Stan</th></tr>${relRows}</table></div>
        </details>

        <h3>4. Flagi</h3>
        <div class="rp-row"><label><input type="checkbox" id="rp-flags" ${S.useFlags ? 'checked' : ''}> uwzględnij nieprzypisane flagi (${esc(flagSummary)})</label></div>
        <div class="rp-row"><label><input type="checkbox" id="rp-cdchk" ${S.checkCd ? 'checked' : ''}> sprawdź blokady 24 h zmiany flag (1 zapytanie na wioskę) – zablokowane wioski zostają bez zmian</label> <span id="rp-cdstatus" class="rp-muted"></span></div>
        <div class="rp-row"><label><input type="checkbox" id="rp-reflags" ${S.reuseFlags ? 'checked' : ''}> uwzględnij też flagi tego typu już przypisane do wiosek (${flagAssigned.length} szt.${flagAssigned.length ? ': ' + flagAssigned.map((a) => '+' + a.pct + '%').join(', ') : ''}) – przeniosę je</label></div>
        <div class="rp-muted">Flagi działają osobno od reliktów (bez wspólnego limitu), więc trafiają do wiosek o największej wadze. Przeniesienie flagi wymaga jej wycofania (cooldown 24 h).</div>

        <div class="rp-row" style="margin-top:12px"><button id="rp-run" type="button">Policz najlepsze ustawienie</button></div>
        <div class="rp-bar" id="rp-barwrap" style="display:none"><div id="rp-bar"></div></div>
        <div id="rp-result"></div>`;

      bindEvents(P, vById);
    }

    function bindEvents(P, vById) {
      const q = (s) => panel.querySelector(s);
      panel.querySelectorAll('[data-done]').forEach((c) => (c.onchange = () => {
        const pl = loadPlan(); if (!pl) return;
        pl.done[c.dataset.done] = c.checked; savePlan(pl);
      }));
      panel.querySelectorAll('[data-start]').forEach((b) => (b.onclick = () => { const pl = loadPlan(); const n = pl && nextTask(pl, b.dataset.start); if (n) location.href = taskUrl(n); }));
      const au = q('#rp-auto');
      if (au) au.onchange = () => { try { localStorage.setItem(AUTO_KEY, au.checked ? '1' : '0'); } catch (e) { /* ignore */ } };
      const cp = q('#rp-clearplan');
      if (cp) cp.onclick = () => { try { localStorage.removeItem(PLAN_KEY); } catch (e) { /* ignore */ } render(); };
      q('#rp-close').onclick = () => (panel.style.display = 'none');
      q('#rp-reload').onclick = (e) => { e.preventDefault(); data = null; refresh(); };
      q('#rp-mode').onchange = (e) => { S.mode = e.target.value; persist(); render(); };
      q('#rp-group').onchange = async (e) => { S.group = e.target.value; S.offVill = new Set(); persist(); await applyGroup(); render(); };
      q('#rp-regex').onchange = async (e) => { S.regex = e.target.value.trim(); persist(); await applyGroup(); render(); };
      q('#rp-slots').onchange = (e) => { S.slots = Math.max(1, intOf(e.target.value)); persist(); };
      q('#rp-cap').onchange = (e) => { S.cap = Math.max(1, num(e.target.value)); persist(); };
      q('#rp-reflags').onchange = (e) => { S.reuseFlags = e.target.checked; persist(); };
      q('#rp-flags').onchange = (e) => { S.useFlags = e.target.checked; persist(); };
      q('#rp-lslot').onchange = (e) => { S.lockedSlot = e.target.checked; persist(); };
      q('#rp-cd').onchange = (e) => { S.ignoreCd = e.target.checked; persist(); render(); };
      const fc = q('#rp-freecap');
      if (fc) fc.onchange = (e) => { S.freeCap = Math.max(1000, intOf(e.target.value)); persist(); render(); };
      const mf = q('#rp-minfree');
      if (mf) mf.onchange = (e) => { S.minFree = Math.max(0, intOf(e.target.value)); persist(); render(); };
      panel.querySelectorAll('[data-b]').forEach((c) => (c.onchange = () => { S.build[c.dataset.b] = c.checked; persist(); render(); }));
      panel.querySelectorAll('[data-vid]').forEach((c) => (c.onchange = () => {
        const id = +c.dataset.vid;
        if (c.checked) { S.offVill.delete(id); S.targetIds.add(id); } else { S.offVill.add(id); S.targetIds.delete(id); }
        persist();
      }));
      panel.querySelectorAll('[data-prio]').forEach((c) => (c.onchange = () => { S.prio[+c.dataset.prio] = num(c.value); persist(); }));
      panel.querySelectorAll('[data-rid]').forEach((c) => (c.onchange = () => {
        const id = +c.dataset.rid;
        if (c.checked) S.offRelic.delete(id); else S.offRelic.add(id);
        persist();
      }));
      q('#rp-cdchk').onchange = (e) => { S.checkCd = e.target.checked; persist(); };
      q('#rp-run').onclick = async () => {
        if (S.checkCd && (S.useFlags || S.reuseFlags)) {
          const st = q('#rp-cdstatus');
          const vids = P.vills.map((v) => v.id);
          await loadFlagCooldowns(data, vids, (t) => { if (st) st.textContent = t; });
          if (st) st.textContent = '';
        }
        run(vById);
      };
    }

    function run(vById) {
      const P = buildProblem(S, data);
      const out = panel.querySelector('#rp-result');
      const bar = panel.querySelector('#rp-bar');
      panel.querySelector('#rp-barwrap').style.display = 'block';
      out.innerHTML = '';
      if (!S.targetIds.size) { out.innerHTML = '<p class="rp-warn">Brak wiosek docelowych.</p>'; return; }

      // podział reliktów: pula (do ustawienia) / zablokowane na miejscu
      const pool = [], fixed = [], freed = [];
      data.relics.forEach((r) => {
        const isFixed = r.locked || r.inactive || (r.cooldown && !S.ignoreCd);
        const off = S.offRelic.has(r.id);
        if (r.villageId) {
          if (isFixed || off) fixed.push(r);
          else if (relicRelevant(r)) pool.push(r);
          else freed.push(r); // założony, ale nie dotyczy celu – zdejmowany
        } else if (!isFixed && !off && relicRelevant(r)) {
          pool.push(r);
        }
      });
      const fixedHosts = new Set(fixed.map((r) => r.villageId));
      const fixedSlots = fixed.filter((r) => S.lockedSlot || !(r.locked || r.inactive)).length;
      const slotsFree = S.slots - fixedSlots;
      if (slotsFree <= 0 || !pool.length) {
        const cd = fixed.filter((r) => r.cooldown && !r.locked && !r.inactive).length;
        out.innerHTML = `<p class="rp-warn">Brak wolnych slotów lub pasujących reliktów. Pula: ${pool.length}, zajęte sloty przez relikty zostające na miejscu: ${fixedSlots} z ${S.slots} (w tym ${cd} z cooldownem zdjęcia). Zaznacz „ignoruj cooldown zdjęcia”, odznacz niepotrzebne blokady albo zwiększ liczbę slotów.</p>`;
        return;
      }
      // pominięte hosty: wioski z zablokowanymi reliktami; wioski spoza listy ignorujemy
      const hosts = [];
      P.vills.forEach((v, i) => { if (!fixedHosts.has(v.id)) hosts.push(i); });

      const fixedEff = fixed.filter((r) => !r.inactive && !r.locked && P.idxById.has(r.villageId)).map((r) => ({
        vec: P.vecOf(r), range: r.range, host: P.idxById.get(r.villageId),
      }));
      const ev = makeEvaluator(P, S.cap, fixedEff);
      const relics = pool.map((r) => ({ r, range: r.range, vec: P.vecOf(r) }));
      const ctx = { relics, hosts, gain: ev.gain };
      const cdMap = (S.checkCd && data.flagCd) || {};
      const blockedIds = new Set(Object.keys(cdMap).map(Number).filter((id) => cdMap[id] > Date.now()));
      data.blockedFlagIds = blockedIds;
      const blockedVi = new Set(); blockedIds.forEach((id) => { if (P.idxById.has(id)) blockedVi.add(P.idxById.get(id)); });
      const flags = S.useFlags || S.reuseFlags ? flagPool(data, FLAG_TYPE[S.mode], S.reuseFlags).filter((f) => (f.from != null || S.useFlags) && !(f.from != null && blockedIds.has(f.from))) : [];

      // wartość obecnego ustawienia (relikty z puli zostają tam, gdzie są)
      const currentState = [];
      relics.forEach((o, ri) => { if (o.r.villageId && P.idxById.has(o.r.villageId)) currentState.push([ri, P.idxById.get(o.r.villageId)]); });
      const curVal = ev.gain(currentState, relics);

      solve(ctx, slotsFree, (p) => { bar.style.width = p + '%'; }, (res) => {
        panel.querySelector('#rp-barwrap').style.display = 'none';
        showResult(P, ev, relics, res, currentState, curVal, fixed, vById, freed, flags.length ? assignFlags(P, flags, blockedVi) : []);
      });
    }

    function bonusesOf(P, ev, relics, state) {
      const K = P.K;
      const b = new Float64Array(P.N * K);
      b.set(ev.base);
      state.forEach(([ri, h]) => {
        P.nb(h, relics[ri].range).forEach((vi) => { for (let k = 0; k < K; k++) b[vi * K + k] += relics[ri].vec[k]; });
      });
      return b;
    }

    function fmtBonus(P, b, vi) {
      const parts = [];
      for (let k = 0; k < P.K; k++) {
        const raw = b[vi * P.K + k];
        if (raw > 0 && P.coef[vi * P.K + k] > 0) {
          const capped = Math.min(S.cap, raw);
          parts.push(`${esc(P.keys[k].label)} +${Math.round(capped * 10) / 10}%${raw > S.cap ? '*' : ''}`);
        }
      }
      return parts.join(', ') || '<span class="rp-muted">—</span>';
    }

    function showResult(P, ev, relics, res, currentState, curVal, fixed, vById, freed, flagPlan) {
      const out = panel.querySelector('#rp-result');
      const state = res.state.slice().sort((a, b) => relics[b[0]].range - relics[a[0]].range);
      const planned = new Set(state.map((s) => s[0]));

      const gainPct = curVal > 0 ? Math.round((res.value / curVal - 1) * 100) : null;
      let html = `<h3>Wynik</h3>
        <div>Wartość planu: <b>${res.value.toFixed(1)}</b>, obecnie: ${curVal.toFixed(1)}`
        + (gainPct != null ? ` → <span class="${gainPct >= 0 ? 'rp-good' : 'rp-warn'}">${gainPct >= 0 ? '+' : ''}${gainPct}%</span>` : '')
        + `<br><span class="rp-muted">(wartość to suma bonusów ważona wagami wiosek; ma sens tylko do porównań)</span></div>`;

      html += '<table><tr><th>Relikt</th><th>Postaw w wiosce</th><th>Co zrobić</th></tr>';
      state.forEach(([ri, h]) => {
        const o = relics[ri], v = P.vills[h];
        const cur = o.r.villageId;
        let act;
        if (cur === v.id) act = '<span class="rp-muted">zostaje</span>';
        else if (cur) act = `przenieś z ${esc((vById.get(cur) || { name: '#' + cur }).name)}`;
        else act = 'załóż z magazynu';
        html += `<tr><td>${esc(o.r.name)} <span class="rp-muted">r${o.r.range}</span><br><span class="rp-muted">${esc(relicShort(o.r))}</span></td>
          <td><a href="/game.php?village=${v.id}&screen=relic_system" target="_blank">${esc(v.name)}</a><br><span class="rp-muted">(${v.x}|${v.y})</span></td><td>${act}</td></tr>`;
      });
      html += '</table>';

      const toRemove = relics.map((o, ri) => ({ o, ri })).filter(({ o, ri }) => o.r.villageId && !planned.has(ri));
      const removeList = toRemove.map(({ o }) => o.r).concat(freed);
      if (removeList.length) {
        html += '<div><b>Zdejmij najpierw:</b><ul>' + removeList.map((r) =>
          `<li>${esc(r.name)} z ${esc((vById.get(r.villageId) || { name: '#' + r.villageId }).name)}</li>`).join('') + '</ul></div>';
      }
      html += '<div class="rp-muted">Kolejność: najpierw zdejmij niepotrzebne relikty, potem zakładaj nowe. Każde przeniesienie uruchamia cooldown zdjęcia (zwykle 24 h).</div>';

      if (data.blockedFlagIds && data.blockedFlagIds.size) {
        html += '<div class="rp-warn" style="margin-top:6px">⏳ Blokada zmiany flagi (24 h) – te wioski zostają bez zmian: '
          + Array.from(data.blockedFlagIds).map((id) => `${esc((vById.get(id) || { name: '#' + id }).name)} (do ${hhmm(data.flagCd[id])})`).join(', ')
          + '. Po upływie blokady uruchom planer ponownie.</div>';
      }
      if (flagPlan.length) {
        const keptFrom = new Set(flagPlan.filter((x) => x.flag.from === x.vi).map((x) => x.vi));
        html += '<h3>Flagi</h3><table><tr><th>Flaga</th><th>Przydziel w wiosce</th><th>Co zrobić</th></tr>'
          + flagPlan.map((x) => {
            const v = P.vills[x.vi];
            const act = x.flag.from === x.vi ? '<span class="rp-muted">zostaje</span>'
              : x.flag.from ? `przenieś z ${esc((vById.get(x.flag.from) || { name: '#' + x.flag.from }).name)}` : 'załóż z magazynu';
            return `<tr><td>+${x.flag.pct}%${x.flag.level ? ' (poz. ' + x.flag.level + ')' : ''}</td>
            <td><a href="/game.php?village=${v.id}&screen=flags" target="_blank">${esc(v.name)}</a> <span class="rp-muted">(${v.x}|${v.y})</span></td><td>${act}</td></tr>`;
          }).join('')
          + '</table>';
        const planFrom = new Set(flagPlan.map((x) => x.flag.from).filter(Boolean));
        const toWithdraw = Object.keys(data.assignedFlags || {}).map(Number).filter((vid) => {
          const a = data.assignedFlags[vid];
          return a.type === FLAG_TYPE[S.mode] && S.reuseFlags && !keptFrom.has(vid) && !(data.blockedFlagIds && data.blockedFlagIds.has(vid));
        });
        if (toWithdraw.length) {
          html += '<div><b>Wycofaj flagi:</b> ' + toWithdraw.map((vid) =>
            `${esc((vById.get(vid) || { name: '#' + vid }).name)} (+${data.assignedFlags[vid].pct}%)`).join(', ') + '</div>';
        }
      }
      // zapisz plan do podpowiedzi na stronach flag / reliktów
      {
        const plan = { created: Date.now(), mode: S.mode, flagType: FLAG_TYPE[S.mode], tasks: {}, names: {}, done: {} };
        const T = (vid) => (plan.tasks[vid] = plan.tasks[vid] || {});
        const nameOf = (vid) => (vById.get(vid) || { name: '#' + vid }).name;
        state.forEach(([ri, h]) => {
          const o = relics[ri], v = P.vills[h], cur = o.r.villageId;
          const label = o.r.name + ' (r' + o.r.range + ')';
          if (cur === v.id) T(v.id).relicKeep = label;
          else { T(v.id).relicPlace = label; if (cur) T(cur).relicRemove = label; }
        });
        removeList.forEach((r) => { T(r.villageId).relicRemove = r.name + ' (r' + r.range + ')'; });
        flagPlan.forEach((x) => {
          const t = T(P.vills[x.vi].id);
          if (x.flag.from === x.vi) t.flagKeep = x.flag.pct; else t.flagPlace = x.flag.pct;
        });
        const keptFlag = new Set(flagPlan.filter((x) => x.flag.from === x.vi).map((x) => x.vi));
        if (S.reuseFlags) {
          Object.keys(data.assignedFlags || {}).map(Number).forEach((vid) => {
            const a = data.assignedFlags[vid];
            if (a.type === FLAG_TYPE[S.mode] && !keptFlag.has(vid) && !(data.blockedFlagIds && data.blockedFlagIds.has(vid))) T(vid).flagRemove = a.pct;
          });
        }
        Object.keys(plan.tasks).forEach((id) => { plan.names[id] = nameOf(+id); });
        savePlan(plan);
      }
      // efekt per wioska
      const before = bonusesOf(P, ev, relics, currentState);
      const after = bonusesOf(P, ev, relics, res.state);
      const flagAt = new Map(flagPlan.map((x) => [x.vi, x.flag.pct]));
      const rows = P.vills.map((v, i) => ({ v, i })).filter(({ v, i }) => P.targets[i] && P.weight[i] > 0)
        .sort((a, b) => P.weight[b.i] - P.weight[a.i]);
      html += '<h3>Efekt w wioskach docelowych</h3><div class="rp-scroll" style="max-height:340px"><table><tr><th>Wioska</th><th>Teraz</th><th>Po zmianie</th></tr>'
        + rows.map(({ v, i }) => `<tr><td>${esc(v.name)}</td><td>${fmtBonus(P, before, i)}</td><td>${fmtBonus(P, after, i)}${flagAt.has(i) ? ` <b>+ flaga ${flagAt.get(i)}%</b>` : ''}</td></tr>`).join('')
        + '</table></div><div class="rp-muted">* = bonus przekracza limit ' + S.cap + '%, nadwyżka się marnuje.</div>';

      const covered = rows.filter(({ i }) => {
        for (let k = 0; k < P.K; k++) if (after[i * P.K + k] > 0 && P.coef[i * P.K + k] > 0) return true;
        return false;
      }).length;
      html += `<div style="margin-top:6px">Wioski docelowe z jakimkolwiek bonusem: <b>${covered}</b> z ${rows.length}.</div>`;

      out.innerHTML = html;
      if (out.scrollIntoView) out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // eksport funkcji do testów (poza przeglądarką)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseAssignedFlags, flagPool, assignFlags, parseFlags, flagList, villageFromCell, parseStat, relicFromRaw, extractInventory, parseProd, parseUnits, parseGroups, buildProblem, makeEvaluator, solve, UNITS };
    return;
  }

  const boot = () => { init(); try { pageHints(); } catch (e) { /* ignore */ } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
