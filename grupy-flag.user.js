// ==UserScript==
// @name         Plemiona – Grupy flag (Zagroda / Surowce / Atak / Rekrutacja)
// @namespace    plemiona.grupy.flag
// @version      1.0.0
// @updateURL    https://raw.githubusercontent.com/Rokerio/noweRepo/main/grupy-flag.user.js
// @downloadURL  https://raw.githubusercontent.com/Rokerio/noweRepo/main/grupy-flag.user.js
// @description  Jednym kliknięciem tworzy / ustawia dynamiczne grupy „gdzie założyć flagę”: F Zagroda+, F Sura, F Atak, F Rekrutacja. Potem wystarczy kliknąć grupę, żeby zobaczyć wioski bez danej flagi, w których ma sens.
// @author       Roker
// @match        https://*.plemiona.pl/game.php*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/* Działa na: Przegląd → Grupy → Dynamiczne grupy.
   Skrypt wypełnia prawdziwy formularz filtrów gry (jej własnym JS), więc w razie czego widzisz, co ustawił. */

(function () {
  'use strict';

  // ================= USTAWIENIA (edytuj do woli) =================
  const NS = 'cl_flagi';
  const AUTO_SAVE = true;      // true = po ustawieniu filtrów sam klika „Zapisz grupę”; false = tylko wypełnia, Ty zapisujesz
  const ECO_MIN = 23;          // F Sura: tartak, cegielnia i huta co najmniej na tym poziomie
  const GRUPA_OFF = 'Off';     // nazwa Twojej RĘCZNEJ grupy z offami (jak w „Ręczna grupa” w filtrach)
  const FARM_LVL = 30;         // F Zagroda+: poziom zagrody
  const FARM_POP_MAX = 500;    // F Zagroda+: wolna populacja mniejsza niż tyle

  // Flagi w grze: 1 Przyrost surowców, 2 Czas rekrutacji, 3 Siła ataku, 4 Siła obrony,
  //               5 Szczęście, 6 Pojemność zagrody, 7 Obniżenie kosztu monet, 8 Pojemność łupu
  // Filtr: t = typ filtra z formularza gry, v = pola (nazwa pola bez końcówki _N → wartość).
  // Wartość '@Tekst' = wybierz opcję o takim napisie. Wszystkie filtry łączone są przez AND.
  const PRESETS = [
    {
      name: 'F Zagroda+', label: 'Zagroda+',
      opis: `zagroda ${FARM_LVL}, wolna pop. < ${FARM_POP_MAX}, w grupie ${GRUPA_OFF}, bez flagi „Pojemność zagrody”`,
      filters: [
        { t: 'building', v: { building_type: 'farm', building_operator: '=', building_level: FARM_LVL } },
        { t: 'pop_total', v: { pop_pop_status: 'available', pop_total_operator: '<', pop_total: FARM_POP_MAX } },
        { t: 'flag', v: { flag_status: 0, flag: 6 } },
        { t: 'group_static', v: { group_static_status: 1, group_static: '@' + GRUPA_OFF } },
      ],
    },
    {
      name: 'F Sura', label: 'Surowce',
      opis: `tartak, cegielnia i huta ≥ ${ECO_MIN}, poza grupą ${GRUPA_OFF}, bez flagi „Przyrost surowców”`,
      filters: [
        { t: 'building', v: { building_type: 'wood', building_operator: '>=', building_level: ECO_MIN } },
        { t: 'building', v: { building_type: 'stone', building_operator: '>=', building_level: ECO_MIN } },
        { t: 'building', v: { building_type: 'iron', building_operator: '>=', building_level: ECO_MIN } },
        { t: 'flag', v: { flag_status: 0, flag: 1 } },
        { t: 'group_static', v: { group_static_status: 0, group_static: '@' + GRUPA_OFF } },
      ],
    },
    {
      name: 'F Atak', label: 'Atak',
      opis: `w grupie ${GRUPA_OFF}, bez flagi „Siła ataku”`,
      filters: [
        { t: 'group_static', v: { group_static_status: 1, group_static: '@' + GRUPA_OFF } },
        { t: 'flag', v: { flag_status: 0, flag: 3 } },
      ],
    },
    {
      name: 'F Rekrutacja', label: 'Rekrutacja',
      opis: 'Menedżer Konta aktywny w kolejce wojska, bez flagi „Czas rekrutacji”',
      filters: [
        { t: 'am', v: { am_status: 1, queue_type: 1 } },
        { t: 'flag', v: { flag_status: 0, flag: 2 } },
      ],
    },
  ];
  // ================================================================

  const KEY = 'cl_flagi_pending';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

  if (!/screen=overview_villages/.test(location.search) || !/mode=groups/.test(location.search) || !/type=dynamic/.test(location.search)) return;
  if (!$('#filter_config') && !$('#group_management_content')) return;

  // ---------- grupy ----------
  const aktualnaNazwa = () => (($('#dynamic_group_name') || {}).textContent || '').trim();
  const aktualneId = () => (($('#filter_config input[name="group_id"]') || {}).value || '');
  function grupy() {
    return $$('.quickedit-group[data-id]').map(g => ({
      id: g.getAttribute('data-id'),
      name: (($('.quickedit-label', g) || {}).textContent || '').trim(),
    })).filter(g => g.id && g.name);
  }
  const znajdz = name => grupy().find(g => g.name === name);
  function urlGrupy(id) {
    const u = new URL(location.href);
    u.searchParams.set('screen', 'overview_villages');
    u.searchParams.set('mode', 'groups');
    u.searchParams.set('type', 'dynamic');
    u.searchParams.set('group', id);
    u.searchParams.delete('action');
    return u.toString();
  }

  // ---------- stan między przeładowaniami ----------
  function getPending() {
    try { const p = JSON.parse(sessionStorage.getItem(KEY)); if (p && Date.now() - p.ts < 120000) return p; } catch (e) { /* brak */ }
    return null;
  }
  const setPending = p => { try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* brak */ } };
  const clearPending = () => { try { sessionStorage.removeItem(KEY); } catch (e) { /* brak */ } };

  // ---------- UI ----------
  let statusEl = null;
  function status(txt, blad) {
    if (!statusEl) return;
    statusEl.textContent = txt;
    statusEl.style.color = blad ? '#b00' : '#000';
  }

  function zbudujPanel() {
    const host = $('#basic_management') || $('#group_management_content');
    if (!host || $('#' + NS + '_box')) return;
    const box = document.createElement('div');
    box.id = NS + '_box';
    box.style.cssText = 'margin:6px 0 10px;padding:6px 8px;border:1px solid #c1a264;background:#f4e4bc';
    box.innerHTML = '<h3 style="margin:0 0 4px">🚩 Grupy flag</h3>' +
      '<div class="grey" style="margin-bottom:6px">Kliknij przycisk: skrypt utworzy grupę (albo ustawi jej filtry). Potem klikasz samą grupę w pasku grup – widzisz wioski, gdzie warto dać flagę.</div>';
    PRESETS.forEach(p => {
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom:6px';
      const b = document.createElement('a');
      b.href = '#'; b.className = 'btn';
      b.style.cssText = 'margin-right:6px;padding:6px 10px';
      b.textContent = '🚩 ' + p.label;
      b.addEventListener('click', e => { e.preventDefault(); start(p); });
      const cnt = document.createElement('b');
      cnt.id = NS + '_cnt_' + p.name.replace(/\W+/g, '_');
      cnt.style.marginRight = '6px';
      const d = document.createElement('span');
      d.className = 'grey';
      d.textContent = p.name + ' – ' + p.opis;
      row.append(b, cnt, d);
      box.appendChild(row);
    });
    statusEl = document.createElement('div');
    statusEl.style.cssText = 'margin-top:4px;font-weight:bold';
    box.appendChild(statusEl);
    host.insertBefore(box, host.firstChild);
  }

  // liczniki: ile wioski pasuje do istniejących grup (z podglądu wyników na stronie grupy)
  async function liczniki() {
    for (const p of PRESETS) {
      const g = znajdz(p.name);
      const out = document.getElementById(NS + '_cnt_' + p.name.replace(/\W+/g, '_'));
      if (!out) continue;
      if (!g) { out.textContent = '(brak grupy)'; out.style.color = '#888'; continue; }
      try {
        const r = await fetch(urlGrupy(g.id), { credentials: 'same-origin' });
        const m = /Wioska \((\d+) pasuje\)/.exec(await r.text());
        out.textContent = m ? '(' + m[1] + ')' : '(?)';
      } catch (e) { out.textContent = '(?)'; }
    }
  }

  // ---------- wypełnianie formularza gry ----------
  function ustaw(name, val) {
    const els = $$('#filter_entries [name="' + name + '"]');
    if (!els.length) throw new Error('nie ma pola ' + name);
    const f = els[0];
    if (f.type === 'radio') {
      const r = els.find(e => e.value === String(val));
      if (!r) throw new Error('pole ' + name + ' nie ma wartości ' + val);
      if (r.disabled) throw new Error('pole ' + name + ' jest nieaktywne');
      r.click();
      return;
    }
    if (f.disabled) throw new Error('pole ' + name + ' jest nieaktywne');
    if (f.tagName === 'SELECT') {
      const txt = typeof val === 'string' && val[0] === '@' ? val.slice(1) : null;
      const opt = [...f.options].find(o => txt !== null ? o.textContent.trim() === txt : o.value === String(val));
      if (!opt) throw new Error('pole ' + name + ': brak opcji „' + (txt !== null ? txt : val) + '”');
      f.value = opt.value;
    } else {
      f.value = String(val);
    }
    f.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function opisFiltrow() {
    return $$('#filter_entries tr').filter(tr => { const c = $('input[data-filter]', tr); return c && c.checked; }).map(tr => {
      const nazwa = (($('label', tr) || {}).textContent || '').replace(/[*]/g, '').replace(/\s+/g, ' ').trim();
      const w = $$('td:nth-child(2) select, td:nth-child(2) input', tr)
        .filter(e => e.type !== 'radio' || e.checked)
        .map(e => e.tagName === 'SELECT' ? (e.selectedOptions[0] || {}).textContent : e.value);
      return nazwa + ': ' + w.join(' ').trim();
    });
  }

  async function zastosuj(p) {
    // własna kombinacja logiczna z poprzedniej konfiguracji zepsułaby AND – wróć do domyślnej
    const ucl = $('#use_custom_logic');
    if (ucl && ucl.value === '1') {
      const reset = $('#reset_gates');
      if (reset) { reset.click(); await sleep(200); }
      if (ucl.value === '1') throw new Error('grupa ma własną kombinację filtrów – kliknij „ustaw domyślne”');
    }
    // wyczyść aktywne filtry
    for (const cb of $$('#filter_entries input[data-filter]').filter(c => c.checked)) { cb.click(); await sleep(40); }
    // ustaw nowe
    for (const f of p.filters) {
      const cb = $$('#filter_entries input[data-filter="' + f.t + '"]').find(c => !c.checked);
      if (!cb) throw new Error('brak wolnego wiersza filtra „' + f.t + '” (gra nie dodała kolejnego)');
      cb.click();
      await sleep(80);
      if (!cb.checked) throw new Error('nie udało się włączyć filtra „' + f.t + '”');
      const id = cb.getAttribute('data-id');
      for (const [k, val] of Object.entries(f.v)) { ustaw(k + '_' + id, val); await sleep(20); }
    }
  }

  async function kontynuuj(p) {
    const preset = PRESETS.find(x => x.name === p.name);
    if (!preset) { clearPending(); return; }
    const g = znajdz(p.name);
    if (aktualnaNazwa() !== p.name) {
      if (!g || (p.proby || 0) >= 3) { clearPending(); status('✖ Nie znalazłem grupy „' + p.name + '” po utworzeniu. Sprawdź listę grup.', true); return; }
      p.proby = (p.proby || 0) + 1; setPending(p);
      location.href = urlGrupy(g.id);
      return;
    }
    if (g && aktualneId() !== g.id) { clearPending(); status('✖ Formularz dotyczy innej grupy niż „' + p.name + '” – przerywam.', true); return; }

    const stare = opisFiltrow();
    clearPending();
    if (stare.length && !confirm('Grupa „' + p.name + '” ma już filtry:\n• ' + stare.join('\n• ') + '\n\nNadpisać je nowymi?')) {
      status('Anulowano – grupa bez zmian.');
      return;
    }
    status('Ustawiam filtry „' + p.name + '”…');
    try { await zastosuj(preset); } catch (e) {
      status('✖ ' + e.message + ' – niczego nie zapisałem (formularz może być wypełniony częściowo).', true);
      return;
    }
    if (AUTO_SAVE) {
      status('Filtry ustawione, zapisuję…');
      await sleep(1200);
      const save = $('#save_filters');
      if (save) save.click(); else status('✖ Nie widzę przycisku „Zapisz grupę”.', true);
    } else {
      status('Filtry ustawione – sprawdź podgląd wyników i kliknij „Zapisz grupę”.');
    }
  }

  function start(p) {
    const g = znajdz(p.name);
    setPending({ name: p.name, ts: Date.now(), proby: 0 });
    if (g) {
      if (aktualnaNazwa() === p.name) kontynuuj(getPending());
      else { status('Przechodzę do grupy „' + p.name + '”…'); location.href = urlGrupy(g.id); }
      return;
    }
    const nazwa = $('#group_name'), btn = $('#btn_filters_create');
    if (!nazwa || !btn) { clearPending(); status('✖ Nie widzę formularza „Nowa grupa”.', true); return; }
    nazwa.value = p.name;
    const copy = $('#filters_create_copy'); if (copy) copy.checked = false;
    status('Tworzę grupę „' + p.name + '”…');
    btn.click();
  }

  // ---------- start ----------
  zbudujPanel();
  const p = getPending();
  if (p) kontynuuj(p); else liczniki();
})();
