// ==UserScript==
// @name         Plemiona – Sprawdzacz skryptów (README vs to urządzenie)
// @namespace    plemiona.sprawdzacz.skryptow
// @version      1.0.0
// @updateURL    https://raw.githubusercontent.com/Rokerio/noweRepo/main/sprawdzacz-skryptow.user.js
// @downloadURL  https://raw.githubusercontent.com/Rokerio/noweRepo/main/sprawdzacz-skryptow.user.js
// @description  Pobiera listę skryptów z README w noweRepo i sprawdza, czy na TYM urządzeniu każdy jest zainstalowany i w najnowszej wersji. Przycisk 🔎 w rogu ekranu.
// @author       Roker
// @match        https://*.plemiona.pl/game.php*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/* Jak to działa:
   Tampermonkey nie udostępnia skryptom listy zainstalowanych skryptów, więc każdy skrypt z README
   przy uruchomieniu zapisuje w localStorage (klucz gdp_registry) swoje id i wersję. Sprawdzacz
   porównuje ten rejestr z README + nagłówkami @version na GitHubie. Rejestr jest osobny na każdym
   urządzeniu/przeglądarce – sprawdzasz więc dokładnie to urządzenie, na którym jesteś.
   Skrypt „nie widziany" = nie jest zainstalowany ALBO jeszcze nie uruchomił się na pasującej stronie
   (w tabeli jest podpowiedź, gdzie go uruchomić – @match). */

