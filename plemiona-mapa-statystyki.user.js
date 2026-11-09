// ==UserScript==
// @name         Plemiona – statystyki gracza w dymku mapy
// @namespace    dawid.plemiona
// @version      2.9
// @description  Dymek mapy: ODA, ODD, rekordy farmy i zbieracza, ochrona 10:1 oraz poparcie z raportów
// @match        https://*.plemiona.pl/game.php*
// @match        https://*.die-staemme.de/game.php*
// @match        https://*.tribalwars.net/game.php*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TTL_KILLS = 60 * 60 * 1000;        // pliki ODA/ODD: odświeżanie co 1 h
  const TTL_PLAYERS = 60 * 60 * 1000;      // punkty graczy: co 1 h
  const TTL_WORLD = 6 * 60 * 60 * 1000;    // ustawienia i wiek świata: co 6 h
  const TTL_RECORD = 30 * 60 * 1000;       // rekordy z rankingu: cache 30 min na gracza
  const LS_KEY = 'twMapStats_v1';

  // ---------- cache w localStorage ----------
  let store = {};
  try { store = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { store = {}; }
  const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) {} };
  store.records = store.records || {};

  const fmt = n => Number(n).toLocaleString('pl-PL');

  // ---------- ODA / ODD z plików świata ----------
  let kills = { att: {}, def: {} };
  let killsPromise = null;

  function parseKills(txt) {
    const out = {};
    txt.trim().split('\n').forEach(line => {
      const [rank, id, score] = line.split(',');
      out[id] = { rank: +rank, score: +score };
    });
    return out;
  }

  function loadKills() {
    if (killsPromise) return killsPromise;
    if (store.kills && Date.now() - store.kills.t < TTL_KILLS) {
      kills = store.kills.data;
      killsPromise = Promise.resolve();
      return killsPromise;
    }
    killsPromise = Promise.all([
      fetch('/map/kill_att.txt').then(r => r.text()),
      fetch('/map/kill_def.txt').then(r => r.text()),
    ]).then(([a, d]) => {
      kills = { att: parseKills(a), def: parseKills(d) };
      store.kills = { t: Date.now(), data: kills };
      save();
    }).catch(() => { killsPromise = null; });
    return killsPromise;
  }

  // ---------- punkty graczy (do wyliczenia progu 10:1) ----------
  let points = {};
  let playersPromise = null;

  function loadPlayers() {
    if (playersPromise) return playersPromise;
    const cached = store.points && store.points.data;
    const shapeOk = cached && typeof cached[Object.keys(cached)[0]] === 'object';
    if (cached && shapeOk && Date.now() - store.points.t < TTL_PLAYERS) {
      points = cached;
      playersPromise = Promise.resolve();
      return playersPromise;
    }
    playersPromise = fetch('/map/player.txt').then(r => r.text()).then(txt => {
      const out = {};
      txt.trim().split('\n').forEach(line => {
        const c = line.split(',');       // id,nazwa,plemię,wioski,punkty,ranga
        let nm = c[1] || '';
        try { nm = decodeURIComponent(nm.replace(/\+/g, ' ')); } catch (e) {}
        out[c[0]] = { p: +c[4], n: nm };
      });
      points = out;
      store.points = { t: Date.now(), data: out };
      save();
    }).catch(() => { playersPromise = null; });
    return playersPromise;
  }

  // ---------- indeks wiosek po współrzędnych (tylko w pamięci sesji) ----------
  let coords = null;
  let villagesPromise = null;

  function loadVillages() {
    if (villagesPromise) return villagesPromise;
    villagesPromise = fetch('/map/village.txt').then(r => r.text()).then(txt => {
      const out = {};
      txt.trim().split('\n').forEach(line => {
        const c = line.split(',');     // id,nazwa,x,y,gracz,punkty,ranga
        out[c[2] + '|' + c[3]] = { vid: c[0], pid: c[4] };
      });
      coords = out;
      console.log('[tw-stats] wczytano wiosek:', Object.keys(out).length);
    }).catch(e => { villagesPromise = null; console.log('[tw-stats] błąd village.txt', e); });
    return villagesPromise;
  }

  // ---------- reguła 10:1: parametry świata + termin wygaśnięcia ----------
  let rules = { ratio: 10, days: 60, endTs: null };
  let worldPromise = null;

  function loadWorld() {
    if (worldPromise) return worldPromise;
    if (store.world && Date.now() - store.world.t < TTL_WORLD) {
      rules = store.world.data;
      worldPromise = Promise.resolve();
      return worldPromise;
    }
    worldPromise = Promise.all([
      fetch('/page/settings').then(r => r.text()).catch(() => ''),
      fetch('/page/stats').then(r => r.text()).catch(() => ''),
    ]).then(([settings, stats]) => {
      const txt = s => new DOMParser().parseFromString(s, 'text/html').body.textContent || '';
      const m = txt(settings).match(/(\d+)\s*:\s*1[^.\n]{0,40}?pierwsze\s+(\d+)\s*dni/i);
      if (m) { rules.ratio = +m[1]; rules.days = +m[2]; }
      const a = txt(stats).match(/Czas pracy serwera:\s*([\d\s]+)\s*dni/i);
      if (a) {
        const age = +a[1].replace(/\s/g, '');
        const left = rules.days - age;
        const end = new Date();
        end.setHours(0, 0, 0, 0);
        end.setDate(end.getDate() + left);
        rules.endTs = end.getTime();
      }
      store.world = { t: Date.now(), data: rules };
      save();
    }).catch(() => { worldPromise = null; });
    return worldPromise;
  }

  // ---------- rekordy z rankingu „Dziennie” ----------
  const pending = {};

  function fetchRecord(type, playerId, playerName) {
    const url = `/game.php?village=${game_data.village.id}&screen=ranking&mode=in_a_day` +
                `&type=${type}&name=${encodeURIComponent(playerName)}`;
    return fetch(url, { credentials: 'same-origin' })
      .then(r => r.text())
      .then(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const link = [...doc.querySelectorAll('a[href*="info_player"]')]
          .find(a => new URLSearchParams(a.getAttribute('href').split('?')[1]).get('id') === String(playerId));
        const row = link && link.closest('tr');
        if (!row) return null;
        const tds = row.querySelectorAll('td');
        // kolumny: ranga | gracz | plemię | wynik | data
        return {
          rank: tds[0].textContent.trim(),
          score: tds[tds.length - 2].textContent.trim(),
          date: tds[tds.length - 1].textContent.trim(),
        };
      })
      .catch(() => null);
  }

  function getRecords(playerId, playerName) {
    const c = store.records[playerId];
    if (c && Date.now() - c.t < TTL_RECORD) return Promise.resolve(c);
    if (pending[playerId]) return pending[playerId];
    pending[playerId] = Promise.all([
      fetchRecord('loot_res', playerId, playerName),
      fetchRecord('scavenge', playerId, playerName),
    ]).then(([farm, scav]) => {
      const rec = { t: Date.now(), farm, scav };
      store.records[playerId] = rec;
      save();
      delete pending[playerId];
      return rec;
    });
    return pending[playerId];
  }

  // ---------- dokładna data ochrony (z komunikatu placu zbornego) ----------
  // Jedno zapytanie na gracza, tylko po kliknięciu. Wynik jest zapisywany na stałe.
  store.prot = store.prot || {};
  const probing = {};
  const probeErr = {};   // nieudane próby – tylko na czas sesji

  function probeProtection(playerId, villageId, xy) {
    if (probing[playerId]) return probing[playerId];
    const base = `/game.php?village=${game_data.village.id}&screen=place`;
    probing[playerId] = fetch(`${base}&target=${villageId}`, { credentials: 'same-origin' })
      .then(r => r.text())
      .then(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const form = doc.querySelector('#command-data-form') || doc.querySelector('form[action*="try=confirm"]');
        if (!form) throw new Error('brak formularza placu');
        const fd = new FormData();
        form.querySelectorAll('input, select, textarea').forEach(el => {
          if (!el.name || el.disabled) return;
          if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked) fd.append(el.name, el.value); return; }
          fd.append(el.name, el.value);
        });
        // minimalny atak: 1 jednostka, której masz najwięcej dostępnych
        const cur = (window.TWMap && TWMap.current_units) || {};
        const unit = ['spear', 'sword', 'axe', 'light', 'heavy', 'spy'].find(u => +cur[u] > 0) || 'spear';
        fd.set(unit, '1');
        // wskazanie celu wprost – inaczej gra zwraca „Wskaż wioskę docelową”
        if (xy) {
          const [x, y] = xy.split('|');
          fd.set('x', x);
          fd.set('y', y);
          fd.set('input', xy);
          fd.set('target_type', 'coord');
        }
        const btn = form.querySelector('#target_attack') || form.querySelector('[name="attack"]');
        if (btn && btn.name) fd.set(btn.name, btn.value || 'Atakuj');
        let action = form.getAttribute('action') || `${base}&try=confirm`;
        if (action && action.indexOf('http') !== 0 && action[0] !== '/') action = '/' + action;
        return fetch(action, { method: 'POST', body: fd, credentials: 'same-origin' }).then(r => r.text());
      })
      .then(resp => {
        const d = new DOMParser().parseFromString(resp, 'text/html');
        const box = d.querySelector('.error_box, .error, #error_box, .warn');
        const text = (box ? box.textContent : '').trim().replace(/\s+/g, ' ');
        console.log('[tw-stats] odpowiedź placu dla gracza', playerId, ':', text || '(brak komunikatu)');
        // gra podaje np. „28.10. 21:27” albo „28.10.2026 21:27”
        const m = text.match(/\d{1,2}[./]\d{1,2}[./](?:\d{2,4})?(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?/);
        const rec = { date: m ? m[0] : null, text: text || null, label: currentLabel || null };
        if (rec.date) { store.prot[playerId] = rec; delete probeErr[playerId]; }
        else probeErr[playerId] = text || 'brak komunikatu';
        scheduleAlerts();
        collectAdd(rec);
        save();
        delete probing[playerId];
        if (!rec.date) return rec;
        return appendNote(villageId, `ochrona do ${rec.date}`)
          .then(r => { rec.note = r; save(); render(); return rec; })
          .catch(e => { rec.note = 'BŁĄD: ' + (e.message || e); save(); render(); return rec; });
      })
      .catch(e => {
        delete probing[playerId];
        return { error: String(e.message || e) };
      });
    return probing[playerId];
  }

  // ---------- notatka wioski ----------
  function csrf() {
    return (window.game_data && game_data.csrf) || (window.TWMap && TWMap.screenKey) || '';
  }

  function getNote(vid) {
    const url = `/game.php?village=${game_data.village.id}&screen=info_village&id=${vid}`;
    return fetch(url, { credentials: 'same-origin' })
      .then(r => r.text())
      .then(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const ta = doc.querySelector('#village_note, textarea[name="note"], #note, textarea');
        if (ta) {
          console.log('[tw-stats] notatka: znaleziono pole', ta.id || ta.name || ta.tagName);
          return ta.value || ta.textContent || '';
        }
        const hits = [];
        const re = /note/gi;
        let m;
        while ((m = re.exec(html)) && hits.length < 6) {
          hits.push(html.slice(Math.max(0, m.index - 150), m.index + 150).replace(/\s+/g, ' '));
        }
        console.log('[tw-stats] notatka: NIE znaleziono pola. Otoczenia „note”:\n' + hits.join('\n---\n'));
        try { copyText('NOTATKA – otoczenia:\n' + hits.join('\n---\n')); } catch (e) {}
        throw new Error('nie znaleziono pola notatki (szczegóły w schowku i konsoli)');
      });
  }

  function setNote(vid, text) {
    const body = new URLSearchParams({ note: text, village_id: String(vid), h: csrf() });
    return fetch(`/game.php?village=${game_data.village.id}&screen=api&ajaxaction=village_note_edit`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'TribalWars-Ajax': '1',
      },
      body: body.toString(),
    }).then(r => r.text()).then(t => {
      console.log('[tw-stats] odpowiedź zapisu notatki:', t.slice(0, 300));
      if (/error|błąd|blad/i.test(t) && !/success|ok/i.test(t)) throw new Error('serwer odrzucił zapis: ' + t.slice(0, 120));
      return t;
    });
  }

  // dopisuje linię do notatki, nie nadpisuje; nic nie robi, gdy linia już tam jest
  function appendNote(vid, line) {
    return getNote(vid).then(cur => {
      if (cur.indexOf(line) !== -1) return 'już było';
      const next = cur.trim() ? cur.replace(/\s+$/, '') + '\n' + line : line;
      return setNote(vid, next).then(() => 'dopisano');
    });
  }

  // ---------- terminy: kalendarz (.ics) i powiadomienie w przeglądarce ----------
  function parseProtDate(s) {
    const m = String(s).match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})?(?:\D{0,3}(\d{1,2}):(\d{2}))?/);
    if (!m) return null;
    let y = m[3] ? +m[3] : new Date().getFullYear();
    if (y < 100) y += 2000;
    const d = new Date(y, +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), 0, 0);
    if (!m[3] && d.getTime() < Date.now() - 180 * 86400000) d.setFullYear(y + 1);
    return d;
  }

  const pad = n => String(n).padStart(2, '0');
  const icsStamp = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
                        `T${pad(d.getHours())}${pad(d.getMinutes())}00`;

  function downloadIcs(title, when) {
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//tw-stats//PL', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:' + Date.now() + '@tw-stats',
      'DTSTAMP:' + icsStamp(new Date()),
      'DTSTART:' + icsStamp(when),
      'DTEND:' + icsStamp(new Date(when.getTime() + 15 * 60000)),
      'SUMMARY:' + title,
      'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:' + title, 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    a.download = 'ochrona.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------- tryb zbierania terminów do schowka ----------
  store.collect = store.collect || [];
  let collecting = store.collecting === true;
  let collectBtn = null;

  function refreshCollectBtn() {
    if (!collectBtn) return;
    collectBtn.textContent = collecting
      ? `Zbieranie terminów: WŁ. (${store.collect.length})`
      : 'Zbieranie terminów: WYŁ.';
    collectBtn.style.opacity = collecting ? '1' : '0.6';
  }

  function collectAdd(rec) {
    if (!collecting || !rec || !rec.date) return;
    const line = `${rec.label || 'gracz'} — ochrona do ${rec.date}`;
    if (store.collect.indexOf(line) === -1) {
      store.collect.push(line);
      save();
      refreshCollectBtn();
    }
  }

  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
    return new Promise(res => {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      ta.remove();
      res();
    });
  }

  const timers = {};

  function notify(title) {
    try {
      if (window.Notification && Notification.permission === 'granted') {
        new Notification('Plemiona', { body: title, requireInteraction: true });
        return;
      }
    } catch (e) {}
    if (window.UI && UI.ErrorMessage) UI.ErrorMessage(title, 20000); else alert(title);
  }

  // alarm godzinę przed końcem ochrony – działa tylko przy otwartej karcie z grą
  function scheduleAlerts() {
    Object.keys(store.prot).forEach(pid => {
      const rec = store.prot[pid];
      if (!rec || !rec.date || timers[pid]) return;
      const when = parseProtDate(rec.date);
      if (!when) return;
      const delay = when.getTime() - 3600000 - Date.now();
      if (delay > 0 && delay < 24 * 3600000) {
        timers[pid] = setTimeout(() => {
          notify(`Za godzinę kończy się ochrona: ${rec.label || pid} (${rec.date})`);
        }, delay);
      }
    });
  }

  // ---------- wstawianie do dymka ----------
  let currentOwner = null;
  let currentVillage = null;
  let currentLabel = '';
  // ostatnia wioska pod kursorem – pamiętana po zamknięciu dymka
  let lastOwner = null, lastVillage = null, lastLabel = '', lastXY = '';
  let currentXY = '';

  function killCell(map, id) {
    const k = map[id];
    return k ? `${fmt(k.score)} <span style="color:#777">(#${k.rank})</span>` : '0';
  }

  function recCell(r) {
    if (r === undefined) return '<i style="color:#777">ładowanie…</i>';
    if (!r) return '<span style="color:#777">brak</span>';
    return `${r.score} <span style="color:#777">— ${r.date}</span>`;
  }

  // status ochrony: lista non_attackable_players pochodzi wprost z gry
  function protCell(id) {
    const list = window.TWMap && TWMap.non_attackable_players;
    if (!list) return '<span style="color:#777">b.d.</span>';
    if (list.indexOf(String(id)) === -1)
      return '<span style="color:#0a0">brak – możesz atakować</span>';

    const my = (points[String(game_data.player.id)] || {}).p;
    const his = (points[String(id)] || {}).p;
    const parts = [];

    if (my && his != null) {
      const need = Math.ceil(my / rules.ratio) - his;
      if (need > 0) parts.push(`brakuje mu <b>${fmt(need)}</b> pkt`);
      else parts.push('punkty już OK – to ochrona nowicjusza');
    }
    if (rules.endTs) {
      const left = Math.ceil((rules.endTs - Date.now()) / 86400000);
      const d = new Date(rules.endTs).toLocaleDateString('pl-PL');
      parts.push(left > 0 ? `reguła ${rules.ratio}:1 wygasa ok. ${d} (za ${left} dni)` : 'reguła już wygasła');
    }

    const p = store.prot[id];
    let exact;
    if (!p && probeErr[id]) {
      return `<span style="color:#a00">aktywna</span> — <span style="color:#777">${probeErr[id].slice(0, 90)}</span>` +
             ` <a href="#" class="tw-prot-check" data-pid="${id}">spróbuj ponownie</a>` +
             (parts.length ? `<br><span style="color:#777">${parts.join(' • ')}</span>` : '');
    }
    if (p && p.date) exact = `<b>koniec: ${p.date}</b>` +
      ` <a href="#" class="tw-prot-ics" data-pid="${id}">kalendarz</a>` +
      (p.note ? ` <span style="color:#777">(${p.note})</span>` : '');
    else if (p && p.text) exact = `<span title="${p.text.replace(/"/g, '&quot;')}">${p.text.slice(0, 90)}</span>`;
    else if (p && p.error) exact = `<span style="color:#a00">błąd: ${p.error}</span>`;
    else exact = `<a href="#" class="tw-prot-check" data-pid="${id}">sprawdź dokładną datę</a>`;

    return `<span style="color:#a00">aktywna</span> — ${exact}` +
           (parts.length ? `<br><span style="color:#777">${parts.join(' • ')}</span>` : '');
  }

  function render() {
    const popup = document.getElementById('map_popup');
    if (!popup || !currentOwner) return;
    const tbody = popup.querySelector('#info_content tbody') ||
                  popup.querySelector('table tbody') ||
                  popup.querySelector('table');
    if (!tbody) return;

    rendering = true;
    try {
      popup.querySelectorAll('.tw-stats').forEach(e => e.remove());
      const id = currentOwner;
      const rec = store.records[id] && Date.now() - store.records[id].t < TTL_RECORD ? store.records[id] : {};
      const rows = [
        ['Pokonani w ataku (ODA)', killCell(kills.att, id)],
        ['Pokonani w obronie (ODD)', killCell(kills.def, id)],
        ['Rekord farmy', recCell(rec.farm)],
        ['Rekord zbieracza', recCell(rec.scav)],
        [`Ochrona ${rules.ratio}:1`, protCell(id)],
      ];
      const loy = loyCell(currentXY);
      if (loy) rows.push(['Poparcie', loy]);
      tbody.insertAdjacentHTML('beforeend', rows.map(([l, v]) =>
        `<tr class="tw-stats"><td>${l}:</td><td>${v}</td></tr>`).join(''));
    } finally {
      setTimeout(() => { rendering = false; }, 0);
    }
  }

  // ---------- przycisk wł./wył. ----------
  let enabled = store.enabled === true; // domyślnie wyłączone

  function styleBtn(btn) {
    btn.textContent = enabled ? 'Statystyki w dymku: WŁ.' : 'Statystyki w dymku: WYŁ.';
    btn.style.opacity = enabled ? '1' : '0.6';
  }

  function loadAll() {
    loadVillages().then(render);
    loadKills().then(render);
    loadPlayers().then(render);
    loadWorld().then(render);
  }

  function addToggle() {
    if (document.getElementById('tw-stats-toggle')) return;
    const btn = document.createElement('button');
    btn.id = 'tw-stats-toggle';
    btn.type = 'button';
    btn.className = 'btn';
    btn.style.margin = '0 0 6px 0';
    styleBtn(btn);
    btn.addEventListener('click', () => {
      enabled = !enabled;
      store.enabled = enabled;
      save();
      styleBtn(btn);
      if (enabled) {
        loadAll();
        try {
          if (window.Notification && Notification.permission === 'default') Notification.requestPermission();
        } catch (e) {}
      } else {
        document.querySelectorAll('.tw-stats').forEach(e => e.remove());
      }
    });
    // drugi przycisk: zbieranie terminów do schowka
    collectBtn = document.createElement('button');
    collectBtn.id = 'tw-stats-collect';
    collectBtn.type = 'button';
    collectBtn.className = 'btn';
    collectBtn.style.margin = '0 0 6px 6px';
    refreshCollectBtn();
    collectBtn.addEventListener('click', () => {
      if (collecting) {
        const text = store.collect.join('\n');
        const n = store.collect.length;
        collecting = false;
        store.collecting = false;
        if (n) {
          copyText(text).then(() => {
            store.collect = [];
            save();
            refreshCollectBtn();
            const msg = `Skopiowano ${n} termin(ów) do schowka.`;
            if (window.UI && UI.SuccessMessage) UI.SuccessMessage(msg, 6000); else alert(msg);
          });
        } else {
          save();
          refreshCollectBtn();
          if (window.UI && UI.InfoMessage) UI.InfoMessage('Brak zebranych terminów.', 4000);
        }
      } else {
        collecting = true;
        store.collecting = true;
        save();
        refreshCollectBtn();
      }
    });

    const bar = document.createElement('div');
    bar.id = 'tw-stats-bar';
    bar.className = 'containerBorder';
    Object.assign(bar.style, {
      padding: '6px 8px', margin: '0 0 6px 0', background: '#f4e4bc',
      border: '1px solid #7d510f', borderRadius: '3px',
    });
    bar.innerHTML = '<b style="margin-right:8px">Statystyki w dymku</b>' +
      '<span style="margin-right:8px;color:#5c3c1a">(Shift+D nad wioską = data ochrony)</span>';
    bar.appendChild(btn);
    bar.appendChild(collectBtn);

    // trzeci przycisk: sprawdzenie daty dla ostatniej wioski pod kursorem
    const dateBtn = document.createElement('button');
    dateBtn.type = 'button';
    dateBtn.className = 'btn';
    dateBtn.style.margin = '0 0 0 6px';
    dateBtn.textContent = 'Sprawdź datę ochrony (ostatnia wioska)';
    dateBtn.addEventListener('click', () => {
      if (!lastOwner || !lastVillage) {
        if (window.UI && UI.InfoMessage) UI.InfoMessage('Najedź najpierw na wioskę gracza.', 4000);
        return;
      }
      const old = dateBtn.textContent;
      dateBtn.textContent = 'sprawdzam…';
      currentLabel = lastLabel;
      probeProtection(lastOwner, lastVillage, lastXY).then(rec => {
        dateBtn.textContent = old;
        render();
        const msg = rec.date ? `${lastLabel} — ochrona do ${rec.date}`
                             : (rec.text || rec.error || 'brak komunikatu');
        if (window.UI && UI.SuccessMessage) UI.SuccessMessage(msg, 10000); else alert(msg);
      });
    });
    bar.appendChild(dateBtn);

    // przycisk diagnostyczny: zrzuca zawartość dymka do schowka
    const dbgBtn = document.createElement('button');
    dbgBtn.type = 'button';
    dbgBtn.className = 'btn';
    dbgBtn.style.margin = '0 0 0 6px';
    dbgBtn.textContent = 'Diagnostyka dymka (5 s)';
    dbgBtn.addEventListener('click', () => {
      const snaps = [];
      dbgBtn.textContent = 'najedź na wioskę…';
      const grab = () => {
        const p = document.getElementById('map_popup');
        if (!p) return;
        const html = p.outerHTML;
        if (html.length > 200 && snaps.indexOf(html) === -1) snaps.push(html);
      };
      const iv = setInterval(grab, 300);
      setTimeout(() => {
        clearInterval(iv);
        const ids = Object.keys(window).filter(k => /map|popup/i.test(k)).join(', ');
        const out = [
          'statystyki włączone: ' + enabled,
          'wiosek w indeksie: ' + (coords ? Object.keys(coords).length : 'nie wczytano'),
          'graczy w indeksie: ' + Object.keys(points).length,
          'ostatnia rozpoznana wioska: ' + (lastLabel || 'brak'),
          'map_popup istnieje: ' + !!document.getElementById('map_popup'),
          'zmienne globalne: ' + ids.slice(0, 300),
          'TWMap: ' + (typeof window.TWMap),
          'TWMap.popup: ' + (window.TWMap ? typeof TWMap.popup : '-'),
          'liczba zrzutów: ' + snaps.length,
          '--- ZRZUTY ---',
          snaps.slice(0, 2).join('\n\n=====\n\n').slice(0, 12000),
        ].join('\n');
        console.log('[tw-stats] DIAGNOSTYKA\n' + out);
        copyText(out).then(() => {
          dbgBtn.textContent = 'Diagnostyka dymka (5 s)';
          const msg = `Skopiowano diagnostykę (${snaps.length} zrzutów). Wklej ją Claude.`;
          if (window.UI && UI.SuccessMessage) UI.SuccessMessage(msg, 8000); else alert(msg);
        });
      }, 5000);
    });
    bar.appendChild(dbgBtn);

    // skan raportów po poparcie
    const loyBtn = document.createElement('button');
    loyBtn.type = 'button';
    loyBtn.className = 'btn';
    loyBtn.style.margin = '0 0 0 6px';
    const loyLabel = () => 'Skanuj raporty (poparcie)';
    loyBtn.textContent = loyLabel();
    loyBtn.addEventListener('click', () => {
      scanReports(2, loyBtn).then(() => { loyBtn.textContent = loyLabel(); });
    });
    bar.appendChild(loyBtn);

    const anchor = document.getElementById('map_whole') || document.getElementById('map_big') ||
                   document.getElementById('content_value');
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(bar, anchor);
      console.log('[tw-stats] pasek wstawiony nad', anchor.id);
    } else {
      Object.assign(bar.style, { position: 'fixed', top: '80px', right: '10px', zIndex: 99999 });
      document.body.appendChild(bar);
      console.log('[tw-stats] pasek wstawiony jako nakładka w prawym górnym rogu');
    }
  }

  // ---------- poparcie z raportów (wioski, w które weszły szlachcice) ----------
  store.loy = store.loy || {};

  function parseReportTime(txt) {
    const now = new Date();
    let m = txt.match(/(dzisiaj|dziś)\s*o\s*(\d{1,2}):(\d{2})/i);
    if (m) { const d = new Date(now); d.setHours(+m[2], +m[3], 0, 0); return d.getTime(); }
    m = txt.match(/(wczoraj|wcz\.)\s*o\s*(\d{1,2}):(\d{2})/i);
    if (m) { const d = new Date(now); d.setDate(d.getDate() - 1); d.setHours(+m[2], +m[3], 0, 0); return d.getTime(); }
    m = txt.match(/(\d{1,2})\.(\d{1,2})\.(?:(\d{2,4}))?\s*o\s*(\d{1,2}):(\d{2})/);
    if (m) {
      let y = m[3] ? +m[3] : now.getFullYear();
      if (y < 100) y += 2000;
      const d = new Date(y, +m[2] - 1, +m[1], +m[4], +m[5], 0, 0);
      if (!m[3] && d.getTime() > Date.now() + 86400000) d.setFullYear(y - 1);
      return d.getTime();
    }
    return null;
  }

  // zbiór moich współrzędnych – żeby odróżnić obrońcę od atakującego
  function myCoordSet() {
    const me = String(game_data.player.id);
    const set = {};
    if (coords) for (const k in coords) if (coords[k].pid === me) set[k] = 1;
    return set;
  }

  function parseReport(html, mine) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const txt = (doc.body.textContent || '').replace(/\s+/g, ' ');

    let m = txt.match(/Poparcie[^0-9]{0,25}(\d{1,3})\s*(?:→|->|–|-|do)\s*(\d{1,3})/i);
    let loy = m ? +m[2] : null;
    if (loy === null) {
      m = txt.match(/Poparcie[^0-9]{0,25}(\d{1,3})/i);
      loy = m ? +m[1] : null;
    }
    if (loy === null) return null;

    const all = (txt.match(/\((\d{1,3})\|(\d{1,3})\)/g) || []).map(x => x.slice(1, -1));
    const target = all.filter(k => !mine[k]).pop() || all.pop();
    if (!target) return null;

    return { key: target, loy, when: (txt.match(/(dzisiaj|dziś|wczoraj|wcz\.|\d{1,2}\.\d{1,2}\.)[^|]{0,20}?\d{1,2}:\d{2}/i) || [''])[0].trim(), ts: parseReportTime(txt) };
  }

  let scanning = false;

  function scanReports(pages, btn) {
    if (scanning) return Promise.resolve();
    scanning = true;
    const setLabel = t => { if (btn) btn.textContent = t; };
    const base = `/game.php?village=${game_data.village.id}&screen=report&mode=attack`;

    return loadVillages().then(() => {
      const mine = myCoordSet();
      const links = [];
      const getPage = i => i >= pages ? Promise.resolve() :
        fetch(`${base}&page=${i}`, { credentials: 'same-origin' }).then(r => r.text()).then(html => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          doc.querySelectorAll('a[href*="view="]').forEach(a => {
            const h = a.getAttribute('href');
            if (h && links.indexOf(h) === -1) links.push(h);
          });
          return getPage(i + 1);
        });

      return getPage(0).then(() => {
        let done = 0, found = 0, sample = null;
        const next = () => {
          if (!links.length) return Promise.resolve();
          const h = links.shift();
          setLabel(`raporty: ${++done}/${done + links.length}`);
          return fetch(h.indexOf('http') === 0 ? h : (h[0] === '/' ? h : '/' + h), { credentials: 'same-origin' })
            .then(r => r.text())
            .then(html => {
              if (!sample) sample = html;
              const r = parseReport(html, mine);
              if (r) {
                const old = store.loy[r.key];
                if (!old || !old.ts || (r.ts && r.ts >= old.ts)) {
                  store.loy[r.key] = { loy: r.loy, when: r.when, ts: r.ts };
                  found++;
                }
              }
            })
            .catch(() => {})
            .then(next);
        };
        return next().then(() => {
          save();
          scanning = false;
          render();
          if (!found && sample) {
            const dump = 'RAPORT – nie znaleziono poparcia. Próbka:\n' +
                         sample.replace(/\s+/g, ' ').slice(0, 4000);
            console.log('[tw-stats] ' + dump);
            copyText(dump);
            const msg = `Przejrzano ${done} raportów, poparcia nie znalazłem — próbka w schowku.`;
            if (window.UI && UI.ErrorMessage) UI.ErrorMessage(msg, 15000); else alert(msg);
          } else {
            const msg = `Przejrzano ${done} raportów, zapisano poparcie dla ${found} wiosek.`;
            if (window.UI && UI.SuccessMessage) UI.SuccessMessage(msg, 10000); else alert(msg);
          }
        });
      });
    }).catch(e => {
      scanning = false;
      console.log('[tw-stats] błąd skanowania raportów', e);
    });
  }

  // poparcie odrasta o 1 na godzinę
  function loyCell(key) {
    const r = store.loy[key];
    if (!r) return null;
    let txt = `<b>${r.loy}</b>`;
    if (r.ts) {
      const h = Math.floor((Date.now() - r.ts) / 3600000);
      const now = Math.min(100, r.loy + Math.max(0, h));
      if (now !== r.loy) txt += ` → teraz ok. <b>${now}</b>`;
    }
    if (r.when) txt += ` <span style="color:#777">(raport: ${r.when})</span>`;
    return txt;
  }

  // ---------- rozpoznawanie dymka po jego zawartosci ----------
  let rendering = false;

  function handlePopup() {
    if (rendering || !enabled) return;
    const popup = document.getElementById('map_popup');
    if (!popup) { currentOwner = null; return; }
    const th = popup.querySelector('#info_content th');
    const m = th && th.textContent.match(/\((\d+)\|(\d+)\)/);
    if (!m) { currentOwner = null; return; }
    const key = m[1] + '|' + m[2];

    if (!coords) { loadVillages().then(() => handlePopup()); return; }
    const v = coords[key];
    if (!v || !v.pid || v.pid === '0') { currentOwner = null; return; }   // barbarzyńska lub nieznana

    if (v.pid === currentOwner && popup.querySelector('.tw-stats')) return;

    currentOwner = v.pid;
    currentVillage = v.vid;
    currentXY = key;
    const nm = (points[v.pid] || {}).n || ('gracz ' + v.pid);
    currentLabel = `${nm} (${key})`;
    lastOwner = v.pid; lastVillage = v.vid; lastLabel = currentLabel; lastXY = key;

    render();
    loadAll();
    if (nm) getRecords(v.pid, nm).then(() => { if (currentOwner === v.pid) render(); });
  }

  function init() {
    if (!/screen=map/.test(location.search)) return;  // tylko ekran mapy
    addToggle();

    const popup = document.getElementById('map_popup');
    if (popup) {
      new MutationObserver(handlePopup).observe(popup, { childList: true, subtree: true, attributes: true });
      console.log('[tw-stats] podpięto obserwator dymka');
    } else {
      // dymek powstaje pozniej – obserwujemy cale body
      new MutationObserver(() => {
        const p = document.getElementById('map_popup');
        if (!p) return;
        new MutationObserver(handlePopup).observe(p, { childList: true, subtree: true, attributes: true });
        console.log('[tw-stats] podpięto obserwator dymka (z opóźnieniem)');
      }).observe(document.body, { childList: true, subtree: true });
    }

    // klikniecia w dymku
    document.addEventListener('click', ev => {
      if (!ev.target.closest) return;

      const chk = ev.target.closest('.tw-prot-check');
      if (chk) {
        ev.preventDefault();
        if (!currentVillage) return;
        chk.textContent = 'sprawdzam…';
        probeProtection(chk.dataset.pid, currentVillage, currentXY).then(() => render());
        return;
      }

      const cal = ev.target.closest('.tw-prot-ics');
      if (cal) {
        ev.preventDefault();
        const rec = store.prot[cal.dataset.pid];
        const when = rec && parseProtDate(rec.date);
        if (when) downloadIcs(`Plemiona: koniec ochrony — ${rec.label || cal.dataset.pid}`, when);
      }
    });

    // skrót Shift+D – sprawdza datę dla wioski aktualnie pod kursorem
    document.addEventListener('keydown', ev => {
      if (!enabled || !ev.shiftKey || ev.ctrlKey || ev.altKey) return;
      if (String(ev.key).toLowerCase() !== 'd') return;
      const t = ev.target && ev.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || (ev.target && ev.target.isContentEditable)) return;
      ev.preventDefault();
      if (!lastOwner || !lastVillage) {
        if (window.UI && UI.InfoMessage) UI.InfoMessage('Najedź myszką na wioskę i naciśnij Shift+D.', 4000);
        return;
      }
      const label = lastLabel;
      if (window.UI && UI.InfoMessage) UI.InfoMessage('Sprawdzam: ' + label, 3000);
      probeProtection(lastOwner, lastVillage, lastXY).then(rec => {
        render();
        const ok = rec.date && rec.note && rec.note.indexOf('BŁĄD') === -1;
        const msg = rec.date ? `${label} — ochrona do ${rec.date}` + (rec.note ? ` [notatka: ${rec.note}]` : '')
                             : (rec.text || rec.error || 'brak komunikatu');
        if (ok) {
          if (window.UI && UI.SuccessMessage) UI.SuccessMessage(msg, 12000); else alert(msg);
        } else {
          const report = [
            'RAPORT Shift+D',
            'wioska: ' + label + ' (id ' + lastVillage + ', gracz ' + lastOwner + ', ' + lastXY + ')',
            'data z placu: ' + (rec.date || 'BRAK'),
            'komunikat placu: ' + (rec.text || rec.error || '-'),
            'notatka: ' + (rec.note || 'nie próbowano'),
          ].join('\n');
          console.log('[tw-stats] ' + report);
          copyText(report);
          if (window.UI && UI.ErrorMessage) UI.ErrorMessage(msg + ' — raport w schowku', 15000);
          else alert(report);
        }
      });
    });

    scheduleAlerts();
    setInterval(scheduleAlerts, 30 * 60 * 1000);
    if (enabled) loadAll();
  }

  init();
})();
