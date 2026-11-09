// ==UserScript==
// @name         Plemiona – Obstawy + Stałki (masowe wsparcie)
// @namespace    dawid.plemiona.obstawy2
// @version      2.5
// @description  Hybryda Stałek TAXI i Hermitowskich Obstaw. Na wątku obstawy: cel i „pozostało” z forum, paczki (50 pik + 50 łuk / 25 CK), zaznaczasz wioski i jednym kliknięciem wysyłasz masowe wsparcie, potem „wysłane/pozostało” w odpowiedź. Poza forum: panel jak Hermitowskie (grupa, strategia, rezerwa, okno dotarcia, wyjście od, rozdział na prędkości).
// @match        https://*.plemiona.pl/game.php*
// @match        https://*.tribalwars.net/game.php*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * ZASTĘPUJE: „Stałki TAXI” i „Obstawy (masowe wsparcie)” – wyłącz je w Tampermonkey.
 * Licznik wysłanych paczek jest ten sam co w Stałkach (nic nie ginie).
 * Wymaga konta premium (przegląd wojsk).
 *
 * Paczka: 50 pik + 50 łuków  albo  25 CK (zmienisz w ⚙).
 * Tryby ilości:  „paczki” – liczba paczek;  „deff” – punkty deffa jak u Hermitowskiego (pik/łuk 1, CK 6).
 * Podział:  „po równo” (Hermitowski – małe wioski dają wszystko, duże dokładają)
 *           „po kolei” (Stałki – bierze z kolejnych wiosek do pełna wg strategii).
 * Wyniki: checkbox przy wiosce, liczby paczek/jednostek możesz poprawić ręcznie.
 * „Wyślij zaznaczone” = masowe wsparcie z zaznaczonych wiosek (przy „Rozdziel” osobny rozkaz
 * na każdą grupę prędkości: piki+łuki / CK+zwiad / miecze). „Plac →” = pojedyncza wysyłka przez plac.
 * „Wyjście od”: przycisk wysyłki odblokowuje się dopiero o tej godzinie (np. dioda po przejęciu).
 * „Wejście o” (ROZPISKA): wszystko ma wejść o podanej godzinie – skrypt liczy, o której wysłać
 *   z każdej wioski (osobno P+Ł i CK), wiersze z odliczaniem, „Plac →” otwiera plac z wpisanym wojskiem.
 *   „Okno min” > 0: wioski łączą się w PARTIE – jedna partia = jedno kliknięcie masowego wsparcia,
 *   wszystko z partii wchodzi między „Wejście o” a „Wejście o” + okno. Przycisk partii odblokowuje się o jej godzinie.
 */
