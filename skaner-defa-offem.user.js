// ==UserScript==
// @name         Skaner defa offem (auto)
// @namespace    plemiona-roker
// @version      2.0
// @description  Automatycznie czyta wysłane fejki, mierzy "Jednostki pokonane w ataku" przed/po wejściu każdego i szacuje obronę we wrogich wioskach
// @author       Roker
// @updateURL    https://raw.githubusercontent.com/Rokerio/noweRepo/main/skaner-defa-offem.user.js
// @downloadURL  https://raw.githubusercontent.com/Rokerio/noweRepo/main/skaner-defa-offem.user.js
// @match        https://*.plemiona.pl/game.php*
// @grant        none
// ==/UserScript==

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
    archer: { pop: 1, d: [50, 40, 5] },
    heavy:  { pop: 6, d: [200, 80, 180] },
  };
  const ATT = { axe: { a: 40, t: 0 }, light: { a: 130, t: 1 }, marcher: { a: 120, t: 2 } };

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
  function model(att, mix, wall, luck, morale) {
    let A0 = 0, w = [0, 0, 0];
    for (const k in ATT) { const v = (att[k] || 0) * ATT[k].a; A0 += v; w[ATT[k].t] += v; }
    if (!A0) return null;
    const tot = (mix.spear + mix.archer + mix.heavy) || 1;
    const pp = [0, 0, 0];
    for (const k in DEF) {
      const share = (mix[k] || 0) / tot;
      for (let i = 0; i < 3; i++) pp[i] += share * (DEF[k].d[i] / DEF[k].pop);
    }
    const c = (w[0] * pp[0] + w[1] * pp[1] + w[2] * pp[2]) / A0;
    return { A: A0 * (1 + luck) * ((morale || 100) / 100), c, W: Math.pow(WALL_BASE, wall) };
  }
  function solve(K, m) {
    if (!m || K <= 0) return null;
    const n0 = Math.max(0, (m.A - 20) / (m.c * m.W));
    if (K >= n0) return { n: Math.round(K), win: true };
    const f = (n) => n * Math.pow(m.A / (n * m.c * m.W + 20), 1.5);
    let lo = n0, hi = Math.max(n0 * 2, 10), it = 0;
    while (f(hi) > K && it++ < 80) hi *= 2;
    for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (f(mid) > K) lo = mid; else hi = mid; }
    return { n: Math.round((lo + hi) / 2), win: false };
  }
  function fmt(r) {
    return r ? r.n.toLocaleString('pl-PL') + ' pop (' + (r.n / FARM).toFixed(2) + ' zagr.)' + (r.win ? '*' : '') : '–';
  }
  function estimateRows(K, att, mix, wall, rep) {
    let s;
    if (rep && rep.luck != null) {
      const w = rep.wall != null ? rep.wall : wall;
      const r = solve(K, model(att, mix, w, rep.luck, rep.morale));
      s = 'szczęście ' + (rep.luck * 100).toFixed(1) + '%' + (rep.morale ? ', morale ' + rep.morale + '%' : '') +
        (rep.wall != null ? ', mur ' + rep.wall : '') + ': <b>' + fmt(r) + '</b>';
    } else {
      s = [['-20%', -0.2], ['0%', 0], ['+20%', 0.2]].map(([lbl, luck]) => lbl + ': ' + fmt(solve(K, model(att, mix, wall, luck, 100)))).join(' | ');
    }
    if (rep && rep.defPop != null) s += '<br><b>Z raportu: obrona przed bitwą ' + rep.defPop.toLocaleString('pl-PL') + ' pop (' + (rep.defPop / FARM).toFixed(2) + ' zagr.)</b>';
    return s;
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
  async function fetchReportInfo(coord, seen) {
    for (let tries = 0; tries < 4; tries++) {
      try {
        const list = await fetchReportList();
        const rep = list.find((r) => r.coord === coord && !seen.has(r.id));
        if (rep) {
          seen.add(rep.id);
          const html = await (await fetch('/game.php?village=' + vid() + '&screen=report&view=' + rep.id, { credentials: 'same-origin' })).text();
          const info = { luck: null, morale: null, wall: null, defPop: null, id: rep.id };
          const lm = html.match(/Szczęście[\s\S]{0,400}?(-?\d+(?:[.,]\d+)?)\s*%/i);
          if (lm) info.luck = parseFloat(lm[1].replace(',', '.')) / 100;
          const mm = html.match(/Morale:?\s*(?:<[^>]*>\s*)*(\d+)\s*%/i);
          if (mm) info.morale = +mm[1];
          const wm = html.match(/Mur\s*\(Poziom\s*(\d+)\)/i);
          if (wm) info.wall = +wm[1];
          const di = html.search(/Obrońca/i);
          if (di >= 0) {
            const seenU = {};
            const re = /unit-item-(\w+)[^>]*>\s*(\d+)/g;
            const part = html.slice(di);
            let m, sum = 0, found = false;
            while ((m = re.exec(part))) {
              if (seenU[m[1]]) continue; // druga seria to straty
              seenU[m[1]] = true; found = true;
              sum += (+m[2]) * (POP[m[1]] != null ? POP[m[1]] : 1);
            }
            if (found && sum > 0) info.defPop = sum;
          }
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
        if (arrival) out.push({ id: c.id, coord: c.coord, arrival, att: { axe: units.axe || 0, light: units.light || 0, marcher: units.marcher || 0 }, units });
      } catch (e) {}
      await sleep(250);
    }
    return out.filter((c) => c.arrival > now - 1000).sort((a, b) => a.arrival - b.arrival);
  }

  // ---------- UI ----------
  const box = document.createElement('div');
  box.style.cssText = 'margin:8px 0;padding:8px;border:2px solid #7d510f;background:#f4e4bc;font-size:13px;max-width:640px';
  box.innerHTML = `
    <b>Skaner defa offem – tryb auto</b>
    <div style="margin:4px 0">Mur <input id="sd_wall" type="number" value="20" min="0" max="20" style="width:40px">
      Obrona (% pop): włócznik <input id="sd_sp" type="number" value="50" style="width:40px">
      łucznik <input id="sd_ar" type="number" value="50" style="width:40px">
      CK <input id="sd_hv" type="number" value="0" style="width:40px"></div>
    <div style="margin:6px 0">
      <button class="btn" id="sd_go" style="padding:8px 12px">Skanuj wysłane fejki</button>
      <button class="btn" id="sd_stop" style="padding:8px 12px">Stop</button>
    </div>
    <div id="sd_status" style="margin:4px 0">Wyślij fejki, zostaw tę kartę otwartą i kliknij „Skanuj".</div>
    <div id="sd_out"></div>`;
  const target = isCommands ? (document.querySelector('#content_value h3, #content_value h2') || document.querySelector('#content_value')) : (document.querySelector('#content_value h2') || document.querySelector('#content_value'));
  target.parentNode.insertBefore(box, target.nextSibling);
  const $ = (id) => box.querySelector('#' + id);
  const status = (t) => { $('sd_status').innerHTML = t; };
  const cfg = () => ({
    mix: { spear: +$('sd_sp').value || 0, archer: +$('sd_ar').value || 0, heavy: +$('sd_hv').value || 0 },
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
    const nofull = cmds.filter((c) => !c.att.axe && !c.att.light && !c.att.marcher).length;
    status('Załadowano ' + cmds.length + ' fejków' + (nofull ? ' (' + nofull + ' bez odczytanego składu)' : '') + '. Nasłuchuję — nie zamykaj tej karty.');

    let lastScore = null, lastTs = null;
    const done = new Set();
    const results = [];
    const seenReports = new Set();
    try { (await fetchReportList()).forEach((r) => seenReports.add(r.id)); } catch (e) {}

    const render = () => {
      $('sd_out').innerHTML = '<table class="vis" style="width:100%"><tr><th>Cel</th><th>Skład fejka</th><th>Pokonane</th><th>Szacunek obrony</th></tr>' +
        results.map((r) => '<tr><td>' + r.coords + '</td><td>' + r.comp + '</td><td>' + r.K + (r.amb ? ' (suma, ' + r.n + ' wejść naraz)' : '') + '</td><td>' + r.est + '</td></tr>').join('') +
        '</table><div style="font-size:11px;margin-top:4px">* = fejk mógł wygrać, więc to ok. cała obrona w wiosce. Dla wejść „naraz" nie da się rozdzielić wyniku — szacunek jest dla sumy i tylko orientacyjny.</div>';
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
            const att = { axe: 0, light: 0, marcher: 0 };
            hit.forEach((c) => { att.axe += c.att.axe; att.light += c.att.light; att.marcher += c.att.marcher; });
            if (!att.axe && !att.light && !att.marcher) { att.axe = 100; att.light = 50; }
            const row = {
              coords: hit.map((c) => c.coord).join(', '),
              comp: att.axe + ' top. + ' + att.light + ' LK' + (att.marcher ? ' + ' + att.marcher + ' CK łucz.' : ''),
              K, n: hit.length, amb: hit.length > 1,
              est: estimateRows(K, att, mix, wall, null) + '<br><i>czekam na raport...</i>',
            };
            results.push(row);
            hit.forEach((c) => done.add(c.id));
            render();
            if (hit.length === 1) {
              // raport pobieramy w tle, żeby nie blokować pomiaru kolejnych fejków
              fetchReportInfo(hit[0].coord, seenReports).then((rep) => {
                row.est = estimateRows(K, att, mix, wall, rep) + (rep ? '' : '<br><i>brak raportu (np. wszystko zginęło) — szacunek bez znanego szczęścia</i>');
                render();
              });
            }
          }
        } else if (lastScore != null && s === lastScore) {
          // brak zmiany: fejki, które już "weszły" bez zmiany wyniku => 0 pokonanych
          pending.forEach((c) => {
            if (c.arrival < ts - 1500 && c.arrival > (lastTs || 0) - 3000) {
              done.add(c.id);
              results.push({ coords: c.coord, comp: c.att.axe + ' top. + ' + c.att.light + ' LK', K: 0, n: 1, amb: false, est: 'brak strat obrony (0 pokonanych)' });
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
