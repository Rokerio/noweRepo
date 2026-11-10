// ==UserScript==
// @name         Plemiona – zrzut źródła strony (do wklejenia Claude)
// @namespace    claude.plemiona
// @updateURL    https://raw.githubusercontent.com/Rokerio/noweRepo/main/plemiona-zrzut-zrodla.user.js
// @downloadURL  https://raw.githubusercontent.com/Rokerio/noweRepo/main/plemiona-zrzut-zrodla.user.js
// @version      1.1
// @description  Przycisk 📋 na dole ekranu: kopiuje odchudzone źródło aktualnej strony (bez skryptów, styli i obrazków) do schowka. Działa w Safari na iPhonie.
// @match        *://*.plemiona.pl/game.php*
// @match        *://*.tribalwars.net/game.php*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
// rejestr wersji dla Sprawdzacza skryptów (localStorage, osobny na każdym urządzeniu)
try{var __r=JSON.parse(localStorage.getItem('gdp_registry')||'{}');__r['plemiona-zrzut-zrodla']={v:'1.1',t:Date.now()};localStorage.setItem('gdp_registry',JSON.stringify(__r));}catch(e){}


(function () {
  'use strict';
  const NS = 'cl_zrzut';
  if (document.getElementById(NS + '_btn')) return;

  // ---------- odchudzanie HTML ----------
  function clean(root) {
    const c = root.cloneNode(true);
    c.querySelectorAll('script, style, link, noscript, svg, iframe, canvas, video, audio, source, meta').forEach(e => e.remove());
    // komentarze
    const w = document.createTreeWalker(c, NodeFilter.SHOW_COMMENT);
    const kom = []; while (w.nextNode()) kom.push(w.currentNode);
    kom.forEach(n => n.remove());
    c.querySelectorAll('*').forEach(e => {
      ['style', 'onclick', 'onmouseover', 'onmouseout', 'onload', 'srcset', 'loading', 'tabindex'].forEach(a => e.removeAttribute(a));
      if (e.tagName === 'IMG') {
        const s = e.getAttribute('src') || '';
        e.setAttribute('src', s.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '').slice(0, 80));
      }
      [...e.attributes].forEach(a => { if (a.value.length > 300) e.setAttribute(a.name, a.value.slice(0, 300) + '…'); });
    });
    return c;
  }
  const zbij = h => h.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').replace(/></g, '>\n<').trim();

  function naglowek() {
    const g = (typeof game_data !== 'undefined') ? game_data : {};
    return [
      '<!-- URL: ' + location.pathname + location.search.replace(/([?&]t=)[^&]*/, '$1x') + ' -->',
      '<!-- screen=' + (g.screen || '') + ' mode=' + (g.mode || '') + ' group_id=' + (g.group_id ?? '') + ' world=' + (g.world || '') + ' -->',
      '<!-- user-agent: ' + navigator.userAgent.slice(0, 80) + ' -->'
    ].join('\n');
  }

  // ---------- tryby ----------
  const TRYBY = {
    tresc: {
      nazwa: 'Treść strony',
      opis: 'Sama zawartość gry (#content_value) – najczęściej to wystarczy.',
      pobierz: () => {
        const r = document.getElementById('content_value') || document.getElementById('contentContainer') || document.body;
        return zbij(clean(r).outerHTML);
      }
    },
    filtry: {
      nazwa: 'Filtry i grupy',
      opis: 'Tylko formularze, selecty, pasek grup i elementy z "filter" w nazwie.',
      pobierz: () => {
        const sel = 'form, .group-menu-item, #group_table, [id*="filter" i], [class*="filter" i], [id*="group" i], [class*="group" i], select';
        const wyb = [...document.querySelectorAll(sel)].filter(e => !e.closest('#' + NS + '_ov, #' + NS + '_btn'));
        // tylko najbardziej zewnętrzne (bez zagnieżdżonych duplikatów)
        const top = wyb.filter(e => !wyb.some(o => o !== e && o.contains(e)));
        if (!top.length) return '(nie znalazłem żadnych formularzy/filtrów na tej stronie)';
        return top.map((e, i) => '<!-- [' + (i + 1) + '/' + top.length + '] -->\n' + zbij(clean(e).outerHTML)).join('\n\n');
      }
    },
    calosc: {
      nazwa: 'Cała strona (odchudzona)',
      opis: 'Cały <body> bez skryptów i stylów. Może być długie.',
      pobierz: () => zbij(clean(document.body).outerHTML)
    }
  };

  // ---------- kopiowanie ----------
  async function kopiuj(ta, info) {
    ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length);
    let ok = false;
    try { await navigator.clipboard.writeText(ta.value); ok = true; } catch (e) { /* fallback */ }
    if (!ok) { try { ok = document.execCommand('copy'); } catch (e) { ok = false; } }
    info.textContent = ok
      ? '✅ Skopiowano ' + ta.value.length + ' znaków. Wklej do rozmowy z Claude.'
      : '⚠️ Nie udało się skopiować automatycznie – tekst jest zaznaczony: dotknij go i wybierz „Kopiuj”.';
  }

  // ---------- UI ----------
  function el(tag, css, txt) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function otworz() {
    if (document.getElementById(NS + '_ov')) return;
    const ov = el('div', 'position:fixed;inset:0;z-index:2147483647;background:#f4e4bc;overflow:auto;padding:10px;box-sizing:border-box;font:14px sans-serif;color:#000');
    ov.id = NS + '_ov';
    ov.appendChild(el('h3', 'margin:0 0 6px', 'Zrzut źródła strony'));

    const info = el('div', 'margin:6px 0;min-height:18px');
    const ta = el('textarea', 'width:100%;box-sizing:border-box;height:45vh;font:10px monospace');
    ta.readOnly = true;

    const pokaz = klucz => {
      let txt;
      try { txt = naglowek() + '\n' + TRYBY[klucz].pobierz(); } catch (e) { txt = 'Błąd: ' + e.message; }
      ta.value = txt;
      info.textContent = TRYBY[klucz].nazwa + ': ' + txt.length + ' znaków' + (txt.length > 120000 ? ' – dużo, wybierz „Filtry i grupy” albo „Treść strony”.' : '.');
    };

    const rzad = el('div', 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px');
    Object.keys(TRYBY).forEach(k => {
      const b = el('button', 'padding:8px 10px;font-size:14px', TRYBY[k].nazwa);
      b.title = TRYBY[k].opis;
      b.onclick = () => pokaz(k);
      rzad.appendChild(b);
    });
    ov.appendChild(rzad);
    ov.appendChild(el('div', 'font-size:12px;color:#555;margin-bottom:6px', 'Jeśli filtry są ukryte (rozwijane), najpierw rozwiń je na stronie, potem otwórz zrzut.'));
    ov.appendChild(ta);
    ov.appendChild(info);

    const rzad2 = el('div', 'display:flex;gap:8px;margin-top:6px');
    const bk = el('button', 'padding:10px 14px;font-size:15px;font-weight:bold', '📋 Kopiuj');
    bk.onclick = () => kopiuj(ta, info);
    const bz = el('button', 'padding:10px 14px;font-size:15px', 'Zamknij');
    bz.onclick = () => ov.remove();
    rzad2.append(bk, bz);
    ov.appendChild(rzad2);

    document.body.appendChild(ov);
    pokaz('filtry');
  }

  const btn = el('button', 'position:fixed;right:8px;bottom:8px;z-index:2147483646;padding:8px 10px;font-size:18px;opacity:.85;border-radius:8px;border:1px solid #804000;background:#f4e4bc', '📋');
  btn.id = NS + '_btn';
  btn.title = 'Zrzut źródła strony';
  btn.onclick = otworz;
  document.body.appendChild(btn);
})();