(function () {
  'use strict';
  if (typeof game_data === 'undefined') return;

  // ======================================================================
  //  STAŁE I POMOCNICZE
  // ======================================================================
  const NS = 'obstawy2_' + game_data.world;
  const ST = 'stalki_v1_';                         // wspólne ze Stałkami TAXI
  const DEFF = ['spear', 'sword', 'archer', 'spy', 'heavy', 'knight'].filter(u => game_data.units.includes(u));
  const HAS_KNIGHT = DEFF.includes('knight');
  const NOT_DEFF = new Set(['spy', 'knight']);          // nie liczą się do punktów deffa ani paczek
  const HAS_ARCHER = DEFF.includes('archer');
  const SPEED_GROUPS = [['spear', 'archer', 'knight'], ['heavy', 'spy'], ['sword']].map(g => g.filter(u => DEFF.includes(u))).filter(g => g.length);
  const GROUP_NAME = { spear: 'piki+łuki', heavy: 'CK+zwiad', sword: 'miecze' };
  const GROUP_SHORT = { spear: 'P+Ł', heavy: 'CK', sword: 'Miecz' };
  // podpis rozkazu wg tego, co w nim faktycznie idzie
  const groupLabel = (g, units) => {
    const us = g.filter(u => (units[u] || 0) > 0);
    if (us.length && us.every(u => u === 'knight')) return 'Rycerz';
    return (GROUP_SHORT[g[0]] || '') + (us.includes('knight') ? '+Ryc' : '');
  };
  const LABEL = { spear: 'Pikinier', sword: 'Miecznik', archer: 'Łucznik', spy: 'Zwiadowca', heavy: 'Ciężka kawaleria', knight: 'Rycerz' };
  const STRATEGY = { DIST_ASC: 'Odległość rosnąco', DIST_DESC: 'Odległość malejąco', TROOP_DESC: 'Ilość wojsk malejąco', TROOP_ASC: 'Ilość wojsk rosnąco', RANDOM: 'Losowo' };
  const DEFAULTS = {
    packSA: 50, packCK: 25,
    ratio: { spear: 1, sword: 1, archer: 1, heavy: 6 },
    safeguard: { spear: 0, sword: 0, archer: 0, spy: 0, heavy: 0 },
    input: {
      mode: 'packs', amount: 20, spy_count: 0, village_count: 0, minimal: 0, strategy: 'DIST_ASC', fill: 'even', prio: 'sa', useCK: true, knights: 'off', knights_max: 0,
      group: '-1', split: true, maxH: 0, land_on: false, land: '', win: 10, depart_on: false, depart: '', before_on: false, before: '', after_on: false, after: '',
    },
  };
  const PENDING_TTL = 30 * 60e3;
  const Q = new URLSearchParams(location.search);
  const base = game_data.link_base_pure;
  const villageUrl = (id, rest) => base.replace(/village=\d+/, 'village=' + id) + rest;

  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const lsDel = k => { try { localStorage.removeItem(k); } catch (e) { } };
  const num = s => parseInt(String(s == null ? '' : s).replace(/\D/g, ''), 10) || 0;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const clock = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const dayClock = t => { const d = new Date(t), n = new Date(now()); return (d.getDate() !== n.getDate() ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ` : '') + clock(t); };
  const hms = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 3600) + ':' + pad(Math.floor(s % 3600 / 60)) + ':' + pad(s % 60); };
  const beautify = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K' : String(Math.round(n));
  const parse = html => new DOMParser().parseFromString(html, 'text/html');
  const fire = el => ['input', 'change', 'keyup'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
  const msg = (t, err, ms) => { if (window.UI) UI[err ? 'ErrorMessage' : 'SuccessMessage'](t, ms || 4000); else alert(t); };

  const settings = (() => {
    const s = lsGet(NS, {});
    return {
      packSA: s.packSA || DEFAULTS.packSA, packCK: s.packCK || DEFAULTS.packCK,
      ratio: { ...DEFAULTS.ratio, ...(s.ratio || {}) }, safeguard: { ...DEFAULTS.safeguard, ...(s.safeguard || {}) }, input: { ...DEFAULTS.input, ...(s.input || {}) },
    };
  })();
  const saveSettings = () => lsSet(NS, settings);

  // licznik paczek – wspólny ze Stałkami
  const keyOf = (x, y) => `k${x}_${y}`;
  const sentGet = (x, y) => lsGet(ST + 'sent_' + keyOf(x, y), 0);
  const sentAdd = (x, y, n) => { const v = sentGet(x, y) + n; lsSet(ST + 'sent_' + keyOf(x, y), v); return v; };
  const sentSet = (x, y, v) => lsSet(ST + 'sent_' + keyOf(x, y), v);

  // paczki z jednostek
  const packsOf = u => ({
    sa: Math.floor((HAS_ARCHER ? Math.min(u.spear || 0, u.archer || 0) : (u.spear || 0)) / settings.packSA),
    ck: Math.floor((u.heavy || 0) / settings.packCK),
  });

  // czas serwera
  function serverOffset() {
    const d = (document.querySelector('#serverDate')?.textContent || '').trim().split('/').map(Number);
    const t = (document.querySelector('#serverTime')?.textContent || '').trim().split(':').map(Number);
    if (d.length < 3 || t.length < 3) return 0;
    return new Date(d[2], d[1] - 1, d[0], t[0], t[1], t[2]).getTime() - Date.now();
  }
  const now = () => Date.now() + serverOffset();

  // „02:00:03”, „jutro 7:00”, „12.10 02:00:03”, „12.10.2026 2:00”
  function parseWhen(str, label) {
    let s = String(str).trim().toLowerCase();
    const n = new Date(now());
    let y = n.getFullYear(), mo = n.getMonth(), d = n.getDate(), hasDate = false;
    const m = s.match(/^(jutro|dzisiaj|dziś|(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?)\s+/);
    if (m) {
      hasDate = true;
      if (m[1] === 'jutro') d += 1;
      else if (m[2]) { d = +m[2]; mo = +m[3] - 1; if (m[4]) { y = +m[4]; if (y < 100) y += 2000; } }
      s = s.slice(m[0].length);
    }
    const t = s.match(/^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?$/);
    if (!t) throw `Pole „${label}” ma zły format (np. 02:00:03, jutro 7:00, 12.10 02:00:03).`;
    let ts = new Date(y, mo, d, +t[1], +(t[2] || 0), +(t[3] || 0)).getTime();
    if (!hasDate && ts < now() - 60e3) ts += 864e5;
    return ts;
  }

  // ======================================================================
  //  DANE
  // ======================================================================
  const cache = { groups: null, villages: new Map(), speeds: null, world: null };

  async function loadGroups() {
    if (cache.groups) return cache.groups;
    const res = await $.get(base + 'groups&mode=overview&ajax=load_group_menu');
    const data = typeof res === 'string' ? JSON.parse(res) : res;
    return (cache.groups = (data.result || []).filter(g => g.type !== 'separator').map(g => ({ id: String(g.group_id), name: g.name })));
  }

  async function unitSpeeds() {
    if (cache.speeds) return cache.speeds;
    const res = await $.get('/interface.php?func=get_unit_info');
    const doc = typeof res === 'string' ? new DOMParser().parseFromString(res, 'text/xml') : res;
    const s = {};
    [...(doc.documentElement?.children || [])].forEach(el => { const v = parseFloat(el.querySelector('speed')?.textContent); if (v) s[el.tagName] = v; });
    if (!s.spear) throw new Error('Nie udało się odczytać prędkości jednostek.');
    if (HAS_KNIGHT && !s.knight) s.knight = 10;
    return (cache.speeds = s);
  }

  async function worldVillage(x, y) {
    if (!cache.world) {
      const txt = await $.get('/map/village.txt');
      cache.world = new Map();
      txt.trim().split('\n').forEach(l => { const a = l.split(','); cache.world.set(a[2] + '|' + a[3], { id: +a[0], owner: +a[4] }); });
    }
    return cache.world.get(x + '|' + y) || null;
  }

  // Przegląd > Wojska > Własne w domu
  async function loadVillages(group) {
    if (cache.villages.has(group)) return cache.villages.get(group);
    const doc = parse(await $.get(base + 'overview_villages&mode=units&type=own_home&page=-1' + (group !== '-1' ? '&group=' + group : '')));
    const table = doc.querySelector('#units_table');
    if (!table) throw 'Nie znalazłem przeglądu wojsk (wymagane konto premium).';
    const headRow = [...table.querySelectorAll('tr')].find(tr => tr.querySelector('img[src*="unit_"]'));
    const headCells = headRow ? [...headRow.children] : [];
    const cols = {};
    headCells.forEach((c, i) => { const m = (c.querySelector('img[src*="unit_"]')?.getAttribute('src') || '').match(/unit_([a-z]+)/); if (m && !(m[1] in cols)) cols[m[1]] = i; });
    const out = [], seen = new Set();
    table.querySelectorAll('tr').forEach(tr => {
      const span = tr.querySelector('span.quickedit-vn');
      const link = tr.querySelector('a[href*="village="]');
      let id = span ? +span.dataset.id : 0;
      if (!id && link) { const m = link.href.match(/village=(\d+)/); if (m) id = +m[1]; }
      if (!id || seen.has(id)) return;
      const cm = [...tr.textContent.matchAll(/\((\d{1,3})\|(\d{1,3})\)/g)].pop();
      if (!cm) return;
      seen.add(id);
      const cells = [...tr.children];
      const off = cells.length - headCells.length;
      const u = {};
      for (const [k, i] of Object.entries(cols)) u[k] = num(cells[i + off]?.textContent);
      const name = ((span || link)?.textContent.trim() || String(id)).replace(/\s*\(\d{1,3}\|\d{1,3}\)\s*K\d+\s*$/, '');
      out.push({ id, name, x: +cm[1], y: +cm[2], u });
    });
    if (!out.length) throw 'Wybrana grupa nie posiada wiosek.';
    cache.villages.set(group, out);
    return out;
  }

  // ======================================================================
  //  FORUM: odczyt wątku (jak w Stałkach)
  // ======================================================================
  function parseThread() {
    const posts = [...document.querySelectorAll('div.post')].map(p => (p.querySelector('.text') || p).innerText.trim());
    let coords = null;
    const heads = [...document.querySelectorAll('h1,h2,h3,.forum-thread-title')].map(h => h.innerText);
    for (const t of [...heads, ...posts]) {
      const m = t.match(/(\d{3})\|(\d{3})/);
      if (m) { coords = { x: +m[1], y: +m[2] }; break; }
    }
    let need = null;
    const first = posts.find(t => /\d{3}\|\d{3}/.test(t));
    if (first) {
      const nums = first.replace(/\(?\d{3}\|\d{3}\)?/g, ' ').replace(/K\d{2}/gi, ' ').match(/\d+/g);
      if (nums) need = +nums[nums.length - 1];
    }
    let remaining = need, lastReply = null;
    posts.forEach(t => {
      const all = [...t.matchAll(/(?:^|\s)(\d{1,4})\s*\/\s*(\d{1,5})(?=\s|$)/g)];
      if (all.length) { const m = all[all.length - 1]; remaining = +m[2]; lastReply = `${m[1]}/${m[2]}`; }
    });
    return { coords, need, remaining, lastReply };
  }

  function fillReply(txt, x, y) {
    const ta = document.querySelector('textarea[name="message"], #message, form textarea');
    if (!ta) return false;
    ta.value = txt; ta.focus(); fire(ta);
    if (ta.form && !ta.form.dataset.ob2) {
      ta.form.dataset.ob2 = 1;
      ta.form.addEventListener('submit', () => sentSet(x, y, 0));
    }
    ta.scrollIntoView({ block: 'center' });
    msg(`Wpisano ${txt} – kliknij „Wyślij”.`);
    return true;
  }

  // ======================================================================
  //  PLAC: pojedyncza wysyłka („Plac →”) – zgodne ze Stałkami
  // ======================================================================
  function getPending() {
    const p = lsGet(ST + 'pending_' + game_data.village.id, null);
    if (!p) return null;
    const exp = p.sendAt ? Math.max(p.ts + PENDING_TTL, p.sendAt - serverOffset() + PENDING_TTL) : p.ts + PENDING_TTL;   // rozpiska: ważne do godziny wysyłki + 30 min
    if (Date.now() > exp) { lsDel(ST + 'pending_' + game_data.village.id); return null; }
    return p;
  }
  function placePage() {
    const p = getPending();
    if (!p) return;
    if (Q.get('stalka') === '1') {
      Object.entries(p.units).forEach(([u, n]) => { const el = document.getElementById('unit_input_' + u); if (el) { el.value = n || ''; fire(el); } });
      const tgtIn = document.querySelector('#place_target input, input.target-input-field');
      if (tgtIn && !tgtIn.value) { tgtIn.value = `${p.tx}|${p.ty}`; fire(tgtIn); }
      const sup = document.getElementById('target_support');
      if (sup) { sup.style.outline = '3px solid #2a8a2a'; sup.focus(); }
      const bar = document.createElement('div');
      bar.style.cssText = 'background:#d6f0c9;border:2px solid #2a8a2a;padding:6px;margin:6px 0;font-weight:bold';
      bar.textContent = `🚕 Obstawa: ${p.packs} paczek → ${p.tx}|${p.ty}. Sprawdź i kliknij POMOC.`;
      (document.querySelector('#command-data-form') || document.querySelector('#content_value') || document.body).prepend(bar);
      if (p.sendAt) {   // rozpiska: odliczanie do godziny wysyłki
        const paint = () => {
          const left = (p.sendAt - now()) / 1000;
          bar.textContent = `🚕 Rozpiska: ${p.packs} paczek → ${p.tx}|${p.ty}, wejście ${clock(p.land)}. `
            + (left > 1 ? `Wyślij o ${clock(p.sendAt)} – za ${hms(left)}.` : left > -2 ? 'WYSYŁAJ TERAZ – kliknij POMOC!' : `SPÓŹNIONE o ${hms(-left)} – wejdzie później niż ${clock(p.land)}.`);
          bar.style.background = left > 60 ? '#f4e4bc' : left > 1 ? '#ffe08a' : left > -2 ? '#7fd36a' : '#f2a0a0';
        };
        paint(); setInterval(paint, 250);
      }
    }
    const obs = new MutationObserver(() => { if (hookConfirm()) obs.disconnect(); });
    obs.observe(document.body, { childList: true, subtree: true });
  }
  function hookConfirm() {
    const p = getPending();
    if (!p) return false;
    const btn = document.querySelector('#troop_confirm_submit, #troop_confirm_go');
    if (!btn || btn.dataset.ob2) return false;
    btn.dataset.ob2 = '1';
    const scope = btn.closest('form') || document.body;
    if (!scope.innerText.includes(`${p.tx}|${p.ty}`)) return true;
    btn.addEventListener('click', () => { sentAdd(p.tx, p.ty, p.packs); lsDel(ST + 'pending_' + game_data.village.id); }, { once: true });
    return true;
  }

  // ======================================================================
  //  PANEL
  // ======================================================================
  const ID = s => 'ob2-' + s;
  const $c = s => document.getElementById(ID(s));
  let rows = [], plan = null, timer = null, forumInfo = null;

  function defaultTarget() {
    if (forumInfo?.coords) return forumInfo.coords.x + '|' + forumInfo.coords.y;
    if (forumInfo) return '';
    if (game_data.screen === 'info_village') {
      const td = [...document.querySelectorAll('#content_value td')].find(t => /^\s*Współrzędne:?\s*$/i.test(t.textContent));
      const m = (td?.nextElementSibling?.textContent || '').match(/(\d{1,3})\|(\d{1,3})/)
        || (document.querySelector('#content_value')?.textContent || '').match(/(\d{1,3})\|(\d{1,3})/);
      if (m) return m[1] + '|' + m[2];
    }
    return game_data.village.x + '|' + game_data.village.y;
  }
  const curTarget = () => { const m = ($c('target')?.value || '').match(/(\d{1,3})\|(\d{1,3})/); return m ? { x: +m[1], y: +m[2] } : null; };

  const CSS = `
    #${ID('panel')}{border:2px solid #7d510f;background:#f4e4bc;padding:6px;margin:6px 0;font-size:12px}
    #${ID('panel')} .f{display:inline-block;vertical-align:top;margin:2px 6px 2px 0}
    #${ID('panel')} .f>span{display:block;font-weight:bold;font-size:11px}
    #${ID('panel')} table.res{width:100%;border-collapse:collapse}
    #${ID('panel')} table.res td,#${ID('panel')} table.res th{border:1px solid #c1a264;padding:1px 3px;text-align:center}
    #${ID('panel')} table.res th{background:#c1a264}
    #${ID('panel')} tr.sent{background:#c8e6b8;opacity:.55}
    #${ID('panel')} tr.off{opacity:.45}
    #${ID('panel')} input.n{width:52px}
  `;

  async function buildPanel(where) {
    const I = settings.input;
    const f = (label, html, title) => `<label class="f" ${title ? `title="${esc(title)}"` : ''}><span>${label}</span>${html}</label>`;
    const tm = (k, ph) => `<input type="checkbox" id="${ID(k + '_on')}" ${I[k + '_on'] ? 'checked' : ''}><input id="${ID(k)}" size="11" placeholder="${ph}" value="${esc(I[k])}">`;
    const unitRow = (branch, title) => `<tr><td><b>${title}</b></td>${DEFF.map(u => ((branch === 'ratio' && u === 'spy') || u === 'knight') ? '<td>–</td>'
      : `<td><input id="${ID(branch + '-' + u)}" size="4" value="${settings[branch][u] ?? 0}"></td>`).join('')}</tr>`;

    const fi = forumInfo;
    const div = document.createElement('div');
    div.id = ID('panel');
    div.innerHTML = `<style>${CSS}</style>
      <b style="font-size:13px">🚕 Obstawy + Stałki</b>
      ${fi ? `&nbsp; Potrzeba: <b>${fi.need ?? '?'}</b> &nbsp; Pozostało (z forum): <input id="${ID('rem')}" size="4" value="${fi.remaining ?? ''}">
        ${fi.lastReply ? `<span style="color:#666">(ostatni wpis ${fi.lastReply})</span>` : ''}
        ${window.Forum && Forum.is_last_page === false ? '<b style="color:#b00"> ⚠ to nie ostatnia strona wątku – „pozostało” może być nieaktualne</b>' : ''}` : ''}
      <span style="float:right"><img id="${ID('settings')}" src="${image_base}icons/settings.png" style="cursor:pointer" title="Paczki, przeliczniki, rezerwa">
        ${fi ? '' : `<a href="#" id="${ID('close')}" style="margin-left:6px;font-weight:bold">✖</a>`}</span>
      <div style="margin-top:4px">
        ${f('Cel', `<input id="${ID('target')}" size="8" value="${esc(defaultTarget())}">`)}
        ${f('Grupa', `<select id="${ID('group')}"><option value="-1">Obecna grupa</option></select>`)}
        ${f('Tryb', `<select id="${ID('mode')}"><option value="packs">paczki</option><option value="deff">deff (pkt)</option></select>`)}
        ${f('<span id="' + ID('amount-label') + '">Ilość</span>', `<input id="${ID('amount')}" size="6" value="${I.amount}">`)}
        ${f('Zwiad', `<input id="${ID('spy_count')}" size="4" value="${I.spy_count}">`, 'Ile zwiadowców łącznie')}
        ${f('Wiosek', `<input id="${ID('village_count')}" size="3" value="${I.village_count}">`, '0 = bez limitu')}
        ${f('Min. z wioski', `<input id="${ID('minimal')}" size="4" value="${I.minimal}">`, 'Minimum paczek (lub deffa) w wiosce, żeby ją brać')}
        ${f('Strategia', `<select id="${ID('strategy')}">${Object.entries(STRATEGY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`)}
        ${f('Podział', `<select id="${ID('fill')}"><option value="even">po równo</option><option value="seq">po kolei</option></select>`, 'po równo = Hermitowski, po kolei = Stałki (pełne wioski wg strategii)')}
        ${f('Najpierw', `<select id="${ID('prio')}"><option value="sa">piki+łuki</option><option value="ck">CK</option></select>`)}
        ${f('CK', `<input type="checkbox" id="${ID('useCK')}" ${I.useCK ? 'checked' : ''}> używaj`)}
        ${HAS_KNIGHT ? f('Rycerze', `<select id="${ID('knights')}"><option value="off">nie wysyłaj</option><option value="with">z wojskiem</option><option value="only">same rycerze</option></select>
          <input id="${ID('knights_max')}" size="2" value="${I.knights_max || 0}" title="Ilu rycerzy maks. (0 = wszyscy)">`,
          '„z wojskiem” – rycerz idzie razem z wysyłanym defem z tej wioski; „same rycerze” – wysyła tylko rycerzy (pole obok: ilu maks., 0 = wszyscy)') : ''}
        ${f('Max czas h', `<input id="${ID('maxH')}" size="3" value="${I.maxH}">`, '0 = bez limitu')}
        ${f('Wejście o', tm('land', '13:20:00'), 'ROZPISKA: wszystko wchodzi od tej godziny – policzy, o której wysłać z każdej wioski')}
        ${f('Okno min', `<input id="${ID('win')}" size="3" value="${I.win ?? 10}">`, 'Rozpiska: ile minut po „Wejście o” może jeszcze wejść. Im większe okno, tym mniej partii (kliknięć masowego wsparcia).')}
        ${f('Wyjście od', tm('depart', '02:00:03'), 'Licz dotarcie od tej godziny i zablokuj wysyłkę do niej')}
        ${f('Dotarcie przed', tm('before', 'jutro 7:00'))}
        ${f('Dotarcie po', tm('after', '23:00'))}
        ${f('Rozdziel', `<input type="checkbox" id="${ID('split')}" ${I.split ? 'checked' : ''}> wg prędkości`, 'Osobny rozkaz dla pik+łuków, CK+zwiadu, mieczy')}
        <label class="f"><span>&nbsp;</span><button type="button" class="btn" id="${ID('generate')}">Generuj</button></label>
      </div>
      <div id="${ID('settings-box')}" style="display:none;margin:4px 0;padding:4px;border:1px dashed #7d510f">
        1 paczka = <input id="${ID('packSA')}" size="3" value="${settings.packSA}"> pik + tyle samo łuków &nbsp; albo &nbsp;
        <input id="${ID('packCK')}" size="3" value="${settings.packCK}"> CK
        <table class="vis" style="margin-top:4px"><tr><th></th>${DEFF.map(u => `<th><img src="${image_base}unit/unit_${u}.png" title="${LABEL[u]}"></th>`).join('')}</tr>
          ${unitRow('ratio', 'Przelicznik (deff)')}${unitRow('safeguard', 'Rezerwa (zostaje)')}</table>
      </div>
      <div id="${ID('summary')}" style="margin:4px 0"></div>
      <div id="${ID('out')}" style="max-height:360px;overflow-y:auto"></div>
      <div style="margin-top:4px">
        <button type="button" class="btn" id="${ID('send')}" style="font-weight:bold" disabled>Wyślij zaznaczone</button>
        <span id="${ID('status')}" style="font-style:italic;margin-left:6px"></span>
      </div>
      <hr style="margin:6px 0">
      Wysłane na <b id="${ID('cnt-target')}"></b> (jeszcze niezgłoszone): <b id="${ID('cnt')}">0</b> paczek
      ${fi ? `&nbsp; <button type="button" class="btn" id="${ID('fill-reply')}">Wpisz do odpowiedzi</button>` : ''}
      <button type="button" class="btn" id="${ID('reset')}">Wyzeruj licznik</button>`;

    where(div);
    div.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); });

    $c('mode').value = I.mode;
    $c('strategy').value = I.strategy;
    $c('fill').value = I.fill;
    $c('prio').value = I.prio;
    if ($c('knights')) $c('knights').value = I.knights || 'off';
    $c('settings').addEventListener('click', () => { const b = $c('settings-box'); b.style.display = b.style.display === 'none' ? '' : 'none'; });
    $c('close')?.addEventListener('click', e => { e.preventDefault(); togglePanel(); });
    const syncMode = () => {
      $c('amount-label').textContent = $c('mode').value === 'packs' ? 'Paczek' : 'Deffa (pkt)';
      if (fi && $c('mode').value === 'packs') { const t = curTarget(); $c('amount').value = Math.max(0, (+$c('rem').value || 0) - (t ? sentGet(t.x, t.y) : 0)); }
    };
    $c('mode').addEventListener('change', syncMode);
    $c('rem')?.addEventListener('input', syncMode);
    if (fi) { $c('mode').value = 'packs'; syncMode(); }
    else $c('amount-label').textContent = I.mode === 'packs' ? 'Paczek' : 'Deffa (pkt)';

    $c('generate').addEventListener('click', async () => {
      const b = $c('generate'); b.disabled = true;
      try { await generate(); } catch (e) { handleError(e); } finally { b.disabled = false; }
    });
    $c('send').addEventListener('click', () => sendSelected().catch(handleError));
    $c('target').addEventListener('input', refreshCounter);
    $c('reset').addEventListener('click', () => {
      const t = curTarget(); if (!t) return;
      if (confirm(`Wyzerować licznik paczek dla ${t.x}|${t.y}?`)) { sentSet(t.x, t.y, 0); refreshCounter(); }
    });
    $c('fill-reply')?.addEventListener('click', () => {
      const t = curTarget(); if (!t) return;
      const sent = sentGet(t.x, t.y);
      const rem = +$c('rem').value || 0;
      if (!sent) return msg('Nic nie zostało jeszcze wysłane.', true);
      const txt = `${sent}/${Math.max(0, rem - sent)}`;
      if (fillReply(txt, t.x, t.y)) return;
      const ans = document.querySelector('a.thread_button[href*="answer=true"], a[href*="answer=true"]');
      if (!ans) { navigator.clipboard?.writeText(txt); return msg(`Skopiowano do schowka: ${txt}`, true); }
      lsSet(ST + 'reply_pending', { txt, key: keyOf(t.x, t.y), x: t.x, y: t.y, ts: Date.now() });
      location.href = ans.getAttribute('href');
    });
    window.addEventListener('focus', refreshCounter);
    refreshCounter();

    try {
      const groups = await loadGroups();
      const sel = $c('group');
      groups.forEach(g => { const o = document.createElement('option'); o.value = g.id; o.textContent = g.name; sel.append(o); });
      sel.value = groups.some(g => g.id === I.group) ? I.group : '-1';
    } catch (e) { /* zostaje obecna grupa */ }
  }

  function refreshCounter() {
    const t = curTarget();
    if (!$c('cnt')) return;
    $c('cnt-target').textContent = t ? `${t.x}|${t.y}` : '?';
    $c('cnt').textContent = t ? sentGet(t.x, t.y) : 0;
  }
  const status = t => { const el = $c('status'); if (el) el.textContent = t; };
  function handleError(e) {
    if (typeof e === 'string') { msg(e, true, 6000); status(e); return; }
    console.error(e);
    msg('Obstawy: ' + (e.message || e), true, 6000);
  }

  function togglePanel() {
    const p = $c('panel');
    if (p && forumInfo) { p.scrollIntoView({ block: 'start' }); return; }
    if (p) { clearInterval(timer); p.remove(); return; }
    buildPanel(div => {
      const cc = document.querySelector('#contentContainer');
      if (cc) cc.parentNode.insertBefore(div, cc);
      else (document.querySelector('#content_value') || document.body).prepend(div);
    }).catch(handleError);
  }

  // ======================================================================
  //  PLANOWANIE
  // ======================================================================
  function readInput() {
    const nonNeg = (k, label) => {
      const v = $c(k).value.trim();
      if (v === '' || isNaN(+v) || +v < 0) { $c(k).focus(); throw `Pole „${label}” musi być liczbą ≥ 0.`; }
      return +v;
    };
    const t = curTarget();
    if (!t) { $c('target').focus(); throw 'Pole „Cel” ma zły format (xxx|yyy).'; }
    const inp = {
      tx: t.x, ty: t.y, group: $c('group').value, mode: $c('mode').value,
      amount: nonNeg('amount', 'Ilość'), spy_count: nonNeg('spy_count', 'Zwiad'), village_count: nonNeg('village_count', 'Wiosek'),
      minimal: nonNeg('minimal', 'Min. z wioski'), maxH: nonNeg('maxH', 'Max czas h'), win: nonNeg('win', 'Okno min'),
      strategy: $c('strategy').value, fill: $c('fill').value, prio: $c('prio').value, useCK: $c('useCK').checked, split: $c('split').checked,
      knights: $c('knights')?.value || 'off', knights_max: $c('knights_max') ? nonNeg('knights_max', 'Rycerze maks.') : 0,
    };
    const names = { land: 'Wejście o', depart: 'Wyjście od', before: 'Dotarcie przed', after: 'Dotarcie po' };
    for (const k of Object.keys(names)) {
      inp[k + '_on'] = $c(k + '_on').checked;
      inp[k + '_raw'] = $c(k).value;
      inp[k] = inp[k + '_on'] ? parseWhen($c(k).value, names[k]) : null;
    }
    if (inp.before != null && inp.before <= now()) throw 'Data „Dotarcie przed” jest w przeszłości.';
    if (inp.land != null && inp.land <= now() + 60e3) throw 'Godzina „Wejście o” musi być w przyszłości.';
    const pSA = parseInt($c('packSA').value, 10), pCK = parseInt($c('packCK').value, 10);
    if (!(pSA > 0) || !(pCK > 0)) { $c('settings-box').style.display = ''; throw 'Rozmiar paczki musi być > 0.'; }
    settings.packSA = pSA; settings.packCK = pCK;
    for (const branch of ['ratio', 'safeguard']) DEFF.forEach(u => {
      const el = $c(branch + '-' + u); if (!el) return;
      const v = +el.value;
      if (isNaN(v) || v < 0) { $c('settings-box').style.display = ''; el.focus(); throw `${branch === 'ratio' ? 'Przelicznik' : 'Rezerwa'} – ${LABEL[u]}: liczba ≥ 0.`; }
      settings[branch][u] = v;
    });
    settings.input = {
      mode: inp.mode, amount: inp.amount, spy_count: inp.spy_count, village_count: inp.village_count, minimal: inp.minimal, strategy: inp.strategy,
      fill: inp.fill, prio: inp.prio, useCK: inp.useCK, knights: inp.knights, knights_max: inp.knights_max, group: inp.group, split: inp.split, maxH: inp.maxH,
      land_on: inp.land_on, land: inp.land_raw, win: inp.win,
      depart_on: inp.depart_on, depart: inp.depart_raw, before_on: inp.before_on, before: inp.before_raw, after_on: inp.after_on, after: inp.after_raw,
    };
    saveSettings();
    return inp;
  }

  async function generate() {
    const inp = readInput();
    status('Pobieram wojska…');
    const [villages, speeds, target] = await Promise.all([loadVillages(inp.group), unitSpeeds(), worldVillage(inp.tx, inp.ty)]);
    if (!target) throw 'Wydaje się, że wioska docelowa nie istnieje.';
    const t0 = inp.depart != null ? Math.max(inp.depart, now()) : now();
    const R = settings.ratio, S = settings.safeguard, PM = inp.mode === 'packs';
    const lim = inp.maxH > 0 ? inp.maxH * 3600e3 : Infinity;

    let list = [];
    for (const v of villages) {
      const dist = Math.hypot(v.x - inp.tx, v.y - inp.ty);
      if (dist === 0) continue;
      const avail = {};
      DEFF.forEach(u => {
        let n = u === 'knight' ? (inp.knights !== 'off' ? (v.u.knight || 0) : 0) : Math.max(0, (v.u[u] || 0) - (S[u] || 0));
        const travel = (speeds[u] || 0) * dist * 60e3, arr = t0 + travel;
        if (travel > lim) n = 0;
        if (inp.land != null) {                       // rozpiska: musi zdążyć wyjść
          if (inp.land - travel < now() + 15e3) n = 0;
        } else {
          if (inp.before != null && arr > inp.before) n = 0;
          if (inp.after != null && arr < inp.after) n = 0;
        }
        if (u === 'heavy' && !inp.useCK) n = 0;
        if (!PM && !NOT_DEFF.has(u) && !R[u]) n = 0;
        if (inp.knights === 'only' && u !== 'knight') n = 0;
        if (PM && u === 'sword') n = 0;
        avail[u] = n;
      });
      const p = packsOf(avail);
      const deff = DEFF.filter(u => !NOT_DEFF.has(u)).reduce((s, u) => s + avail[u] * (R[u] || 0), 0);
      list.push({ id: v.id, name: v.name, x: v.x, y: v.y, dist, avail, availSA: p.sa, availCK: p.ck, packs: p.sa + p.ck, deff, units: {}, pSA: 0, pCK: 0 });
    }
    const score = v => PM ? v.packs : v.deff;
    const total = { packs: list.reduce((a, v) => a + v.packs, 0), sa: list.reduce((a, v) => a + v.availSA, 0), ck: list.reduce((a, v) => a + v.availCK, 0), deff: list.reduce((a, v) => a + v.deff, 0) };

    if (inp.knights === 'only') list = list.filter(v => v.avail.knight > 0);
    else list = list.filter(v => (inp.amount ? score(v) > 0 && score(v) >= inp.minimal : false) || (inp.spy_count && v.avail.spy > 0));
    const by = (f, dir) => (a, b) => dir * (f(a) - f(b));
    switch (inp.strategy) {
      case 'DIST_ASC': list.sort(by(v => v.dist, 1)); break;
      case 'DIST_DESC': list.sort(by(v => v.dist, -1)); break;
      case 'TROOP_ASC': list.sort(by(v => inp.amount ? score(v) : v.avail.spy, 1)); break;
      case 'TROOP_DESC': list.sort(by(v => inp.amount ? score(v) : v.avail.spy, -1)); break;
      default: for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    }
    if (inp.village_count > 0) list = list.slice(0, inp.village_count);

    // --- ile z której wioski ---
    let selected = 0;
    const takeFrom = (v, want) => {   // want w jednostkach trybu (paczki / pkt deffa)
      if (PM) {
        const order = inp.prio === 'ck' ? ['CK', 'SA'] : ['SA', 'CK'];
        let left = want;
        order.forEach(o => { const t = Math.min(v['avail' + o], left); v['p' + o] = t; left -= t; });
        v.units.spear = v.pSA * settings.packSA;
        if (HAS_ARCHER) v.units.archer = v.pSA * settings.packSA;
        if (DEFF.includes('heavy')) v.units.heavy = v.pCK * settings.packCK;
        return v.pSA + v.pCK;
      }
      const r = v.deff ? Math.min(1, want / v.deff) : 0;
      let got = 0;
      DEFF.filter(u => !NOT_DEFF.has(u)).forEach(u => { const c = Math.min(Math.round(r * v.avail[u]), v.avail[u]); v.units[u] = c; got += c * (R[u] || 0); });
      return got;
    };
    if (inp.knights === 'only') {
      // same rycerze – bez paczek i deffa
    } else if (inp.fill === 'seq') {
      for (const v of list) { if (selected >= inp.amount) break; if (score(v) < inp.minimal) continue; selected += takeFrom(v, inp.amount - selected); }
    } else {
      const sorted = list.filter(v => score(v) > 0).sort(by(score, -1));
      for (let i = sorted.length; i > 0; i--) {
        const v = sorted[i - 1];
        const left = inp.amount - selected;
        if (left <= 0) break;
        const want = PM ? Math.min(v.packs, Math.ceil(left / i), left) : left / i;
        selected += takeFrom(v, want);
      }
    }
    // zwiad – po równo
    if (DEFF.includes('spy') && inp.spy_count) {
      const sp = list.filter(v => v.avail.spy > 0).sort(by(v => v.avail.spy, -1));
      let got = 0;
      for (let i = sp.length; i > 0; i--) {
        const v = sp[i - 1];
        const thr = (inp.spy_count - got) / i;
        const c = Math.min(Math.round(thr < v.avail.spy ? thr : v.avail.spy), v.avail.spy);
        v.units.spy = c; got += c;
      }
    }

    // rycerze: z wojskiem – tam, gdzie coś idzie; same – z kolejnych wiosek wg strategii
    if (inp.knights !== 'off' && HAS_KNIGHT) {
      let left = inp.knights_max > 0 ? inp.knights_max : Infinity;
      for (const v of list) {
        if (left <= 0) break;
        if (!(v.avail.knight > 0)) continue;
        if (inp.knights === 'with' && !DEFF.some(u => u !== 'knight' && v.units[u] > 0)) continue;
        const n = Math.min(v.avail.knight, left);
        v.units.knight = n; left -= n;
      }
    }
    rows = list.filter(v => DEFF.some(u => v.units[u] > 0)).sort(by(v => v.dist, 1)).map(v => ({ ...v, checked: true, sent: {}, done: false }));
    plan = { inp, speeds, t0, target, selected };

    const owner = target.owner === 0 ? 'barbarzyńska' : target.owner === +game_data.player.id ? 'Twoja' : 'gracza';
    const kSel = rows.reduce((a, r) => a + (r.units.knight || 0), 0), kAll = list.reduce((a, v) => a + (v.avail.knight || 0), 0);
    $c('summary').innerHTML = `Cel <b>${inp.tx}|${inp.ty}</b> (${owner}). `
      + (inp.knights === 'only' ? `Same rycerze: wybrano <b>${kSel}</b> (dostępnych ${kAll})`
      : (inp.knights === 'with' ? `Rycerzy z wojskiem: <b>${kSel}</b>. ` : '') + (PM ? `Stać Cię na <b>${total.packs}</b> paczek (P+Ł ${total.sa}, CK ${total.ck}). Wybrano <b>${selected}</b>/${inp.amount}`
            + (selected < inp.amount ? ` <b style="color:#b00">– brakuje ${inp.amount - selected}</b>` : '')
        : `Dostępny deff ${beautify(total.deff)}, wybrano <b>${beautify(selected)}</b>/${beautify(inp.amount)}`))
      + ` z ${rows.length} wiosek.`
      + (inp.land != null ? ` <b>Rozpiska – wejście o ${dayClock(inp.land)}</b>.` : inp.depart != null ? ` Wyjście od <b>${dayClock(inp.depart)}</b>.` : '')
      + (target.owner === 0 && inp.depart == null && inp.land == null ? ' <b style="color:#b00">Barbarki nie wesprzesz przed przejęciem – ustaw „Wyjście od”.</b>' : '');
    status('');
    if (inp.land != null) buildSchedule(); else render();
  }

  // ======================================================================
  //  TABELA WYNIKÓW
  // ======================================================================
  function render() {
    const out = $c('out');
    const PM = plan.inp.mode === 'packs';
    const show = DEFF.filter(u => rows.some(r => r.avail[u] > 0));
    if (!rows.length) { out.innerHTML = '<i>Żadna wioska nie spełnia warunków.</i>'; updateSend(); return; }
    out.innerHTML = `<table class="res"><tr>
        <th><input type="checkbox" id="${ID('all')}" checked title="Zaznacz wszystkie"></th><th>Wioska</th><th>Pola</th>
        <th title="paczki 50 pik + 50 łuk">P+Ł</th><th title="paczki CK">CK</th>
        ${show.map(u => `<th><img src="${image_base}unit/unit_${u}.png" title="${LABEL[u]}"></th>`).join('')}
        <th>Paczek</th><th>Dotarcie</th><th></th></tr>
      ${rows.map((r, i) => `<tr data-i="${i}">
        <td><input type="checkbox" class="ck" checked></td>
        <td style="text-align:left"><a href="${villageUrl(r.id, 'info_village&id=' + r.id)}" target="_blank">${esc(r.name)}</a> (${r.x}|${r.y})</td>
        <td>${r.dist.toFixed(1)}</td>
        <td><input class="n psa" value="${packsOf(r.units).sa}" title="wolne: ${r.availSA}"></td>
        <td><input class="n pck" value="${packsOf(r.units).ck}" title="wolne: ${r.availCK}"></td>
        ${show.map(u => `<td><input class="n u" data-u="${u}" value="${r.units[u] || 0}" title="wolne: ${r.avail[u]}"></td>`).join('')}
        <td class="pk"></td><td class="arr" style="white-space:nowrap"></td>
        <td><button type="button" class="btn plac" title="Pojedynczo przez plac">Plac →</button></td></tr>`).join('')}
      </table>`;
    if (!PM) out.querySelectorAll('.psa,.pck').forEach(el => { el.title += ' (tryb deff – możesz też wpisać paczki)'; });

    const rowOf = el => rows[+el.closest('tr').dataset.i];
    out.querySelectorAll('tr[data-i]').forEach(tr => updateRow(tr));
    out.oninput = e => {
      const el = e.target, tr = el.closest('tr[data-i]');
      if (!tr) return;
      const r = rowOf(el);
      if (el.classList.contains('u')) r.units[el.dataset.u] = Math.min(num(el.value), r.avail[el.dataset.u] || 0);
      if (el.classList.contains('psa')) {
        const p = Math.min(num(el.value), r.availSA);
        r.units.spear = p * settings.packSA; if (HAS_ARCHER) r.units.archer = p * settings.packSA;
        tr.querySelectorAll('.u').forEach(x => { if (x.dataset.u === 'spear' || x.dataset.u === 'archer') x.value = r.units[x.dataset.u] || 0; });
      }
      if (el.classList.contains('pck')) {
        const p = Math.min(num(el.value), r.availCK);
        r.units.heavy = p * settings.packCK;
        tr.querySelectorAll('.u[data-u="heavy"]').forEach(x => { x.value = r.units.heavy; });
      }
      updateRow(tr, el);
      updateSend();
    };
    out.onchange = e => {
      if (e.target.classList.contains('ck')) { rowOf(e.target).checked = e.target.checked; updateRow(e.target.closest('tr')); updateSend(); }
    };
    $c('all').addEventListener('change', e => {
      out.querySelectorAll('tr[data-i]').forEach(tr => { const r = rows[+tr.dataset.i]; if (r.done) return; r.checked = e.target.checked; tr.querySelector('.ck').checked = e.target.checked; updateRow(tr); });
      updateSend();
    });
    out.querySelectorAll('.plac').forEach(b => b.addEventListener('click', () => openPlace(rowOf(b), b)));
    updateSend();
    clearInterval(timer); tick(); timer = setInterval(tick, 500);
  }

  // jednostki, które jeszcze nie poszły (po częściowej wysyłce grup)
  const pendingUnits = r => { const u = {}; DEFF.forEach(k => { if ((r.units[k] || 0) > 0 && !r.sent[k]) u[k] = Math.min(r.units[k], r.avail[k] || 0); }); return u; };

  function updateRow(tr, skip) {
    const r = rows[+tr.dataset.i];
    const p = packsOf(r.units);
    tr.querySelector('.pk').textContent = p.sa + p.ck || '';
    if (skip !== tr.querySelector('.psa')) tr.querySelector('.psa').value = p.sa;
    if (skip !== tr.querySelector('.pck')) tr.querySelector('.pck').value = p.ck;
    const { speeds, t0 } = plan;
    const grp = plan.inp.split ? SPEED_GROUPS : [DEFF];
    const times = grp.map(g => {
      const us = g.filter(u => (r.units[u] || 0) > 0);
      return us.length ? { g: groupLabel(g, r.units), t: clock(t0 + Math.max(...us.map(u => speeds[u] || 0)) * r.dist * 60e3) } : null;
    }).filter(Boolean);
    tr.querySelector('.arr').innerHTML = times.map(x => times.length > 1 ? `<small>${x.g}</small> ${x.t}` : x.t).join('<br>');
    tr.classList.toggle('off', !r.checked && !r.done);
    tr.classList.toggle('sent', r.done);
  }

  function updateSend() {
    const sel = rows.filter(r => r.checked && !r.done && Object.keys(pendingUnits(r)).length);
    const packs = sel.reduce((a, r) => { const p = packsOf(pendingUnits(r)); return a + p.sa + p.ck; }, 0);
    const b = $c('send');
    b.dataset.n = sel.length;
    b.dataset.packs = packs;
    tick();
  }

  function tick() {
    const b = $c('send');
    if (!b) { clearInterval(timer); return; }
    if (plan?.schedule) { tickSchedule(); return; }
    const n = +b.dataset.n || 0, packs = +b.dataset.packs || 0;
    const dep = plan?.inp.depart;
    if (b.dataset.busy) { b.disabled = true; return; }
    if (!n) { b.disabled = true; b.textContent = 'Wyślij zaznaczone'; b.style.background = ''; b.style.color = ''; return; }
    const label = `${n} wiosek${packs ? `, ${packs} paczek` : ''}`;
    if (dep != null && now() < dep) {
      b.disabled = true; b.textContent = `Wyślij zaznaczone (${label}) za ${hms((dep - now()) / 1000)}`; b.style.background = ''; b.style.color = '';
      return;
    }
    b.disabled = false;
    b.textContent = `Wyślij zaznaczone (${label})`;
    b.style.background = '#2a7a2a'; b.style.color = '#fff';
  }

  // ======================================================================
  //  ROZPISKA („Wejście o”)
  // ======================================================================
  const unitsTxt = u => Object.entries(u).filter(([, n]) => n > 0).map(([k, n]) => `${n} <img src="${image_base}unit/unit_${k}.png" style="height:14px;vertical-align:middle">`).join(' ');
  const unitsPlain = u => Object.entries(u).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${({ spear: 'pik', archer: 'łuk', heavy: 'CK', spy: 'zwiad', sword: 'miecz', knight: 'rycerz' })[k] || k}`).join(', ');

  function buildSchedule() {
    const { inp, speeds } = plan;
    const groups = inp.split ? SPEED_GROUPS : [DEFF];
    const W = inp.win * 60e3;
    const entries = [];
    rows.forEach(r => groups.forEach(g => {
      const units = {};
      g.forEach(u => { if ((r.units[u] || 0) > 0) units[u] = Math.min(r.units[u], r.avail[u] || 0); });
      if (!Object.keys(units).length) return;
      const travel = Math.round(Math.max(...Object.keys(units).map(u => speeds[u] || 0)) * r.dist * 60) * 1000;   // gra liczy w pełnych sekundach
      const p = packsOf(units);
      const sendAt = inp.land - travel;
      entries.push({ r, gu: g, g: inp.split || units.knight ? groupLabel(inp.split ? g : DEFF, units) : '', units, packs: p.sa + p.ck, travel, sendAt, endAt: sendAt + W, opened: false, sent: false });
    }));
    entries.sort((a, b) => a.sendAt - b.sendAt);
    // partie: wszystko w partii można wysłać jednym kliknięciem i wejdzie w oknie
    const batches = [];
    entries.forEach(e => {
      const b = batches[batches.length - 1];
      if (b && W > 0 && e.sendAt <= b.end) { b.items.push(e); b.start = Math.max(b.start, e.sendAt); b.end = Math.min(b.end, e.endAt); }
      else batches.push({ items: [e], start: e.sendAt, end: e.endAt, sent: false, busy: false });
    });
    batches.forEach((b, i) => { b.no = i + 1; b.items.forEach(e => { e.batch = b; }); });
    plan.schedule = entries;
    plan.batches = batches;
    const out = $c('out');
    if (!entries.length) { out.innerHTML = '<i>Żadna wioska nie zdąży wyjść na tę godzinę.</i>'; tick(); return; }
    let n = 0;
    out.innerHTML = `<div style="margin-bottom:4px">
        <button type="button" class="btn" id="${ID('copy')}">Kopiuj rozpiskę</button>
        <small>Wejście <b>${dayClock(inp.land)}</b>${W ? `–<b>${clock(inp.land + W)}</b>` : ''}. Partii (kliknięć masowego wsparcia): <b>${batches.length}</b>.
        ${W ? '' : 'Okno 0 min – każda pozycja osobno (ustaw np. 10 min, żeby łączyło w partie).'}</small></div>
      <table class="res"><tr><th>#</th><th>Wioska</th><th>Pola</th><th>Rozkaz</th><th>Paczek</th><th>Wyjście</th><th>Wejście</th><th></th></tr>
      ${batches.map(b => `<tr class="bh" data-b="${b.no - 1}" style="background:#e3d2a5">
          <td colspan="5" style="text-align:left"><b>Partia ${b.no}</b> – ${b.items.length} rozk., ${b.items.reduce((a, e) => a + e.packs, 0)} paczek.
            Wyślij między <b>${clock(b.start)}</b> a <b>${clock(b.end)}</b> <span class="bcd"></span></td>
          <td colspan="3"><button type="button" class="btn bsend" style="font-weight:bold">Wyślij partię</button></td></tr>
        ${b.items.map(e => `<tr data-e="${entries.indexOf(e)}">
          <td>${++n}</td>
          <td style="text-align:left"><a href="${villageUrl(e.r.id, 'info_village&id=' + e.r.id)}" target="_blank">${esc(e.r.name)}</a> (${e.r.x}|${e.r.y})</td>
          <td>${e.r.dist.toFixed(1)}</td>
          <td style="text-align:left">${e.g ? `<b>${e.g}</b>: ` : ''}${unitsTxt(e.units)}</td>
          <td>${e.packs || ''}</td>
          <td>od ${clock(e.sendAt)}</td><td class="land"></td>
          <td><button type="button" class="btn sopen" title="Pojedynczo przez plac">Plac →</button></td></tr>`).join('')}`).join('')}
      </table>`;
    out.oninput = null; out.onchange = null;
    out.querySelectorAll('.sopen').forEach(b => b.addEventListener('click', () => openEntry(+b.closest('tr').dataset.e)));
    out.querySelectorAll('.bsend').forEach(b => b.addEventListener('click', () => sendBatch(+b.closest('tr').dataset.b).catch(handleError)));
    $c('copy').addEventListener('click', () => {
      const txt = `Rozpiska na ${inp.tx}|${inp.ty} – wejście ${dayClock(inp.land)}${W ? '–' + clock(inp.land + W) : ''}\n` + batches.map(b =>
        `Partia ${b.no}: wyślij ${clock(b.start)}–${clock(b.end)}\n` + b.items.map(e =>
          `  ${e.r.name} (${e.r.x}|${e.r.y}) | ${unitsPlain(e.units)}${e.packs ? ` (${e.packs} pacz.)` : ''}`).join('\n')).join('\n');
      navigator.clipboard?.writeText(txt).then(() => msg('Skopiowano rozpiskę do schowka.'), () => msg('Nie udało się skopiować.', true));
    });
    clearInterval(timer); tick(); timer = setInterval(tick, 500);
  }

  function openEntry(i) {
    const e = plan.schedule[i];
    if (!e || e.sent) return;
    const { tx, ty, land } = plan.inp;
    lsSet(ST + 'pending_' + e.r.id, { tx, ty, key: keyOf(tx, ty), packs: e.packs, units: e.units, sendAt: e.batch ? e.batch.start : e.sendAt, land, ts: Date.now() });
    window.open(villageUrl(e.r.id, `place&x=${tx}&y=${ty}&stalka=1`), '_blank');
    e.opened = true;
    tick();
  }

  async function sendBatch(bi) {
    const b = plan.batches[bi];
    if (!b || b.sent || b.busy) return;
    const t = now();
    if (t < b.start) return;
    if (t > b.end && !confirm(`Partia ${b.no}: minęło okno – część wsparcia wejdzie po ${clock(plan.inp.land + plan.inp.win * 60e3)}. Wysłać mimo to?`)) return;
    const todo = b.items.filter(e => !e.sent && !e.opened);
    if (!todo.length) return;
    b.busy = true; tick();
    let packs = 0, cmds = 0;
    const fails = [];
    try {
      const byGroup = new Map();
      todo.forEach(e => { const k = e.gu.join('+'); if (!byGroup.has(k)) byGroup.set(k, []); byGroup.get(k).push(e); });
      for (const [, list] of byGroup) {
        const units = [...new Set(list.flatMap(e => Object.keys(e.units)))];
        // postCall bierze r.units – podstawiamy jednostki z pozycji rozpiski
        const shim = list.map(e => ({ id: e.r.id, units: e.units, avail: e.units }));
        const res = await postCall(shim, units);
        if (!res.ok) { fails.push(res); continue; }
        cmds++;
        list.forEach(e => { e.sent = true; packs += e.packs; });
      }
    } finally { b.busy = false; b.sent = b.items.every(e => e.sent || e.opened); }
    if (cmds) cache.villages.clear();
    const { tx, ty } = plan.inp;
    const total = packs ? sentAdd(tx, ty, packs) : sentGet(tx, ty);
    refreshCounter();
    if (cmds) msg(`Partia ${b.no}: wysłano ${cmds} ${cmds === 1 ? 'rozkaz' : 'rozkazy'} masowego wsparcia${packs ? ` = ${packs} paczek (licznik: ${total})` : ''}.`, false, 5000);
    if (fails.length) {
      msg('Gra odrzuciła część partii' + (fails[0].text ? ': ' + fails[0].text : '') + '. Kliknij ponownie albo użyj „Plac →”.', true, 8000);
      fails.forEach(f => { if (!f.text && f.url) window.open(f.url, '_blank'); });
    }
    tick();
  }

  function tickSchedule() {
    const sb = $c('send');
    sb.disabled = true; sb.textContent = 'Rozpiska – wysyłasz partiami (przyciski w tabeli)'; sb.style.background = ''; sb.style.color = '';
    const t = now();
    (plan.schedule || []).forEach((e, i) => {
      const tr = document.querySelector(`#${ID('out')} tr[data-e="${i}"]`);
      if (!tr) return;
      const go = e.batch ? e.batch.start : e.sendAt;
      tr.querySelector('.land').textContent = clock(Math.max(go, t) + e.travel);
      tr.style.background = e.sent ? '#c8e6b8' : e.opened ? '#d9ecd0' : '';
      tr.style.opacity = e.sent ? '.6' : '';
      const btn = tr.querySelector('.sopen');
      btn.disabled = e.sent;
      if (e.sent) btn.textContent = 'wysłane'; else if (e.opened) btn.textContent = 'otwarto';
    });
    (plan.batches || []).forEach((b, i) => {
      const tr = document.querySelector(`#${ID('out')} tr.bh[data-b="${i}"]`);
      if (!tr) return;
      const btn = tr.querySelector('.bsend'), cd = tr.querySelector('.bcd');
      const left = (b.start - t) / 1000, endLeft = (b.end - t) / 1000;
      const todo = b.items.filter(e => !e.sent && !e.opened);
      const pk = todo.reduce((a, e) => a + e.packs, 0);
      if (!todo.length) { btn.disabled = true; btn.textContent = b.items.some(e => e.sent) ? 'Wysłano ✔' : 'Otwarte na placu'; btn.style.background = ''; btn.style.color = ''; cd.textContent = ''; tr.style.background = '#c8e6b8'; return; }
      if (b.busy) { btn.disabled = true; btn.textContent = 'Wysyłam…'; return; }
      if (left > 0) {
        btn.disabled = true; btn.textContent = `Wyślij partię za ${hms(left)}`; btn.style.background = ''; btn.style.color = '';
        cd.textContent = `(za ${hms(left)})`;
        tr.style.background = left < 60 ? '#ffc46b' : left < 300 ? '#ffe08a' : '#e3d2a5';
      } else if (endLeft >= 0) {
        btn.disabled = false; btn.textContent = `WYŚLIJ PARTIĘ (${todo.length} rozk., ${pk} pacz.) – zostało ${hms(endLeft)}`;
        btn.style.background = '#2a7a2a'; btn.style.color = '#fff';
        cd.textContent = '– TERAZ'; tr.style.background = '#7fd36a';
      } else {
        btn.disabled = false; btn.textContent = `Po oknie – wyślij mimo to (${todo.length} rozk.)`;
        btn.style.background = '#b00'; btn.style.color = '#fff';
        cd.textContent = `– okno minęło ${hms(-endLeft)} temu`; tr.style.background = '#f2a0a0';
      }
    });
  }

  // ======================================================================
  //  WYSYŁKA
  // ======================================================================
  async function postCall(villages, units) {
    const { inp, target } = plan;
    const body = new URLSearchParams({ x: inp.tx, y: inp.ty, target: target.id, h: game_data.csrf });
    villages.forEach(r => units.forEach(u => { const n = Math.min(r.units[u] || 0, r.avail[u] || 0); if (n > 0) body.append(`call[${r.id}][${u}]`, n); }));
    const res = await fetch(base + 'place&mode=call&action=call', {
      method: 'POST', body, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    });
    const txt = await res.text();
    const err = new URL(res.url, location.href).searchParams.get('error');
    const box = parse(txt).querySelector('.error_box, .autoHideBox.error');
    if (err || box || !res.ok) return { ok: false, text: box ? box.textContent.trim() : '', url: res.url };
    return { ok: true };
  }

  async function sendSelected() {
    const b = $c('send');
    if (!plan || b.dataset.busy) return;
    if (plan.inp.depart != null && now() < plan.inp.depart) return;
    const sel = rows.filter(r => r.checked && !r.done && Object.keys(pendingUnits(r)).length);
    if (!sel.length) return;
    b.dataset.busy = '1'; b.disabled = true; b.textContent = 'Wysyłam…';
    const groups = plan.inp.split ? SPEED_GROUPS : [DEFF];
    let packsSent = 0, cmds = 0;
    const fails = [];
    try {
      for (const g of groups) {
        const vs = sel.filter(r => g.some(u => (r.units[u] || 0) > 0 && !r.sent[u]));
        if (!vs.length) continue;
        const units = g.filter(u => vs.some(r => r.units[u] > 0 && !r.sent[u]));
        const res = await postCall(vs, units);
        if (!res.ok) { fails.push({ g, res }); continue; }
        cmds++;
        vs.forEach(r => {
          const part = {};
          units.forEach(u => { if (r.units[u] > 0 && !r.sent[u]) { part[u] = Math.min(r.units[u], r.avail[u]); r.sent[u] = true; } });
          const p = packsOf(part); packsSent += p.sa + p.ck;
        });
      }
    } finally {
      sel.forEach(r => { if (!Object.keys(pendingUnits(r)).length) { r.done = true; r.checked = false; } });
      $c('out').querySelectorAll('tr[data-i]').forEach(tr => {
        const r = rows[+tr.dataset.i];
        if (r.done) { tr.querySelectorAll('input,button').forEach(x => { x.disabled = true; }); tr.querySelector('.ck').checked = false; }
        updateRow(tr);
      });
      delete b.dataset.busy;
      updateSend();
    }
    if (cmds) cache.villages.clear();
    const { tx, ty } = plan.inp;
    const total = packsSent ? sentAdd(tx, ty, packsSent) : sentGet(tx, ty);
    refreshCounter();
    if (cmds) msg(`Wysłano ${cmds} ${cmds === 1 ? 'rozkaz' : 'rozkazy'} masowego wsparcia${packsSent ? ` = ${packsSent} paczek (licznik: ${total})` : ''}.`, false, 5000);
    if (fails.length) {
      const t = fails.map(f => `${f.g.map(u => GROUP_NAME[u]).filter(Boolean).join('') || f.g.join('+')}${f.res.text ? ': ' + f.res.text : ''}`).join('; ');
      msg('Gra odrzuciła: ' + t + '. Te wiersze zostają zaznaczone – możesz kliknąć ponownie.', true, 8000);
      fails.forEach(f => { if (!f.res.text && f.res.url) window.open(f.res.url, '_blank'); });
    }
    status(fails.length ? 'Część nie poszła – zobacz komunikat.' : (cmds ? 'Wysłane ✔' : ''));
  }

  function openPlace(r, btn) {
    const u = pendingUnits(r);
    if (!Object.keys(u).length) return msg('Brak jednostek do wysłania z tej wioski.', true);
    const p = packsOf(u);
    const { tx, ty } = plan.inp;
    lsSet(ST + 'pending_' + r.id, { tx, ty, key: keyOf(tx, ty), packs: p.sa + p.ck, units: u, ts: Date.now() });
    window.open(villageUrl(r.id, `place&x=${tx}&y=${ty}&stalka=1`), '_blank');
    // licznik doliczy się po zatwierdzeniu na placu; wiersz wyłączamy z masowej wysyłki
    Object.keys(u).forEach(k => { r.sent[k] = true; });
    r.done = true; r.checked = false;
    const tr = btn.closest('tr');
    tr.querySelectorAll('input,button').forEach(x => { x.disabled = true; });
    tr.querySelector('.ck').checked = false;
    btn.textContent = 'otwarto';
    updateRow(tr); updateSend();
  }

  // ======================================================================
  //  START
  // ======================================================================
  const screen = Q.get('screen');
  console.log('[Obstawy+Stałki] start, ekran:', screen);

  // przycisk najpierw – żeby był zawsze (przy „Doku przycisków” trafia do menu ☰ Skrypty)
  const tb = document.createElement('button');
  tb.textContent = '🚕 Obstawy';
  tb.className = 'btn';
  tb.title = 'Obstawy + Stałki: rozłóż wsparcie po wioskach i wyślij masowo';
  Object.assign(tb.style, { position: 'fixed', right: '12px', bottom: '204px', zIndex: 99999 });
  tb.addEventListener('click', togglePanel);
  document.body.appendChild(tb);

  try {
    if (screen === 'place' && Q.get('try') === 'confirm') hookConfirm();
    else if (screen === 'place') placePage();
  } catch (e) { console.error('[Obstawy+Stałki] plac:', e); }

  // ---------- FORUM: wątek może się wczytać bez przeładowania strony ----------
  let threadKey = null;
  function threadId() {
    const p = new URLSearchParams(location.search);
    const a = document.querySelector('a[href*="thread_id="]');
    return p.get('thread_id') || (a && (a.getAttribute('href').match(/thread_id=(\d+)/) || [])[1]) || '';
  }
  function forumCheck() {
    if (!document.querySelector('div.post')) return;                  // nie widok wątku
    const key = threadId() + '|' + (document.querySelector('div.post')?.innerText || '').slice(0, 80);
    const panel = $c('panel');
    if (panel && forumInfo && key === threadKey && document.body.contains(panel)) return;
    if (panel && !forumInfo) return;                                    // otwarty ręcznie – nie ruszamy
    if (panel) { clearInterval(timer); panel.remove(); }
    threadKey = key;

    const rp = lsGet(ST + 'reply_pending', null);
    if (rp && document.querySelector('textarea[name="message"], #message')) {
      lsDel(ST + 'reply_pending');
      if (Date.now() - rp.ts < 10 * 60e3) {
        const m = (rp.key || '').match(/k(\d+)_(\d+)/);
        fillReply(rp.txt, rp.x ?? (m && +m[1]), rp.y ?? (m && +m[2]));
      }
    }
    const info = parseThread();
    if (!info.coords) {                                                 // zapas: koordy gdziekolwiek na stronie
      const m = (document.querySelector('#content_value')?.innerText || '').match(/(\d{3})\|(\d{3})/);
      if (m) info.coords = { x: +m[1], y: +m[2] };
    }
    forumInfo = info;
    buildPanel(div => {
      const post = document.querySelector('div.post');
      const anchor = document.querySelector('#forum_post_list') || (post && (post.closest('form') || post));
      if (anchor) anchor.parentNode.insertBefore(div, anchor);
      else (document.querySelector('#content_value') || document.body).prepend(div);
    }).then(() => {
      if (!info.coords) status('Nie znalazłem koordów celu w wątku – wpisz cel ręcznie.');
      rows = []; plan = null;
    }).catch(handleError);
  }
  // profil wioski: panel od razu otwarty z celem tej wioski
  if (screen === 'info_village') { try { togglePanel(); } catch (e) { handleError(e); } }

  // forum plemienia: screen=forum albo screen=ally&mode=forum (wątki wczytują się bez przeładowania)
  if (screen === 'forum' || screen === 'ally' || document.querySelector('div.post')) {
    try { forumCheck(); } catch (e) { handleError(e); }
    let t;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => { try { forumCheck(); } catch (e) { handleError(e); } }, 300); })
      .observe(document.querySelector('#content_value') || document.body, { childList: true, subtree: true });
  }
})();
