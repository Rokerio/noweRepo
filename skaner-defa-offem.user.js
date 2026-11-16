// ==UserScript==
// @name         Skaner defa offem (auto)
// @namespace    plemiona-roker
// @version      2.2
// @description  Automatycznie czyta wysłane fejki, mierzy "Jednostki pokonane w ataku" przed/po wejściu każdego i szacuje obronę (z raportu: szczęście, morale, mur, bonusy, skład ataku)
// @author       Roker
// @updateURL    https://raw.githubusercontent.com/Rokerio/noweRepo/main/skaner-defa-offem.user.js
// @downloadURL  https://raw.githubusercontent.com/Rokerio/noweRepo/main/skaner-defa-offem.user.js
// @match        https://*.plemiona.pl/game.php*
// @grant        none
// ==/UserScript==
// rejestr wersji dla Sprawdzacza skryptów (localStorage, osobny na każdym urządzeniu)
try{var __r=JSON.parse(localStorage.getItem('gdp_registry')||'{}');__r['skaner-defa-offem']={v:'2.2',t:Date.now()};localStorage.setItem('gdp_registry',JSON.stringify(__r));}catch(e){}

(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const screen = q.get('screen');
  const isRanking = screen === 'ranking' && q.get('mode') === 'in_a_day';
  const isCommands = screen === 'overview_villages' && q.get('mode') === 'commands';
  if (!isRanking && !isCommands) return;

  const FARM = 24000;       // max zagroda na pl233
  const WALL_BASE = 1.037;
  const POLL_MS = 600;
  const PRE_MS = 2500;      // okno nasłuchu przed wejściem
  const POST_MS = 3500;     // okno nasłuchu po wejściu

  // obrona: pop, [ogólna, vs kawaleria, vs łucznicy]
  const DEF = {
    spear:  { pop: 1, d: [15, 45, 20] },
    sword:  { pop: 1, d: [50, 25, 40] },
    archer: { pop: 1, d: [50, 40, 5] },
    heavy:  { pop: 6, d: [200, 80, 180] },
  };
  // atak: wartość ataku, typ obrony (0 ogólna, 1 kawaleria, 2 łucznicy)
  const ATT = {
    axe:      { a: 40,  t: 0 },
    light:    { a: 130, t: 1 },
    marcher:  { a: 120, t: 2 },
    heavy:    { a: 150, t: 1 },
    ram:      { a: 2,   t: 0 },
    catapult: { a: 100, t: 0 },
  };
  const ATT_KEYS = Object.keys(ATT);

  const vid = () => (window.game_data && game_data.village && game_data.village.id) || q.get('village');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- wynik z rankingu ----------
  function parseScore(html) {
    const m = html.match(/Mój dzisiejszy wynik:\s*<b>([^<]*)<\/b>/i);
    if (!m) return null;
    const n = parseInt(m[1].replace(/[^\d]/g, ''), 10);
    return isNaN(n) ? null : n;
  }
  async function fetchScore() {
    const url = '/game.php?village=' + vid() + '&screen=ranking&mode=in_a_day&type=kill_att';
    const html = await (await fetch(url, { credentials: 'same-origin' })).text();
    return parseScore(html);
  }

  // ---------- model bitwy ----------
  // b = { att:{axe,light,marcher,heavy w %}, def:{spear,sword,archer,heavy,flag w %}, wallEff w % }
  function model(att, mix, wall, luck, morale, b) {
    b = b || {};
    const ab = b.att || {}, db = b.def || {};
    let A0 = 0;
    const w = [0, 0, 0];
    for (const k of ATT_KEYS) {
      const v = (att[k] || 0) * ATT[k].a * (1 + (ab[k] || 0) / 100);
      A0 += v; w[ATT[k].t] += v;
    }
    if (!A0) return null;
    const tot = (mix.spear + mix.sword + mix.archer + mix.heavy) || 1;
    const pp = [0, 0, 0];
    for (const k in DEF) {
      const share = (mix[k] || 0) / tot;
      const mult = (1 + (db[k] || 0) / 100) * (1 + (db.flag || 0) / 100);
      for (let i = 0; i < 3; i++) pp[i] += share * (DEF[k].d[i] / DEF[k].pop) * mult;
    }
    const c = (w[0] * pp[0] + w[1] * pp[1] + w[2] * pp[2]) / A0;
    const W = 1 + (Math.pow(WALL_BASE, wall) - 1) * (1 + (b.wallEff || 0) / 100);
    return { A: A0 * (1 + luck) * ((morale || 100) / 100), c, W };
  }
  // K = pokonani obrońcy; zwraca szacunek wielkości obrony (pop)
  function solve(K, m) {
    if (!m || K <= 0) return null;
    const n0 = Math.max(0, (m.A - 20) / (m.c * m.W)); // remis: atak = obrona
    if (K >= n0) return { n: Math.round(K), win: true, n0: Math.round(n0) };
    const f = (n) => n * Math.pow(m.A / (n * m.c * m.W + 20), 1.5);
    let lo = n0, hi = Math.max(n0 * 2, 10), it = 0;
    while (f(hi) > K && it++ < 80) hi *= 2;
    for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (f(mid) > K) lo = mid; else hi = mid; }
    return { n: Math.round((lo + hi) / 2), win: false, n0: Math.round(n0) };
  }
  function fmt(r, K) {
    if (!r) return '–';
    if (r.win) {
      // atak bliski remisu albo wygrany: pokonani ≈ cała obrona (obrona rzadko > 1,25 K, gdy atak przegrał o włos)
      const hi = Math.round(K * 1.25);
      return K.toLocaleString('pl-PL') + '–' + hi.toLocaleString('pl-PL') + ' pop (' + (K / FARM).toFixed(2) + '–' + (hi / FARM).toFixed(2) + ' zagr.) – atak bliski remisu';
    }
    return r.n.toLocaleString('pl-PL') + ' pop (' + (r.n / FARM).toFixed(2) + ' zagr.)';
  }
  function estimateRows(K, att, mix, wall, rep) {
    const b = rep ? rep.bonus : null;
    const mor = rep && rep.morale ? rep.morale : 100;
    const w = rep && rep.wall != null ? rep.wall : wall;
    let s;
    if (rep && rep.luck != null) {
      const r = solve(K, model(att, mix, w, rep.luck, mor, b));
      s = 'szczęście ' + (rep.luck * 100).toFixed(1) + '%, morale ' + mor + '%, mur ' + w + ': <b>' + fmt(r, K) + '</b>';
    } else {
      s = [['-20%', -0.2], ['0%', 0], ['+20%', 0.2]].map(([lbl, luck]) =>
        lbl + ': ' + fmt(solve(K, model(att, mix, w, luck, mor, b)), K)).join(' | ');
    }
    if (rep && rep.attAllDied) s += '<br><i>atak zginął w całości (obrona silniejsza od ataku)</i>';
    if (rep && rep.defPop != null) s += '<br><b>Z raportu: obrona przed bitwą ' + rep.defPop.toLocaleString('pl-PL') + ' pop (' + (rep.defPop / FARM).toFixed(2) + ' zagr.)</b>';
    return s;
  }
  function compText(a) {
    const p = [];
    if (a.axe) p.push(a.axe + ' top.');
    if (a.light) p.push(a.light + ' LK');
    if (a.marcher) p.push(a.marcher + ' ŁnK');
    if (a.heavy) p.push(a.heavy + ' CK');
    if (a.ram) p.push(a.ram + ' tar.');
    if (a.catapult) p.push(a.catapult + ' kat.');
    return p.join(' + ') || '?';
  }

  // ---------- raporty ----------
  const POP = { spear: 1, sword: 1, axe: 1, archer: 1, spy: 2, light: 4, marcher: 5, heavy: 6, ram: 5, catapult: 8, knight: 10, snob: 100, militia: 0 };
  async function fetchReportList() {
    const html = await (await fetch('/game.php?village=' + vid() + '&screen=report&mode=attack', { credentials: 'same-origin' })).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out = [];
    doc.querySelectorAll('a[href*="view="]').forEach((a) => {
      const idm = a.href.match(/[?&]view=(\d+)/);
      const cm = a.textContent.match(/\((\d{3}\|\d{3})\)/);
      if (idm && cm) out.push({ id: idm[1], coord: cm[1] });
    });
    return out;
  }
  function sumBonus(text, nameRe, kindsRe) {
    const re = new RegExp(nameRe + ':\\s*\\+(\\d+)%\\s*siła\\s*(?:' + kindsRe + ')', 'gi');
    let m, s = 0;
    while ((m = re.exec(text))) s += +m[1];
    return s;
  }
  function unitSeries(htmlPart) {
    // zwraca { jednostka: [ilość, straty] } — pierwsza seria to ilość, druga to straty
    const res = {};
    const re = /unit-item-(\w+)[^>]*>\s*(\d+)/g;
    let m;
    while ((m = re.exec(htmlPart))) {
      (res[m[1]] = res[m[1]] || []).push(+m[2]);
    }
    return res;
  }
  function parseReport(html) {
    const txt = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const info = { luck: null, morale: null, wall: null, defPop: null, att: null, attAllDied: false, bonus: { att: {}, def: {}, wallEff: 0 } };
    const lm = txt.match(/Szczęście[^%]{0,200}?(-?\d+(?:[.,]\d+)?)\s*%/i);
    if (lm) info.luck = parseFloat(lm[1].replace(',', '.')) / 100;
    const mm = txt.match(/Morale:?\s*(\d+)\s*%/i);
    if (mm) info.morale = +mm[1];
    // mur: poziom PRZED taranami (bitwa toczy się z pełnym murem)
    const wm = txt.match(/Mur uszkodzony z poziomu\s*(\d+)/i) || txt.match(/Mur\s*\(Poziom\s*(\d+)\)/i);
    if (wm) info.wall = +wm[1];

    const ia = txt.search(/Agresor/i), id = txt.search(/Obrońca/i);
    const attTxt = ia >= 0 && id > ia ? txt.slice(ia, id) : '';
    const defTxt = id >= 0 ? txt.slice(id) : '';
    const ATTK = 'w ataku i w obronie|w ataku|napadu';
    const DEFK = 'w ataku i w obronie|obrony';
    info.bonus.att = {
      axe: sumBonus(attTxt, 'Topornik', ATTK),
      light: sumBonus(attTxt, 'Lekki kawalerzysta', ATTK),
      marcher: sumBonus(attTxt, 'Łucznik na koniu', ATTK),
      heavy: sumBonus(attTxt, 'Ciężki kawalerzysta', ATTK),
    };
    info.bonus.def = {
      spear: sumBonus(defTxt, 'Pikinier', DEFK),
      sword: sumBonus(defTxt, 'Miecznik', DEFK),
      archer: sumBonus(defTxt, 'Łucznik(?! na koniu)', DEFK),
      heavy: sumBonus(defTxt, 'Ciężki kawalerzysta', DEFK),
      flag: 0,
    };
    const fm = defTxt.match(/Flaga:\s*\+(\d+)%\s*siła obrony/i);
    if (fm) info.bonus.def.flag = +fm[1];
    const em = defTxt.match(/\+(\d+)%\s*efektywność muru/i);
    if (em) info.bonus.wallEff = +em[1];

    // skład ataku i straty
    const ha = html.search(/Agresor/i), hd = html.search(/Obrońca/i);
    if (ha >= 0 && hd > ha) {
      const ser = unitSeries(html.slice(ha, hd));
      const att = {};
      let cnt = 0, lost = 0;
      for (const k in ser) {
        const n = ser[k][0] || 0, l = ser[k][1] || 0;
        if (ATT[k]) att[k] = n;
        if (k !== 'spy' && k !== 'knight') { cnt += n; lost += l; }
      }
      if (cnt > 0) { info.att = att; info.attAllDied = lost >= 0.98 * cnt; }
    }
    // obrona przed bitwą (tylko gdy raport ją pokazuje)
    if (hd >= 0) {
      const ser = unitSeries(html.slice(hd));
      let sum = 0, found = false;
      for (const k in ser) { found = true; sum += (ser[k][0] || 0) * (POP[k] != null ? POP[k] : 1); }
      if (found && sum > 0) info.defPop = sum;
    }
    return info;
  }
  async function fetchReportInfo(coord, seen) {
    for (let tries = 0; tries < 4; tries++) {
      try {
        const list = await fetchReportList();
        const rep = list.find((r) => r.coord === coord && !seen.has(r.id));
        if (rep) {
          seen.add(rep.id);
          const html = await (await fetch('/game.php?village=' + vid() + '&screen=report&view=' + rep.id, { credentials: 'same-origin' })).text();
          const info = parseReport(html);
          info.id = rep.id;
          return info;
        }
      } catch (e) {}
      await sleep(1500);
    }
    return null;
  }

  // ---------- czas serwera (zegar ścienny w ms) ----------
  function parseServerNow() {
    const t = (document.getElementById('serverTime') || {}).textContent || '';
    const d = (document.getElementById('serverDate') || {}).textContent || '';
    const tm = t.match(/(\d+):(\d+):(\d+)/), dm = d.match(/(\d+)\/(\d+)\/(\d+)/);
    if (!tm || !dm) return null;
    return Date.UTC(+dm[3], +dm[2] - 1, +dm[1], +tm[1], +tm[2], +tm[3]);
  }
  const anchor = parseServerNow(), perf0 = performance.now();
  const nowWall = () => (anchor == null ? null : anchor + (performance.now() - perf0));

  function parseArrival(txt, nowMs) {
    // "dzisiaj o 17:45:12:345", "jutro o ...", "dnia 23.10. o 01:02:03"
    const tm = txt.match(/(\d{1,2}):(\d{2}):(\d{2})(?::(\d{1,3}))?/);
    if (!tm) return null;
    const base = new Date(nowMs);
    let y = base.getUTCFullYear(), mo = base.getUTCMonth(), day = base.getUTCDate();
    if (/jutro/i.test(txt)) day += 1;
    else if (/wczoraj/i.test(txt)) day -= 1;
    else {
      const dm = txt.match(/(\d{1,2})\.(\d{1,2})\./);
      if (dm) { day = +dm[1]; mo = +dm[2] - 1; }
    }
    return Date.UTC(y, mo, day, +tm[1], +tm[2], +tm[3], tm[4] ? +tm[4].padEnd(3, '0') : 0);
  }

  // ---------- odczyt rozkazów ----------
  async function loadAttackCommands(log) {
    const list = [];
    const rows = document.querySelectorAll('#commands_table tr');
    rows.forEach((tr) => {
      const a = tr.querySelector('a[href*="info_command"]');
      if (!a) return;
      const txt = tr.textContent.replace(/\s+/g, ' ');
      const img = (tr.querySelector('img[src*="command/"]') || {}).src || '';
      const isAttack = /attack/i.test(img) || /^\s*Atak/i.test(a.textContent) || /Atak/i.test(txt.slice(0, 40));
      if (!isAttack || /powr|return|back/i.test(img + ' ' + a.textContent)) return;
      const idm = a.href.match(/[?&]id=(\d+)/);
      if (!idm) return;
      const coord = (txt.match(/\((\d{3}\|\d{3})\)/) || [])[1] || '?';
      list.push({ id: idm[1], coord });
    });
    log('Znaleziono ' + list.length + ' rozkazów ataku. Czytam szczegóły...');
    const now = nowWall();
    const out = [];
    for (const c of list) {
      try {
        const html = await (await fetch('/game.php?village=' + vid() + '&screen=info_command&id=' + c.id + '&type=own', { credentials: 'same-origin' })).text();
        const am = html.match(/Przybycie:?[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i);
        const arrival = am ? parseArrival(am[1].replace(/<[^>]*>/g, ' '), now) : null;
        const units = {};
        const re = /unit-item-(\w+)[^>]*>\s*(\d+)/g;
        let m;
        while ((m = re.exec(html))) units[m[1]] = +m[2];
        const att = {};
        ATT_KEYS.forEach((k) => { att[k] = units[k] || 0; });
        if (arrival) out.push({ id: c.id, coord: c.coord, arrival, att, units });
      } catch (e) {}
      await sleep(250);
    }
    return out.filter((c) => c.arrival > now - 1000).sort((a, b) => a.arrival - b.arrival);
  }

  // ---------- UI ----------
  const box = document.createElement('div');
  box.style.cssText = 'margin:8px 0;padding:8px;border:2px solid #7d510f;background:#f4e4bc;font-size:13px;max-width:700px';
  box.innerHTML = `
    <b>Skaner defa offem – tryb auto</b>
    <div style="margin:4px 0">Mur <input id="sd_wall" type="number" value="20" min="0" max="20" style="width:40px">
      Obrona (% pop): włócznik <input id="sd_sp" type="number" value="50" style="width:40px">
      miecznik <input id="sd_sw" type="number" value="0" style="width:40px">
      łucznik <input id="sd_ar" type="number" value="50" style="width:40px">
      CK <input id="sd_hv" type="number" value="0" style="width:40px"></div>
    <div style="margin:6px 0">
      <button class="btn" id="sd_go" style="padding:8px 12px">Skanuj wysłane fejki</button>
      <button class="btn" id="sd_stop" style="padding:8px 12px">Stop</button>
    </div>
    <div id="sd_status" style="margin:4px 0">Wyślij fejki, zostaw tę kartę otwartą i kliknij „Skanuj". Mur i bonusy obrony skrypt weźmie z raportu, a pola wyżej to założenia do czasu raportu.</div>
    <div id="sd_out"></div>`;
  const target = isCommands ? (document.querySelector('#content_value h3, #content_value h2') || document.querySelector('#content_value')) : (document.querySelector('#content_value h2') || document.querySelector('#content_value'));
  target.parentNode.insertBefore(box, target.nextSibling);
  const $ = (id) => box.querySelector('#' + id);
  const status = (t) => { $('sd_status').innerHTML = t; };
  const cfg = () => ({
    mix: { spear: +$('sd_sp').value || 0, sword: +$('sd_sw').value || 0, archer: +$('sd_ar').value || 0, heavy: +$('sd_hv').value || 0 },
    wall: Math.min(20, Math.max(0, +$('sd_wall').value || 0)),
  });

  let running = false;
  $('sd_stop').onclick = () => { running = false; status('Zatrzymano.'); };

  if (isRanking) {
    // na rankingu tylko podgląd + przekierowanie do trybu auto
    status('Tryb auto działa na stronie Przeglądy → Rozkazy. <a href="/game.php?village=' + vid() + '&screen=overview_villages&mode=commands&type=attack">Otwórz rozkazy</a>');
    $('sd_go').disabled = true;
    return;
  }

  $('sd_go').onclick = async () => {
    if (running) return;
    if (nowWall() == null) { status('Nie odczytałem czasu serwera.'); return; }
    running = true;
    const cmds = await loadAttackCommands((t) => status(t));
    if (!cmds.length) { status('Brak rozkazów ataku z odczytanym czasem przybycia (sprawdź filtr „Ataki" w rozkazach).'); running = false; return; }
    const nofull = cmds.filter((c) => !ATT_KEYS.some((k) => c.att[k])).length;
    status('Załadowano ' + cmds.length + ' fejków' + (nofull ? ' (' + nofull + ' bez odczytanego składu)' : '') + '. Nasłuchuję — nie zamykaj tej karty.');

    let lastScore = null, lastTs = null;
    const done = new Set();
    const results = [];
    const seenReports = new Set();
    try { (await fetchReportList()).forEach((r) => seenReports.add(r.id)); } catch (e) {}

    const render = () => {
      $('sd_out').innerHTML = '<table class="vis" style="width:100%"><tr><th>Cel</th><th>Skład ataku</th><th>Pokonane</th><th>Szacunek obrony</th></tr>' +
        results.map((r) => '<tr><td>' + r.coords + '</td><td>' + r.comp + '</td><td>' + r.K + (r.amb ? ' (suma, ' + r.n + ' wejść naraz)' : '') + '</td><td>' + r.est + '</td></tr>').join('') +
        '</table><div style="font-size:11px;margin-top:4px">„atak bliski remisu” = pokonane ≈ cała obrona (obrona zwykle K do 1,25×K). Przy małym K (poniżej ok. 20) szacunek jest zgrubny, bo K jest całkowite. Dla wejść „naraz” nie da się rozdzielić wyniku — szacunek jest orientacyjny.</div>';
    };

    while (running) {
      const t = nowWall();
      const pending = cmds.filter((c) => !done.has(c.id));
      if (!pending.length) break;
      const active = pending.some((c) => t >= c.arrival - PRE_MS && t <= c.arrival + POST_MS);
      if (!active) {
        lastScore = null;
        const next = pending[0].arrival - PRE_MS;
        const wait = Math.max(POLL_MS, Math.min(next - t, 2000));
        status('Fejków do zmierzenia: ' + pending.length + '. Najbliższy za ' + Math.max(0, Math.round((pending[0].arrival - t) / 1000)) + ' s. Wyników: ' + results.length);
        await sleep(wait);
        continue;
      }
      const ts = nowWall();
      let s = null;
      try { s = await fetchScore(); } catch (e) {}
      if (s != null) {
        if (lastScore != null && s !== lastScore) {
          const hit = pending.filter((c) => c.arrival > lastTs - 500 && c.arrival <= ts + 100);
          const K = s - lastScore;
          if (hit.length) {
            const { mix, wall } = cfg();
            const att = {};
            ATT_KEYS.forEach((k) => { att[k] = 0; });
            hit.forEach((c) => ATT_KEYS.forEach((k) => { att[k] += c.att[k] || 0; }));
            if (!ATT_KEYS.some((k) => att[k])) { att.axe = 100; att.light = 50; }
            const row = {
              coords: hit.map((c) => c.coord).join(', '),
              comp: compText(att),
              K, n: hit.length, amb: hit.length > 1,
              est: estimateRows(K, att, mix, wall, null) + '<br><i>czekam na raport...</i>',
            };
            results.push(row);
            hit.forEach((c) => done.add(c.id));
            render();
            if (hit.length === 1) {
              // raport pobieramy w tle, żeby nie blokować pomiaru kolejnych fejków
              fetchReportInfo(hit[0].coord, seenReports).then((rep) => {
                const a2 = rep && rep.att ? Object.assign({}, att, rep.att) : att;
                if (rep && rep.att) row.comp = compText(a2);
                row.est = estimateRows(K, a2, mix, wall, rep) + (rep ? '' : '<br><i>brak raportu — szacunek bez znanego szczęścia, morale i muru</i>');
                render();
              });
            }
          }
        } else if (lastScore != null && s === lastScore) {
          // brak zmiany: fejki, które już "weszły" bez zmiany wyniku => 0 pokonanych
          pending.forEach((c) => {
            if (c.arrival < ts - 1500 && c.arrival > (lastTs || 0) - 3000) {
              done.add(c.id);
              const row = { coords: c.coord, comp: compText(c.att), K: 0, n: 1, amb: false, est: 'K = 0 — obrona poza zasięgiem tego ataku (albo pusta wioska, albo niskie morale). Czekam na raport...' };
              results.push(row);
              const { mix, wall } = cfg();
              fetchReportInfo(c.coord, seenReports).then((rep) => {
                if (!rep) return;
                const mor = rep.morale || 100, w = rep.wall != null ? rep.wall : wall;
                const a2 = rep.att ? Object.assign({}, c.att, rep.att) : c.att;
                const m = model(a2, mix, w, rep.luck || 0, mor, rep.bonus);
                // K < 0,5 => obrona co najmniej: (A^1,5 / (c·W)^1,5 / 0,5)^2
                let lowerBound = null;
                if (m) lowerBound = Math.round(Math.pow(Math.pow(m.A, 1.5) / (Math.pow(m.c * m.W, 1.5) * 0.5), 2));
                row.comp = compText(a2);
                row.est = 'K = 0: obrona co najmniej ok. ' + (lowerBound != null ? lowerBound.toLocaleString('pl-PL') + ' pop (' + (lowerBound / FARM).toFixed(2) + ' zagr.)' : '?') +
                  ' (szczęście ' + ((rep.luck || 0) * 100).toFixed(1) + '%, morale ' + mor + '%, mur ' + w + ')' +
                  (mor < 70 ? '<br><i>niskie morale osłabiło atak — zeskanuj większym atakiem albo od gracza o podobnych punktach</i>' : '');
                render();
              });
            }
          });
          render();
        }
        lastScore = s; lastTs = ts;
      }
      await sleep(POLL_MS);
    }
    if (running) status('Gotowe — zmierzono ' + results.length + ' wpisów.');
    running = false;
  };
})();
