// ==UserScript==
// @name         Plemiona – Cofanie wojsk wg wiosek (gracz → wioska → wycofaj)
// @namespace    dawid.plemiona.cofanie
// @version      1.0
// @author       Roker
// @description  Na „Wojska poza wioską → szczegóły” grupuje wsparcie wg GRACZA i WIOSKI DOCELOWEJ (rozwijane menu) zamiast wg Twoich wiosek. Jednym przyciskiem wycofujesz całe wsparcie z wybranej wioski, od gracza albo z zaznaczonych.
// @match        https://*.plemiona.pl/game.php*
// @match        https://*.tribalwars.net/game.php*
// @updateURL    https://raw.githubusercontent.com/Rokerio/noweRepo/main/cofanie-wg-wiosek.user.js
// @downloadURL  https://raw.githubusercontent.com/Rokerio/noweRepo/main/cofanie-wg-wiosek.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * Następca bookmarkletu „HermitowskieCofanieWojsk” (filtry + zaznaczanie) – tu zamiast
 * przeszukiwać listę Twoich wiosek, widzisz listę wiosek docelowych.
 *
 * Działa na: Przegląd → Wojska → „Poza wioską” → szczegóły (screen=overview_villages&mode=units&type=away_detail).
 * Przycisk „↩ Wg wiosek” w prawym dolnym rogu otwiera panel.
 * Skrypt pobiera WSZYSTKIE strony przeglądu (page=-1), więc paginacja (80 wiosek) nie przeszkadza.
 *
 * Panel:  Gracz [PLEMIĘ]  (wioski, rozkazy, suma wojsk)  ▸
 *           └ Wioska docelowa (xxx|yyy)  suma wojsk   [↩ Wycofaj]
 *                └ z której Twojej wioski → ile jednostek (checkbox przy każdym rozkazie)
 *  - „↩ Wycofaj” przy wiosce  = wszystkie rozkazy wsparcia w tej wiosce docelowej,
 *  - „↩ Wszystko od gracza”   = wszystkie wioski danego gracza,
 *  - „Wycofaj zaznaczone”     = to, co zaznaczysz checkboxami (gracz / wioska / pojedynczy rozkaz).
 * Przed wysłaniem jest potwierdzenie z liczbami. Wycofanie to ten sam POST, który wysyła
 * przycisk „Cofnij” w grze (action=command_back), więc nic poza zwykłym cofnięciem się nie dzieje.
 * Filtr: wpisz fragment nazwy wioski / gracza / plemienia / współrzędnych.
 */
