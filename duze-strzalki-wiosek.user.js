// ==UserScript==
// @name         Duże strzałki przełączania wiosek
// @namespace    plemiona-roker
// @version      1.1
// @updateURL    https://raw.githubusercontent.com/Rokerio/noweRepo/main/duze-strzalki-wiosek.user.js
// @downloadURL  https://raw.githubusercontent.com/Rokerio/noweRepo/main/duze-strzalki-wiosek.user.js
// @description  Duże przyciski poprzednia/następna wioska: pływająca para na środku ekranu (działa też przy powiększeniu) + rząd pod opisem w Ratuszu
// @author       Roker
// @match        https://*.plemiona.pl/game.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // --- USTAWIENIA ---
    var ROZMIAR = 64;         // px, średnica przycisku pływającego
    var ODSTEP_OD_DOLU = 90;  // px od dołu widocznego ekranu
    var ODSTEP_MIEDZY = 24;   // px między dwoma przyciskami (środek ekranu)
    var PRZEZROCZYSTOSC = 0.85;

    var css = [
        '.rk-vs {width:' + ROZMIAR + 'px; height:' + ROZMIAR + 'px; border-radius:50%; background:#7d510f; color:#fff3cf;',
        '  border:3px solid #3e2a07; box-sizing:border-box; font:bold ' + Math.round(ROZMIAR * 0.55) + 'px/' + (ROZMIAR - 8) + 'px Arial;',
        '  text-align:center; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,.5);',
        '  -webkit-tap-highlight-color:transparent; user-select:none; -webkit-user-select:none; touch-action:manipulation;}',
        '.rk-vs:active {background:#a8701a;}',
        '#rk-float {position:fixed; left:0; top:0; z-index:99999; display:flex; gap:' + ODSTEP_MIEDZY + 'px;',
        '  transform-origin:0 0; opacity:' + PRZEZROCZYSTOSC + '; pointer-events:auto;}',
        '#rk-row {display:flex; justify-content:center; gap:' + ODSTEP_MIEDZY + 'px; margin:8px 0;}',
        '#rk-row .rk-vs {width:auto; min-width:140px; height:52px; border-radius:10px; padding:0 14px; font-size:20px; line-height:46px;}'
    ].join('\n');
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    function znajdzLink(kierunek) {
        var el = document.getElementById('village_switch_' + kierunek);
        if (el && el.href) return el;
        var span = document.querySelector(kierunek === 'left' ? '.groupLeft' : '.groupRight');
        var a = span && span.closest('a');
        if (a && a.href) return a;
        el = document.querySelector('a.village_switch_link[accesskey="' + (kierunek === 'left' ? 'a' : 'd') + '"]');
        return el && el.href ? el : null;
    }

    function idz(kierunek) {
        var link = znajdzLink(kierunek);
        if (link) window.location.href = link.href;
    }

    function przycisk(kierunek, tekst) {
        var b = document.createElement('div');
        b.className = 'rk-vs';
        b.textContent = tekst;
        b.addEventListener('click', function (e) { e.preventDefault(); idz(kierunek); });
        return b;
    }

    if (!znajdzLink('left') && !znajdzLink('right')) return;

    // --- 1) Pływająca para na środku widocznego ekranu ---
    var box = document.createElement('div');
    box.id = 'rk-float';
    box.appendChild(przycisk('left', '‹'));
    box.appendChild(przycisk('right', '›'));
    document.body.appendChild(box);

    function ustaw() {
        var vv = window.visualViewport;
        var w = 2 * ROZMIAR + ODSTEP_MIEDZY;
        if (!vv) {
            box.style.transform = 'translate(' + Math.round(window.innerWidth / 2 - w / 2) + 'px,' +
                Math.round(window.innerHeight - ODSTEP_OD_DOLU - ROZMIAR) + 'px)';
            return;
        }
        var s = 1 / vv.scale; // stały rozmiar mimo powiększenia strony
        var x = vv.offsetLeft + vv.width / 2 - (w * s) / 2;
        var y = vv.offsetTop + vv.height - (ODSTEP_OD_DOLU + ROZMIAR) * s;
        box.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
    }
    ustaw();
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', ustaw);
        window.visualViewport.addEventListener('scroll', ustaw);
    }
    window.addEventListener('scroll', ustaw);
    window.addEventListener('resize', ustaw);

    // --- 2) Rząd pod opisem budynku w Ratuszu ---
    var screen = (window.game_data && window.game_data.screen) ||
        new URLSearchParams(location.search).get('screen');
    if (screen === 'main') {
        var content = document.getElementById('content_value');
        if (content) {
            var row = document.createElement('div');
            row.id = 'rk-row';
            row.appendChild(przycisk('left', '‹ Poprzednia'));
            row.appendChild(przycisk('right', 'Następna ›'));
            var tabs = content.querySelector('table.modemenu');
            if (tabs) {
                tabs.parentNode.insertBefore(row, tabs);
            } else {
                var h2 = content.querySelector('h2');
                if (h2 && h2.nextSibling) h2.parentNode.insertBefore(row, h2.nextSibling.nextSibling || h2.nextSibling);
                else content.insertBefore(row, content.firstChild);
            }
        }
    }
})();
