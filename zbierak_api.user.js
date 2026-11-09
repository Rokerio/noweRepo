// ==UserScript==
// @name         Masowy Zbierak API (Plemiona)
// @namespace    plemiona.masowy.zbierak.api
// @version      7.5
// @description  Zbieractwo masowe przez API gry: kazda wioska dostaje wlasny sklad, wszystkie poziomy wracaja o tej samej godzinie. Jeden przycisk wysyla komplet.
// @match        *://*.plemiona.pl/*
// @match        *://*.tribalwars.net/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      discord.com
// @connect      ntfy.sh
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * Różnica wobec wersji formularzowej: nie dotykamy pól na ekranie.
 * Plan liczymy osobno dla każdej wioski i wysyłamy go wprost do
 * scavenge_api → send_squads, tak jak robi to natywny ekran.
 * Dzięki temu każda wioska może mieć inny skład, a mimo to wszystko
 * wraca o tej samej porze.
 */
(function () {
  'use strict';

  // Z @grant skrypt chodzi w piaskownicy Tampermonkey, więc po obiekty gry
  // sięgamy przez unsafeWindow. W zamian dostajemy GM_xmlhttpRequest, który
  // nie podlega polityce bezpieczeństwa strony – a to ona blokowała
  // powiadomienia wysyłane przez zwykły fetch.
  const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
  const $ = W.jQuery || W.$;
  const game_data = W.game_data;
  const TribalWars = W.TribalWars;
  const UI = W.UI;
  const image_base = W.image_base;
  if (!$ || !game_data) return;

  const GM_POST = (typeof GM_xmlhttpRequest === 'function') ? GM_xmlhttpRequest :
    (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest : null);

  // Jedno miejsce na wysyłkę powiadomień. Zwraca kod HTTP w logu,
  // więc od teraz widać, czy wiadomość faktycznie poszła.
  function httpPost(url, data, contentType, label, onDone) {
    if (GM_POST) {
      GM_POST({
        method: 'POST', url: url, data: data || '',
        headers: contentType ? { 'Content-Type': contentType } : {},
        onload: r => {
          console.log('[Zbierak API] ' + label + ' → HTTP ' + r.status, r.responseText && r.responseText.slice(0, 300));
          if (onDone) onDone(r.status, r.responseText || '');
        },
        onerror: e => {
          console.log('[Zbierak API] ' + label + ' → błąd połączenia', e);
          if (onDone) onDone(0, 'brak połączenia');
        }
      });
      return;
    }
    if (onDone) onDone(-1, 'brak GM_xmlhttpRequest – wynik nieznany');
    try { W.fetch(url, { method: 'POST', body: data || '', mode: 'no-cors' }); }
    catch (e) { console.log('[Zbierak API] ' + label + ' nie wyszedł', e); }
  }

  const SCAV = ['spear', 'sword', 'axe', 'archer', 'light', 'marcher', 'heavy', 'knight'];
  const NAMES = { spear: 'Pika', sword: 'Miecz', axe: 'Topór', archer: 'Łuk', light: 'LK', marcher: 'ŁNK', heavy: 'CK', knight: 'Ryc' };
  const KEY = 'zapi_' + game_data.world;
  const CHUNK = 200;          // limit oddziałów na jedno żądanie
  const MIN_UNITS = 10;       // gra nie przyjmie oddziału mniejszego niż 10 jednostek
  const COLS = [4, 3, 2, 1];  // wypełniamy od najwyższego poziomu

  // --- przypominajka: działa na KAŻDEJ stronie gry, nie tylko na zbieractwie ---
  const READY_KEY = 'zapi_ready_' + game_data.world;

  function beep() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.frequency.value = 880; g.gain.value = 0.05;
      o.start(); setTimeout(() => { o.stop(); ac.close(); }, 250);
    } catch (e) { /* bez dźwięku */ }
  }

  function fireReady() {
    const msg = 'Zbieractwo wróciło – można puszczać kolejną falę.';
    try {
      if (window.Notification && Notification.permission === 'granted') {
        new Notification('Plemiona ' + game_data.world, { body: msg, tag: 'zapi-ready' });
      }
    } catch (e) { /* brak powiadomień */ }
    beep();
    try {
      const cfgNow = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (cfgNow.webhook) discordSend(cfgNow.webhook, '🔔 **Zbieractwo wróciło** – można puszczać kolejną falę.');
      if (cfgNow.ntfy) ntfySend(cfgNow.ntfy, 'Zbieractwo wróciło – można puszczać kolejną falę. (' + game_data.world + ')');
    } catch (e) { /* brak */ }
    if (document.title.indexOf('✅') < 0) document.title = '✅ ' + document.title;
    if (UI && UI.SuccessMessage) {
      UI.SuccessMessage('<b>' + msg + '</b> <a href="' + game_data.link_base_pure +
        'place&mode=scavenge_mass">Otwórz zbieractwo masowe</a>', 20000);
    }
    try { localStorage.removeItem(READY_KEY); } catch (e) { /* brak */ }
  }

  // Discord: wysyłamy jako FormData z polem payload_json – taki request nie
  // wymaga zgody CORS, więc działa z poziomu strony gry bez dodatkowych uprawnień.
  function discordSend(url, text) {
    if (!url || url.indexOf('discord.com/api/webhooks/') < 0) return;
    httpPost(url, JSON.stringify({ content: text, username: 'Zbierak ' + game_data.world }),
      'application/json', 'Discord');
  }

  // ntfy.sh – zwykły POST z tekstem, bez konta i bez nagłówków,
  // więc nie potrzebuje zgody CORS ani serwera po Twojej stronie.
  // Rozbijamy wpis użytkownika na serwer + temat. Można wpisać samą nazwę
  // tematu (idzie na ntfy.sh) albo pełny adres własnego serwera ntfy.
  function ntfyParts(input) {
    const v = String(input || '').trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) {
      const u = new URL(v);
      const topic = u.pathname.replace(/^\/+|\/+$/g, '');
      if (!topic) return null;
      return { base: u.origin, topic: topic };
    }
    return { base: 'https://ntfy.sh', topic: v.replace(/^\/+|\/+$/g, '') };
  }

  // Publikacja w postaci JSON na katalog główny serwera – to jest
  // udokumentowana forma, która przyjmuje też pole "delay".
  // Wcześniej wysyłaliśmy POST z pustym ciałem i parametrami w adresie
  // i właśnie dlatego zaplanowane powiadomienia nie dochodziły.
  function ntfyPublish(input, body, label, onDone) {
    const p = ntfyParts(input);
    if (!p) return false;
    const payload = Object.assign({ topic: p.topic }, body);
    httpPost(p.base + '/', JSON.stringify(payload), 'application/json', label, onDone);
    return true;
  }

  function ntfySend(topic, text, title) {
    return ntfyPublish(topic, {
      message: text,
      title: title || ('Zbierak ' + game_data.world)
    }, 'ntfy');
  }

  // Wysyłka z opóźnieniem: serwer ntfy przetrzymuje wiadomość i doręcza
  // o zadanej godzinie, więc przeglądarka może być wtedy zamknięta.
  // Limity serwera: nie mniej niż 10 s i nie więcej niż 3 dni.
  function ntfyAt(topic, text, unixTs, title) {
    const delaySec = Math.round(unixTs - Date.now() / 1000);
    if (delaySec < 15) return false;
    if (delaySec > 3 * 24 * 3600 - 300) return false;
    return ntfyPublish(topic, {
      message: text,
      title: title || ('Zbierak ' + game_data.world),
      delay: String(Math.round(unixTs)),
      tags: ['pick']
    }, 'ntfy (zaplanowane na ' + fmtClock(unixTs) + ')');
  }

  function icsStamp(ts) {
    return new Date(ts * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  // Plik .ics z alarmem – jedyny sposób, żeby przypomnienie zadziałało
  // przy zamkniętej przeglądarce (kalendarz telefonu zadzwoni sam).
  function icsDownload(readyAt, info) {
    const uid = 'zbierak-' + Math.round(readyAt) + '@plemiona';
    const body = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Masowy Zbierak//PL', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + icsStamp(Date.now() / 1000),
      'DTSTART:' + icsStamp(readyAt), 'DURATION:PT10M',
      'SUMMARY:Zbieractwo wróciło – ' + game_data.world,
      'DESCRIPTION:' + info.replace(/[,;]/g, ' '),
      'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Zbieractwo wróciło',
      'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');
    try {
      const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
      const a = document.createElement('a');
      a.href = url; a.download = 'zbierak-' + game_data.world + '.ics';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
    } catch (e) { console.log('[Zbierak API] .ics nie wyszedł', e); }
  }

  function watchReturn() {
    let t = 0;
    try { t = parseFloat(localStorage.getItem(READY_KEY) || '0'); } catch (e) { return; }
    if (!t) return;
    const left = t - (Date.now() / 1000);
    if (left <= 0) return fireReady();
    // zadziała, dopóki ta karta jest otwarta; po przeładowaniu liczy się od nowa
    setTimeout(fireReady, Math.min(left * 1000 + 2000, 2147483000));
  }
  watchReturn();

  // --- automatyczne powtarzanie fali (opcjonalne, domyślnie wyłączone) ---
  const AUTO_KEY = 'zapi_auto_' + game_data.world;
  const loadAuto = () => { try { return JSON.parse(localStorage.getItem(AUTO_KEY) || 'null'); } catch (e) { return null; } };
  const saveAuto = a => { try { a ? localStorage.setItem(AUTO_KEY, JSON.stringify(a)) : localStorage.removeItem(AUTO_KEY); } catch (e) { /* brak */ } };

  if (!document.getElementById('scavenge_mass_screen')) return;
  if (window.__zapi) { $('#zapi-panel').show(); return; }
  window.__zapi = true;

  const DEFAULTS = {
    units: { spear: true, sword: true, axe: true, archer: true, light: false, marcher: false, heavy: false, knight: false },
    keep: {}, cats: { 1: true, 2: true, 3: true, 4: true }, hours: 0, align: true, allPages: true, notify: true,
    autoRepeat: false, maxCycles: 3, webhook: '', ntfy: '', ics: false, alignLoss: 30
  };
  const loadCfg = () => { try { return $.extend(true, {}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return $.extend(true, {}, DEFAULTS); } };
  const saveCfg = c => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* brak */ } };
  const esc = t => $('<div>').text(t).html();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------- odczyt danych ekranu ----------
  function extract(src) {
    const marker = 'new ScavengeMassScreen(';
    const at = src.indexOf(marker);
    if (at < 0) return null;
    let i = at + marker.length;
    const args = [];
    while (args.length < 4) {
      while (i < src.length && /[\s,]/.test(src[i])) i++;
      const s = i;
      if (src[i] === '{' || src[i] === '[') {
        let d = 0, q = false;
        for (; i < src.length; i++) {
          const ch = src[i];
          if (q) { if (ch === '\\') i++; else if (ch === '"') q = false; continue; }
          if (ch === '"') q = true;
          else if (ch === '{' || ch === '[') d++;
          else if (ch === '}' || ch === ']') { d--; if (!d) { i++; break; } }
        }
      } else { while (i < src.length && !/[\s,)]/.test(src[i])) i++; }
      args.push(JSON.parse(src.slice(s, i)));
    }
    return { options: args[0], units: args[1], villages: args[3] };
  }

  async function loadData(allPages) {
    const own = Array.from(document.scripts).map(s => s.textContent || '').find(t => t.indexOf('new ScavengeMassScreen(') >= 0);
    const first = extract(own || '');
    if (!first) throw new Error('Nie znalazłem danych ekranu – odśwież stronę.');
    const villages = first.villages.slice();
    if (allPages) {
      const links = [];
      $('#content_value a.paged-nav-item').each(function () { if (this.href && links.indexOf(this.href) < 0) links.push(this.href); });
      for (const url of links) {
        try {
          const html = await $.get(url);
          const d = extract(html);
          if (d) d.villages.forEach(v => { if (!villages.some(x => x.village_id === v.village_id)) villages.push(v); });
        } catch (e) { /* strona nie wczytana – pomijamy */ }
        await sleep(250);
      }
    }
    return { options: first.options, units: first.units, villages: villages };
  }

  // ---------- matematyka ----------
  const unitCarry = u => (DATA.units[u] ? DATA.units[u].carry : 0);
  const durationSec = (opt, carry) => {
    const loot = carry * opt.loot_factor;
    return (Math.pow(loot * loot * 100, opt.duration_exponent) + opt.duration_initial_seconds) * opt.duration_factor;
  };
  const carryForDuration = (opt, sec) => {
    const x = sec / opt.duration_factor - opt.duration_initial_seconds;
    return x <= 0 ? 0 : Math.sqrt(Math.pow(x, 1 / opt.duration_exponent) / 100) / opt.loot_factor;
  };
  const minDuration = opt => opt.duration_initial_seconds * opt.duration_factor;
  const fmtH = s => { const m = Math.round(s / 60); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); };
  const fmtClock = ts => { const d = new Date(ts * 1000); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const nowSec = () => { try { if (window.Timing && Timing.getCurrentServerTime) return Timing.getCurrentServerTime() / 1000; } catch (e) { /* brak */ } return Date.now() / 1000; };

  const isFree = (v, c) => v.has_rally_point && v.options[c] && !v.options[c].is_locked && !v.options[c].scavenging_squad;

  function pool(v, cfg) {
    const a = {}; let carry = 0;
    SCAV.forEach(u => {
      if (!cfg.units[u] || !DATA.units[u]) return;
      const n = Math.max(0, (v.unit_counts_home[u] || 0) - (cfg.keep[u] || 0));
      if (n > 0) { a[u] = n; carry += n * unitCarry(u); }
    });
    return { units: a, carry: carry };
  }

  // Wybierz z puli oddział o udźwigu ~target, w proporcjach tego, co wioska ma.
  // Zwraca liczby jednostek i realny udźwig; zdejmuje użyte jednostki z puli.
  function take(av, target) {
    let totalLeft = 0;
    for (const u in av) totalLeft += av[u] * unitCarry(u);
    if (totalLeft <= 0) return null;
    const want = Math.min(target, totalLeft);
    const frac = want / totalLeft;
    const counts = {}; let carry = 0;
    for (const u in av) {
      const n = Math.floor(av[u] * frac);
      if (n > 0) { counts[u] = n; carry += n * unitCarry(u); }
    }
    // dobij do celu najtańszymi jednostkami, żeby nie przestrzelić
    const order = Object.keys(av).sort((a, b) => unitCarry(a) - unitCarry(b));
    for (const u of order) {
      while (carry < want && (counts[u] || 0) < av[u]) { counts[u] = (counts[u] || 0) + 1; carry += unitCarry(u); }
      if (carry >= want) break;
    }
    if (!carry) return null;
    for (const u in counts) { av[u] -= counts[u]; if (!av[u]) delete av[u]; }
    return { counts: counts, carry: carry };
  }

  // Gra odrzuca oddziały poniżej 10 jednostek. Dobijamy najlżejszymi
  // jednostkami, żeby jak najmniej wydłużyć czas powrotu.
  function topUp(av, counts) {
    let total = 0;
    for (const u in counts) total += counts[u];
    if (total >= MIN_UNITS) return { ok: true, added: 0 };
    const order = Object.keys(av).sort((a, b) => unitCarry(a) - unitCarry(b));
    let added = 0;
    for (const u of order) {
      while (total < MIN_UNITS && av[u] > 0) {
        counts[u] = (counts[u] || 0) + 1;
        av[u]--; if (!av[u]) delete av[u];
        total++; added++;
      }
      if (total >= MIN_UNITS) break;
    }
    return { ok: total >= MIN_UNITS, added: added };
  }

  // Plan dla jednej wioski: każdy wolny poziom dostaje udźwig na czas T.
  // Gdy wojska brakuje, wypełniamy od poziomu 4 w dół – niższe zostają puste.
  function planVillage(v, T, cfg, diag) {
    const out = [];
    const why = {};
    COLS.forEach(c => {
      if (!cfg.cats[c]) { why[c] = 'odznaczony'; return; }
      if (!v.options[c]) { why[c] = 'brak poziomu'; return; }
      if (v.options[c].is_locked) { why[c] = 'zablokowany'; return; }
      if (v.options[c].scavenging_squad) { why[c] = 'już zbiera'; return; }
      if (!v.has_rally_point) { why[c] = 'brak placu'; return; }
    });
    const free = COLS.filter(c => cfg.cats[c] && isFree(v, c));
    if (diag) diag[v.village_id] = { name: v.village_name, why: why };
    if (!free.length) return out;
    const p = pool(v, cfg);
    if (!p.carry) { free.forEach(c => { why[c] = 'brak wojska'; }); return out; }
    const av = p.units;
    const factor = v.unit_carry_factor || 1;
    free.forEach(c => {
      const opt = DATA.options[c];
      const target = carryForDuration(opt, T) / factor;
      const got = take(av, Math.floor(target));
      if (!got) { why[c] = 'pula pusta'; return; }
      const up = topUp(av, got.counts);
      if (!up.ok) { why[c] = 'mniej niż ' + MIN_UNITS + ' jednostek'; return; }
      if (up.added) { got.carry = 0; for (const u in got.counts) got.carry += got.counts[u] * unitCarry(u); }
      const carryMax = Math.floor(got.carry * factor);
      if (carryMax * opt.loot_factor < 20) { why[c] = 'za mały łup (' + Math.floor(carryMax * opt.loot_factor) + ')'; return; }
      why[c] = 'wysyłka';
      const full = {};
      game_data.units.forEach(u => { full[u] = got.counts[u] || 0; });
      out.push({
        village_id: v.village_id,
        village_name: v.village_name,
        option_id: c,
        counts: full,
        carry_max: carryMax,
        dur: durationSec(opt, carryMax),
        loot: Math.floor(carryMax * opt.loot_factor)
      });
    });
    return out;
  }

  function planAll(T, cfg, diag) {
    const squads = [];
    DATA.villages.forEach(v => { planVillage(v, T, cfg, diag).forEach(s => squads.push(s)); });
    const loot = squads.reduce((s, x) => s + x.loot, 0);
    let idle = 0;
    DATA.villages.forEach(v => {
      const p = pool(v, cfg);
      const used = squads.filter(s => s.village_id === v.village_id)
        .reduce((sum, s) => sum + Object.keys(s.counts).reduce((a, u) => a + s.counts[u] * unitCarry(u), 0), 0);
      idle += Math.max(0, p.carry - used);
    });
    return { squads: squads, loot: loot, idle: idle, rate: loot / (T / 3600) };
  }

  // Łup na godzinę rośnie wraz z długością fali, dopóki starcza wojska;
  // gdy armia się kończy, łup przestaje rosnąć i wskaźnik spada. Szukamy szczytu.
  function autoT(cfg) {
    let best = null;
    const scan = [];
    const steps = [];
    for (let m = 30; m <= 240; m += 5) steps.push(m);
    for (let m = 255; m <= 1440; m += 15) steps.push(m);
    for (const m of steps) {
      const T = m * 60;
      const r = planAll(T, cfg);
      // odrzuć wyniki bez sensu – wcześniej NaN mógł zablokować wybór na pierwszym kroku
      if (!r.loot || !isFinite(r.rate) || r.rate <= 0) continue;
      scan.push({ min: m, squads: r.squads.length, loot: r.loot, rate: Math.round(r.rate), idle: r.idle });
      if (best === null || r.rate > best.rate) best = { T: T, rate: r.rate, loot: r.loot };
    }
    window.__zapiScan = scan;
    console.log('[Zbierak API] skan czasów', scan);
    return best;
  }

  // Kotwica: najdłuższy trwający zbierak, niezależnie od poziomu.
  // Nowe wysyłki mają wrócić razem z nim i nigdy po nim.
  function anchorLongest() {
    const now = nowSec();
    let best = null;
    DATA.villages.forEach(v => {
      [1, 2, 3, 4].forEach(c => {
        const sq = v.options[c] && v.options[c].scavenging_squad;
        if (!sq || !sq.return_time) return;
        const left = sq.return_time - now;
        if (left < minDuration(DATA.options[c]) + 120) return; // za blisko, nie zdążymy
        if (!best || sq.return_time > best.t) best = { t: sq.return_time, col: c };
      });
    });
    return best;
  }

  // ---------- wysyłka ----------
  async function sendAll(squads, btn) {
    const payload = squads.map(s => ({
      village_id: s.village_id,
      candidate_squad: { unit_counts: s.counts, carry_max: s.carry_max },
      option_id: s.option_id,
      use_premium: false
    }));
    let ok = 0, err = 0, firstErr = '';
    let scheduledAt = false, scheduledFor = 0;
    const perCol = {};
    squads.forEach(s => { perCol[s.option_id] = perCol[s.option_id] || { ok: 0, err: 0 }; });
    for (let i = 0; i < payload.length; i += CHUNK) {
      const part = payload.slice(i, i + CHUNK);
      btn.text('Wysyłam ' + (i + 1) + '–' + (i + part.length) + ' z ' + payload.length + '…');
      const res = await new Promise(resolve => {
        TribalWars.post('scavenge_api', { ajaxaction: 'send_squads' }, { squad_requests: part },
          r => resolve(r || {}), () => resolve({ __fail: true }));
      });
      if (res.__fail) { err += part.length; firstErr = firstErr || 'serwer odrzucił żądanie'; }
      else if (Array.isArray(res.squad_responses)) {
        res.squad_responses.forEach((r, k) => {
          const col = squads[i + k] ? squads[i + k].option_id : 0;
          const slot = perCol[col] || (perCol[col] = { ok: 0, err: 0 });
          if (r && r.success) { ok++; slot.ok++; }
          else { err++; slot.err++; firstErr = firstErr || (r && r.error) || 'nieznany błąd'; }
        });
      } else ok += part.length;
      console.log('[Zbierak API] odpowiedz serwera', res);
      await sleep(400);
    }
    // zapamiętaj najpóźniejszy powrót z tej fali, żeby przypomnieć o kolejnej
    if (ok) {
      const longest = squads.reduce((m, s) => Math.max(m, s.dur), 0);
      const readyAt = Date.now() / 1000 + longest;
      try { localStorage.setItem(READY_KEY, String(readyAt)); } catch (e) { /* brak */ }
      if (CFG && CFG.notify) watchReturn();
      const unix = Math.round(readyAt);
      scheduledFor = readyAt;
      const summary = ok + ' oddziałów, powrót <t:' + unix + ':t> (<t:' + unix + ':R>)';
      if (CFG && CFG.webhook) {
        discordSend(CFG.webhook, '⛏️ Wysłano **' + ok + '** oddziałów na zbieractwo.\n' +
          'Powrót: <t:' + unix + ':F> — <t:' + unix + ':R>');
      }
      if (CFG && CFG.ntfy) {
        ntfySend(CFG.ntfy, 'Wysłano ' + ok + ' oddziałów. Powrót o ' + fmtClock(readyAt) + ' (' + game_data.world + ')');
        // to jest jedyne powiadomienie, które zadziała przy zamkniętej przeglądarce:
        // serwer ntfy przetrzymuje wiadomość i doręcza ją o zadanej godzinie
        scheduledAt = ntfyAt(CFG.ntfy, 'Zbieractwo wróciło – można puszczać kolejną falę.', readyAt,
          'Zbierak ' + game_data.world);
      }
      if (CFG && CFG.ics) icsDownload(readyAt, summary);
      if (CFG && CFG.autoRepeat) {
        const prev = loadAuto();
        saveAuto({ on: true, readyAt: readyAt, cycles: (prev && prev.on ? prev.cycles : 0) + 1, maxCycles: CFG.maxCycles });
      } else saveAuto(null);
    }
    const byCol = [4, 3, 2, 1].filter(c => perCol[c]).map(c => 'p' + c + ': ' + perCol[c].ok + ' ok' + (perCol[c].err ? ' / ' + perCol[c].err + ' bł.' : '')).join(' · ');
    info('<b>Wysłane: ' + ok + '</b>' + (err ? ', błędów: ' + err + ' (' + esc(firstErr) + ')' : '') +
      (byCol ? '<br>' + byCol : '') +
      '<br>Odśwież stronę (F5), żeby zobaczyć stan.' +
      (scheduledAt ? '<br>Przypomnienie na ' + fmtClock(scheduledFor) + ' zaplanowane na serwerze ntfy – zadziała też przy zamkniętej przeglądarce.' : '') +
      (ok && CFG.notify ? '<br>Przypomnę o kolejnej fali, dopóki karta z grą zostaje otwarta.' : ''));
    btn.text('Gotowe – odśwież stronę').prop('disabled', true);
  }

  // ---------- panel ----------
  let DATA = null, CFG = null, PLAN = null, T = 0;
  const info = h => $('#zapi-info').html(h);

  function readCfg() {
    const cfg = loadCfg();
    $('.zapi-u').each(function () { cfg.units[$(this).data('u')] = this.checked; });
    $('.zapi-k').each(function () { cfg.keep[$(this).data('u')] = Math.max(0, parseInt(this.value, 10) || 0); });
    $('.zapi-c').each(function () { cfg.cats[$(this).data('c')] = this.checked; });
    cfg.hours = Math.max(0, parseFloat($('#zapi-t').val()) || 0);
    cfg.align = $('#zapi-align').is(':checked');
    cfg.allPages = $('#zapi-pages').is(':checked');
    cfg.notify = $('#zapi-notify').is(':checked');
    cfg.autoRepeat = $('#zapi-auto').is(':checked');
    cfg.maxCycles = Math.min(24, Math.max(1, parseInt($('#zapi-cycles').val(), 10) || 3));
    cfg.webhook = ($('#zapi-hook').val() || '').trim();
    cfg.ntfy = ($('#zapi-ntfy').val() || '').trim();
    cfg.ics = $('#zapi-ics').is(':checked');
    if (cfg.notify && window.Notification && Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch (e) { /* brak */ }
    }
    saveCfg(cfg);
    return cfg;
  }

  async function build() {
    CFG = readCfg();
    info('Wczytuję wioski…');
    try { DATA = await loadData(CFG.allPages); }
    catch (e) { return info('Błąd: ' + esc(e.message)); }

    let note = '';
    if (CFG.hours > 0) {
      T = CFG.hours * 3600;
    } else {
      const best = autoT(CFG);
      if (!best) return info('Nie ma czego wysłać – sprawdź „Wysyłaj”, „Rezerwa” i poziomy.');
      T = best.T;
    }
    // Kotwica działa w obie strony, ale przede wszystkim jako SUFIT:
    // nowe oddziały nie mogą wracać później niż ten, który jeszcze zbiera.
    const anc = CFG.align ? anchorLongest() : null;
    if (anc) {
      const left = anc.t - nowSec();
      const rAuto = planAll(T, CFG).rate;
      const rAnc = planAll(left, CFG).rate;
      const loss = rAuto > 0 ? Math.round((1 - rAnc / rAuto) * 100) : 0;
      T = left;
      note = ' · zgrane z najdłuższym zbierakiem (poziom ' + anc.col + '), powrót o <b>' + fmtClock(anc.t) + '</b>' +
        (loss > 0 ? ' – kosztuje ' + loss + '% łupu/h' : '');
      if (loss > 40) {
        note += '<br><span style="color:#a00">Zgranie wychodzi drogo – odznacz „zgraj z trwającym zbieractwem”, ' +
          'jeśli wolisz pełną falę kosztem wspólnego powrotu.</span>';
      }
    }

    const DIAG = {};
    PLAN = planAll(T, CFG, DIAG);
    // podsumowanie: co się stało z każdym poziomem w każdej wiosce
    const tally = { 1: {}, 2: {}, 3: {}, 4: {} };
    Object.keys(DIAG).forEach(id => {
      const w = DIAG[id].why;
      [1, 2, 3, 4].forEach(c => { const k = w[c] || 'brak danych'; tally[c][k] = (tally[c][k] || 0) + 1; });
    });
    window.__zapiDiag = { T: T, diag: DIAG, tally: tally, squads: PLAN.squads };
    console.log('[Zbierak API] plan', window.__zapiDiag);
    let tallyHtml = '';
    [4, 3, 2, 1].forEach(c => {
      const parts = Object.keys(tally[c]).map(k => k + ': ' + tally[c][k]).join(', ');
      tallyHtml += '<div>Poziom ' + c + ' → ' + esc(parts) + '</div>';
    });
    if (!PLAN.squads.length) return info('Nie ma czego wysłać przy tym czasie.');

    const byCol = {};
    PLAN.squads.forEach(s => { byCol[s.option_id] = (byCol[s.option_id] || 0) + 1; });
    const times = PLAN.squads.map(s => s.dur);
    let rows = '';
    DATA.villages.forEach(v => {
      const mine = PLAN.squads.filter(s => s.village_id === v.village_id);
      if (!mine.length) return;
      rows += '<tr><td style="text-align:left">' + esc(v.village_name) + '</td><td>' +
        mine.map(s => 'p' + s.option_id + ': ' + SCAV.filter(u => s.counts[u]).map(u => NAMES[u] + ' ' + s.counts[u]).join(', ') +
          ' <span style="color:#555">(' + fmtH(s.dur) + ', ' + s.loot + ')</span>').join('<br>') +
        '</td></tr>';
    });

    let scanHtml = '';
    if (window.__zapiScan && window.__zapiScan.length) {
      const sc = window.__zapiScan;
      const pick = [];
      [60, 90, 120, 180, 240, 360, 480].forEach(m => {
        const row = sc.reduce((a, b) => (Math.abs(b.min - m) < Math.abs(a.min - m) ? b : a));
        if (!pick.some(x => x.min === row.min)) pick.push(row);
      });
      scanHtml = '<div style="margin-top:4px;font-size:11px;color:#555">Łup/h przy różnych falach: ' +
        pick.map(r => fmtH(r.min * 60) + ' → ' + r.rate).join(' · ') + '</div>';
    }
    info('<b>Czas powrotu ' + fmtH(T) + ' h</b>' + note +
      '<br>Oddziałów: <b>' + PLAN.squads.length + '</b> (p4: ' + (byCol[4] || 0) + ', p3: ' + (byCol[3] || 0) +
      ', p2: ' + (byCol[2] || 0) + ', p1: ' + (byCol[1] || 0) + ') · łup <b>' + PLAN.loot + '</b> (' + Math.round(PLAN.rate) + '/h)' +
      '<br>Rozrzut czasów: ' + fmtH(Math.min.apply(null, times)) + ' – ' + fmtH(Math.max.apply(null, times)) +
      (PLAN.idle ? ' · w domu zostaje <b>' + PLAN.idle + '</b> udźwigu' : ' · nic nie zostaje w domu') +
      (PLAN.idle > PLAN.loot ? '<br><span style="color:#a00">Dużo wojska zostaje w domu – wydłuż czas albo odznacz „zgraj z poziomem 4”.</span>' : '') +
      scanHtml +
      '<div style="margin-top:5px;padding:4px;background:#efe6cc;border:1px solid #c1a264">' +
      '<b>Co z którym poziomem:</b>' + tallyHtml + '</div>' +
      '<div style="max-height:220px;overflow:auto;margin-top:5px"><table class="vis" style="width:100%">' + rows + '</table></div>' +
      '<div style="margin-top:6px"><a href="#" class="btn" id="zapi-send">Wyślij wszystko (' + PLAN.squads.length + ')</a></div>');

    $('#zapi-send').on('click', function (e) {
      e.preventDefault();
      const b = $(this);
      if (b.prop('disabled')) return;
      b.prop('disabled', true);
      sendAll(PLAN.squads, b);
    });
  }

  function panel() {
    const cfg = loadCfg();
    $('head').append('<style>' +
      '#zapi-panel{margin:0 0 10px 0;width:100%;box-sizing:border-box}' +
      '#zapi-panel .zh{background:#c1a264;border:1px solid #7d510f;padding:3px 6px;font-weight:bold;cursor:pointer}' +
      '#zapi-panel .zb{border:1px solid #7d510f;border-top:0;background:#f4e4bc;padding:6px}' +
      '#zapi-grid{border-collapse:collapse;margin-bottom:6px}' +
      '#zapi-grid th,#zapi-grid td{border:1px solid #c1a264;padding:2px 4px;text-align:center;white-space:nowrap}' +
      '#zapi-grid .lb{text-align:left;font-weight:bold;background:#e3d5b3}' +
      '#zapi-grid input[type=number]{width:52px;text-align:center}' +
      '#zapi-info{margin-top:6px;padding:4px 6px;background:#fff8e0;border:1px solid #c1a264;line-height:1.5}' +
      '</style>');

    let h = '<div id="zapi-panel"><div class="zh">Masowy Zbierak API <span style="float:right" id="zapi-tg">[zwiń]</span></div>' +
      '<div class="zb"><table id="zapi-grid"><tr><th class="lb">Jednostka</th>';
    SCAV.forEach(u => { h += '<th><img src="' + image_base + 'unit/unit_' + u + '.webp" title="' + NAMES[u] + '" style="width:18px;height:18px;vertical-align:middle"></th>'; });
    h += '</tr><tr><td class="lb">Wysyłaj</td>';
    SCAV.forEach(u => { h += '<td><input type="checkbox" class="zapi-u" data-u="' + u + '"' + (cfg.units[u] ? ' checked' : '') + '></td>'; });
    h += '</tr><tr><td class="lb">Rezerwa</td>';
    SCAV.forEach(u => { h += '<td><input type="number" min="0" class="zapi-k" data-u="' + u + '" value="' + (cfg.keep[u] || 0) + '"></td>'; });
    h += '</tr></table><div>Poziomy: ';
    [1, 2, 3, 4].forEach(c => { h += '<label style="margin-right:8px"><input type="checkbox" class="zapi-c" data-c="' + c + '"' + (cfg.cats[c] ? ' checked' : '') + '> ' + c + '</label>'; });
    h += '&nbsp;&nbsp;Czas: <input type="number" min="0" step="0.25" id="zapi-t" value="' + cfg.hours + '" style="width:52px"> h <small>(0 = dobierz sam)</small>' +
      '&nbsp;&nbsp;<label><input type="checkbox" id="zapi-align"' + (cfg.align ? ' checked' : '') + '> zgraj z trwającym zbieractwem</label>' +
      '&nbsp;&nbsp;<label><input type="checkbox" id="zapi-pages"' + (cfg.allPages ? ' checked' : '') + '> wszystkie strony</label>' +
      '&nbsp;&nbsp;<label><input type="checkbox" id="zapi-notify"' + (cfg.notify ? ' checked' : '') + '> powiadom, gdy wróci</label>' +
      '<br><label><input type="checkbox" id="zapi-auto"' + (cfg.autoRepeat ? ' checked' : '') + '> <b>powtarzaj automatycznie</b></label> ' +
      'maks. <input type="number" min="1" max="24" id="zapi-cycles" value="' + cfg.maxCycles + '" style="width:40px"> cykli ' +
      '<small>(wymaga otwartej karty na tym ekranie; wysyła bez pytania)</small></div>' +
      '<div style="margin-top:4px">Discord webhook: <input type="text" id="zapi-hook" value="' + (cfg.webhook || '').replace(/"/g, '&quot;') + '" placeholder="https://discord.com/api/webhooks/..." style="width:330px">' +
      '</div><div style="margin-top:4px">ntfy (planuje powiadomienie na serwerze – działa przy zamkniętej przeglądarce): ' +
      '<input type="text" id="zapi-ntfy" value="' + (cfg.ntfy || '').replace(/"/g, '&quot;') + '" placeholder="np. zbierak-roker-x7k2" style="width:200px">' +
      '&nbsp;&nbsp;<label><input type="checkbox" id="zapi-ics"' + (cfg.ics ? ' checked' : '') + '> plik do kalendarza (.ics)</label></div>' +
      '<div style="margin-top:5px"><a href="#" class="btn" id="zapi-plan">Policz plan</a> <a href="#" class="btn" id="zapi-test">Test powiadomień</a></div>' +
      '<div id="zapi-info">Ustaw jednostki i kliknij <b>Policz plan</b>.</div></div></div>';

    $('#scavenge_mass_screen').before(h);
    $('#zapi-panel .zh').on('click', function () {
      const b = $('#zapi-panel .zb').toggle();
      $('#zapi-tg').text(b.is(':visible') ? '[zwiń]' : '[rozwiń]');
    });
    $('#zapi-plan').on('click', e => { e.preventDefault(); build(); });
    $('#zapi-test').on('click', e => {
      e.preventDefault();
      const c = readCfg();
      if (!c.webhook && !c.ntfy) return info('Wpisz najpierw webhooka Discorda albo nazwę kanału ntfy.');
      if (c.webhook) discordSend(c.webhook, '✅ Test z Masowego Zbieraka – połączenie działa.');
      if (c.ntfy) {
        const raport = [];
        const pokaz = () => info('<b>Test powiadomień</b><br>' + raport.join('<br>'));
        ntfyPublish(c.ntfy, { message: 'Test natychmiastowy – połączenie działa.', title: 'Zbierak – test' },
          'ntfy', (st, txt) => {
            raport.push('ntfy teraz: ' + (st === 200 ? 'OK (200)' : 'HTTP ' + st + ' – ' + esc(txt.slice(0, 120))));
            pokaz();
          });
        const za = Date.now() / 1000 + 60;
        const poszlo = ntfyPublish(c.ntfy, {
          message: 'Test opóźniony – jeśli to widzisz, przypomnienia działają też przy zamkniętej przeglądarce.',
          title: 'Zbierak – test', delay: String(Math.round(za))
        }, 'ntfy (zaplanowane)', (st, txt) => {
          raport.push('ntfy za minutę: ' + (st === 200 ? 'przyjęte (200) – zamknij przeglądarkę i czekaj' : 'HTTP ' + st + ' – ' + esc(txt.slice(0, 120))));
          pokaz();
        });
        if (!poszlo) raport.push('ntfy: nie rozpoznałem nazwy kanału.');
      }
      info('Wysłałem testową wiadomość.<br>' +
        '<small>W konsoli (F12): „Discord → HTTP 204” i „ntfy → HTTP 200”. ' +
        'Dla ntfy leci też test opóźniony – przyjdzie za minutę, możesz w tym czasie zamknąć przeglądarkę.</small>');
    });
  }

  panel();

  // Jeśli auto-powtarzanie jest włączone i fala już wróciła, przelicz i wyślij.
  // Działa tylko wtedy, gdy ta karta została otwarta na ekranie zbieractwa.
  (function resumeAuto() {
    const a = loadAuto();
    if (!a || !a.on) return;
    const left = a.readyAt - Date.now() / 1000;
    const go = function () {
      const jitter = 10000 + Math.random() * 50000; // 10–60 s, żeby nie było co do sekundy
      info('Auto-powtarzanie: fala wróciła, wysyłam za ' + Math.round(jitter / 1000) + ' s. ' +
        '<a href="#" id="zapi-cancel">Anuluj</a>');
      const timer = setTimeout(async function () {
        await build();
        if (PLAN && PLAN.squads.length) {
          const b = $('#zapi-send');
          if (b.length) { b.prop('disabled', true); sendAll(PLAN.squads, b); }
        }
      }, jitter);
      $('#zapi-cancel').on('click', e => {
        e.preventDefault(); clearTimeout(timer);
        saveAuto(null); info('Auto-powtarzanie zatrzymane.');
      });
    };
    if (a.cycles >= a.maxCycles) { saveAuto(null); return info('Auto-powtarzanie: wykonano ' + a.cycles + ' cykli, stop. Włącz ponownie, jeśli chcesz dalej.'); }
    if (left <= 0) go();
    else {
      info('Auto-powtarzanie czeka: kolejna fala o ' + fmtClock(a.readyAt) + ' (cykl ' + (a.cycles + 1) + '/' + a.maxCycles + '). Zostaw tę kartę otwartą.');
      setTimeout(go, Math.min(left * 1000 + 2000, 2147483000));
    }
  })();
})();