(function () {
  'use strict';
  if (typeof game_data === 'undefined') return;
  const Q = new URLSearchParams(location.search);
  if (Q.get('screen') !== 'overview_villages' || Q.get('mode') !== 'units' || Q.get('type') !== 'away_detail') return;

  const base = game_data.link_base_pure;
  const MY_ID = String(game_data.player.id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = s => parseInt(String(s == null ? '' : s).replace(/\D/g, ''), 10) || 0;
  const fmt = n => n.toLocaleString('pl-PL');
  const IMG = (typeof image_base !== 'undefined' ? image_base : 'https://dspl.innogamescdn.com/asset/5848ecf5/graphic/');

  const st = { data: null, filter: '', open: new Set(), sel: new Set() };

  // ---------------------------------------------------------------- dane
  function parseDoc(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('#units_table');
    if (!table) throw new Error('Nie znalazłem tabeli „Poza wioską – szczegóły”.');
    const form = doc.querySelector('#overview_form');
    const units = [...table.querySelectorAll('thead img[src*="unit_"]')]
      .map(i => (i.getAttribute('src').match(/unit_([a-z_]+)\./) || [])[1]).filter(Boolean);
    const entries = [];
    let origin = null;
    table.querySelectorAll('tr').forEach(tr => {
      if (tr.classList.contains('units_away')) {
        const vn = tr.querySelector('.quickedit-vn');
        const lab = tr.querySelector('.quickedit-label');
        origin = vn ? { id: vn.dataset.id, name: (lab ? lab.textContent : vn.textContent).replace(/\s+/g, ' ').trim() } : null;
        return;
      }
      const cb = tr.querySelector('input.village_checkbox');
      const anc = tr.querySelector('.village_anchor');
      if (!cb || !anc || !origin) return;
      const pl = tr.querySelector('a[href*="info_player"]');
      const al = tr.querySelector('a[href*="info_ally"]');
      const label = anc.textContent.replace(/\s+/g, ' ').trim();
      const m = label.match(/^(.*?)\s*\((\d+)\|(\d+)\)\s*K\d+\s*$/);
      const cells = [...tr.querySelectorAll('td.unit-item')];
      const u = {};
      units.forEach((k, i) => { const c = num(cells[i] && cells[i].textContent); if (c > 0) u[k] = c; });
      const distTd = tr.querySelectorAll('td')[1];
      const playerId = anc.dataset.player || '0';
      entries.push({
        cmd: cb.value, field: cb.name,                    // units_back[originId][] = cmd
        originId: origin.id, originName: origin.name,
        targetId: anc.dataset.id,
        targetName: m ? m[1] : label, coords: m ? m[2] + '|' + m[3] : '',
        playerId: (pl || playerId === MY_ID) ? playerId : '0',   // własne wioski nie mają linku do gracza
        playerName: pl ? pl.textContent.trim() : '',
        tribe: al ? al.textContent.trim() : '',
        dist: distTd ? num(distTd.textContent) : 0, units: u,
      });
    });
    return { entries, units, formAction: form ? form.getAttribute('action') : null };
  }

  async function load() {
    const url = base + 'overview_villages&mode=units&type=away_detail&group=0&page=-1';
    const html = await (await fetch(url, { credentials: 'same-origin' })).text();
    const d = parseDoc(html);
    if (!d.formAction) throw new Error('Brak formularza „Cofnij” – odśwież stronę.');
    // grupowanie: gracz -> wioska docelowa -> rozkazy
    const players = new Map();
    d.entries.forEach(e => {
      const pid = e.playerId === MY_ID ? 'me' : (e.playerId === '0' ? 'barb' : e.playerId);
      let p = players.get(pid);
      if (!p) {
        p = {
          id: pid, villages: new Map(), units: {}, cmds: 0,
          name: pid === 'me' ? game_data.player.name + ' (moje wioski)' : pid === 'barb' ? 'Barbarzyńcy / brak gracza' : e.playerName,
          tribe: e.tribe,
        };
        players.set(pid, p);
      }
      let v = p.villages.get(e.targetId);
      if (!v) { v = { id: e.targetId, name: e.targetName, coords: e.coords, player: p, rows: [], units: {} }; p.villages.set(e.targetId, v); }
      v.rows.push(e); p.cmds++;
      for (const k in e.units) { v.units[k] = (v.units[k] || 0) + e.units[k]; p.units[k] = (p.units[k] || 0) + e.units[k]; }
    });
    return { players: [...players.values()], units: d.units, formAction: d.formAction, total: d.entries.length };
  }

  // ---------------------------------------------------------------- UI
  const unitsHtml = u => Object.keys(u).length
    ? Object.keys(u).map(k => `<span class="cw-u"><img src="${IMG}unit/unit_${k}.webp" alt="${k}">${fmt(u[k])}</span>`).join(' ')
    : '<span style="color:#888">–</span>';
  const pop = u => (u.spear || 0) + (u.sword || 0) + (u.axe || 0) + (u.archer || 0) + (u.spy || 0) * 2 + (u.light || 0) * 4 + (u.marcher || 0) * 5 + (u.heavy || 0) * 6 + (u.ram || 0) * 5 + (u.catapult || 0) * 8 + (u.knight || 0) * 10 + (u.snob || 0) * 100;
  const matches = (p, v) => {
    const f = st.filter.trim().toLowerCase();
    if (!f) return true;
    return [p.name, p.tribe, v.name, v.coords].some(s => String(s || '').toLowerCase().includes(f));
  };

  function injectCss() {
    if (document.getElementById('cw-css')) return;
    const s = document.createElement('style');
    s.id = 'cw-css';
    s.textContent = `
      #cw-btn{position:fixed;right:10px;bottom:10px;z-index:99998;padding:10px 14px;background:#7d510f;color:#fff;border:2px solid #3e2a06;border-radius:6px;font:bold 14px sans-serif}
      #cw-ov{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:none}
      #cw-box{position:absolute;inset:8px;background:#f4e4bc;border:3px solid #7d510f;border-radius:6px;display:flex;flex-direction:column;font:13px sans-serif;color:#222}
      #cw-head{padding:8px;border-bottom:2px solid #7d510f;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
      #cw-head input[type=text]{flex:1;min-width:120px;padding:6px;font-size:15px}
      #cw-body{flex:1;overflow:auto;padding:6px;-webkit-overflow-scrolling:touch}
      #cw-foot{padding:8px;border-top:2px solid #7d510f;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .cw-b{padding:7px 11px;border:1px solid #3e2a06;border-radius:4px;background:#c8a05a;color:#222;font-weight:bold;font-size:13px}
      .cw-b.red{background:#b33;color:#fff}.cw-b:disabled{opacity:.45}
      .cw-p{margin:4px 0;border:1px solid #b09560;border-radius:4px;background:#fbf2d9}
      .cw-ph{padding:7px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:#e6d199;border-radius:4px}
      .cw-pn{font-weight:bold;flex:1;min-width:140px}.cw-meta{color:#555;font-size:12px}
      .cw-v{margin:2px 6px 2px 18px;border-left:3px solid #c8a05a;padding:3px 6px}
      .cw-vh{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
      .cw-r{margin:2px 0 2px 22px;padding:2px 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px;border-top:1px dotted #cdb887}
      .cw-u{display:inline-flex;align-items:center;gap:1px;margin-right:4px}.cw-u img{height:14px}
      .cw-t{cursor:pointer;user-select:none;width:18px;display:inline-block}
      #cw-box input[type=checkbox]{width:18px;height:18px}
    `;
    document.head.appendChild(s);
  }

  function pKey(p) { return 'p' + p.id; }
  function vKey(v) { return 'v' + v.player.id + '_' + v.id; }

  function render() {
    const body = document.getElementById('cw-body');
    if (!st.data) { body.innerHTML = 'Wczytuję…'; return; }
    const list = st.data.players.map(p => ({ p, vs: [...p.villages.values()].filter(v => matches(p, v)) })).filter(x => x.vs.length);
    list.sort((a, b) => (a.p.id === 'me') - (b.p.id === 'me') || b.p.cmds - a.p.cmds);
    body.innerHTML = list.map(({ p, vs }) => {
      const open = st.open.has(pKey(p)) || !!st.filter.trim();
      const allIds = vs.flatMap(v => v.rows.map(r => r.cmd));
      const pChecked = allIds.length && allIds.every(c => st.sel.has(c));
      return `<div class="cw-p" data-pk="${pKey(p)}">
        <div class="cw-ph">
          <span class="cw-t" data-act="tp">${open ? '▾' : '▸'}</span>
          <input type="checkbox" data-act="selp" ${pChecked ? 'checked' : ''}>
          <span class="cw-pn">${esc(p.name)} ${p.tribe ? '[' + esc(p.tribe) + ']' : ''}
            <span class="cw-meta">· ${vs.length} wiosek · ${allIds.length} rozk. · ${fmt(pop(vs.reduce((a, v) => { for (const k in v.units) a[k] = (a[k] || 0) + v.units[k]; return a; }, {})))} pop</span></span>
          <button class="cw-b red" data-act="backp">↩ Wszystko od gracza</button>
        </div>
        ${open ? vs.sort((a, b) => b.rows.length - a.rows.length).map(v => {
          const vopen = st.open.has(vKey(v));
          const ids = v.rows.map(r => r.cmd);
          const vChecked = ids.every(c => st.sel.has(c));
          return `<div class="cw-v" data-vk="${vKey(v)}" data-pk="${pKey(p)}">
            <div class="cw-vh">
              <span class="cw-t" data-act="tv">${vopen ? '▾' : '▸'}</span>
              <input type="checkbox" data-act="selv" ${vChecked ? 'checked' : ''}>
              <b>${esc(v.name)}</b> <span class="cw-meta">(${esc(v.coords)}) · ${v.rows.length} z Twoich wiosek</span>
              <span>${unitsHtml(v.units)}</span>
              <button class="cw-b red" data-act="backv">↩ Wycofaj</button>
            </div>
            ${vopen ? v.rows.map(r => `<div class="cw-r"><input type="checkbox" data-act="selr" data-cmd="${esc(r.cmd)}" ${st.sel.has(r.cmd) ? 'checked' : ''}>
              <span>z <b>${esc(r.originName)}</b> · ${r.dist} pól</span> ${unitsHtml(r.units)}</div>`).join('') : ''}
          </div>`;
        }).join('') : ''}
      </div>`;
    }).join('') || '<p>Brak wsparcia pasującego do filtra.</p>';
    updateFoot();
  }

  function updateFoot() {
    const n = st.sel.size;
    const btn = document.getElementById('cw-go');
    btn.disabled = !n;
    btn.textContent = `↩ Wycofaj zaznaczone (${n})`;
    const total = st.data ? st.data.total : 0;
    document.getElementById('cw-info').textContent = st.data ? `Rozkazów wsparcia: ${total}, graczy: ${st.data.players.length}` : '';
  }

  // ---------------------------------------------------------------- wycofanie
  const CHUNK = 150;
  async function withdraw(entries, label) {
    if (!entries.length) return;
    const sum = {};
    entries.forEach(e => { for (const k in e.units) sum[k] = (sum[k] || 0) + e.units[k]; });
    const txt = Object.keys(sum).map(k => k + ' ' + fmt(sum[k])).join(', ');
    if (!confirm(`Wycofać ${entries.length} rozkazów wsparcia: ${label}?\n\nŁącznie: ${txt}`)) return;
    const h = document.getElementById('cw-info');
    let done = 0;
    try {
      for (let i = 0; i < entries.length; i += CHUNK) {
        const part = entries.slice(i, i + CHUNK);
        const body = new URLSearchParams();
        part.forEach(e => body.append(e.field, e.cmd));
        body.append('submit_units_back', 'Cofnij');
        h.textContent = `Wycofuję… ${done}/${entries.length}`;
        const r = await fetch(st.data.formAction, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        done += part.length;
        await new Promise(res => setTimeout(res, 300));
      }
      if (typeof UI !== 'undefined') UI.SuccessMessage(`Wycofano ${done} rozkazów (${label}).`, 4000);
    } catch (e) {
      if (typeof UI !== 'undefined') UI.ErrorMessage(`Cofanie przerwane po ${done}/${entries.length}: ${e.message || e}`, 8000);
    }
    entries.forEach(e => st.sel.delete(e.cmd));
    await reload();
  }

  async function reload() {
    try { st.data = await load(); } catch (e) { document.getElementById('cw-body').textContent = 'Błąd: ' + (e.message || e); return; }
    render();
  }

  const byCmd = () => { const m = new Map(); st.data.players.forEach(p => p.villages.forEach(v => v.rows.forEach(r => m.set(r.cmd, r)))); return m; };
  const find = (pk, vk) => {
    const p = st.data.players.find(x => pKey(x) === pk);
    const v = vk && p ? [...p.villages.values()].find(x => vKey(x) === vk) : null;
    return { p, v };
  };

  function onClick(ev) {
    const t = ev.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    const pEl = t.closest('[data-pk]'), vEl = t.closest('[data-vk]');
    const { p, v } = find(pEl && pEl.dataset.pk, vEl && vEl.dataset.vk);
    const visibleVillages = p ? [...p.villages.values()].filter(x => matches(p, x)) : [];
    if (act === 'tp') { const k = pKey(p); st.open.has(k) ? st.open.delete(k) : st.open.add(k); render(); }
    else if (act === 'tv') { const k = vKey(v); st.open.has(k) ? st.open.delete(k) : st.open.add(k); render(); }
    else if (act === 'selp') { const ids = visibleVillages.flatMap(x => x.rows.map(r => r.cmd)); ids.forEach(c => t.checked ? st.sel.add(c) : st.sel.delete(c)); render(); }
    else if (act === 'selv') { v.rows.forEach(r => t.checked ? st.sel.add(r.cmd) : st.sel.delete(r.cmd)); render(); }
    else if (act === 'selr') { t.checked ? st.sel.add(t.dataset.cmd) : st.sel.delete(t.dataset.cmd); render(); }
    else if (act === 'backv') withdraw(v.rows, `${v.name} (${v.coords})`);
    else if (act === 'backp') withdraw(visibleVillages.flatMap(x => x.rows), `wszystko od: ${p.name}`);
  }

  function build() {
    injectCss();
    const btn = document.createElement('button');
    btn.id = 'cw-btn'; btn.textContent = '↩ Wg wiosek';
    const ov = document.createElement('div');
    ov.id = 'cw-ov';
    ov.innerHTML = `<div id="cw-box">
      <div id="cw-head"><b>Wsparcie wg wiosek docelowych</b>
        <input type="text" id="cw-f" placeholder="filtr: gracz, plemię, wioska, 500|500">
        <button class="cw-b" id="cw-ex">Rozwiń wszystko</button><button class="cw-b" id="cw-co">Zwiń</button>
        <button class="cw-b" id="cw-rf">⟳</button><button class="cw-b" id="cw-x">✕</button></div>
      <div id="cw-body">Wczytuję…</div>
      <div id="cw-foot"><button class="cw-b red" id="cw-go" disabled>↩ Wycofaj zaznaczone (0)</button>
        <button class="cw-b" id="cw-cl">Odznacz</button><span id="cw-info" class="cw-meta"></span></div></div>`;
    document.body.append(btn, ov);
    btn.onclick = async () => { ov.style.display = 'block'; await reload(); };
    document.getElementById('cw-x').onclick = () => { ov.style.display = 'none'; };
    document.getElementById('cw-rf').onclick = reload;
    document.getElementById('cw-cl').onclick = () => { st.sel.clear(); render(); };
    document.getElementById('cw-f').oninput = e => { st.filter = e.target.value; render(); };
    document.getElementById('cw-ex').onclick = () => { st.data.players.forEach(p => { st.open.add(pKey(p)); p.villages.forEach(v => st.open.add(vKey(v))); }); render(); };
    document.getElementById('cw-co').onclick = () => { st.open.clear(); render(); };
    document.getElementById('cw-go').onclick = () => { const m = byCmd(); withdraw([...st.sel].map(c => m.get(c)).filter(Boolean), 'zaznaczone'); };
    document.getElementById('cw-body').addEventListener('click', onClick);
  }

  build();
})();
