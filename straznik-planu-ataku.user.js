// ==UserScript==
// @name         Plemiona – Strażnik planu ataku
// @namespace    dawid.plemiona
// @version      1.21
// @updateURL    https://raw.githubusercontent.com/Rokerio/noweRepo/main/straznik-planu-ataku.user.js
// @downloadURL  https://raw.githubusercontent.com/Rokerio/noweRepo/main/straznik-planu-ataku.user.js
// @description  Pływający panel z planem ataku: odliczanie do otwarcia/zamknięcia okna wysyłki, alarm dźwiękowy + powiadomienie, licznik w tytule karty, auto-odhaczanie po wysłaniu, podpowiedź celu katapult (spichlerz/zagroda). Import planu przez wklejenie BBCode (format tabelaryczny i lista "Wyślij FEJK/OFF/BURZAK"). Nie klika za Ciebie.
// @match        https://*.plemiona.pl/game.php*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/* global game_data, Timing, UI */

(function () {
  'use strict';

  if (typeof game_data === 'undefined') return;

  // =====================================================================
  //  DOMYŚLNY PLAN (pl233, wejście 01.10 08:00–12:00)
  // =====================================================================
  const DEFAULT_WORLD = 'pl233';
  const PLAN_VER = 'all-29.10';
  const DEFAULT_PLAN = [
    { id: 1, type: 'Burzak', vil: 13391, tgt: 11488, units: 0, note: '25k na Kuźnia', from: '617|539', to: '422|583', start: '2026-10-29 05:02:56', end: '2026-10-29 09:02:56' },
    { id: 2, type: 'Burzak', vil: 12617, tgt: 11211, units: 0, note: '25k na Zagroda', from: '611|550', to: '421|577', start: '2026-10-29 09:02:44', end: '2026-10-29 13:02:44' },
    { id: 3, type: 'Szlachcic', vil: 21855, tgt: 0, units: 0, note: '1 szlachcic (dobitka), ląd. 10:45:29.061', from: '643|553', to: '641|551', start: '2026-10-29 09:06:19', end: '2026-10-29 09:06:39' },
    { id: 4, type: 'Burzak', vil: 12789, tgt: 9689, units: 0, note: '25k na Zagroda', from: '611|549', to: '425|566', start: '2026-10-29 11:36:45', end: '2026-10-29 15:36:45' },
    { id: 5, type: 'Burzak', vil: 14485, tgt: 7338, units: 0, note: '25k na Zagroda', from: '620|539', to: '436|558', start: '2026-10-29 12:30:39', end: '2026-10-29 16:30:39' },
    { id: 6, type: 'Burzak', vil: 20466, tgt: 9057, units: 0, note: '40k na Zagroda', from: '640|556', to: '458|588', start: '2026-10-29 12:36:15', end: '2026-10-29 16:36:15' },
    { id: 7, type: 'Burzak', vil: 12513, tgt: 8634, units: 0, note: '25k na Zagroda', from: '611|538', to: '431|565', start: '2026-10-29 13:59:35', end: '2026-10-29 17:59:35' },
    { id: 8, type: 'Fejk', vil: 2818, tgt: 8594, units: 100, note: '', from: '604|536', to: '427|560', start: '2026-10-29 14:41:25', end: '2026-10-29 16:41:25' },
    { id: 9, type: 'OFF', vil: 9922, tgt: 6062, units: 21048, note: '150k na Zagroda', from: '612|536', to: '435|545', start: '2026-10-29 15:23:08', end: '2026-10-29 17:23:08' },
    { id: 10, type: 'Fejk', vil: 13186, tgt: 959, units: 100, note: '', from: '609|552', to: '435|585', start: '2026-10-29 15:26:57', end: '2026-10-29 17:26:57' },
    { id: 11, type: 'Fejk', vil: 1812, tgt: 10228, units: 100, note: '', from: '606|541', to: '434|583', start: '2026-10-29 15:28:23', end: '2026-10-29 17:28:23' },
    { id: 12, type: 'Fejk', vil: 11662, tgt: 6315, units: 100, note: '', from: '609|542', to: '432|541', start: '2026-10-29 15:29:55', end: '2026-10-29 17:29:55' },
    { id: 13, type: 'Burzak', vil: 14403, tgt: 6631, units: 0, note: '25k na Zagroda', from: '617|546', to: '439|555', start: '2026-10-29 15:53:11', end: '2026-10-29 19:53:11' },
    { id: 14, type: 'Burzak', vil: 11907, tgt: 1047, units: 0, note: '45k na Zagroda', from: '610|538', to: '432|537', start: '2026-10-29 15:59:55', end: '2026-10-29 19:59:55' },
    { id: 15, type: 'Fejk', vil: 1812, tgt: 2519, units: 100, note: '', from: '606|541', to: '436|582', start: '2026-10-29 16:33:46', end: '2026-10-29 18:33:46' },
    { id: 16, type: 'Fejk', vil: 11662, tgt: 4770, units: 100, note: '', from: '609|542', to: '435|552', start: '2026-10-29 16:51:23', end: '2026-10-29 18:51:23' },
    { id: 17, type: 'Fejk', vil: 2327, tgt: 6218, units: 100, note: '', from: '603|540', to: '429|533', start: '2026-10-29 16:55:47', end: '2026-10-29 18:55:47' },
    { id: 18, type: 'Fejk', vil: 2818, tgt: 7448, units: 100, note: '', from: '604|536', to: '431|554', start: '2026-10-29 17:01:59', end: '2026-10-29 19:01:59' },
    { id: 19, type: 'Fejk', vil: 2818, tgt: 9747, units: 100, note: '', from: '604|536', to: '438|583', start: '2026-10-29 17:44:14', end: '2026-10-29 19:44:14' },
    { id: 20, type: 'Fejk', vil: 13186, tgt: 11567, units: 100, note: '', from: '609|552', to: '443|598', start: '2026-10-29 17:52:20', end: '2026-10-29 19:52:20' },
    { id: 21, type: 'Fejk', vil: 13337, tgt: 7641, units: 100, note: '', from: '612|552', to: '443|585', start: '2026-10-29 17:54:15', end: '2026-10-29 19:54:15' },
    { id: 22, type: 'OFF', vil: 2818, tgt: 6208, units: 19373, note: '150k na Zagroda', from: '604|536', to: '432|540', start: '2026-10-29 17:58:36', end: '2026-10-29 19:58:36' },
    { id: 23, type: 'Burzak', vil: 7048, tgt: 6208, units: 0, note: '25k na Zagroda', from: '605|539', to: '432|540', start: '2026-10-29 18:29:55', end: '2026-10-29 22:29:55' },
    { id: 24, type: 'Burzak', vil: 12846, tgt: 8804, units: 0, note: '25k na Zagroda', from: '612|548', to: '445|577', start: '2026-10-29 20:15:01', end: '2026-10-30 00:15:01' },
    { id: 25, type: 'Burzak', vil: 12671, tgt: 14258, units: 0, note: '25k na Zagroda', from: '611|548', to: '456|616', start: '2026-10-29 20:22:12', end: '2026-10-30 00:22:12' },
    { id: 26, type: 'Burzak', vil: 9032, tgt: 6905, units: 0, note: '25k na Zagroda', from: '605|537', to: '439|560', start: '2026-10-29 21:12:26', end: '2026-10-30 01:12:26' },
    { id: 27, type: 'Burzak', vil: 1789, tgt: 11072, units: 0, note: '25k na Zagroda', from: '607|536', to: '456|603', start: '2026-10-29 22:24:06', end: '2026-10-30 02:24:06' },
    { id: 28, type: 'Burzak', vil: 12168, tgt: 9057, units: 0, note: '25k na Zagroda', from: '611|540', to: '458|588', start: '2026-10-30 00:49:25', end: '2026-10-30 04:49:25' },
    { id: 29, type: 'Burzak', vil: 13739, tgt: 4603, units: 0, note: '25k na Zagroda', from: '615|550', to: '462|598', start: '2026-10-30 00:49:25', end: '2026-10-30 04:49:25' },
    { id: 30, type: 'Burzak', vil: 11810, tgt: 9486, units: 0, note: '25k na Zagroda', from: '607|543', to: '458|587', start: '2026-10-30 03:19:10', end: '2026-10-30 07:19:10' },
    { id: 31, type: 'Burzak', vil: 11510, tgt: 4603, units: 0, note: '25k na Zagroda', from: '604|541', to: '462|598', start: '2026-10-30 04:29:36', end: '2026-10-30 08:29:36' },
    { id: 32, type: 'Burzak', vil: 19906, tgt: 1791, units: 200, note: '75k na Zagroda', from: '641|554', to: '498|505', start: '2026-10-30 05:25:08', end: '2026-10-30 09:25:08' },
    { id: 33, type: 'Burzak', vil: 34454, tgt: 2100, units: 200, note: '75k na Zagroda', from: '693|508', to: '547|505', start: '2026-10-30 07:59:05', end: '2026-10-30 11:59:05' },
    { id: 34, type: 'OFF', vil: 11662, tgt: 929, units: 19697, note: '150k na Zagroda', from: '609|542', to: '481|607', start: '2026-10-30 08:13:15', end: '2026-10-30 10:13:15' },
    { id: 35, type: 'Burzak', vil: 12944, tgt: 7198, units: 0, note: '25k na Zagroda', from: '612|550', to: '480|605', start: '2026-10-30 09:30:00', end: '2026-10-30 13:30:00' },
    { id: 36, type: 'OFF', vil: 2327, tgt: 929, units: 19609, note: '150k na Zagroda', from: '603|540', to: '481|607', start: '2026-10-30 10:24:24', end: '2026-10-30 12:24:24' },
    { id: 37, type: 'OFF', vil: 1812, tgt: 10699, units: 19564, note: '150k na Zagroda', from: '606|541', to: '482|603', start: '2026-10-30 10:40:55', end: '2026-10-30 12:40:55' },
    { id: 38, type: 'Burzak', vil: 11171, tgt: 10456, units: 0, note: '25k na Zagroda', from: '608|536', to: '486|603', start: '2026-10-30 11:24:24', end: '2026-10-30 15:24:24' },
    { id: 39, type: 'Fejk', vil: 2327, tgt: 18051, units: 100, note: '', from: '603|540', to: '510|639', start: '2026-10-30 12:05:05', end: '2026-10-30 14:05:05' },
    { id: 40, type: 'Fejk', vil: 13186, tgt: 8639, units: 100, note: '', from: '609|552', to: '481|592', start: '2026-10-30 12:56:52', end: '2026-10-30 14:56:52' },
    { id: 41, type: 'Burzak', vil: 11388, tgt: 10174, units: 200, note: '100k na Zagroda', from: '606|543', to: '483|600', start: '2026-10-30 13:13:02', end: '2026-10-30 17:13:02' },
    { id: 42, type: 'Fejk', vil: 13337, tgt: 14600, units: 100, note: '', from: '612|552', to: '502|627', start: '2026-10-30 13:25:57', end: '2026-10-30 15:25:57' },
    { id: 43, type: 'OFF', vil: 460, tgt: 10274, units: 21209, note: '150k na Zagroda', from: '605|541', to: '488|604', start: '2026-10-30 13:33:30', end: '2026-10-30 15:33:30' },
    { id: 44, type: 'Fejk', vil: 9922, tgt: 19682, units: 100, note: '', from: '612|536', to: '532|640', start: '2026-10-30 14:23:42', end: '2026-10-30 16:23:42' },
    { id: 45, type: 'Fejk', vil: 13337, tgt: 13581, units: 100, note: '', from: '612|552', to: '504|625', start: '2026-10-30 14:49:17', end: '2026-10-30 16:49:17' },
    { id: 46, type: 'Fejk', vil: 1812, tgt: 8161, units: 100, note: '', from: '606|541', to: '487|591', start: '2026-10-30 15:27:41', end: '2026-10-30 17:27:41' },
    { id: 47, type: 'Fejk', vil: 460, tgt: 21045, units: 100, note: '', from: '605|541', to: '534|648', start: '2026-10-30 15:47:36', end: '2026-10-30 17:47:36' },
    { id: 48, type: 'Fejk', vil: 9922, tgt: 12449, units: 100, note: '', from: '612|536', to: '515|620', start: '2026-10-30 15:50:31', end: '2026-10-30 17:50:31' },
    { id: 49, type: 'Burzak', vil: 12208, tgt: 12211, units: 0, note: '25k na Zagroda', from: '609|536', to: '511|621', start: '2026-10-30 16:08:12', end: '2026-10-30 20:08:12' },
    { id: 50, type: 'Fejk', vil: 460, tgt: 20986, units: 100, note: '', from: '605|541', to: '534|647', start: '2026-10-30 16:12:34', end: '2026-10-30 18:12:34' },
    { id: 51, type: 'Fejk', vil: 9922, tgt: 24670, units: 100, note: '', from: '612|536', to: '559|652', start: '2026-10-30 16:13:58', end: '2026-10-30 18:13:58' },
    { id: 52, type: 'Fejk', vil: 11662, tgt: 14767, units: 100, note: '', from: '609|542', to: '513|624', start: '2026-10-30 16:52:23', end: '2026-10-30 18:52:23' },
    { id: 53, type: 'Burzak', vil: 13798, tgt: 2133, units: 0, note: '25k na Zagroda', from: '615|543', to: '496|507', start: '2026-10-30 18:50:13', end: '2026-10-30 22:50:13' },
    { id: 54, type: 'Burzak', vil: 13940, tgt: 3261, units: 0, note: '25k na Zagroda', from: '618|540', to: '499|508', start: '2026-10-30 19:23:11', end: '2026-10-30 23:23:11' },
    { id: 55, type: 'Burzak', vil: 12252, tgt: 12190, units: 0, note: '25k na Zagroda', from: '610|544', to: '514|619', start: '2026-10-30 20:05:17', end: '2026-10-31 00:05:17' },
    { id: 56, type: 'Burzak', vil: 12103, tgt: 101, units: 0, note: '25k na Zagroda', from: '609|538', to: '501|503', start: '2026-10-31 00:14:06', end: '2026-10-31 04:14:06' },
    { id: 57, type: 'OFF', vil: 13337, tgt: 12255, units: 15343, note: '119k na Zagroda', from: '612|552', to: '541|608', start: '2026-10-31 10:47:12', end: '2026-10-31 12:47:12' },
    { id: 58, type: 'Fejk', vil: 460, tgt: 12847, units: 100, note: '', from: '605|541', to: '548|610', start: '2026-10-31 11:15:03', end: '2026-10-31 13:15:03' },
    { id: 59, type: 'OFF', vil: 13186, tgt: 11345, units: 15324, note: '113k na Zagroda', from: '609|552', to: '541|607', start: '2026-10-31 12:16:15', end: '2026-10-31 14:16:15' },
    { id: 60, type: 'Fejk', vil: 2327, tgt: 11383, units: 100, note: '', from: '603|540', to: '548|604', start: '2026-10-31 13:48:25', end: '2026-10-31 15:48:25' }
  ];

  // =====================================================================
  //  STAN
  // =====================================================================
  const KEY = 'planAtaku_' + game_data.world;
  const store = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
  if (!store.plan) store.plan = [];
  store.done = store.done || {};          // id -> timestamp wysłania
  store.alerted = store.alerted || {};    // "id:open" / "id:warn" / "id:close"
  store.warnMin = store.warnMin == null ? 10 : Number(store.warnMin);   // alarm X min przed otwarciem
  store.lastMin = store.lastMin == null ? 30 : Number(store.lastMin);   // ostrzeżenie X min przed zamknięciem
  store.collapsed = !!store.collapsed;
  if (window.innerWidth < 700) store.collapsed = true;   // telefon: panel po wejściu na stronę zawsze zwinięty (rozwinięty zasłania całą stronę, w tym Klina)
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } };

  const pad = (n, l = 2) => String(n).padStart(l, '0');
  function now() {
    try { if (typeof Timing !== 'undefined' && Timing.getCurrentServerTime) return Timing.getCurrentServerTime(); } catch (e) { /* brak */ }
    return Date.now();
  }
  const toMs = s => { const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : NaN; };
  function fmtLeft(ms) {
    ms = Math.max(0, ms);
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
    return (d ? d + 'd ' : '') + (d || h ? h + ':' + pad(m) : m) + ':' + pad(s);
  }
  const hm = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const dayLbl = ms => { const d = new Date(ms); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`; };

  // Okna, które są już otwarte w chwili wczytania planu, nie odpalają alarmu otwarcia/ostrzeżenia (bez lawiny dźwięków).
  const silenceOpen = () => { const n = now(); store.plan.forEach(a => { if (toMs(a.start) <= n) { store.alerted[a.id + ':warn'] = 1; store.alerted[a.id + ':open'] = 1; } }); };

  // Plan wbudowany w skrypt: wczytuje się raz po każdej nowej wersji planu (PLAN_VER); własny import potem go nie nadpisuje.
  if (game_data.world === DEFAULT_WORLD && store.defaultVer !== PLAN_VER) {
    store.plan = DEFAULT_PLAN; store.done = {}; store.alerted = {}; store.defaultVer = PLAN_VER; store.planVer = 'default';
    silenceOpen(); save();
  }

  // =====================================================================
  //  IMPORT BBCode
  // =====================================================================
  const fmtDate = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm(ms)}`; };
  const fmtType = t => { t = t.trim(); return t.length <= 3 ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(); };

  // Format 1: tabela tw-planer ([table]...[*]...[|]...)
  function parseTable(bb) {
    const rows = bb.split('[*]').slice(1);
    const out = [];
    rows.forEach((r, i) => {
      const c = r.replace('[/table]', '').split('[|]');
      if (c.length < 7) return;
      const url = (c[1].match(/\[url=([^\]]+)\]/) || [])[1] || '';
      const label = (c[1].match(/\]([^[]+)\[\/url\]/) || [])[1] || '';
      const vil = +((url.match(/village=(\d+)/) || [])[1] || 0);
      const tgt = +((url.match(/target=(\d+)/) || [])[1] || 0);
      const times = c[5].match(/(\d{4}-\d{2}-\d{2})[\s\S]*?(\d{2}:\d{2}:\d{2})[\s\S]*?(\d{2}:\d{2}:\d{2})/);
      const coords = r.match(/\[coord\](\d+\|\d+)\[\/coord\]/g) || [];
      if (!times || coords.length < 2) return;
      const start = `${times[1]} ${times[2]}`;
      let end = `${times[1]} ${times[3]}`;
      if (toMs(end) <= toMs(start)) end = fmtDate(toMs(end) + 864e5);
      out.push({
        id: +c[0].trim() || i + 1,
        type: fmtType(label.replace(/^Wyślij\s*/i, '')) || 'Atak',
        vil, tgt, units: +c[2] || 0, note: c[4].trim() === '-' ? '' : c[4].trim(),
        from: coords[0].replace(/\[\/?coord\]/g, ''), to: coords[1].replace(/\[\/?coord\]/g, ''),
        start, end
      });
    });
    return out;
  }

  // Format 2: lista
  //   1. [b][color=..]Wyślij FEJK[100 off][/color] (...)[/b]
  //   [b]05/10/2026 [color=#ff0000]09:25:19 - 10:25:19[/color][/b]
  //   [coord]612|536[/coord] [b]->[/b] [coord]490|607[/coord]
  //   [url=...game.php?village=9922&screen=place&target=3167]...[/url]
  function parseList(bb) {
    const out = [];
    bb.split(/\r?\n(?=\s*\d+\.\s)/).forEach(chunk => {
      const head = chunk.match(/^\s*(\d+)\.\s*(?:\[[^\]]*\])*\s*Wyślij\s+([^\[\s(]+)\s*(?:\[([^\]]*)\])?/i);
      if (!head) return;
      const tm = chunk.match(/(\d{2})\/(\d{2})\/(\d{4})\s*(?:\[[^\]]*\])*\s*(\d{2}:\d{2}:\d{2})\s*-\s*(?:(\d{2})\/(\d{2})\/(\d{4})\s*)?(\d{2}:\d{2}:\d{2})/);
      const coords = chunk.match(/\[coord\](\d+\|\d+)\[\/coord\]/g) || [];
      const url = (chunk.match(/\[url=([^\]]+)\]/) || [])[1] || '';
      if (!tm || coords.length < 2) return;
      const details = head[3] || '';
      const start = `${tm[3]}-${tm[2]}-${tm[1]} ${tm[4]}`;
      let end = tm[5] ? `${tm[7]}-${tm[6]}-${tm[5]} ${tm[8]}` : `${tm[3]}-${tm[2]}-${tm[1]} ${tm[8]}`;
      if (toMs(end) <= toMs(start)) end = fmtDate(toMs(end) + 864e5);
      out.push({
        id: +head[1],
        type: fmtType(head[2]),
        vil: +((url.match(/village=(\d+)/) || [])[1] || 0),
        tgt: +((url.match(/target=(\d+)/) || [])[1] || 0),
        units: +((details.match(/^\s*(\d+)\s*off/i) || [])[1] || 0),
        note: /^\s*\d+\s*off/i.test(details) ? details.split('+').slice(1).join('+').trim() : details.trim(),
        from: coords[0].replace(/\[\/?coord\]/g, ''), to: coords[1].replace(/\[\/?coord\]/g, ''),
        start, end
      });
    });
    return out;
  }

  function parseBB(bb) {
    let plan = parseTable(bb);
    if (!plan.length) plan = parseList(bb);
    return plan;
  }

  // =====================================================================
  //  DŹWIĘK + POWIADOMIENIA
  // =====================================================================
  let ctx = null;
  function beep(freq, len) {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.18, ctx.currentTime);
      o.start(); o.stop(ctx.currentTime + len);
    } catch (e) { /* audio zablokowane */ }
  }
  function unlock() {
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch (e) { /* brak */ }
    try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e) { /* brak */ }
  }
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, unlock, { once: true, capture: true }));

  function alarm(kind, a, text) {
    const pattern = kind === 'open' ? [[880, 0], [1175, 250], [1568, 500]] : kind === 'close' ? [[440, 0], [440, 350], [440, 700], [330, 1050]] : [[660, 0], [880, 250]];
    pattern.forEach(([f, t]) => setTimeout(() => beep(f, 0.2), t));
    try {
      if (window.Notification && Notification.permission === 'granted') {
        const n = new Notification(`⚔️ #${a.id} ${a.type} → ${a.to}`, { body: text, tag: 'plan-' + a.id + kind, requireInteraction: kind !== 'warn' });
        n.onclick = () => { window.focus(); location.href = sendUrl(a); n.close(); };
      }
    } catch (e) { /* brak */ }
    if (typeof UI !== 'undefined') UI.InfoMessage(`⚔️ #${a.id}: ${text}`, 8000);
  }

  const sendUrl = a => a.tgt ? `/game.php?village=${a.vil}&screen=place&target=${a.tgt}` : `/game.php?village=${a.vil}&screen=place&x=${a.to.split('|')[0]}&y=${a.to.split('|')[1]}`;

  // =====================================================================
  //  STATUS KAŻDEJ AKCJI
  // =====================================================================
  function status(a, n) {
    const s = toMs(a.start), e = toMs(a.end);
    if (store.done[a.id]) return { k: 'done', txt: '✅ wysłane ' + hm(store.done[a.id]) };
    if (n > e) return { k: 'miss', txt: '❌ okno minęło' };
    if (n >= s) return { k: e - n < store.lastMin * 6e4 ? 'hurry' : 'open', txt: '🟢 WYŚLIJ – zostało ' + fmtLeft(e - n), left: e - n };
    return { k: s - n < store.warnMin * 6e4 ? 'soon' : 'wait', txt: 'za ' + fmtLeft(s - n), left: s - n };
  }

  function checkAlarms(n) {
    store.plan.forEach(a => {
      if (store.done[a.id]) return;
      const s = toMs(a.start), e = toMs(a.end);
      const fire = (k, cond, text) => { if (cond && !store.alerted[a.id + ':' + k]) { store.alerted[a.id + ':' + k] = 1; save(); alarm(k, a, text); } };
      fire('warn', n < s && s - n <= store.warnMin * 6e4, `Okno otwiera się za ${Math.ceil((s - n) / 6e4)} min (${a.from} → ${a.to})`);
      fire('open', n >= s && n < e, `Okno OTWARTE do ${hm(e)} – wyślij teraz!`);
      fire('close', n >= s && n < e && e - n <= store.lastMin * 6e4, `Zostało ${Math.ceil((e - n) / 6e4)} min do zamknięcia okna!`);
    });
  }

  // =====================================================================
  //  PANEL
  // =====================================================================
  const css = document.createElement('style');
  css.textContent = `
    #pa-panel { position:fixed; right:8px; top:60px; z-index:99999; width:min(380px, calc(100vw - 16px)); max-height:min(55vh, calc(100vh - 200px)); overflow:auto;
      background:#f4e4bc; border:2px solid #7d510f; border-radius:5px; font:11px Verdana,sans-serif; box-shadow:0 2px 10px rgba(0,0,0,.35); }
    #pa-panel .pa-hd { display:flex; justify-content:space-between; align-items:center; padding:4px 8px; background:#c1a264; cursor:move; font-weight:bold; user-select:none; position:sticky; top:0; z-index:1; }
    #pa-panel .pa-hd span { font-weight:normal; }
    #pa-panel .pa-it { padding:5px 8px; border-top:1px solid #d8c08a; display:flex; gap:6px; align-items:flex-start; }
    #pa-panel .pa-it .pa-b { flex:1; }
    #pa-panel .pa-st { font:bold 12px monospace; }
    #pa-panel .pa-wait .st { color:#6b5a3a; } #pa-panel .pa-soon .st { color:#b35900; }
    #pa-panel .pa-open { background:#dff5d0; } #pa-panel .pa-open .st { color:#1a7a1a; }
    #pa-panel .pa-hurry { background:#ffe0b3; animation:paBlink 1s infinite; } #pa-panel .pa-hurry .st { color:#c40f00; }
    #pa-panel .pa-miss .btn { filter:grayscale(1); } #pa-panel .pa-done { opacity:.55; } #pa-panel .pa-miss { opacity:.55; } #pa-panel .pa-miss .st { color:#c40f00; }
    #pa-panel .pa-cur { outline:2px solid #2a6ecf; }
    #pa-panel .pa-ft { padding:5px 8px; border-top:1px solid #d8c08a; font-size:10px; }
    #pa-panel .pa-ft input[type=number] { width:40px; }
    #pa-panel textarea { width:100%; height:80px; font:10px monospace; }
    @keyframes paBlink { 50% { background:#ffc680; } }
    #pa-hint { margin:6px 0; padding:6px 10px; background:#fff4d0; border:2px solid #b35900; font:12px Verdana; }
  `;
  document.head.appendChild(css);

  const panel = document.createElement('div');
  panel.id = 'pa-panel';
  document.body.appendChild(panel);

  // pozycja: zapamiętana po przeciągnięciu za nagłówek (dwuklik na nagłówku = powrót do domyślnej)
  function applyPos() {
    const p = store.pos;
    if (p) {
      const x = Math.min(Math.max(0, p.x), window.innerWidth - 60), y = Math.min(Math.max(0, p.y), window.innerHeight - 30);
      Object.assign(panel.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
    } else Object.assign(panel.style, { left: '', top: '', right: '', bottom: '' });
  }
  applyPos();
  window.addEventListener('resize', applyPos);
  let drag = null, dragged = false;
  panel.addEventListener('pointerdown', e => {
    if (!e.target.closest('#pa-toggle') || e.button !== 0) return;
    const r = panel.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY };
    dragged = false;
  });
  document.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!dragged && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 5) return;
    dragged = true;
    store.pos = { x: e.clientX - drag.dx, y: e.clientY - drag.dy };
    applyPos();
  });
  document.addEventListener('pointerup', () => {
    if (drag && dragged) save();
    else if (drag) { store.collapsed = !store.collapsed; impOpen = false; save(); render(); }
    drag = null;
  });
  document.addEventListener('pointercancel', () => { drag = null; });
  panel.addEventListener('dblclick', e => { if (e.target.closest('#pa-toggle')) { delete store.pos; save(); applyPos(); } });

  const curVil = +game_data.village.id;
  const curTgt = +((location.search.match(/target=(\d+)/) || [])[1] || 0);
  const curXY = (location.search.match(/[?&]x=(\d+)/) && location.search.match(/[?&]y=(\d+)/)) ? location.search.match(/[?&]x=(\d+)/)[1] + '|' + location.search.match(/[?&]y=(\d+)/)[1] : '';

  let impOpen = false;
  function render() { if (impOpen) return; const sc = panel.scrollTop; renderInner(); panel.scrollTop = sc; }
  function renderInner() {
    const n = now();
    const pending = store.plan.filter(a => !store.done[a.id] && n <= toMs(a.end));
    const openNow = pending.filter(a => n >= toMs(a.start));
    const head = `<div class="pa-hd" id="pa-toggle">⚔️ Plan ataku <span>${openNow.length ? '🟢 ' + openNow.length + ' do wysłania' : pending.length + ' w kolejce'} ${store.collapsed ? '▲' : '▼'}</span></div>`;
    if (store.collapsed) { panel.innerHTML = head; return; }
    const SOON = 10 * 60000;
    const showAll = !!store.showAll;
    const typeF = store.typeF || {};
    const typeOn = Object.keys(typeF).filter(k => typeF[k]);
    const vis = a => {
      if (typeOn.length && !typeOn.includes(a.type)) return false;
      if (showAll) return true;
      if (store.done[a.id] || n > toMs(a.end)) return false;          // wysłane / przeminęły
      if (typeOn.length) return true;                                  // filtr typu: wszystkie czekające tego typu
      return toMs(a.start) - n <= SOON;                               // otwarte teraz lub otwierają się w ≤10 min
    };
    const hidden = store.plan.filter(a => !vis(a)).length;
    const items = store.plan.filter(vis).map(a => {
      const st = status(a, n);
      const here = a.vil === curVil && (!curTgt || a.tgt === curTgt) && (!curXY || a.to === curXY) ? ' pa-cur' : '';
      return `<div class="pa-it pa-${st.k}${here}">
        <input type="checkbox" data-id="${a.id}" ${store.done[a.id] ? 'checked' : ''} title="Odhacz jako wysłane">
        <div class="pa-b"><b>#${a.id} ${a.type}</b> ${a.units ? a.units + ' ' : ''}<span>${a.from} → ${a.to}</span>
          ${a.note ? `<br>🎯 ${a.note}` : ''}
          <br>okno ${dayLbl(toMs(a.start))} ${hm(toMs(a.start))} – ${hm(toMs(a.end))}${dayLbl(toMs(a.end)) !== dayLbl(toMs(a.start)) ? ' (' + dayLbl(toMs(a.end)) + ')' : ''}
          <div class="pa-st">${st.txt}</div></div>
        ${st.k === 'done' ? '' : `<a class="btn" href="${sendUrl(a)}">Plac</a>`}
      </div>`;
    }).join('');
    const types = [...new Set(store.plan.map(a => a.type))];
    const chips = types.map(t => {
      const c = store.plan.filter(a => a.type === t && !store.done[a.id] && n <= toMs(a.end)).length;
      if (!c && !typeF[t]) return '';
      return `<label style="margin-right:8px;white-space:nowrap"><input type="checkbox" data-type="${t}" ${typeF[t] ? 'checked' : ''}> ${t} <b>${c}</b></label>`;
    }).join('');
    const shown = store.plan.filter(vis).length;
    const flt0 = `<div class="pa-ft">Do wysłania: ${chips}${typeOn.length ? `<br>pokazuję ${shown} (${typeOn.join(' + ')}) · <a href="#" id="pa-clrtype">wszystkie typy</a>` : ''}</div>`;
    const flt = flt0 + `<div class="pa-ft"><label><input type="checkbox" id="pa-all" ${showAll ? 'checked' : ''}> pokaż minione i późniejsze niż 10 min${showAll ? '' : ` (ukryte: ${hidden})`}</label></div>`;
    panel.innerHTML = head + flt + (items || `<div class="pa-it">${store.plan.length ? 'Nic nie czeka w najbliższych 10 min.' : 'Brak planu – wklej BBCode poniżej.'}</div>`) + `
      <div class="pa-ft">🔔 alarm <input type="number" id="pa-warn" min="0" value="${store.warnMin}"> min przed otwarciem,
        ⚠️ <input type="number" id="pa-last" min="0" value="${store.lastMin}"> min przed zamknięciem
        <br><label><input type="checkbox" id="pa-lockopt" ${store.lockOn ? 'checked' : ''}> blokuj „Wyślij” do początku okna (gdy zostało ≤10 min)</label>
        <br><a href="#" id="pa-imp">📋 wklej nowy plan (BBCode)</a> · <a href="#" id="pa-reset">wyczyść odhaczenia</a> · <a href="#" id="pa-test">test dźwięku</a>
        <div id="pa-impbox" style="display:none"><textarea placeholder="Wklej BBCode z planera (tabela lub lista „Wyślij FEJK/OFF/BURZAK”)"></textarea><button class="btn" id="pa-impgo">Wczytaj</button> <button class="btn" id="pa-impno">Anuluj</button></div>
      </div>`;
  }

  panel.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('#pa-toggle')) return;
    if (t.closest('a.btn[href*="screen=place"]')) { store.collapsed = true; save(); return; }   // po wejściu na plac panel się zwija
    if (t.id === 'pa-clrtype') { e.preventDefault(); store.typeF = {}; save(); render(); return; }
    if (t.id === 'pa-imp') { e.preventDefault(); impOpen = true; const b = panel.querySelector('#pa-impbox'); b.style.display = ''; const ta = b.querySelector('textarea'); ta.focus(); return; }
    if (t.id === 'pa-reset') { e.preventDefault(); if (confirm('Wyczyścić odhaczenia i alarmy?')) { store.done = {}; store.alerted = {}; save(); render(); } return; }
    if (t.id === 'pa-test') { e.preventDefault(); unlock(); alarm('open', { id: 0, type: 'Test', to: '-' }, 'Tak brzmi alarm otwarcia okna'); return; }
    if (t.id === 'pa-impno') { impOpen = false; render(); return; }
    if (t.id === 'pa-impgo') {
      const all = parseBB(panel.querySelector('#pa-impbox textarea').value);
      if (!all.length) { alert('Nie znalazłem wierszy planu w tym tekście.'); return; }
      const n = now();
      const plan = all.filter(a => toMs(a.end) > n);   // pomijamy okna, które już minęły
      if (!plan.length) { alert('Wszystkie okna z tego planu już minęły.'); return; }
      store.plan = plan; store.planVer = 'custom'; store.done = {}; store.alerted = {}; silenceOpen(); impOpen = false; save(); render();
      if (typeof UI !== 'undefined') UI.SuccessMessage(`Wczytano ${plan.length} wysyłek` + (all.length > plan.length ? ` (pominięto ${all.length - plan.length} minionych).` : '.'), 4000);
    }
  });
  panel.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.id) { if (t.checked) store.done[t.dataset.id] = now(); else delete store.done[t.dataset.id]; save(); render(); }
    if (t.id === 'pa-lockopt') { store.lockOn = t.checked; save(); return; }
    if (t.dataset.type) { store.typeF = store.typeF || {}; store.typeF[t.dataset.type] = t.checked; save(); render(); return; }
    if (t.id === 'pa-all') { store.showAll = t.checked; save(); render(); return; }
    if (t.id === 'pa-warn') { store.warnMin = Math.max(0, +t.value || 0); save(); }
    if (t.id === 'pa-last') { store.lastMin = Math.max(0, +t.value || 0); save(); }
  });

  // =====================================================================
  //  PLAC / POTWIERDZENIE: podpowiedź + auto-odhaczenie + cel katapult
  // =====================================================================
  function matching() {
    const n = now();
    return store.plan.filter(a => a.vil === curVil && !store.done[a.id] && n <= toMs(a.end));
  }

  function targetCoordsOnPage() {
    const m = (document.getElementById('content_value') || document.body).textContent.match(/\((\d{1,3}\|\d{1,3})\)/);
    return m ? m[1] : null;
  }

  // ---- Klin (osobny skrypt "wejście na czas"): wspólny localStorage, wpisujemy mu godzinę wejścia ----
  const KLIN_KEY = 'klin_' + game_data.world;
  store.land = store.land || {};
  function landMs(a) {
    if (store.land[a.id]) return store.land[a.id];
    const m = String(a.note || '').match(/ląd\.?\s*(\d{1,2}):(\d{2}):(\d{2})[.:](\d{1,3})/i);   // np. „ląd. 10:45:29.061”
    if (!m) return 0;
    const d = new Date(toMs(a.end));
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), +m[1], +m[2], +m[3], +m[4].padEnd(3, '0')).getTime();
  }
  function parseLand(str) {
    const m = String(str).match(/(\d{1,2}):(\d{2}):(\d{2})(?:[:.,](\d{1,3}))?/);
    if (!m) return 0;
    const b = new Date(now()), d = new Date(b.getFullYear(), b.getMonth(), b.getDate(), +m[1], +m[2], +m[3], m[4] ? +m[4].padEnd(3, '0') : 0);
    if (/jutro/i.test(str)) d.setDate(d.getDate() + 1);
    else if (d.getTime() < now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  const fmtLand = ms => `${hm(ms)}:${String(new Date(ms).getMilliseconds()).padStart(3, '0')}`;
  function pushKlin(a, t) {
    try {
      const k = JSON.parse(localStorage.getItem(KLIN_KEY)) || {};
      k.targets = k.targets || {};
      k.targets[a.to] = { t, saved: Date.now() };
      k.pending = { coords: a.to, t, ts: Date.now() };
      localStorage.setItem(KLIN_KEY, JSON.stringify(k));
      return true;
    } catch (e) { return false; }
  }

  // Uzupełnianie formularza placu (nie klika "Wyślij" – to zostaje po Twojej stronie)
  const UNITS_OFF = ['axe', 'light', 'marcher', 'ram', 'catapult'];
  const POP = { spear: 1, sword: 1, axe: 1, archer: 1, spy: 2, light: 4, marcher: 5, heavy: 6, ram: 5, catapult: 8, knight: 10, snob: 100 };
  function setVal(inp, v) {
    inp.value = v;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    inp.dispatchEvent(new Event('keyup', { bubbles: true }));
  }
  function avail(u) {
    const el = document.getElementById('units_entry_all_' + u) || document.querySelector(`#unit_input_${u}`)?.parentElement?.querySelector('a[data-count], .units-entry-all');
    if (!el) return 0;
    if (el.dataset && el.dataset.count) return +el.dataset.count || 0;
    const m = el.textContent.replace(/[\s.,\u00a0]/g, '').match(/(\d+)/);
    return m ? +m[1] : 0;
  }
  // plan składu wojska dla ataku a z puli dostępnych jednostek pool
  function buildPlan(a, pool) {
    const plan = {};
    const avail = u => pool[u] || 0;
    // rozdziela n sztuk między jednostki z puli: wagi ~ 1/ludność (lekka 4 → 4x mniej sztuk niż topór), z limitem dostępności
    const spread = (n, pool) => {
      let guard = 20;
      while (n > 0 && guard--) {
        const live = pool.filter(u => avail(u) - (plan[u] || 0) > 0);
        if (!live.length) break;
        const W = live.reduce((t, u) => t + 1 / POP[u], 0);
        let given = 0;
        live.forEach(u => {
          const cap = avail(u) - (plan[u] || 0);
          const g = Math.min(cap, n - given, Math.max(1, Math.floor(n / W / POP[u])));
          plan[u] = (plan[u] || 0) + g; given += g;
        });
        n -= given;
        if (!given) break;
      }
      return n;
    };
    const fillPieces = n => {            // najpierw ofensywne, potem najtańsze defensywne, ciężka na końcu
      n = spread(n, ['axe', 'light', 'marcher']);
      if (n > 0) n = spread(n, ['spear', 'sword', 'archer']);
      if (n > 0) spread(n, ['heavy']);
    };
    const spies = () => { const sp = avail('spy'); if (sp) plan.spy = Math.min(sp, 10); };  // 5–10 zwiadu
    const cnt = +a.units || +((a.note.match(/(\d+)\s*off/i) || [])[1]) || (a.type === 'Fejk' ? 100 : 0);
    const cats = +((a.note.match(/(\d+)\s*k\b/i) || [])[1]) || 0;
    if (a.type === 'Szlachcic') plan.snob = 1;
    else if (a.type === 'Fejk') {         // łącznie cnt jednostek (z taranem i zwiadem)
      if (avail('ram')) plan.ram = 1;
      spies();
      fillPieces(cnt - (plan.ram || 0) - (plan.spy || 0));
    } else if (a.type === 'Burzak') {     // katapulty ze wskazanej liczby + min. 200 jednostek (z zwiadem) off/def, bez taranów
      plan.catapult = Math.min(cats || avail('catapult'), avail('catapult'));
      spies();
      fillPieces(Math.max(+a.units || 0, 200) - (plan.spy || 0));   // pusty burzak: min. 200 jednostek
    } else {                              // OFF: cała armia z wioski (tarany + katapulty na cel), bez rycerza i szlachcica
      ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult'].forEach(u => { const c = avail(u); if (c) plan[u] = c; });
    }
    return plan;
  }

  let fillMsg = '';
  function autoFill(a, force) {
    const form = document.getElementById('command-data-form');
    if (!form || (form.dataset.paFilled && !force)) return;
    const inputs = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob']
      .map(u => [u, form.querySelector(`input[name="${u}"]`)]).filter(x => x[1]);
    if (!inputs.length) return;
    if (!force && inputs.some(x => +x[1].value > 0)) { form.dataset.paFilled = 1; return; } // user już coś wpisał
    form.dataset.paFilled = 1;
    // cel
    const tgt = form.querySelector('input.target-input-field, #place_target input[type="text"]');
    if (tgt && !tgt.value.trim() || (tgt && force)) setVal(tgt, a.to);
    else if (!tgt) {
      const [x, y] = a.to.split('|');
      const ix = form.querySelector('input[name="x"]'), iy = form.querySelector('input[name="y"]');
      if (ix && iy && (!ix.value || force)) { setVal(ix, x); setVal(iy, y); }
    }
    // wojsko: rezerwa dla innych, jeszcze nieodhaczonych ataków z tej wioski (poza pełnymi offami)
    const pool = {};
    Object.keys(POP).forEach(u => { pool[u] = avail(u); });
    const n0 = now();
    const others = store.plan.filter(o => o.id !== a.id && o.vil === a.vil && !store.done[o.id] && n0 <= toMs(o.end) && o.type !== 'OFF')
      .sort((x, y) => toMs(x.end) - toMs(y.end));
    if (a.type !== 'Szlachcic') others.forEach(o => { const r = buildPlan(o, pool); Object.keys(r).forEach(u => { pool[u] = Math.max(0, pool[u] - r[u]); }); });
    const plan = buildPlan(a, pool);

    inputs.forEach(([u, inp]) => { if (plan[u]) setVal(inp, plan[u]); else if (force) setVal(inp, ''); });
    const tot = Object.keys(plan).reduce((t, u) => t + (u === 'catapult' || u === 'ram' ? 0 : plan[u]), 0);
    fillMsg = Object.keys(plan).length
      ? '✅ wpisano: ' + Object.keys(plan).map(u => `${u} ${plan[u]}`).join(', ') + ` (bez tar./kat.: ${tot})`
      : '⚠️ nie odczytałem dostępnych jednostek – wpisz ręcznie';
    const hb = document.getElementById('pa-msg'); if (hb) hb.innerHTML = fillMsg;
  }

  function placeHints() {
    if (!/screen=place/.test(location.search)) return;
    const confirmBtn = document.querySelector('#troop_confirm_submit, #troop_confirm_go, input[name="submit_confirm"]');
    let list = matching();
    if (confirmBtn) {
      const to = targetCoordsOnPage();
      if (to) list = list.filter(a => a.to === to);
    } else if (curTgt) {
      list = list.filter(a => a.tgt === curTgt);
    } else if (curXY) {
      list = list.filter(a => a.to === curXY);
    }
    if (!list.length) return;
    const a = list[0];
    const box = document.getElementById('pa-hint') || document.createElement('div');
    box.id = 'pa-hint';
    const st = status(a, now());
    const rest = store.plan.filter(o => o.id !== a.id && o.vil === a.vil && !store.done[o.id] && now() <= toMs(o.end));
    box.innerHTML = `⚔️ <b>Plan #${a.id}: ${a.type}</b> ${a.from} → ${a.to}${a.units ? ` · ${a.units} jedn.` : ''}${a.note ? ` · 🎯 ${a.note}` : ''} · <b>${st.txt}</b>` +
      (rest.length ? `<br>⚠️ Z tej wioski jeszcze ${rest.length}: ` + rest.map(o => `#${o.id} ${o.type}${o.type === 'OFF' ? ' (full)' : ''} do ${o.end.slice(11, 16)}`).join(', ') + ' – wojsko pod nie zostaje w rezerwie' : '') + `<div id="pa-msg">${fillMsg}</div>`;
    if (!box.parentElement) {
      const anchor = document.querySelector('#command-data-form') || confirmBtn?.closest('form') || document.getElementById('content_value');
      if (anchor) anchor.parentElement.insertBefore(box, anchor);
    }
    // godzina wejścia dla Klina
    let lr = document.getElementById('pa-landrow');
    if (!lr) { lr = document.createElement('div'); lr.id = 'pa-landrow'; box.after(lr); }
    if (lr.dataset.aid !== String(a.id)) {
      lr.dataset.aid = a.id;
      const cur = landMs(a);
      lr.innerHTML = `⏱ Wejście o: <input type="text" id="pa-land" placeholder="hh:mm:ss:ms" value="${cur ? fmtLand(cur) : ''}" style="width:110px;text-align:center;font:bold 12px monospace"> <a href="#" id="pa-landgo" class="btn">→ Klin</a> <span id="pa-landmsg"></span>`;
      const go = () => {
        const t = parseLand(lr.querySelector('#pa-land').value);
        if (!t) { lr.querySelector('#pa-landmsg').textContent = '⚠️ zły format'; return; }
        store.land[a.id] = t; save();
        lr.querySelector('#pa-landmsg').textContent = pushKlin(a, t) ? `✅ Klin: ${fmtLand(t)} na ${a.to}` : '⚠️ nie zapisano';
      };
      lr.querySelector('#pa-landgo').addEventListener('click', e => { e.preventDefault(); go(); });
      lr.querySelector('#pa-land').addEventListener('change', go);
      if (cur && cur > now()) { pushKlin(a, cur); lr.querySelector('#pa-landmsg').textContent = `✅ Klin: ${fmtLand(cur)}`; }
    }
    if (!confirmBtn) {
      if (!box.querySelector('#pa-fill')) {
        box.insertAdjacentHTML('beforeend', ' · <a href="#" id="pa-fill" class="btn">Uzupełnij</a>');
        box.querySelector('#pa-fill').addEventListener('click', e => { e.preventDefault(); autoFill(a, true); });
      }
      autoFill(a, false);
    }
    if (confirmBtn) {
      // 1) Klin: wejście = początek okna + czas marszu (klik dokładnie na początku okna)
      const root = confirmBtn.closest('form') || document.getElementById('content_value') || document.body;
      const dm = ((root.textContent || '').match(/(?:Czas trwania|Trwanie)\s*:?\s*(\d+):(\d{2}):(\d{2})/i) || []);
      const dur = dm[1] ? ((+dm[1] * 60 + +dm[2]) * 60 + +dm[3]) * 1000 : 0;
      const startMs = toMs(a.start);
      const klinT = document.getElementById('klin-t');
      const near = startMs - now() <= 10 * 60000;   // tylko gdy okno tego ataku zaraz się otwiera (inaczej to pewnie inny klin)
      if (klinT && dur && near && !klinT.dataset.paSet && !landMs(a) && now() < startMs) {
        klinT.dataset.paSet = 1;
        klinT.value = fmtLand(startMs + dur);
        klinT.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // 2) blokada przycisku do początku okna; potem już bez znaczenia
      let off = 0; try { off = Number((JSON.parse(localStorage.getItem(KLIN_KEY)) || {}).offset) || 0; } catch (e) { /* brak */ }
      const unlockAt = startMs - off;
      if (store.lockOn === true && near && !confirmBtn.dataset.paLock && now() < unlockAt) {
        confirmBtn.dataset.paLock = 1;
        const form = confirmBtn.closest('form');
        let free = false;
        // jedyny hamulec: wysyłka formularza (Enter) – bez przechwytywania innych kliknięć na stronie
        const block = ev => { if (!free && now() < unlockAt) ev.preventDefault(); };
        if (form) form.addEventListener('submit', block);
        const msg = document.createElement('div');
        msg.id = 'pa-lock'; msg.style.cssText = 'margin:4px 0;font:bold 12px Verdana;color:#b35900';
        msg.innerHTML = `🔒 Wyślij zablokowane do początku okna (#${a.id}, ${hm(startMs)}) – jeszcze <span id="pa-lockleft"></span> · <a href="#" id="pa-free">odblokuj</a>`;
        confirmBtn.parentElement.insertBefore(msg, confirmBtn);
        const left$ = msg.querySelector('#pa-lockleft');
        const release = () => { free = true; confirmBtn.disabled = false; confirmBtn.style.opacity = ''; msg.remove(); clearInterval(iv); clearTimeout(to); };
        msg.querySelector('#pa-free').addEventListener('click', ev => { ev.preventDefault(); release(); });
        confirmBtn.disabled = true; confirmBtn.style.opacity = '.45';
        const upd = () => { const sec = Math.ceil((unlockAt - now()) / 1000); left$.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
        const iv = setInterval(upd, 500); upd();
        const to = setTimeout(release, Math.max(0, unlockAt - now()));   // odblokowanie co do ms
      }
      // cel katapult: spichlerz / zagroda, jeśli tak mówi plan
      const sel = document.querySelector('select[name="building"]');
      const tm = ((a.note.match(/na\s+(\S+)/i) || [])[1] || '').toLowerCase();
      const MAP = [[/kuźn|kuzn/, 'smith'], [/zagrod/, 'farm'], [/spichl/, 'storage'], [/ratusz/, 'main'], [/koszar/, 'barracks'], [/stajn/, 'stable'], [/warszt/, 'garage'], [/pałac|palac|akadem/, 'snob'], [/rynek/, 'market'], [/tartak/, 'wood'], [/cegiel/, 'stone'], [/huta/, 'iron'], [/mur/, 'wall'], [/kościół|kosciol/, 'church'], [/plac/, 'place']];
      const hit = MAP.find(m => m[0].test(tm));
      const bld = hit ? hit[1] : null;
      if (sel && !sel.dataset.paUser) {
        if (!sel.dataset.paBound) { sel.dataset.paBound = 1; sel.addEventListener('change', ev => { if (ev.isTrusted) sel.dataset.paUser = 1; }); }
        if (bld && [...sel.options].some(o => o.value === bld) && sel.value !== bld) { sel.value = bld; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      }
      // auto-odhaczenie po kliknięciu wysyłki
      if (!confirmBtn.dataset.paHook) {
        confirmBtn.dataset.paHook = 1;
        confirmBtn.addEventListener('click', () => { store.done[a.id] = now(); save(); });
      }
    }
  }

  // =====================================================================
  //  PĘTLA
  // =====================================================================
  const ORIG_TITLE = document.title;
  function tick() {
    const n = now();
    checkAlarms(n);
    if (!panel.matches(':focus-within')) render();
    const open = store.plan.filter(a => !store.done[a.id] && n >= toMs(a.start) && n <= toMs(a.end));
    if (open.length) {
      const soonest = open.reduce((x, y) => toMs(x.end) < toMs(y.end) ? x : y);
      document.title = `🟢 ${open.length} do wysłania (#${soonest.id} ${fmtLeft(toMs(soonest.end) - n)}) · ` + ORIG_TITLE;
    } else document.title = ORIG_TITLE;
  }
  render();
  placeHints();
  setInterval(tick, 1000);
  let mt;
  new MutationObserver(recs => {
    if (recs.every(r => r.target.closest && r.target.closest('#pa-panel, #pa-hint'))) return;
    clearTimeout(mt); mt = setTimeout(placeHints, 200);
  }).observe(document.getElementById('content_value') || document.body, { childList: true, subtree: true });
})();
