// ==UserScript==
// @name         Plemiona – Klin PRO (normalny + z cofki, auto)
// @namespace    dawid.plemiona
// @version      3.16
// @updateURL    https://raw.githubusercontent.com/Rokerio/noweRepo/main/klin-pro.user.js
// @downloadURL  https://raw.githubusercontent.com/Rokerio/noweRepo/main/klin-pro.user.js
// @description  Łączy "Klin: wejście na czas" i "Klin z cofki". Dobiera tryb (normalny / z cofki), wstrzymuje przycisk Wyślij do wyliczonego momentu (z regulowanym przyspieszeniem/opóźnieniem), uczy się Twojego przesunięcia. Nie klika za Ciebie.
// @match        https://*.plemiona.pl/game.php*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// rejestr wersji dla Sprawdzacza skryptów (localStorage, osobny na każdym urządzeniu)
try{var __r=JSON.parse(localStorage.getItem('gdp_registry')||'{}');__r['klin-pro']={v:'3.16',t:Date.now()};localStorage.setItem('gdp_registry',JSON.stringify(__r));}catch(e){}


/* global game_data, Timing, UI */

(function () {
  'use strict';
  if (typeof game_data === 'undefined') return;

  const DAY = 86400000;
  const KEY = 'klin2_' + game_data.world;
  const $ = (id) => document.getElementById(id);
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const num = (v, d) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v))) ? d : Number(v);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- ustawienia i stan ----------
  const st = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
  st.lead = num(st.lead, 100);               // ms: o ile wcześniej odblokować Wyślij (ujemne = później)
  if (!st.leadV2) { st.lead = 100; st.leadV2 = 1; } // jednorazowo: domyślnie puszczam 100 ms wcześniej (bez tego wchodziło za późno)
  st.cancelLead = num(st.cancelLead, 25);  // ms: o ile wcześniej odblokować Anuluj
  st.wedge = Math.max(1, num(st.wedge, 30)); // ms po ataku wroga (minimum 1 – klin ma wejść ZA atakiem)
  st.alarm = Math.max(0, num(st.alarm, 20));
  if (!st.alarmV3) { st.alarm = Math.max(st.alarm, 20); st.alarmV3 = 1; } // jednorazowo: sygnał min. 20 s przed cofnięciem
  st.mode = st.mode || 'auto';             // auto / normal / cofka
  st.secBias = num(st.secBias, 1);         // s: stała poprawka powrotu cofki (wojsko wraca o tyle s później niż S+2k); uczy się z wyniku
  st.speedK = num(st.speedK, 1);           // skala marszu (uczy się z ekranu potwierdzenia)
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* ignore */ } };

  // ---------- czas serwera ----------
  const now = () => {
    try { if (typeof Timing !== 'undefined' && Timing.getCurrentServerTime) return Timing.getCurrentServerTime(); } catch (e) { /* brak */ }
    return Date.now();
  };
  let OFF = null;
  function off() {
    if (OFF !== null) return OFF;
    const el = $('serverTime');
    const m = el && el.textContent.match(/(\d+):(\d+):(\d+)/);
    const disp = m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) : 0;
    const n = now();
    let best = 0, bd = 1e9;
    for (const c of [(window.server_utc_diff || 0) * 1000, 0]) {
      const t = Math.floor((((n + c) % DAY) + DAY) % DAY / 1000);
      let e = Math.abs(t - disp); e = Math.min(e, 86400 - e);
      if (e < bd) { bd = e; best = c; }
    }
    return (OFF = best);
  }
  const tod = (ms) => (((ms + off()) % DAY) + DAY) % DAY;           // ms od północy serwera
  const epochOf = (todMs, shiftDays = 0) => { const n = now(); return n - tod(n) + todMs + shiftDays * DAY; };
  const wrap = (d) => { d %= DAY; if (d > DAY / 2) d -= DAY; if (d < -DAY / 2) d += DAY; return d; };

  function fmtClock(ms) {
    const t = tod(ms);
    const h = Math.floor(t / 3600000), m = Math.floor(t / 60000) % 60, s = Math.floor(t / 1000) % 60, x = t % 1000;
    const dd = Math.floor((ms + off()) / DAY) - Math.floor((now() + off()) / DAY);
    return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(x, 3)}` + (dd ? ` (${dd > 0 ? '+' : ''}${dd} d)` : '');
  }
  function fmtLeft(ms) {
    const neg = ms < 0; ms = Math.abs(ms);
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, x = Math.floor(ms % 1000);
    return (neg ? '−' : '') + (h ? h + ':' + pad(m) : m) + ':' + pad(s) + '.' + pad(x, 3);
  }
  const sgn = (v) => (v >= 0 ? '+' : '') + v;

  function dayDiff(d, mo) {
    const el = $('serverDate');
    const m = el && el.textContent.match(/(\d+)\/(\d+)\/(\d+)/);
    if (!m) return 0;
    const y = +m[3];
    const y2 = mo < +m[2] - 6 ? y + 1 : y;
    return Math.round((Date.UTC(y2, mo - 1, d) - Date.UTC(y, +m[2] - 1, +m[1])) / DAY);
  }

  // "17:45:30:250", "jutro 01:02:03:500", "24.09. 01:02:03:500"
  function parseClock(str, minEpoch) {
    const t = String(str).match(/(\d{1,2}):(\d{2}):(\d{2})(?:[:.,](\d{1,3}))?/);
    if (!t) return null;
    const ms = t[4] ? +t[4].padEnd(3, '0') : 0;
    const tm = ((+t[1] * 60 + +t[2]) * 60 + +t[3]) * 1000 + ms;
    const dm = String(str).match(/(\d{1,2})\.(\d{1,2})\./);
    let shift = 0, fixed = false;
    if (dm) { shift = dayDiff(+dm[1], +dm[2]); fixed = true; }
    else if (/jutro|tomorrow/i.test(str)) { shift = 1; fixed = true; }
    let e = epochOf(tm, shift);
    if (!fixed && e < minEpoch) e += DAY;
    return e;
  }

  const RE_ARR = /(dzisiaj|jutro|dnia\s+\d{1,2}\.\d{1,2}\.?|today|tomorrow)\s+o?\s*(\d{1,2}:\d{2}:\d{2})(?:[:.](\d{1,3}))?/i;
  function parseArrival(text) {
    const m = text.replace(/\s+/g, ' ').match(RE_ARR);
    if (!m) return null;
    let shift = 0;
    if (/jutro|tomorrow/i.test(m[1])) shift = 1;
    else if (/dnia/i.test(m[1])) { const d = m[1].match(/(\d{1,2})\.(\d{1,2})/); shift = dayDiff(+d[1], +d[2]); }
    const [h, mi, s] = m[2].split(':').map(Number);
    const ms = m[3] ? +m[3].padEnd(3, '0') : 0;
    return epochOf(((h * 60 + mi) * 60 + s) * 1000 + ms, shift);
  }

  // ---------- odczyt ekranów ----------
  const MSRE = /(\d{1,2}):(\d{2}):(\d{2})[:.](\d{3})/;
  const findConfirm = () => document.querySelector('#troop_confirm_submit, #troop_confirm_go, input[name="submit_confirm"], #troop_confirm_train');

  function readDuration(root) {
    for (const td of root.querySelectorAll('td, th')) {
      if (!/^(Czas trwania|Trwanie|Duration|Dauer):?$/i.test(td.textContent.trim())) continue;
      const nx = td.nextElementSibling;
      const m = nx && nx.textContent.match(/(\d+):(\d{2}):(\d{2})/);
      if (m) return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000;
    }
    const m = (root.textContent || '').match(/(?:Czas trwania|Trwanie|Duration)\s*:?\s*(\d+):(\d{2}):(\d{2})/i);
    return m ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 : null;
  }
  function readTargetCoords(root) {
    const m = (root.textContent || '').match(/\((\d{1,3})\|(\d{1,3})\)/g);
    return m ? m[0].replace(/[()]/g, '') : 'x';
  }
  // wiersze wychodzących rozkazów na placu: link anuluj + czas przybycia (z ms) + timer
  const CANCEL_SEL = 'a.command-cancel, a[href*="action=cancel"], a[href*="cancel_command"]';
  function outgoing() {
    return Array.from(document.querySelectorAll(CANCEL_SEL)).map((a) => {
      const tr = a.closest('tr');
      const m = tr && tr.textContent.match(MSRE);
      const t = tr && tr.querySelector('span.timer[data-endtime]');
      return {
        a, tr,
        arrTod: m ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4] : null,
        endS: t ? parseInt(t.getAttribute('data-endtime'), 10) : null
      };
    });
  }

  // ---------- dźwięk, alarm ----------
  let actx = null;
  function unlockAudio() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { /* brak audio */ }
  }
  ['pointerdown', 'touchstart', 'click', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { if (!actx || actx.state !== 'running') unlockAudio(); }, { capture: true, passive: true }));
  function beep(freq, len) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = freq; o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.15, actx.currentTime);
      o.start(); o.stop(actx.currentTime + len);
    } catch (e) { /* audio zablokowane */ }
  }
  const buzz = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* brak */ } };
  function askNotify() {
    try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e) { /* brak */ }
    unlockAudio();
  }
  function fireAlarm(left, what) {
    beep(880, 0.15); setTimeout(() => beep(880, 0.15), 250); setTimeout(() => beep(1175, 0.25), 500);
    buzz(200);
    try {
      if (window.Notification && Notification.permission === 'granted') {
        const n = new Notification('⏱ Klin – przygotuj się!', { body: `${what} za ${Math.ceil(left / 1000)} s`, tag: 'klin' });
        n.onclick = () => { window.focus(); n.close(); };
      }
    } catch (e) { /* powiadomienia niedostępne */ }
  }

  // alarm przed cofnięciem: odliczanie pikaniem co sekundę w ostatnich st.alarm sekundach + wibracja + miganie panelu
  let lastBeepKey = '';
  function cancelAlert(ci, rem, box) {
    const on = st.alarm > 0 && rem > 0 && rem <= st.alarm;
    if (box) box.classList.toggle('klin-flash', on && Math.ceil(rem * 2) % 2 === 0);
    if (!on) return;
    const s = Math.ceil(rem), key = ci.start + '|' + s;
    if (key === lastBeepKey) return;
    lastBeepKey = key;
    if (s >= Math.ceil(st.alarm) && alarmKey !== 'a' + ci.start) { alarmKey = 'a' + ci.start; fireAlarm(rem * 1000, 'Cofnięcie'); return; }
    const fin = s <= 3;
    beep(fin ? 1400 : 900, fin ? 0.25 : 0.12);
    buzz(fin ? 300 : 120);
  }
  function alarmRowHtml() {
    return '<div class="row">🔔 sygnał <input form="klin-noform" autocomplete="off" type="number" id="klin-al2" min="0" max="120" step="any" style="width:60px" value="' + st.alarm + '"> s przed cofnięciem (0 = wył.) ' +
      '<button type="button" id="klin-altest">test dźwięku</button> <span id="klin-alst" class="far"></span></div>';
  }
  function wireAlarmRow(root) {
    const inp = root.querySelector('#klin-al2'), tb = root.querySelector('#klin-altest'), stt = root.querySelector('#klin-alst');
    inp.addEventListener('input', () => { st.alarm = Math.max(0, num(inp.value, 0)); save(); alarmKey = null; lastBeepKey = ''; });
    tb.addEventListener('click', (ev) => { ev.preventDefault(); askNotify(); fireAlarm(st.alarm * 1000, 'Test'); });
    setInterval(() => { stt.textContent = actx && actx.state === 'running' ? '🔊 dźwięk włączony' : '🔇 dotknij ekranu lub „test”, żeby włączyć dźwięk'; }, 500);
  }

  // ---------- style ----------
  const css = document.createElement('style');
  css.textContent = `
    #klin-panel, #klin-status { margin:8px 0; padding:8px 10px; background:#f4e4bc; border:2px solid #7d510f; border-radius:4px; font:12px Verdana,sans-serif; }
    #klin-panel input[type=text] { width:150px; font:bold 13px monospace; text-align:center; }
    #klin-panel input[type=number] { width:60px; text-align:center; }
    #klin-panel .row { margin:4px 0; }
    #klin-left, #klin-cleft { font:bold 26px monospace; margin:6px 0 2px; }
    #klin-now { font:13px monospace; }
    .far { color:#6b5a3a; } .soon { color:#b35900; } .go { color:#fff; background:#1a8f1a; padding:0 6px; border-radius:3px; } .late { color:#c40f00; }
    .klin-glow { outline:3px solid #2c0 !important; box-shadow:0 0 14px 4px #2c0 !important; }
    .klin-wait { outline:3px solid #e0a000 !important; }
    /* telefon: szybkie dotknięcia nie mają przybliżać strony (double-tap zoom) */
    html, body, button, input, select, a, #troop_confirm_submit, #troop_confirm_go, input[name="submit_confirm"], #klin-panel, #klin-status, #klin-cbtn { touch-action: manipulation !important; }
    #troop_confirm_submit, #troop_confirm_go, input[name="submit_confirm"], #klin-cbtn { min-height:56px; -webkit-tap-highlight-color: transparent; user-select:none; -webkit-user-select:none; }
    .klin-flash { background:#ff9a3c !important; }
    #klin-missbtn { width:100%; height:90px; font-size:22px; font-weight:bold; border:3px solid #900; background:#f99; touch-action:manipulation; }
    #klin-cbtn { display:none; width:100%; height:90px; margin-top:6px; font-size:26px; font-weight:bold; border:3px solid #7d510f; background:#ddd; }
  `;
  document.head.appendChild(css);

  // ---------- tytuł karty + alarm (wspólne dla wysyłania i cofania) ----------
  let titleTimer = null, alarmKey = null;
  const ORIG_TITLE = document.title;
  function startTicker(getLeft, getKey, what) {
    if (titleTimer) clearInterval(titleTimer);
    const short = ORIG_TITLE.replace(/\s*[-–|]\s*Plemiona.*$/i, '');
    titleTimer = setInterval(() => {
      const left = getLeft();
      if (left === null) { document.title = ORIG_TITLE; return; }
      if (st.alarm > 0 && left > 0 && left <= st.alarm * 1000 && alarmKey !== getKey()) { alarmKey = getKey(); fireAlarm(left, what); }
      if (left < -300) { document.title = '⛔ za późno · ' + short; return; }
      if (left <= 150) { document.title = '🟢 KLIKAJ! · ' + short; return; }
      const s = Math.ceil(left / 1000);
      document.title = (s <= 10 ? '🟠 ' : '⏱ ') + `${Math.floor(s / 60)}:${pad(s % 60)}` + ' · ' + short;
    }, 200);
  }

  // =====================================================================
  //  PLAN: normalny klin albo z cofki
  // =====================================================================
  // Normalny: wysyłasz tak, żeby wejście było o T  →  S = T − marsz.
  // Z cofki: wysyłasz o S, cofasz po k pełnych sekundach, wojsko wraca o S + 2k.
  //          Ms powrotu = ms wysłania, więc S = T − 2k (te same ms co T).
  const LEAD_SLACK = 250;   // ms: o tyle zapas odblokowania może wyjść przed atak (kompensacja czasu reakcji)
  const LATE_TOL = 200;     // ms: o tyle po planowanym celu uznajemy próbę za chybioną (za późno)
  const MARGIN = 4000;      // zapas na przygotowanie przed wysłaniem
  const CANCEL_MAX_K = 590; // gra pozwala cofnąć w ciągu 10 min
  function makePlan(mode, T, n, dur) {
    if (mode === 'normal') {
      const S = T - dur;
      return S >= n + 200
        ? { mode, ok: true, S, T, dur }
        : { mode, ok: false, T, dur, note: 'Za późno na normalny klin: marsz ' + fmtLeft(dur).replace(/\.\d+$/, '') + ' jest dłuższy niż czas do celu.' };
    }
    const kmax = Math.min(Math.floor(dur / 1000) - 1, CANCEL_MAX_K);
    const k = Math.min(kmax, Math.floor((T - n - MARGIN - 1000 * st.secBias) / 2000));
    if (k < 1) {
      return { mode, ok: false, T, dur, note: 'Klin z cofki się nie zmieści: za mało czasu do celu albo cel za blisko (limit cofnięcia: 10 min, cofnąć trzeba przed wejściem).' };
    }
    const S = T - 2000 * k - 1000 * st.secBias;
    return { mode, ok: true, S, T, dur, k, cancelAt: S + 1000 * k };
  }

  // =====================================================================
  //  EKRAN POTWIERDZENIA: panel, wstrzymanie przycisku Wyślij
  // =====================================================================
  const PENDING_GRACE = 60000;
  const validPending = () => (st.pending && st.pending.t > now() - PENDING_GRACE ? st.pending : null);

  // Zapas odblokowania nigdy nie pozwala wejść przed atakiem: najwcześniejsze możliwe kliknięcie daje wejście >= atak + 1 ms
  function leadFor(pl) {
    const P = validPending();
    const a = P && P.attack;
    return a && pl && pl.T ? Math.min(st.lead, pl.T - a - 1 + LEAD_SLACK) : st.lead; // dopuszcza kompensację reakcji palca (~100–250 ms)
  }

  // Plan ze skryptu „Strażnik planu ataku” (ten sam localStorage): okno wysyłki <= 5 min lub konkretna godzina
  const GUARD_MAX_WINDOW = 5 * 60000;
  function guardLocal(str) {
    const m = String(str).match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : NaN;
  }
  function guardianEntry(G) {
    try {
      const g = JSON.parse(localStorage.getItem('planAtaku_' + game_data.world)) || {};
      const done = g.done || {};
      const n = now();
      let best = null;
      (g.plan || []).forEach((a) => {
        if (done[a.id]) return;
        if (String(a.vil) !== String(game_data.village.id) || a.to !== G) return;
        const s0 = guardLocal(a.start), e0 = guardLocal(a.end);
        if (!(s0 > 0) || !(e0 >= s0) || n > e0 || e0 - s0 > GUARD_MAX_WINDOW) return;
        if (!best || e0 < best.end) best = { a, start: s0, end: e0 };
      });
      return best;
    } catch (e) { return null; }
  }

  let panelTimer = null;
  function build(btn) {
    const root = btn.closest('form') || $('content_value') || document.body;
    const dur = readDuration(root);
    if (!dur) return;
    const G = readTargetCoords(root);
    const sig = (btn.id || 'x') + '|' + G + '|' + dur;
    const old = $('klin-panel');
    if (old && old.dataset.sig === sig && document.body.contains(btn)) return;
    if (old) old.remove();

    const C = game_data.village.coord;
    // blokujemy Wyślij tylko przy rozkazie, który pasuje do zaplanowanego klina (inne wysyłki – np. masowe – przechodzą bez zmian)
    const P0 = validPending();
    // klin to mała wysyłka (zwykle 1 jednostka); masowe wysyłki (dużo wojsk) nigdy nie są blokowane
    let tot = 0;
    root.querySelectorAll('input[name]').forEach((i) => {
      if (Object.prototype.hasOwnProperty.call(BASE_MPF, i.name) || i.name === 'knight' || i.name === 'snob') tot += parseInt(i.value, 10) || 0;
    });
    const smallSend = tot === 0 || tot <= 10;
    const P = P0 && smallSend && st.gateOn !== false && (G === P0.coords || (C === P0.coords && (!P0.dest || G === P0.dest))) ? P0 : null;
    let T = P ? P.t : null;
    let guard = null, guardNote = '';
    if (!P && st.gateOn !== false) {
      const g = guardianEntry(G);
      if (g) {
        if (now() < g.start) { guard = g; T = g.start + dur; guardNote = `Plan strażnika #${g.a.id}: wyślij o ${fmtClock(g.start)} (okno do ${fmtClock(g.end).replace(/:\d{3}.*$/, '')}).`; }
        else guardNote = `Plan strażnika #${g.a.id}: okno otwarte do ${fmtClock(g.end).replace(/:\d{3}.*$/, '')} – możesz wysłać teraz, bez blokady.`;
      }
    }

    // kalibracja: porównaj marsz z planu z rzeczywistym marszem z ekranu potwierdzenia
    let calNote = '';
    if (P && P.predDur && String(P.vid) === String(game_data.village.id)) {
      const ratio = dur / P.predDur;
      if (ratio > 0.2 && ratio < 5 && Math.abs(ratio - 1) > 0.002) {
        st.speedK = Math.round(st.speedK * ratio * 10000) / 10000;
        calNote = `Marsz: plan ${fmtLeft(P.predDur).replace(/\.\d+$/, '')}, rzeczywisty ${fmtLeft(dur).replace(/\.\d+$/, '')}. Skorygowałem skalę marszu (×${st.speedK}).`;
      }
      P.predDur = null;
      save();
    }

    const p = document.createElement('div');
    p.id = 'klin-panel';
    p.dataset.sig = sig;
    p.innerHTML = `
      <b>⏱ Klin PRO</b> <span class="far">(cel ${G}, marsz ${fmtLeft(dur).replace(/\.\d+$/, '')})</span>
      <div class="row">Wejście o: <input form="klin-noform" autocomplete="off" type="text" id="klin-t" placeholder="17:45:30:250" value="${T ? fmtClock(T).replace(/ \(.*\)$/, '') : ''}">
        &nbsp; <a href="#" data-d="-100">−100</a> <a href="#" data-d="-10">−10</a> <a href="#" data-d="10">+10</a> <a href="#" data-d="100">+100</a> ms</div>
      <div class="row">Tryb: <select form="klin-noform" id="klin-mode">
          <option value="auto">auto (dobierz)</option><option value="normal">normalny klin</option><option value="cofka">klin z cofki</option></select>
        &nbsp; | &nbsp; puść Wyślij o <input form="klin-noform" autocomplete="off" type="number" id="klin-lead" step="any" value="${st.lead}"> ms wcześniej <span class="far">(−  = później)</span>
        &nbsp; | &nbsp; 🔔 <input form="klin-noform" autocomplete="off" type="number" id="klin-alarm" min="0" max="120" step="any" value="${st.alarm}"> s <span class="far">(0 = wył.)</span>
        &nbsp; | &nbsp; <label><input form="klin-noform" type="checkbox" id="klin-gate" ${st.gateOn !== false ? 'checked' : ''}> blokuj Wyślij do momentu</label></div>
      <div id="klin-modetxt" class="row"></div>
      <div id="klin-plan" class="row"></div>
      <div id="klin-left" class="far">wpisz godzinę wejścia</div>
      <div id="klin-now"></div>
      <div class="row far" style="font-size:10px">Przycisk „Wyślij” jest zablokowany do wyliczonego momentu. Odblokowanie = dźwięk wysokiego tonu, wtedy klikasz sam.
        „Puść o X ms wcześniej” = Twoja reakcja + ping; skrypt sam to koryguje po każdej wysyłce.</div>`;
    const tbl = btn.closest('table');
    const anchor = tbl && root.contains(tbl) && tbl !== root ? tbl : btn;
    anchor.parentElement.insertBefore(p, anchor);
    if (guardNote) calNote = guardNote + (calNote ? ' ' + calNote : '');
    if (calNote) {
      const cn = document.createElement('div');
      cn.className = 'row far';
      cn.textContent = calNote;
      p.appendChild(cn);
    }

    const $t = p.querySelector('#klin-t'), $left = p.querySelector('#klin-left'), $now = p.querySelector('#klin-now');
    const $plan = p.querySelector('#klin-plan'), $mt = p.querySelector('#klin-modetxt');
    const $mode = p.querySelector('#klin-mode'), $lead = p.querySelector('#klin-lead'), $al = p.querySelector('#klin-alarm');
    $mode.value = st.mode;

    function pickMode() {
      if (guard) return { mode: 'normal', why: `plan strażnika #${guard.a.id}: wysyłka o ustalonej godzinie` };
      if (st.mode !== 'auto') return { mode: st.mode, why: 'wybrane ręcznie' };
      if (P) {
        if (G === P.coords && C !== P.coords) return { mode: 'normal', why: 'wysyłasz z innej wioski na atakowaną' };
        if (C === P.coords && G !== P.coords) return { mode: 'cofka', why: 'jesteś w atakowanej wiosce, wojsko wróci do niej' };
      }
      return { mode: 'normal', why: P ? 'cel i wioska nie pasują do zapisanego ataku' : 'brak zapisanego ataku' };
    }

    let plan = null, planKey = '', lastBeep = null;
    function setT() { T = parseClock($t.value, now() - 3600000); plan = null; lastBeep = null; }
    $t.addEventListener('input', () => { askNotify(); setT(); });
    $mode.addEventListener('change', () => { st.mode = $mode.value; save(); plan = null; });
    $lead.addEventListener('input', () => { st.lead = num($lead.value, 0); save(); lastBeep = null; alarmKey = null; });
    p.querySelector('#klin-gate').addEventListener('change', (e) => { st.gateOn = e.target.checked; save(); });
    $al.addEventListener('input', () => { st.alarm = Math.max(0, num($al.value, 0)); save(); alarmKey = null; askNotify(); });
    p.addEventListener('click', askNotify, { once: true });
    p.querySelectorAll('a[data-d]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      if (!T) return;
      $t.value = fmtClock(T + Number(a.dataset.d)).replace(/ \(.*\)$/, '');
      setT();
    }));
    setT();
    if (T === null && P) T = P.t;

    // zapis wysyłki: na placu skrypt odczyta prawdziwe ms i skoryguje przyspieszenie
    let sentOnce = false; // ochrona przed przypadkowym podwójnym kliknięciem: tylko prawdziwe kliknięcia, tylko przez 2 s
    btn.addEventListener('click', (ev) => {
      if (sentOnce && ev.isTrusted) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
      if (btn.disabled) return;
      if (ev.isTrusted) {
        sentOnce = true;
        setTimeout(() => { btn.disabled = true; btn.style.opacity = '0.5'; }, 60);
        setTimeout(() => { sentOnce = false; btn.style.opacity = ''; }, 2000);
      }
      const units = {};
      root.querySelectorAll('input[name]').forEach((i) => {
        if (Object.prototype.hasOwnProperty.call(BASE_MPF, i.name) || i.name === 'knight' || i.name === 'snob') { const n = parseInt(i.value, 10); if (n > 0) units[i.name] = n; }
      });
      if (plan) st.last = { mode: plan.mode, T: plan.T, S: plan.S, k: plan.k || 0, dur, sentClient: now(), G, C, learned: false, bias: st.secBias, attack: (P && P.attack) || null, attackUrl: (P && P.attackUrl) || null, units, vid: String(game_data.village.id), dest: G };
      else st.last = null;
      save();
    }, true);
    const form = btn.closest('form');
    if (form) {
      let subAt = 0;
      form.addEventListener('submit', (ev) => {
        if (btn.disabled && !sentOnce && ev.isTrusted) { ev.preventDefault(); return; }
        if (ev.isTrusted && subAt && Date.now() - subAt < 2000) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
        subAt = Date.now();
      }, true);
    }

    startTicker(() => {
      if (!document.body.contains(p)) { clearInterval(titleTimer); titleTimer = null; return null; }
      return plan && plan.ok ? plan.S - leadFor(plan) - now() : null;
    }, () => (plan ? plan.S : null), 'Przycisk Wyślij odblokuje się');

    if (panelTimer) clearInterval(panelTimer);
    panelTimer = setInterval(() => {
      if (!document.body.contains(p)) { clearInterval(panelTimer); panelTimer = null; return; }
      const n = now();
      const mp = pickMode();
      $mt.textContent = 'Tryb: ' + (mp.mode === 'normal' ? 'normalny klin' : 'klin z cofki') + ' (' + mp.why + ')';
      if (!T || st.gateOn === false) {
        $plan.textContent = ''; $left.textContent = st.gateOn === false ? 'blokada wyłączona – możesz wysłać w każdej chwili' : 'wpisz godzinę wejścia'; $left.className = 'far';
        btn.classList.remove('klin-glow', 'klin-wait');
        btn.disabled = sentOnce;
        return;
      }
      const key = mp.mode + '|' + T + '|' + dur;
      if (!plan || planKey !== key || (plan.mode === 'cofka' && plan.ok && n > plan.S + 500)) { plan = makePlan(mp.mode, T, n, dur); planKey = key; lastBeep = null; }

      if (!plan.ok) {
        let note = plan.note;
        if (st.mode === 'auto' && plan.mode === 'normal' && P && C !== P.coords) note += ` Spróbuj z wioski ${P.coords}: klin z cofki.`;
        $plan.innerHTML = '<span class="late">' + note + '</span>';
        $left.textContent = '—'; $left.className = 'far';
        btn.disabled = sentOnce;
        btn.classList.remove('klin-glow', 'klin-wait');
      } else {
        $plan.innerHTML = plan.mode === 'normal'
          ? `Normalny klin: wyślij o <b>${fmtClock(plan.S)}</b> → wejście o ${fmtClock(plan.T)}`
          : `Klin z cofki: wyślij o <b>${fmtClock(plan.S)}</b>, cofnij po <b>${plan.k} s</b> (o ${fmtClock(plan.cancelAt)}) → powrót o ${fmtClock(plan.T)}`;
        const lf = leadFor(plan);
        const unlockAt = plan.S - lf;
        const pa = P && P.attack;
        if (pa) $plan.innerHTML += `<br>Najwcześniejsze kliknięcie = wejście ${sgn(Math.round(plan.T - lf - pa))} ms po ataku` + (plan.T - lf - pa <= 0 ? ' <span class="late">⚠ tylko natychmiastowe kliknięcie po odblokowaniu wejdzie przed atakiem</span>' : '') + (lf < st.lead ? ` <span class="late">(zapas ograniczony do ${lf} ms)</span>` : '');
        const left = unlockAt - n;
        const locked = left > 0;
        btn.disabled = locked || sentOnce;
        $left.textContent = left >= -300 ? 'Odblokuje się za ' + fmtLeft(Math.max(0, left)) : 'Za późno o ' + fmtLeft(-left) + (plan.mode === 'cofka' ? ' – przeliczam' : ' – wpisz nowy czas');
        $left.className = left < -300 ? 'late' : left <= 150 ? 'go' : left < 10000 ? 'soon' : 'far';
        btn.classList.toggle('klin-glow', left <= 150 && left > -300);
        btn.classList.toggle('klin-wait', left > 150 && left < 10000);
        const sec = Math.ceil(left / 1000);
        if (left > 0 && sec <= 3 && sec !== lastBeep) { lastBeep = sec; beep(660, 0.08); }
        if (left <= 0 && lastBeep !== 0 && left > -300) { lastBeep = 0; beep(1320, 0.18); buzz(80); }
      }
      const arr = n + dur;
      $now.textContent = 'Jeśli klikniesz teraz, wejdzie o ' + fmtClock(arr) + (T && plan && plan.mode === 'normal' ? ` (${sgn(Math.round(arr - T))} ms od celu)` : '');
    }, 30);
  }

  // =====================================================================
  //  PRZYBYWAJĄCE ATAKI: przycisk ⏱ przy każdym
  // =====================================================================
  const toast = (t) => (typeof UI !== 'undefined' && UI.SuccessMessage ? UI.SuccessMessage(t, 5000) : console.log(t));
  const onInfo = /screen=info_village/.test(location.search);

  function infoVillageCoords() {
    for (const td of document.querySelectorAll('#content_value td')) {
      if (/^(Współrzędne|Coordinates|Koordinaten):?$/i.test(td.textContent.trim()) && td.nextElementSibling) {
        const m = td.nextElementSibling.textContent.match(/(\d{1,3}\|\d{1,3})/);
        if (m) return m[1];
      }
    }
    return null;
  }
  function coordsOfRow(tr, targetCol, pageCoords) {
    if (targetCol >= 0 && tr.children[targetCol]) {
      const m = tr.children[targetCol].textContent.match(/\((\d{1,3}\|\d{1,3})\)/);
      if (m) return m[1];
    }
    if (pageCoords) return pageCoords;
    return game_data.village && game_data.village.coord ? game_data.village.coord : null;
  }
  function tableKind(table) {
    if (table.querySelector('table') || table.closest('#klin-panel')) return null;
    const head = table.querySelector('tr');
    const headTxt = head ? Array.from(head.querySelectorAll('th')).map((th) => th.textContent.trim()).join(' | ') : '';
    if (table.id === 'incomings_table' || table.closest('#show_incoming_units, [id*="incoming"]') ||
        /^(Przybywające|Nadchodzące|Incoming|Ankommend)/i.test(headTxt)) return 'in';
    if (onInfo && /^(Własne rozkazy|Own commands|Eigene Befehle)/i.test(headTxt)) return 'own';
    return null;
  }
  function addDirectButton() {
    if ($('klin-direct')) return;
    const a = document.querySelector('#send_troops');
    const m = a && (a.getAttribute('href') || '').match(/target=(\d+)/);
    const coords = infoVillageCoords();
    const row = a && a.closest('tr');
    if (!m || !coords || !row) return;
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="2"><a href="#" id="klin-direct"><b>⏱ Klin PRO: atakuj stąd – wioski i jednostki</b></a></td>';
    row.parentNode.insertBefore(tr, row.nextSibling);
    tr.querySelector('a').addEventListener('click', (e) => {
      e.preventDefault();
      startPlanner({ coords, t: null, targetId: m[1] });
      setTimeout(() => { const b = $('klin-plan-box'); if (b && b.scrollIntoView) b.scrollIntoView({ block: 'start' }); }, 50);
    });
  }
  function addWedgeButtons() {
    const pageCoords = onInfo ? infoVillageCoords() : null;
    document.querySelectorAll('table').forEach((table) => {
      const kind = tableKind(table);
      if (!kind) return;
      const rows = Array.from(table.querySelectorAll('tr')).filter((tr) => tr.querySelector('td') && RE_ARR.test(tr.textContent.replace(/\s+/g, ' ')));
      if (!rows.length) return;
      const th = Array.from(table.querySelectorAll('th')).find((x) => /^(Cel|Target|Ziel)$/i.test(x.textContent.trim()));
      const targetCol = th ? Array.from(th.parentElement.children).indexOf(th) : -1;

      if (!$('klin-bar')) {
        const bar = document.createElement('div');
        bar.id = 'klin-bar';
        bar.style.cssText = 'margin:3px 0;font-size:11px';
        bar.innerHTML = `⏱ Klin: wejdź <input form="klin-noform" autocomplete="off" type="number" min="1" step="any" value="${st.wedge}" style="width:56px;text-align:center"> ms po ataku <span class="grey">(min. 1 – zawsze za atakiem)</span>`;
        bar.querySelector('input').addEventListener('input', (e) => { st.wedge = Math.max(1, num(e.target.value, 30)); save(); });
        table.parentElement.insertBefore(bar, table);
      }
      rows.forEach((tr) => {
        if (tr.querySelector('.klin-btn')) return;
        const at = parseArrival(tr.textContent);
        const coords = coordsOfRow(tr, targetCol, kind === 'own' || onInfo ? pageCoords : null);
        if (!at || !coords) return;
        const b = document.createElement('a');
        b.href = '#';
        b.className = 'klin-btn';
        b.textContent = '⏱';
        b.title = 'Ustaw klin pod ten atak i przejdź na Plac';
        b.style.cssText = 'margin-left:4px;text-decoration:none;font-size:13px';
        b.addEventListener('click', (e) => {
          e.preventDefault();
          const t = at + st.wedge;
          const il = tr.querySelector('a[href*="info_command"]');
          st.pending = { coords, t, attack: at, attackUrl: il ? il.getAttribute('href') : null, ts: Date.now() };
          st.retry = null;
          st.last = null;
          save();
          toast(`Klin: wejście ${fmtClock(t)} na (${coords}). Sprawdzam, które wioski zdążą.`);
          startPlanner(st.pending);
        });
        (tr.querySelector('td') || tr).appendChild(b);
      });
    });
  }

  // =====================================================================
  //  PLAC: cel, podpowiedź, uczenie się, cofanie
  // =====================================================================
  let coordsDone = false, unitDone = false; // wypełniamy tylko raz na wczytanie strony – ręczne czyszczenie pól zostaje
  function prefillDirect() {
    const d = st.direct;
    if (!d || d.ts < Date.now() - 5 * 60000 || String(d.vid) !== String(game_data.village.id) || findConfirm()) return;
    const inp = $('unit_input_' + d.unit);
    if (!inp) return;
    let have = parseInt(inp.getAttribute('data-all-count'), 10);
    if (!Number.isFinite(have)) { const e = $('units_entry_all_' + d.unit), m = e && e.textContent.match(/(\d+)/); have = m ? +m[1] : 0; }
    if (have > 0 && !inp.value && !inp.disabled) {
      inp.value = have;
      ['input', 'change', 'keyup'].forEach((ev) => inp.dispatchEvent(new Event(ev, { bubbles: true })));
    }
    delete st.direct;
    save();
  }
  function prefillPlace() {
    const p = validPending();
    if (!p || p.t < now()) return;
    if (findConfirm()) return;
    const C = game_data.village.coord;
    const cofka = C === p.coords;
    let filled = false;
    // normalny klin: wpisz atakowaną wioskę; klin z cofki: wpisz cel wybrany przez planer (pobliska własna wioska)
    const R = st.retry && st.retry.ts > Date.now() - 20 * 60000 && String(st.retry.vid) === String(game_data.village.id) ? st.retry : null;
    const fillCoords = cofka ? ((R && R.dest) || p.dest) : p.coords;
    if (fillCoords && !coordsDone) {
      const [x, y] = fillCoords.split('|');
      const set = (el, v) => {
        if (!el || el.value) return false;
        el.value = v;
        ['input', 'change', 'keyup', 'blur'].forEach((ev) => el.dispatchEvent(new Event(ev, { bubbles: true })));
        return true;
      };
      const one = document.querySelector('input.target-input-field, input[name="input"]#place_target, #place_target input');
const ix = document.querySelector('#inputx, input[name="x"]'), iy = document.querySelector('#inputy, input[name="y"]');
      if (one || (ix && iy)) coordsDone = true;
      filled = one ? set(one, fillCoords) : (set(ix, x) | set(iy, y));
    }
    // planer wskazał jednostkę: wpisz 1 sztukę
    let unitNote = '';
    if (R && cofka && !unitDone) {
      let any = false, filledU = [];
      Object.keys(R.units).forEach((u) => {
        const inp = $('unit_input_' + u);
        if (!inp) return;
        any = true;
        let have = parseInt(inp.getAttribute('data-all-count'), 10);
        if (!Number.isFinite(have)) { const e = $('units_entry_all_' + u), m = e && e.textContent.match(/(\d+)/); have = m ? +m[1] : 0; }
        const n = Math.min(R.units[u], have);
        if (n > 0 && !inp.value && !inp.disabled) {
          inp.value = n;
          ['input', 'change', 'keyup'].forEach((ev) => inp.dispatchEvent(new Event(ev, { bubbles: true })));
          filledU.push(`${n} ${UNIT_PL[u] || u}`);
        }
      });
      if (any) unitDone = true;
      if (filledU.length) unitNote = ` Wypełniono tymi samymi wojskami co poprzednio: ${filledU.join(', ')}.`;
    } else if (p.unit && !unitDone && String(p.vid) === String(game_data.village.id)) {
      const inp = $('unit_input_' + p.unit);
      if (inp) unitDone = true;
      let have = inp ? parseInt(inp.getAttribute('data-all-count'), 10) : 0;
      if (inp && !Number.isFinite(have)) { const e = $('units_entry_all_' + p.unit), m = e && e.textContent.match(/(\d+)/); have = m ? +m[1] : 0; }
      if (inp && !inp.value && !inp.disabled && have > 0) {
        inp.value = 1;
        ['input', 'change', 'keyup'].forEach((ev) => inp.dispatchEvent(new Event(ev, { bubbles: true })));
        unitNote = ` Wpisałem 1 szt.: ${UNIT_PL[p.unit] || p.unit}.`;
      }
    }
    if ($('klin-hint')) return;
    const form = document.querySelector('#command-data-form, form[name="units"]') || $('content_value');
    if (!form) return;
    const h = document.createElement('div');
    h.id = 'klin-hint';
    h.className = 'info_box';
    h.style.cssText = 'margin:4px 0;padding:4px 8px';
    h.innerHTML = cofka
      ? `⏱ Klin z cofki w tej wiosce: wejście <b>${fmtClock(p.t)}</b>.` +
        (p.dest ? ` Cel: <b>${p.dest}</b> (własna wioska, wyślij jako <b>Wsparcie</b>).` : ' Wybierz pobliską wioskę jako cel.') +
        `${unitNote} Na potwierdzeniu wyliczę moment wysłania i cofnięcia. <a href="#" id="klin-cancel-p">anuluj klin</a>`
      : `⏱ Klin: cel <b>${p.coords}</b>${filled ? '' : ''}, wejście <b>${fmtClock(p.t)}</b>.${unitNote} Normalny klin, jeśli zdążysz; jeśli nie, skrypt podpowie klin z cofki z wioski ${p.coords}. <a href="#" id="klin-cancel-p">anuluj klin</a>`;
    form.parentElement.insertBefore(h, form);
    h.querySelector('#klin-cancel-p').addEventListener('click', (e) => { e.preventDefault(); delete st.pending; save(); h.remove(); });
  }

  // =====================================================================
  //  PLANER: które wioski zdążą z normalnym klinem, a jak żadna – klin z cofki
  // =====================================================================
  const BASE_MPF = { spear: 18, sword: 22, axe: 18, archer: 18, spy: 9, light: 10, marcher: 10, heavy: 11, ram: 30, catapult: 30 }; // min/pole przy prędkości 1
  const WEDGE_ORDER = ['spy', 'spear', 'axe', 'light', 'archer', 'marcher', 'heavy', 'sword', 'ram', 'catapult']; // czym wolisz klinować
  const UNIT_PL = { spear: 'pikinier', sword: 'miecznik', axe: 'topornik', archer: 'łucznik', spy: 'zwiadowca', light: 'lekka kaw.', marcher: 'łucznik konny', heavy: 'ciężka kaw.', ram: 'taran', catapult: 'katapulta' };
  const PLAN_MARGIN = 20000; // ms zapasu na dojście do wioski i wysłanie
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // na zastępstwie adres niesie t=<id gracza>; bez niego gra przenosi na własne konto
  const sitterT = () => new URLSearchParams(location.search).get('t');
  const gameUrl = (vid, screen, extra) => `/game.php?village=${vid}&screen=${screen}` + (extra ? '&' + extra : '') + (sitterT() ? `&t=${encodeURIComponent(sitterT())}` : '');
  async function getDoc(url, type) {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return new DOMParser().parseFromString(await r.text(), type || 'text/html');
  }

  // Prędkości jednostek na tym świecie (min/pole, z uwzględnieniem prędkości świata)
  async function loadSpeeds() {
    const c = st.cfg;
    if (c && c.mpf && Date.now() - c.ts < 7 * DAY) return c;
    let k = 1;
    try {
      const d1 = await getDoc('/interface.php?func=get_config', 'text/xml');
      const ws = parseFloat((d1.getElementsByTagName('speed')[0] || {}).textContent);
      const us = parseFloat((d1.getElementsByTagName('unit_speed')[0] || {}).textContent);
      if (ws > 0 && us > 0) k = ws * us;
    } catch (e) { /* domyślnie 1 */ }
    let doc = null;
    try { doc = await getDoc('/interface.php?func=get_unit_info', 'text/xml'); } catch (e) { /* domyślne wartości */ }
    const mpf = {};
    Object.keys(BASE_MPF).forEach((u) => {
      const base = BASE_MPF[u];
      let val = base / k;
      const node = doc && doc.getElementsByTagName(u)[0];
      const sp = node && node.getElementsByTagName('speed')[0];
      const v = sp ? parseFloat(sp.textContent) : NaN;
      if (v > 0) {
        // format wartości bywa różny (min/pole, pola/min, s/pole) – bierzemy ten, który pasuje do bazy
        let best = null, bd = 1e9;
        [v, 1 / v, v / 60, 1 / (v * 60)].forEach((cnd) => {
          const d = Math.min(Math.abs(cnd / base - 1), Math.abs(cnd / (base / k) - 1));
          if (d < bd) { bd = d; best = cnd; }
        });
        if (bd < 0.25) val = Math.abs(best / (base / k) - 1) <= Math.abs(best / base - 1) ? best : best / k;
      }
      mpf[u] = val;
    });
    st.cfg = { ts: Date.now(), k, mpf };
    save();
    return st.cfg;
  }

  // Lista własnych wiosek (id, współrzędne, nazwa)
  async function loadVillages() {
    const doc = await getDoc(gameUrl(game_data.village.id, 'overview_villages', 'mode=prod&page=-1'));
    const out = [], seen = new Set();
    const add = (id, text) => {
      const m = text.match(/\((\d{1,3})\|(\d{1,3})\)/);
      if (!id || !m || seen.has(id)) return;
      seen.add(id);
      out.push({ id, x: +m[1], y: +m[2], coords: m[1] + '|' + m[2], name: text.trim().replace(/\s+/g, ' ') });
    };
    doc.querySelectorAll('span.quickedit-vn[data-id]').forEach((s) => add(s.getAttribute('data-id'), s.textContent));
    if (!out.length) {
      doc.querySelectorAll('a[href*="screen=overview"]').forEach((a) => {
        const m = (a.getAttribute('href') || '').match(/village=(\d+)/);
        add(m && m[1], a.textContent);
      });
    }
    return out;
  }

  // Wojska stojące w wiosce (ze ekranu placu wskazanej wioski)
  async function loadUnits(vid) {
    const doc = await getDoc(gameUrl(vid, 'place'));
    const res = {};
    doc.querySelectorAll('input[id^="unit_input_"]').forEach((i) => {
      const u = i.id.replace('unit_input_', '');
      let n = parseInt(i.getAttribute('data-all-count'), 10);
      if (!Number.isFinite(n)) {
        const e = doc.getElementById('units_entry_all_' + u);
        const m = e && e.textContent.match(/(\d+)/);
        n = m ? +m[1] : 0;
      }
      res[u] = n;
    });
    return res;
  }

  // Wszystkie wioski + wojska "w wiosce" jednym zapytaniem z Przeglądu wojsk (mode=units)
  function parseUnitsOverview(doc, into) {
    const tbl = doc.getElementById('units_table');
    if (!tbl) return 0;
    const cols = Array.from(tbl.querySelectorAll('thead th')).map((th) => {
      const img = th.querySelector('img');
      const m = img && (img.getAttribute('src') || '').match(/unit_([a-z]+)\./i);
      return m ? m[1].toLowerCase() : null;
    });
    let added = 0;
    tbl.querySelectorAll('tbody').forEach((tb) => {
      const vn = tb.querySelector('span.quickedit-vn[data-id]');
      if (!vn) return;
      const id = vn.getAttribute('data-id');
      const lab = vn.textContent.replace(/\s+/g, ' ').trim();
      const cm = lab.match(/\((\d{1,3})\|(\d{1,3})\)/);
      if (!cm || into.map[id]) return;
      const trs = Array.from(tb.querySelectorAll('tr'));
      const home = trs.find((tr) => /^(w wiosce|in village)$/i.test((tr.children[0] && tr.children[0].textContent || '').trim())) || trs[1];
      if (!home) return;
      const units = {};
      // komórki jednostek idą po etykiecie wiersza, w kolejności nagłówków (pomijamy pierwsze 2 th: Wioska i pusty)
      const unitCols = cols.slice(2);
      const tds = Array.from(home.querySelectorAll('td.unit-item'));
      unitCols.forEach((u, i) => { if (u && tds[i]) units[u] = parseInt(tds[i].textContent.replace(/\D/g, ''), 10) || 0; });
      into.map[id] = units;
      into.list.push({ id, x: +cm[1], y: +cm[2], coords: cm[1] + '|' + cm[2], name: lab });
      added++;
    });
    return added;
  }
  async function loadAllUnits() {
    const into = { list: [], map: {} };
    const base = 'mode=units&type=complete&group=0';
    const doc = await getDoc(gameUrl(game_data.village.id, 'overview_villages', base + '&page=-1'));
    parseUnitsOverview(doc, into);
    const hm = (doc.querySelector('#units_table thead th') || {}).textContent || '';
    const total = +((hm.match(/\((\d+)\)/) || [])[1] || 0);
    for (let pg = 0; total && into.list.length < total && pg < 20; pg++) {
      const d = await getDoc(gameUrl(game_data.village.id, 'overview_villages', base + '&page=' + pg));
      if (!parseUnitsOverview(d, into)) break;
    }
    return into;
  }

  let planRun = 0;
  const PRESETS = { all: WEDGE_ORDER.slice(), def: ['spear', 'sword', 'archer', 'heavy'], off: ['axe', 'light', 'marcher', 'ram'], wall: ['ram', 'catapult'] };
  async function startPlanner(pend) {
    const run = ++planRun;
    let box = $('klin-plan-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'klin-plan-box';
      box.style.cssText = 'margin:8px 0;padding:8px 10px;background:#f4e4bc;border:2px solid #7d510f;border-radius:4px;font:12px Verdana,sans-serif';
      const host = $('content_value') || document.body;
      host.insertBefore(box, host.firstChild);
    }
    const say = (h) => { if (run === planRun) box.innerHTML = h; };
    const T = pend.t;
    const direct = !T; // tryb bezpośredni: atak na wioskę bez zadanej godziny – sam podgląd, z których wiosek i czym można zaatakować
    const head = direct
      ? `<b>⏱ Klin PRO – atak na (${esc(pend.coords)})</b> <span class="far">z których wiosek i czym możesz zaatakować</span>`
      : `<b>⏱ Klin PRO – planowanie</b> <span class="far">wejście o ${fmtClock(T)} na (${esc(pend.coords)})</span>`;
    const fallback = `<a href="${gameUrl(game_data.village.id, 'place')}">przejdź na plac</a>`;
    if (!direct && T < now() + 3000) { say(head + '<div class="row late">Ten czas już minął albo jest za blisko.</div>'); return; }
    say(head + '<div class="row">Pobieram dane świata i listę wiosek…</div>');
    try {
      const cfg = await loadSpeeds();
      let allU = null;
      try { allU = await loadAllUnits(); if (!allU.list.length) allU = null; } catch (e) { allU = null; }
      const vill = allU ? allU.list : await loadVillages();
      if (!vill.length) throw new Error('nie znalazłem listy wiosek');
      const target = vill.find((v) => v.coords === pend.coords);
      const [tx, ty] = pend.coords.split('|').map(Number);
      const V = []; // wszystkie własne wioski (poza ratowaną) z wojskami "w wiosce"
      for (let i = 0; i < vill.length; i++) {
        if (run !== planRun) return;
        const v = vill[i];
        if (v.coords === pend.coords) continue;
        say(head + `<div class="row">Sprawdzam wojska w wioskach… ${i + 1}/${vill.length}</div>`);
        let units;
        try { units = (allU && allU.map[v.id]) || await loadUnits(v.id); } catch (e) { continue; }
        V.push({ v, units, dist: Math.hypot(v.x - tx, v.y - ty) });
        if (!(allU && allU.map[v.id])) await sleep(120);
      }
      const go = (vid, extra) => {
        st.pending = Object.assign({ coords: pend.coords, t: T, attack: pend.attack, attackUrl: pend.attackUrl, ts: Date.now() }, extra);
        st.last = null;
        st.retry = null;
        save();
        location.href = gameUrl(vid, 'place');
      };
      const canCofka = !direct && !!target && T - now() >= 8000;
      const durOf = (r, u) => Math.round(r.dist * cfg.mpf[u] * 60 * st.speedK) * 1000;
      const mmss = (ms) => fmtLeft(Math.max(0, ms)).replace(/\.\d+$/, '');

      const controls = (sel, minN, showLate) => {
        let h = '<div class="row" style="margin-top:6px"><b>Jednostki:</b> ' + WEDGE_ORDER.map((u) =>
          `<label style="margin-right:8px;white-space:nowrap"><input type="checkbox" form="klin-noform" data-pu="${u}" ${sel.includes(u) ? 'checked' : ''}> ${esc(UNIT_PL[u])}</label>`).join('') + '</div>';
        h += '<div class="row">Zestawy: <a href="#" data-preset="def">🛡 obrona</a> · <a href="#" data-preset="off">⚔ wycięcie obrony</a> · <a href="#" data-preset="wall">🧱 mur (tarany / katapulty)</a> · <a href="#" data-preset="all">wszystkie</a>' +
          ` &nbsp;|&nbsp; min. sztuk: <input type="number" form="klin-noform" id="klin-pmin" min="1" step="any" style="width:60px" value="${minN}">` +
          ` &nbsp;|&nbsp; <label><input type="checkbox" form="klin-noform" id="klin-plate" ${showLate ? 'checked' : ''}> ${direct ? 'pokaż też wioski bez wybranych jednostek' : 'pokaż też wioski, które nie zdążą'}</label>` +
          ' &nbsp;|&nbsp; <a href="#" id="klin-prefresh">przelicz teraz</a> · <a href="#" id="klin-preload">pobierz wojska od nowa</a></div>';
        if (pend.targetId) {
          h += '<div class="row">Wejście o (opcjonalnie): <input type="text" form="klin-noform" id="klin-dt" placeholder="hh:mm:ss:ms" style="width:110px" value="' + (direct ? '' : esc(fmtClock(T).replace(/ \(.*\)$/, ''))) + '"> ' +
            '<a href="#" id="klin-dset">ustaw godzinę (klin)</a>' + (direct ? '' : ' · <a href="#" id="klin-dclr">bez godziny (sam podgląd)</a>') + '</div>';
        }
        return h;
      };
      const renderDirect = (sel, minN) => {
        const n = now();
        const rows = [], none = [];
        V.forEach((r) => {
          const opts = sel.filter((u) => (r.units[u] || 0) >= minN).map((u) => ({ u, dur: durOf(r, u), n: r.units[u] })).sort((a, b) => a.dur - b.dur);
          if (opts.length) rows.push({ r, b: opts[0], alts: opts.slice(1) }); else none.push(r);
        });
        rows.sort((a, b) => a.b.dur - b.b.dur);
        none.sort((a, b) => a.v.name.localeCompare(b.v.name, 'pl'));
        let html = head + ` <span class="far">wioski: ${V.length}, skala marszu ×${st.speedK}</span>`;
        html += controls(sel, minN, !!st.planLate);
        html += `<div class="row"><b>${rows.length}</b> z ${V.length} wiosek ma wybrane jednostki (najszybsze na górze; „Atakuj” otwiera plac tej wioski z celem i wypełnionymi wojskami).</div>`;
        const cells = rows.map((x) => {
          const arr = n + x.b.dur;
          return `<tr><td>${esc(x.r.v.name)}</td><td>${x.r.dist.toFixed(1)}</td><td>${esc(UNIT_PL[x.b.u] || x.b.u)} (${x.b.n})` +
            (x.alts.length ? `<br><span class="far">też: ` + x.alts.map((a) => `<a href="#" data-v="${x.r.v.id}" data-u="${a.u}">${esc(UNIT_PL[a.u] || a.u)} (${a.n}) ${mmss(a.dur)}</a>`).join(', ') + '</span>' : '') +
            `</td><td>${mmss(x.b.dur)}</td><td>${fmtClock(arr).replace(/:\d{3}/, '')}</td><td><a href="#" data-v="${x.r.v.id}">Atakuj</a></td></tr>`;
        });
        if (st.planLate) none.forEach((r) => cells.push(`<tr style="opacity:.6"><td>${esc(r.v.name)}</td><td>${r.dist.toFixed(1)}</td><td colspan="4" class="far">brak wybranych jednostek (min. ${minN} szt.)</td></tr>`));
        html += cells.length
          ? '<div style="max-height:420px;overflow:auto;margin-top:4px"><table class="vis" style="width:100%"><tr><th>Wioska</th><th>Pola</th><th>Jednostka</th><th>Marsz</th><th>Dojdzie (gdybyś wysłał teraz)</th><th></th></tr>' + cells.join('') + '</table></div>'
          : '<div class="row late" style="margin-top:6px">Żadna wioska nie ma wybranych jednostek w wymaganej liczbie.</div>';
        say(html);
        wire(rows);
      };

      const render = () => {
        if (run !== planRun) return;
        const n = now();
        const avail = T - n - PLAN_MARGIN;
        const sel = (Array.isArray(st.planUnits) ? st.planUnits : WEDGE_ORDER).filter((u) => WEDGE_ORDER.includes(u));
        const minN = Math.max(1, Math.round(num(st.planMin, 1)));
        if (direct) { renderDirect(sel, minN); return; }
        const okRows = [], lateRows = [], noneRows = [];
        V.forEach((r) => {
          const opts = sel.filter((u) => (r.units[u] || 0) >= minN).map((u) => ({ u, dur: durOf(r, u), n: r.units[u] }));
          const good = opts.filter((o) => o.dur <= avail).sort((a, b) => b.dur - a.dur); // domyślnie najwolniejsza, która zdąży
          if (good.length) okRows.push({ r, b: good[0], alts: good.slice(1), left: avail - good[0].dur });
          else if (opts.length) { const f = opts.slice().sort((a, b) => a.dur - b.dur)[0]; lateRows.push({ r, b: f, alts: [], late: f.dur - (T - n) }); }
          else noneRows.push({ r });
        });
        okRows.sort((a, b) => b.left - a.left);
        lateRows.sort((a, b) => a.late - b.late);
        noneRows.sort((a, b) => a.r.v.name.localeCompare(b.r.v.name, 'pl'));
        const showLate = !!st.planLate;

        let html = head + ` <span class="far">wioski: ${V.length}, skala marszu ×${st.speedK}</span>`;
        html += controls(sel, minN, showLate);
        html += `<div class="row"><b>Zdążą: ${okRows.length}</b> z ${V.length} wiosek (wybrane jednostki, zapas ${PLAN_MARGIN / 1000} s na wysłanie).</div>`;

        const unitCell = (x) => `${esc(UNIT_PL[x.b.u] || x.b.u)} (${x.b.n})` + (x.alts.length
          ? `<br><span class="far">też: ` + x.alts.map((a) => `<a href="#" data-v="${x.r.v.id}" data-u="${a.u}">${esc(UNIT_PL[a.u] || a.u)} (${a.n})</a>`).join(', ') + '</span>' : '');
        const rowsHtml = [];
        okRows.forEach((x) => {
          const arr = n + x.b.dur;
          rowsHtml.push(`<tr><td>${esc(x.r.v.name)}</td><td>${unitCell(x)}</td><td>${mmss(x.b.dur)}</td><td>${fmtClock(T - x.b.dur).replace(/:\d{3}/, '')}</td>` +
            `<td>✔ dojdzie ${fmtClock(arr).replace(/:\d{3}/, '')}, zapas ${mmss(T - arr)}</td><td><a href="#" data-v="${x.r.v.id}">Wybierz</a></td></tr>`);
        });
        if (showLate) {
          lateRows.forEach((x) => {
            const arr = n + x.b.dur;
            rowsHtml.push(`<tr style="opacity:.75"><td>${esc(x.r.v.name)}</td><td>${esc(UNIT_PL[x.b.u] || x.b.u)} (${x.b.n})</td><td>${mmss(x.b.dur)}</td><td>–</td>` +
              `<td class="late">✖ dojdzie ${fmtClock(arr).replace(/:\d{3}/, '')}, spóźni się o ${mmss(x.late)}</td><td></td></tr>`);
          });
          noneRows.forEach((x) => {
            rowsHtml.push(`<tr style="opacity:.6"><td>${esc(x.r.v.name)}</td><td colspan="5" class="far">brak wybranych jednostek (min. ${minN} szt.)</td></tr>`);
          });
        }
        if (rowsHtml.length) {
          html += '<div style="max-height:420px;overflow:auto;margin-top:4px"><table class="vis" style="width:100%"><tr><th>Wioska</th><th>Jednostka</th><th>Marsz</th><th>Wyślij o</th><th>Gdybyś wysłał teraz</th><th></th></tr>' + rowsHtml.join('') + '</table></div>';
        } else {
          html += `<div class="row late" style="margin-top:6px">Żadna wioska nie zdąży normalnym klinem wybranymi jednostkami (zapas ${PLAN_MARGIN / 1000} s na wysłanie).</div>`;
        }
        html += '<div class="row" style="margin-top:6px">' + (canCofka
          ? `${okRows.length ? 'Albo: ' : '<b>Proponuję:</b> '}<a href="#" id="klin-go-cofka"><b>klin z cofki z wioski ratowanej (${esc(target.name)})</b></a>`
          : `<span class="far">${target ? 'Za mało czasu na klin z cofki.' : 'Wioska ratowana nie jest na liście twoich wiosek, klin z cofki niedostępny.'}</span>`) + '</div>';
        say(html);
        wire(okRows);
      };

      const wire = (okRows) => {
        box.querySelectorAll('input[data-pu]').forEach((c) => c.addEventListener('change', () => {
          st.planUnits = Array.from(box.querySelectorAll('input[data-pu]')).filter((x) => x.checked).map((x) => x.dataset.pu);
          save(); render();
        }));
        box.querySelectorAll('a[data-preset]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); st.planUnits = PRESETS[a.dataset.preset].slice(); save(); render(); }));
        const pm = box.querySelector('#klin-pmin');
        if (pm) pm.addEventListener('change', () => { st.planMin = Math.max(1, Math.round(num(pm.value, 1))); save(); render(); });
        const pl = box.querySelector('#klin-plate');
        if (pl) pl.addEventListener('change', () => { st.planLate = pl.checked; save(); render(); });
        const pr = box.querySelector('#klin-prefresh');
        if (pr) pr.addEventListener('click', (e) => { e.preventDefault(); render(); });
        const pw = box.querySelector('#klin-preload');
        if (pw) pw.addEventListener('click', (e) => { e.preventDefault(); startPlanner(pend); });
        box.querySelectorAll('a[data-v]').forEach((a) => a.addEventListener('click', (e) => {
          e.preventDefault();
          const x = okRows.find((o) => String(o.r.v.id) === a.dataset.v);
          if (!x) return;
          const u = a.dataset.u || x.b.u;
          if (direct) {
            st.direct = { vid: x.r.v.id, unit: u, ts: Date.now() };
            save();
            location.href = gameUrl(x.r.v.id, 'place', 'target=' + pend.targetId);
            return;
          }
          go(x.r.v.id, { vid: x.r.v.id, unit: u, predDur: durOf(x.r, u) });
        }));
        const dset = box.querySelector('#klin-dset');
        if (dset) dset.addEventListener('click', (e) => {
          e.preventDefault();
          const t = parseClock(box.querySelector('#klin-dt').value, now());
          if (t === null || t < now() + 3000) { alert('Podaj godzinę wejścia z przyszłości, np. 23:15:30:250.'); return; }
          startPlanner(Object.assign({}, pend, { t }));
        });
        const dclr = box.querySelector('#klin-dclr');
        if (dclr) dclr.addEventListener('click', (e) => { e.preventDefault(); startPlanner(Object.assign({}, pend, { t: null })); });
        const gc = box.querySelector('#klin-go-cofka');
        if (gc) gc.addEventListener('click', async (e) => {
          e.preventDefault();
          say(head + '<div class="row">Wybieram jednostkę i cel dla klina z cofki…</div>');
          let units = {};
          try { units = (allU && allU.map[target.id]) || await loadUnits(target.id); } catch (err) { /* bez wojsk */ }
          const selU = (Array.isArray(st.planUnits) ? st.planUnits : WEDGE_ORDER).filter((u) => WEDGE_ORDER.includes(u));
          const unit = WEDGE_ORDER.find((u) => selU.includes(u) && units[u] > 0) || WEDGE_ORDER.find((u) => units[u] > 0) || null;
          const extra = { vid: target.id };
          if (unit) {
            // cel musi być na tyle daleko, żeby marsz trwał dłużej niż czas do cofnięcia (k s)
            const kWant = Math.min(CANCEL_MAX_K, Math.floor((T - now() - MARGIN) / 2000));
            const list = vill.filter((v) => v.id !== target.id)
              .map((v) => ({ v, d: Math.round(Math.hypot(v.x - target.x, v.y - target.y) * cfg.mpf[unit] * 60 * st.speedK) * 1000 }))
              .filter((x) => x.d >= 3000);
            const enough = list.filter((x) => x.d >= (kWant + 2) * 1000).sort((a, b) => a.d - b.d)[0];
            const pick = enough || list.sort((a, b) => b.d - a.d)[0];
            extra.unit = unit;
            if (pick) { extra.dest = pick.v.coords; extra.predDur = pick.d; }
          }
          go(target.id, extra);
        });
      };
      render();
    } catch (e) {
      say(head + `<div class="row late">Nie udało się sprawdzić wojsk (${esc(e.message)}). Czas i cel są zapisane – ${fallback} i wybierz wioskę ręcznie.</div>`);
    }
  }

  function ensureStatus() {
    let box = $('klin-status');
    if (box) return box;
    const host = $('content_value');
    if (!host) return null;
    box = document.createElement('div');
    box.id = 'klin-status';
    box.style.display = 'none';
    box.innerHTML = '<b>⏱ Klin PRO</b><div id="klin-info" style="white-space:pre-line;font-size:12px;margin-top:4px"></div>' +
      '<div id="klin-miss" style="display:none"><div id="klin-misstxt" class="late" style="font-weight:bold;margin:6px 0"></div><button id="klin-missbtn" type="button">❌ ANULUJ ROZKAZ I PRÓBUJ PONOWNIE</button></div>' +
      '<div id="klin-cleft" class="far"></div><button type="button" id="klin-cbtn">ANULUJ ROZKAZ</button>' + alarmRowHtml();
    host.insertBefore(box, host.firstChild);
    $('klin-cbtn').addEventListener('click', onCancelBtn);
    $('klin-missbtn').addEventListener('click', () => {
      const c = st.last;
      if (!c || !c.miss) return;
      const link = ourLink(c);
      c.missDone = true; save();
      if (link) link.click(); else alert('Nie znaleziono rozkazu do anulowania. Anuluj ręcznie z listy rozkazów.');
    });
    wireAlarmRow(box);
    return box;
  }

  // --- historia prób (ostatnie 10) i trend ---
  st.hist = Array.isArray(st.hist) ? st.hist : [];
  function pushHist(c, patch) {
    c.hid = c.hid || Date.now();
    let h = st.hist.find((x) => x.id === c.hid);
    if (!h) { h = { id: c.hid, mode: c.mode, at: fmtClock(c.S).replace(/\s*\(.*$/, '') }; st.hist.push(h); }
    Object.assign(h, patch);
    if (st.hist.length > 10) st.hist = st.hist.slice(-10);
    save();
  }
  function histLines() {
    const H = st.hist;
    if (!H.length) return [];
    const out = ['Historia prób (wysyłka / powrót, błąd w ms):'];
    H.slice().reverse().forEach((h, i) => {
      out.push(`${H.length - i}. ${h.at} ${h.mode === 'cofka' ? 'cofka' : 'norm.'}: wysyłka ${h.send === undefined ? '–' : sgn(h.send)}` +
        (h.mode === 'cofka' ? `, powrót ${h.retErr === undefined || h.retErr === null ? '–' : sgn(h.retErr)}, cofnięcie ${h.cancelOff === undefined ? '–' : sgn(h.cancelOff)}` : ''));
    });
    const sends = H.filter((h) => Number.isFinite(h.send)).map((h) => Math.abs(h.send));
    if (sends.length >= 4) {
      const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      const r = avg(sends.slice(-3)), o = avg(sends.slice(-6, -3).length ? sends.slice(-6, -3) : sends.slice(0, -3));
      out.push(`Trend wysyłki: średni błąd ${Math.round(r)} ms (wcześniej ${Math.round(o)} ms) – ` + (r < o - 5 ? 'zbliżasz się ✔' : r > o + 5 ? 'oddalasz się ✖' : 'bez zmian'));
    } else out.push('Trend: potrzeba min. 4 prób wysyłki.');
    return out;
  }

  // --- uczenie się po wysłaniu: prawdziwe ms z listy rozkazów ---
  function learnSend() {
    const c = st.last;
    if (!c || c.learned) return;
    const exp = tod(c.sentClient + c.dur);
    let best = null;
    outgoing().forEach((o) => {
      if (o.arrTod === null) return;
      const d = wrap(o.arrTod - exp);
      if (Math.abs(d) <= 2500 && (!best || Math.abs(d) < Math.abs(best.d))) best = { o, d };
    });
    if (!best) return;
    const e = wrap(best.o.arrTod - c.dur - tod(c.S)); // >0: wysłane później niż plan
    { const il = best.o.tr && best.o.tr.querySelector('a[href*="info_command"]'); if (il) c.cmdUrl = il.getAttribute('href'); }
    c.realSend = c.S + e;
    c.sendErr = e;
    c.learned = true;
    if (c.mode === 'cofka') {
      const vsAtk = c.attack ? (c.T + e) - c.attack : null;
      const early = vsAtk !== null && vsAtk <= 0;
      const late = e > LATE_TOL;
      if (early || late) {
        c.miss = { early, late, e: Math.round(e), vsAtk: vsAtk === null ? null : Math.round(vsAtk) };
        if (c.units && Object.keys(c.units).length) st.retry = { vid: c.vid, dest: c.dest, units: c.units, ts: Date.now() };
      } else st.retry = null;
    }
    pushHist(c, { send: Math.round(e), lead: st.lead });
    if (Math.abs(e) <= 1500) {
      st.lead = clamp(Math.round(st.lead + (e < 0 ? e : 0.5 * e)), -500, 1500); // za wcześnie = korekta w pełni, za późno = połowa
      c.infoSend = `Wysyłka: ${sgn(e)} ms od planu (${c.mode === 'cofka' ? 'powrót' : 'wejście'} o ${sgn(e)} ms od celu). Następnym razem puszczam o ${st.lead} ms wcześniej.`;
    } else {
      c.infoSend = `Wysyłka: ${sgn(e)} ms od planu – za duże odchylenie, nie koryguję.`;
    }
    save();
  }

  // --- cofanie (tylko klin z cofki) ---
  function cancelInfo() {
    const c = st.last;
    if (!c || c.mode !== 'cofka' || c.cancelClick || !c.k || c.miss) return null;
    const S = Number.isFinite(c.realSend) ? c.realSend : c.sentClient;
    const start = S + c.k * 1000;
    return { c, S, start, unlockAt: start - st.cancelLead, expected: Math.floor((S + 2000 * c.k + 1000 * (c.bias || 0)) / 1000) };
  }
  function ourLink(c) {
    const S = Number.isFinite(c.realSend) ? c.realSend : c.sentClient;
    const endS = Math.floor((S + c.dur) / 1000);
    const list = outgoing();
    let best = null, bd = 99;
    list.forEach((o) => { if (o.endS === null) return; const d = Math.abs(o.endS - endS); if (d < bd) { bd = d; best = o; } });
    if (best && bd <= 3) return best.a;
    return list.length === 1 ? list[0].a : null;
  }
  function recordCancel(ci) {
    const c = ci.c;
    c.cancelClick = now();
    c.cancelOffset = Math.round(c.cancelClick - ci.start);
    c.expected = ci.expected;
    c.evalDone = false;
    save();
  }
  function onCancelBtn(ev) {
    ev.preventDefault();
    const ci = cancelInfo();
    if (!ci) return;
    if (now() < ci.unlockAt) return;
    const link = ourLink(ci.c);
    recordCancel(ci);
    if (link) link.click();
    else alert('Nie znaleziono rozkazu do anulowania. Anuluj ręcznie z listy rozkazów.');
  }
  // blokada natywnych linków "anuluj" przy naszym rozkazie (tylko prawdziwe kliknięcia gracza)
  document.addEventListener('click', (ev) => {
    if (!ev.isTrusted) return;
    const a = ev.target.closest && ev.target.closest(CANCEL_SEL);
    if (!a) return;
    const ci = cancelInfo();
    if (!ci || a !== ourLink(ci.c)) return;
    if (now() < ci.unlockAt) { ev.preventDefault(); ev.stopPropagation(); } else recordCancel(ci);
  }, true);

  function evaluateCancel() {
    const c = st.last;
    if (!c || !c.cancelClick || c.evalDone || !c.expected) return;
    let best = null;
    document.querySelectorAll('span.timer[data-endtime]').forEach((t) => {
      const d = parseInt(t.getAttribute('data-endtime'), 10) - c.expected;
      if (Math.abs(d) <= 4 && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t };
    });
    if (!best) return;
    let res = 'trafiona', nl = st.cancelLead;
    if (Math.abs(best.d) === 1) { st.secBias = clamp(st.secBias + best.d, -3, 3); res = `powrót przesunięty o ${sgn(best.d)} s – poprawka sekund: ${st.secBias}`; }
    else if (best.d <= -2) { res = 'za wcześnie'; nl = Math.max(-200, st.cancelLead - 40); }
    else if (best.d >= 2) { res = 'za późno'; nl = Math.min(300, st.cancelLead + 40); }
    st.cancelLead = nl;
    c.evalDone = true;
    const tr = best.t.closest('tr');
    const m = tr && tr.textContent.match(MSRE);
    let msTxt = '', retErr = null;
    if (m) {
      const retTod = ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4];
      retErr = wrap(retTod - tod(c.T));
      msTxt = ` Powrót o ${pad(+m[1])}:${m[2]}:${m[3]}:${m[4]}, błąd względem celu ${sgn(wrap(retTod - tod(c.T)))} ms.`;
    }
    pushHist(c, { cancelOff: Math.round(c.cancelOffset), retErr, res, cancelLead: nl });
    c.infoCancel = `Cofka: ${sgn(c.cancelOffset)} ms od startu okna, ${res}.${msTxt} Odblokowanie anuluj: ${nl} ms przed oknem.`;
    save();
  }

  // Jeśli rozkaz wysłano bez zapisanego planu (st.last), odtwórz go z listy rozkazów:
  // z okna szczegółów rozkazu bierzemy czas trwania, stąd moment wysłania i wyliczamy, po ilu sekundach cofnąć.
  let recovering = false, lastRecover = 0;
  async function recoverLast() {
    if (recovering || Date.now() - lastRecover < 4000) return;
    const P = validPending();
    if (!P || game_data.village.coord !== P.coords) return;
    const c0 = st.last;
    if (c0 && !c0.cancelClick && c0.mode === 'cofka' && c0.k) return; // mamy plan; po cofnięciu szukamy nowego rozkazu
    const rows = outgoing().filter((o) => o.arrTod !== null && o.endS !== null);
    if (!rows.length) return;
    recovering = true;
    lastRecover = Date.now();
    try {
      for (const o of rows) {
        const link = o.tr.querySelector('a[href*="info_command"]');
        if (!link) continue;
        const doc = await getDoc(link.getAttribute('href'));
        const dur = readDuration(doc.body);
        if (!dur) continue;
        const A = o.endS * 1000 + (o.arrTod % 1000);
        const S = A - dur;
        const k = Math.round((P.t - S - 1000 * st.secBias) / 2000);
        if (k < 1 || k > CANCEL_MAX_K || Math.abs(P.t - (S + 2000 * k + 1000 * st.secBias)) > 1500) continue;
        st.last = {
          mode: 'cofka', T: P.t, S, k, dur, sentClient: S, realSend: S, learned: true, recovered: true, bias: st.secBias, C: P.coords, cmdUrl: link.getAttribute('href'), attackUrl: P.attackUrl || null, vid: String(game_data.village.id),
          infoSend: `Odtworzono z listy rozkazów: wysłane o ${fmtClock(S)}, cofnij po ${k} s (o ${fmtClock(S + 1000 * k)}), powrót o ${fmtClock(S + 2000 * k + 1000 * st.secBias)}.`
        };
        save();
        return;
      }
    } catch (e) { /* spróbuje ponownie */ } finally { recovering = false; }
  }

  function statusTick() {
    const box = ensureStatus();
    if (!box) return;
    recoverLast();
    learnSend();
    evaluateCancel();
    const c = st.last;
    const lines = c ? [c.infoSend, c.infoCancel].filter(Boolean) : [];
    if (!cancelInfo()) {
      const Pp = validPending();
      if (Pp && game_data.village.coord === Pp.coords) lines.push('Klin PRO działa, ale nie ma planu cofnięcia. Szukam twojego rozkazu na liście…');
    }
    $('klin-info').textContent = lines.concat(histLines()).join('\n');
    const ci = cancelInfo();
    const btn = $('klin-cbtn'), cl = $('klin-cleft');
    if (ci) {
      const n = now();
      const rem = (ci.start - n) / 1000;
      const locked = n < ci.unlockAt;
      btn.style.display = 'block';
      btn.disabled = locked;
      btn.textContent = locked ? 'ZABLOKOWANE...' : 'ANULUJ ROZKAZ';
      btn.style.background = rem <= 0 && rem > -1 ? '#f55' : rem > 0 && rem < 3 ? '#fc6' : '#ddd';
      if (rem > 0) { cl.textContent = 'Cofnij za: ' + fmtLeft(rem * 1000); cl.className = rem < 10 ? 'soon' : 'far'; }
      else if (rem > -1) { cl.textContent = 'ANULUJ TERAZ!'; cl.className = 'go'; if (alarmKey !== 'c' + ci.start) { alarmKey = 'c' + ci.start; beep(1320, 0.2); buzz(150); } }
      else { cl.textContent = 'Okno cofnięcia minęło.'; cl.className = 'late'; }
      cancelAlert(ci, rem, box);
    } else {
      btn.style.display = 'none';
      cl.textContent = '';
    }
    const mc = st.last && st.last.miss && !st.last.missDone ? st.last : null;
    $('klin-miss').style.display = mc ? 'block' : 'none';
    if (mc) {
      $('klin-misstxt').textContent = '❌ Chybione: ' + (mc.miss.early ? `wejdzie ${Math.abs(mc.miss.vsAtk)} ms PRZED atakiem` : `za późno o ${mc.miss.e} ms względem celu`) +
        '. Anuluj od razu – następną próbę wypełnię tymi samymi wojskami i celem.';
      if (alarmKey !== 'm' + mc.hid + mc.S) { alarmKey = 'm' + mc.hid + mc.S; beep(300, 0.4); buzz(400); }
    }
    box.style.display = lines.length || ci || st.hist.length || mc ? 'block' : 'none';
  }


  // =====================================================================
  //  STRONA SZCZEGÓŁÓW ROZKAZU (info_command): okno cofnięcia + odliczanie + przycisk
  // =====================================================================
  function infoCommandPanel() {
    const host = $('content_value');
    const cancelA = document.querySelector(CANCEL_SEL);
    if (!host) return;
    const cell = (re) => {
      for (const td of host.querySelectorAll('td, th')) {
        if (re.test(td.textContent.trim())) return td.nextElementSibling;
      }
      return null;
    };
    const dur = readDuration(host);
    const arrCell = cell(/^(Przybycie|Arrival):?$/i);
    let A = null;
    if (arrCell) {
      const txt = arrCell.textContent.replace(/\s+/g, ' ').replace(/(\d{1,2}:\d{2}:\d{2})\s*[:.]\s*(\d{3})/, '$1:$2');
      A = parseArrival(txt) || parseClock(txt, now() - DAY);
    }
    const box = document.createElement('div');
    box.id = 'klin-status';
    if (!dur || A === null) {
      box.innerHTML = '<b>⏱ Klin PRO</b><div>Nie udało się odczytać czasu trwania / przybycia z tej strony.</div>';
      host.insertBefore(box, host.firstChild);
      return;
    }
    const S = A - dur;
    const P = validPending();
    const defA = P && P.attack ? P.attack : (st.last && st.last.attack && st.last.attack > S ? st.last.attack : (P ? P.t - st.wedge : null));
    const clockOnly = (ms) => fmtClock(ms).replace(/\s*\(.*$/, '');
    box.innerHTML = '<b>⏱ Klin PRO – cofnięcie</b>' +
      '<div class="row">Wysłane: <b>' + clockOnly(S) + '</b> · marsz ' + fmtLeft(dur).replace(/\.\d+$/, '') + '</div>' +
      '<div class="row">Atak wroga (z ms): <input form="klin-noform" autocomplete="off" type="text" id="klin-it" placeholder="hh:mm:ss:ms" value="' + (defA ? clockOnly(defA) : (st.infoA || '')) + '"> ' +
      ' + zapas <input form="klin-noform" autocomplete="off" type="number" id="klin-iw" min="1" step="any" style="width:56px" value="' + st.wedge + '"> ms</div>' +
      '<div class="row">Następny szlachcic (opcjonalnie): <input form="klin-noform" autocomplete="off" type="text" id="klin-in" placeholder="hh:mm:ss:ms" value="' + (st.infoN || '') + '"> ' +
      ' lub sekundy cofki: <input form="klin-noform" autocomplete="off" type="number" id="klin-ik" min="1" max="590" style="width:60px"></div>' +
      '<div id="klin-iinfo" class="row" style="white-space:pre-line"></div>' +
      '<div id="klin-cleft" class="far"></div><button type="button" id="klin-cbtn" style="display:block">ANULUJ ROZKAZ</button>' + alarmRowHtml();
    host.insertBefore(box, host.firstChild);
    wireAlarmRow(box);
    const it = $('klin-it'), iw = $('klin-iw'), inx = $('klin-in'), ik = $('klin-ik'), info = $('klin-iinfo'), cl = $('klin-cleft'), btn = $('klin-cbtn');
    let k = null, T = null, lastKey = '';
    if (cancelA) cancelA.setAttribute('data-klin', '1');

    function recompute(fromK) {
      k = null; T = null;
      const atk = it.value.trim() ? parseClock(it.value, S) : null;
      const nxt = inx.value.trim() ? parseClock(inx.value, S) : null;
      const wd = Math.max(1, num(iw.value, 30));
      if (fromK && ik.value) {
        k = Math.round(+ik.value);
      } else if (atk !== null) {
        T = atk + wd; k = Math.round((T - S - 1000 * st.secBias) / 2000);
        st.infoA = it.value.trim(); st.wedge = wd; save();
      }
      if (inx.value.trim()) { st.infoN = inx.value.trim(); save(); }
      if (k !== null && (k < 1 || k > CANCEL_MAX_K)) k = null;
      if (k !== null) {
        ik.value = k;
        const key = S + '|' + k;
        if (key !== lastKey) {
          lastKey = key;
          st.last = { mode: 'cofka', T: T || (S + 2000 * k), S, k, dur, sentClient: S, realSend: S, learned: true, recovered: true, C: '', bias: st.secBias, attack: atk, cmdUrl: location.pathname + location.search, attackUrl: (P && P.attackUrl) || null, vid: String(game_data.village.id) };
          save();
        }
      }
      if (k === null) { info.textContent = 'Wpisz czas ataku wroga (z ms) albo liczbę sekund do cofnięcia.'; return; }
      const ret = S + 2000 * k + 1000 * st.secBias;
      const lines = ['Cofnij po ' + k + ' s: okno ' + clockOnly(S + 1000 * k) + ' – ' + clockOnly(S + 1000 * (k + 1)) + '  (kliknij na początku okna)',
        'Powrót wojsk: ' + clockOnly(ret)];
      if (atk !== null) {
        const d = Math.round(ret - atk);
        if (d <= 0) lines.push('⛔ WEJDZIE PRZED ATAKIEM (' + sgn(d) + ' ms) – to zły klin, główny atak je rozbije!');
        else if (nxt !== null && ret >= nxt) lines.push('⛔ WEJDZIE ZA SZLACHCICEM (' + sgn(Math.round(ret - nxt)) + ' ms) – za późno.');
        else lines.push('✔ Wejście ' + sgn(d) + ' ms po ataku' + (nxt !== null ? ', ' + Math.round(nxt - ret) + ' ms przed szlachcicem' : '') + '.');
      }
      if (st.last && st.last.infoCancel) lines.push(st.last.infoCancel);
      info.textContent = lines.concat(histLines()).join('\n');
    }
    [it, iw, inx].forEach((el) => el.addEventListener('input', () => { ik.value = ''; recompute(false); }));
    ik.addEventListener('input', () => recompute(true));
    recompute(false);

    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      const ci = cancelInfo();
      if (!ci || now() < ci.unlockAt) return;
      recordCancel(ci);
      if (cancelA) cancelA.click(); else alert('Nie znaleziono linku „przerwij”. Anuluj ręcznie.');
    });
    document.addEventListener('click', (ev) => {
      if (!ev.isTrusted) return;
      const a = ev.target.closest && ev.target.closest(CANCEL_SEL);
      if (!a) return;
      const ci = cancelInfo();
      if (!ci) return;
      if (now() < ci.unlockAt) { ev.preventDefault(); ev.stopImmediatePropagation(); }
    }, true);

    setInterval(() => {
      const ci = cancelInfo();
      if (!ci) { cl.textContent = ''; btn.disabled = true; btn.textContent = 'Podaj cel lub sekundy'; return; }
      const n = now();
      const rem = (ci.start - n) / 1000;
      const locked = n < ci.unlockAt;
      btn.disabled = locked;
      btn.textContent = locked ? 'ZABLOKOWANE...' : 'ANULUJ ROZKAZ';
      btn.style.background = rem <= 0 && rem > -1 ? '#f55' : rem > 0 && rem < 3 ? '#fc6' : '#ddd';
      if (rem > 0) { cl.textContent = 'Cofnij za: ' + fmtLeft(rem * 1000); cl.className = rem < 10 ? 'soon' : 'far'; }
      else if (rem > -1) { cl.textContent = 'ANULUJ TERAZ!'; cl.className = 'go'; if (alarmKey !== 'c' + ci.start) { alarmKey = 'c' + ci.start; beep(1320, 0.2); buzz(150); } }
      else { cl.textContent = 'Okno cofnięcia minęło (cofnij ręcznie – wojska wrócą o sekundę później).'; cl.className = 'late'; }
      cancelAlert(ci, rem, box);
    }, 30);
  }


  // =====================================================================
  //  BANER „COFNIJ ZA…” na każdej stronie gry (z odnośnikiem do rozkazu i do ataku)
  // =====================================================================
  function cancelBanner() {
    let bar = null;
    const readFresh = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
    setInterval(() => {
      const f = readFresh();
      const c = f.last;
      const al = Math.max(15, num(f.alarm, 20));
      let rem = null;
      if (c && c.mode === 'cofka' && !c.cancelClick && !c.miss && c.k) {
        const S = Number.isFinite(c.realSend) ? c.realSend : c.sentClient;
        rem = (S + c.k * 1000 - now()) / 1000;
      }
      if (rem === null || rem > al || rem < -1) { if (bar) { bar.remove(); bar = null; } return; }
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'klin-banner';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;padding:10px;text-align:center;font:bold 18px Verdana,sans-serif;background:#ffb347;color:#000;border-bottom:4px solid #7d510f;touch-action:manipulation';
        document.body.appendChild(bar);
      }
      const url = c.cmdUrl || gameUrl(c.vid || game_data.village.id, 'place');
      const head = rem > 0 ? '⏱ COFNIJ ZA ' + fmtLeft(rem * 1000).replace(/\.(\d)\d*$/, '.$1') : '🟢 ANULUJ TERAZ!';
      bar.style.background = rem <= 0 ? '#5c5' : rem < 5 ? '#ff7043' : '#ffb347';
      bar.innerHTML = head + '<br><a href="' + esc(url) + '" style="color:#00e;font-size:20px">▶ Otwórz rozkaz i cofnij</a>' +
        (c.attackUrl ? ' &nbsp; <a href="' + esc(c.attackUrl) + '" style="color:#00e;font-size:14px">atak wroga</a>' : '');
      cancelAlert({ start: S0(c) + c.k * 1000 }, rem, null);
    }, 100);
  }
  const S0 = (c) => (Number.isFinite(c.realSend) ? c.realSend : c.sentClient);
  // =====================================================================
  function scan() {
    const btn = findConfirm();
    if (btn) build(btn);
    if (/screen=(overview|info_village)/.test(location.search)) addWedgeButtons();
    if (/screen=place/.test(location.search) && !btn) { prefillDirect(); prefillPlace(); }
    if (onInfo) addDirectButton();
  }

  if (!/screen=info_command/.test(location.search)) cancelBanner();
  if (/screen=info_command/.test(location.search)) { infoCommandPanel(); return; }
  scan();
  if (/screen=place/.test(location.search) && !findConfirm()) setInterval(statusTick, 30);

  let t;
  const ours = (n) => { const el = n && n.nodeType === 1 ? n : n && n.parentElement; return el && el.closest('#klin-panel, #klin-bar, #klin-hint, #klin-status'); };
  new MutationObserver((recs) => {
    if (recs.every((r) => ours(r.target))) return;
    clearTimeout(t); t = setTimeout(scan, 150);
  }).observe(document.body, { childList: true, subtree: true });
})();