(function () {
  'use strict';

  // ================= USTAWIENIA =================
  const NS = 'gdp_sprawdzacz';
  const REPO_RAW = 'https://raw.githubusercontent.com/Rokerio/noweRepo/main/';
  const README = REPO_RAW + 'README.md';
  const REG_KEY = 'gdp_registry';       // wspólny rejestr (zapisują go wszystkie skrypty)
  const AUTO_CHECK_H = 24;              // co ile godzin sprawdzać sam w tle (plakietka na przycisku)
  const SELF = { id: 'sprawdzacz-skryptow', v: '1.0.0' };

  // ---------- rejestr ----------
  function readReg() {
    try { return JSON.parse(localStorage.getItem(REG_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function register(id, v) {
    try {
      const r = readReg();
      r[id] = { v: v, t: Date.now() };
      localStorage.setItem(REG_KEY, JSON.stringify(r));
    } catch (e) { /* brak localStorage – trudno */ }
  }
  register(SELF.id, SELF.v);

  // ---------- pomocnicze ----------
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const idOf = url => url.split('/').pop().replace(/\.user\.js$/, '');
  function cmp(a, b) {                   // -1 / 0 / 1 dla wersji typu 2.2.1 vs 2.10
    const x = String(a).split('.'), y = String(b).split('.');
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const p = parseInt(x[i] || '0', 10) || 0, q = parseInt(y[i] || '0', 10) || 0;
      if (p !== q) return p < q ? -1 : 1;
    }
    return 0;
  }
  const bust = url => url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(); // raw.github cache ~5 min
  async function getText(url) {
    const r = await fetch(bust(url), { cache: 'no-store' });
    if (!r.ok) throw new Error(url.split('/').pop() + ': HTTP ' + r.status);
    return r.text();
  }
  function header(src, key) {
    const m = src.match(new RegExp('//\\s*@' + key + '\\s+(.+)'));
    return m ? m[1].trim() : '';
  }
  function headers(src, key) {
    const re = new RegExp('//\\s*@' + key + '\\s+(.+)', 'g'), out = [];
    let m; while ((m = re.exec(src))) out.push(m[1].trim());
    return out;
  }

  // ---------- główna logika ----------
  async function check() {
    const readme = await getText(README);
    const urls = [...new Set((readme.match(/https:\/\/raw\.githubusercontent\.com\/[^\s)>\]"']+?\.user\.js/g) || []))];
    if (!urls.length) throw new Error('W README nie znalazłem żadnych linków .user.js');

    const reg = readReg();
    const rows = await Promise.all(urls.map(async url => {
      const id = idOf(url);
      try {
        const src = await getText(url);
        const latest = header(src, 'version') || '?';
        const name = header(src, 'name') || id;
        const matches = headers(src, 'match');
        const inst = reg[id];
        let status;
        if (!inst) status = 'missing';
        else if (latest !== '?' && cmp(inst.v, latest) < 0) status = 'old';
        else status = 'ok';
        return { id, url, name, latest, installed: inst ? inst.v : null, seen: inst ? inst.t : null, matches, status };
      } catch (e) {
        return { id, url, name: id, latest: '?', installed: (reg[id] || {}).v || null, matches: [], status: 'err', err: e.message };
      }
    }));
    return rows;
  }

  // ---------- UI ----------
  const ICON = { ok: '✅', old: '🔄', missing: '❌', err: '⚠️' };
  const LABEL = { ok: 'aktualny', old: 'do aktualizacji', missing: 'nie widziany', err: 'błąd pobierania' };
  let rows = [];

  function badge(rows_) {
    const bad = rows_.filter(r => r.status !== 'ok').length;
    const b = document.getElementById(NS + '_btn');
    if (!b) return;
    b.textContent = bad ? '🔎 ' + bad : '🔎 ✅';
    b.style.background = bad ? '#c0392b' : '#2e7d32';
  }

  function where(r) {
    if (!r.matches.length) return '';
    const m = r.matches[0].replace('https://*.plemiona.pl/game.php', '').replace(/^\*/, '') || 'dowolna strona gry';
    return '<br><span style="color:#777;font-size:11px">uruchamia się na: ' + esc(m) + '</span>';
  }

  function render() {
    const bad = rows.filter(r => r.status !== 'ok');
    const body = rows.slice().sort((a, b) => (a.status === 'ok') - (b.status === 'ok') || a.name.localeCompare(b.name, 'pl')).map(r => `
      <tr style="border-top:1px solid #d9c9a0">
        <td style="padding:4px 2px">${ICON[r.status]} <b>${esc(r.name)}</b>${r.status === 'missing' || r.status === 'err' ? where(r) : ''}${r.err ? '<br><span style="color:#a00;font-size:11px">' + esc(r.err) + '</span>' : ''}</td>
        <td style="padding:4px 2px;white-space:nowrap;text-align:right">${esc(r.installed || '–')} → <b>${esc(r.latest)}</b><br>
          <span style="color:#777;font-size:11px">${LABEL[r.status]}</span>
          ${r.status === 'ok' ? '' : '<br><a href="' + esc(r.url) + '" style="font-size:12px">' + (r.status === 'old' ? 'Aktualizuj' : 'Zainstaluj') + '</a>'}</td>
      </tr>`).join('');
    const p = document.getElementById(NS + '_panel');
    p.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <b style="font-size:14px">Skrypty z README: ${rows.length - bad.length}/${rows.length} OK</b>
        <span><a href="#" id="${NS}_re" style="margin-right:12px">Odśwież</a><a href="#" id="${NS}_x">Zamknij</a></span>
      </div>
      <div style="color:#555;font-size:11px;margin-bottom:6px">To urządzenie. „Nie widziany” = niezainstalowany albo jeszcze nie uruchomiony na swojej stronie.</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px"><tbody>${body}</tbody></table>`;
    p.querySelector('#' + NS + '_x').onclick = e => { e.preventDefault(); p.style.display = 'none'; };
    p.querySelector('#' + NS + '_re').onclick = e => { e.preventDefault(); run(true); };
  }

  async function run(show) {
    const p = document.getElementById(NS + '_panel');
    if (show) { p.style.display = 'block'; p.innerHTML = '<i>Sprawdzam…</i>'; }
    try {
      rows = await check();
      localStorage.setItem(NS + '_last', String(Date.now()));
      badge(rows);
      if (show) render();
    } catch (e) {
      if (show) p.innerHTML = '<span style="color:#a00">Błąd: ' + esc(e.message) + '</span> <a href="#" id="' + NS + '_x2">Zamknij</a>';
      const x = p.querySelector('#' + NS + '_x2'); if (x) x.onclick = ev => { ev.preventDefault(); p.style.display = 'none'; };
    }
  }

  function init() {
    if (document.getElementById(NS + '_btn')) return;
    const b = document.createElement('div');
    b.id = NS + '_btn';
    b.textContent = '🔎';
    b.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:99998;background:#555;color:#fff;font:bold 13px sans-serif;padding:6px 9px;border-radius:14px;cursor:pointer;opacity:.85';
    b.onclick = () => {
      const p = document.getElementById(NS + '_panel');
      if (p.style.display === 'block') { p.style.display = 'none'; return; }
      if (rows.length) { p.style.display = 'block'; render(); } else run(true);
    };
    const p = document.createElement('div');
    p.id = NS + '_panel';
    p.style.cssText = 'display:none;position:fixed;left:6px;right:6px;bottom:42px;max-height:70vh;overflow:auto;-webkit-overflow-scrolling:touch;z-index:99999;background:#f4e4bc;border:2px solid #7d510f;border-radius:6px;padding:8px;font:12px sans-serif;color:#000;box-shadow:0 2px 10px rgba(0,0,0,.4)';
    document.body.appendChild(p);
    document.body.appendChild(b);

    const last = parseInt(localStorage.getItem(NS + '_last') || '0', 10);
    if (Date.now() - last > AUTO_CHECK_H * 3600e3) run(false);
  }

  init();
})();
