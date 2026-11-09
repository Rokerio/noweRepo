// ==UserScript==
// @name         Plemiona - nazwy Taxi / Bolt
// @namespace    roker.plemiona
// @version      5.4
// @updateURL    https://raw.githubusercontent.com/Rokerio/noweRepo/main/plemiona-nazwy.user.js
// @downloadURL  https://raw.githubusercontent.com/Rokerio/noweRepo/main/plemiona-nazwy.user.js
// @author       Roker
// @description  Off = Taxi, Def = Bolt. Numer = grupa geograficzna (0,1,2) + numer (w grupie najpierw offy). DUZE LITERY = ludnosc od 23 500, kropka = wioska 9k+ pkt
// @match        https://*.plemiona.pl/game.php*
// @run-at       document-end
// @grant        none
// ==/UserScript==
// LEGALNE: nic nie dzieje sie samo. Skrypt czyta tylko strone, ktora masz otwarta, i tylko gdy klikniesz "Zbierz dane z tej strony".
// Nie wysyla wlasnych zapytan. Zmiana nazwy = 1 klikniecie = 1 wioska (natywny QuickEdit gry).
// Typ (Taxi/Bolt) = Twoje grupy statyczne "Off" i "Deff". Uzycie: guzik "Nazwy" -> "Pobierz dane" (1 klikniecie = 3 odczyty przegladow Produkcji: Off, Deff, wszystkie - tylko odczyt, jak w Dysponencie) -> "Zmien nastepna" (1 klik = 1 wioska).
// Zmiana nazw dziala tez w widoku mniejszej grupy (zmienia tylko widoczne wioski, dane z "wszystkie" zostaja).
(function () {
  'use strict';
  var CFG = { MAX_POINTS: 9000, FULL_POP: 23500, OFF_MIN: 2000, OFF_VS_DEF: 0.5, LINK: 12, SPLIT_AT: 30, MATCH: 12, MAX_AGE_H: 24 };
  // LINK = max odleglosc (pola) miedzy wioskami jednego skupiska; skupiska wieksze niz SPLIT_AT dzielone sa na polowy.
  // Numery grup sa zapamietywane (po srodku skupiska), wiec nowe skupisko dostaje kolejny numer, a stare nie zmieniaja numerow.
  var NAME_OFF = 'Taxi', NAME_DEF = 'Bolt';
  var KEY = 'tw_cls_v5';
  var UNITS = ['spear','sword','axe','archer','spy','light','marcher','heavy','ram','catapult','knight','snob','militia'];

  function num(t) { return parseInt(String(t).replace(/[^\d]/g, ''), 10) || 0; }
  function txt(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
  function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
  function vid(el) { var s = el.querySelector('.quickedit-vn'); return s ? String(s.getAttribute('data-id')) : null; }

  var gd = window.game_data || {};
  var mode = gd.mode || '';
  var onOverview = gd.screen === 'overview_villages';
  var totalVillages = gd.player ? num(gd.player.villages) : 0;
  var store = load(), note = '', cls = null;

  /* ---------- parsery (tylko czytaja biezacy dokument) ---------- */
  function parseProd(doc) {
    var out = {};
    doc.querySelectorAll('#production_table tr').forEach(function (tr) {
      var id = vid(tr); if (!id) return;
      var label = tr.querySelector('.quickedit-label');
      var m = /\((\d+)\|(\d+)\)/.exec(txt(label)); if (!m) return;
      var cells = Array.prototype.slice.call(tr.cells), nameIdx = -1, i;
      for (i = 0; i < cells.length; i++) if (cells[i].querySelector('.quickedit-vn')) { nameIdx = i; break; }
      var pts = num(txt(cells[nameIdx + 1]));
      var pairs = [];
      cells.forEach(function (c) { var t = txt(c); if (/^\d+\s*\/\s*\d+$/.test(t)) pairs.push(t.split('/').map(num)); });
      var farm = pairs[1] || pairs[0] || [0, 1];
      out[id] = { x: +m[1], y: +m[2], pts: pts, pop: farm[0], mx: farm[1] || 1 };
    });
    return out;
  }
  function parseUnits(doc) {
    var out = {}, order = [];
    doc.querySelectorAll('#units_table thead img').forEach(function (im) {
      var r = /unit_(\w+)\./.exec(im.getAttribute('src') || ''); if (r) order.push(r[1]);
    });
    if (!order.length) order = UNITS;
    doc.querySelectorAll('#units_table tbody').forEach(function (tb) {
      var id = vid(tb); if (!id) return;
      var rec = {};
      tb.querySelectorAll('tr').forEach(function (tr) {
        var first = tr.querySelector('td:not(.unit-item):not([rowspan])');
        var cnt = tr.querySelectorAll('td.unit-item'); if (!first || !cnt.length) return;
        var row = {}; cnt.forEach(function (c, i) { row[order[i]] = num(txt(c)); });
        rec[txt(first)] = row;
      });
      out[id] = rec.razem || null;
    });
    return out;
  }
  var STEPS = [['prod', 'Produkcja (wszystkie)'], ['off', 'Grupa Off'], ['def', 'Grupa Deff']];
  var GID = { off: '39161', def: '39311' };   // zapasowe id grup statycznych, gdy nie znajde ich w menu po nazwie
  var NAMERE = { off: /^\[?\s*off\s*\]?$/i, def: /^\[?\s*de+f+\s*\]?$/i };
  function menuItems() {
    var r = [];
    document.querySelectorAll('.group-menu-item[data-group-id]').forEach(function (a) { r.push({ id: String(a.getAttribute('data-group-id')), name: txt(a) }); });
    return r;
  }
  function groupIdOf(kind) {
    var id = null; menuItems().forEach(function (m) { if (!id && NAMERE[kind].test(m.name)) id = m.id; });
    return id || GID[kind];
  }
  function viewKind() {   // jaki widok Produkcji mam otwarty: all / off / def / other
    var g = String(gd.group_id || '0'); if (g === '0') return 'all';
    if (g === groupIdOf('off')) return 'off';
    if (g === groupIdOf('def')) return 'def';
    return 'other';
  }

  /* ---------- klasyfikacja ---------- */
  function kmeansIds(pts, ids, k) {
    if (k <= 1) return [ids];
    var xs = ids.map(function (i) { return pts[i].x; }).sort(function (a, b) { return a - b; });
    var yc = ids.reduce(function (s, i) { return s + pts[i].y; }, 0) / ids.length;
    var c = []; for (var q = 0; q < k; q++) c.push([xs[Math.floor((q + 0.5) * xs.length / k)], yc]);
    var g, it;
    for (it = 0; it < 80; it++) {
      g = c.map(function () { return []; });
      ids.forEach(function (id) {
        var b = 0, bd = 1e9;
        c.forEach(function (p, j) { var d = Math.hypot(pts[id].x - p[0], pts[id].y - p[1]); if (d < bd) { bd = d; b = j; } });
        g[b].push(id);
      });
      g.forEach(function (m, j) {
        if (m.length) c[j] = [m.reduce(function (s, i) { return s + pts[i].x; }, 0) / m.length, m.reduce(function (s, i) { return s + pts[i].y; }, 0) / m.length];
      });
    }
    return g.filter(function (m) { return m.length; });
  }
  function regions(pts) {
    var ids = Object.keys(pts), parent = {};
    ids.forEach(function (i) { parent[i] = i; });
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    ids.forEach(function (a, ai) {
      for (var bi = ai + 1; bi < ids.length; bi++) {
        var b = ids[bi];
        if (Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y) <= CFG.LINK) parent[find(a)] = find(b);
      }
    });
    var by = {}; ids.forEach(function (i) { (by[find(i)] = by[find(i)] || []).push(i); });
    return Object.keys(by).map(function (k) { return by[k]; });
  }
  // zwraca {id: numer grupy 0,1,2,3...}; numery stabilne dzieki zapamietanym srodkom
  function groupsOf(pts) {
    var clusters = [];
    regions(pts).forEach(function (r) {
      kmeansIds(pts, r, Math.ceil(r.length / CFG.SPLIT_AT)).forEach(function (m) { clusters.push(m); });
    });
    var cent = clusters.map(function (m) {
      return [m.reduce(function (s, i) { return s + pts[i].x; }, 0) / m.length, m.reduce(function (s, i) { return s + pts[i].y; }, 0) / m.length];
    });
    var old = (store.gc && store.gc.length) ? store.gc : [[607.8, 539.1, 0], [613.9, 545.8, 1], [644, 556.5, 2]];
    var order = cent.map(function (c, i) { return i; }).sort(function (a, b) { return cent[a][0] - cent[b][0]; });
    var no = {}, used = {}, maxNo = -1;
    old.forEach(function (o) { if (o[2] > maxNo) maxNo = o[2]; });
    // najpierw dopasuj do znanych skupisk (najblizsze pary)
    var pairs = [];
    order.forEach(function (i) { old.forEach(function (o, j) { pairs.push([Math.hypot(cent[i][0] - o[0], cent[i][1] - o[1]), i, j]); }); });
    pairs.sort(function (a, b) { return a[0] - b[0]; });
    var oi = {};
    pairs.forEach(function (p) {
      if (p[0] <= CFG.MATCH && no[p[1]] === undefined && !oi[p[2]]) { no[p[1]] = old[p[2]][2]; oi[p[2]] = 1; }
    });
    order.forEach(function (i) { if (no[i] === undefined) no[i] = ++maxNo; });
    store.gc = cent.map(function (c, i) { return [c[0], c[1], no[i]]; }); save(store);
    var res = {};
    clusters.forEach(function (m, i) { m.forEach(function (id) { res[id] = no[i]; }); });
    return res;
  }

  function classify() {
    var P = store.prod && store.prod.d, U = store.units && store.units.d;
    var O = store.off && store.off.d, D = store.def && store.def.d;
    var miss = []; if (!P) miss.push('Produkcja'); if (!O) miss.push('Grupa Off'); if (!D) miss.push('Grupa Deff');
    if (miss.length) return { miss: miss };
    var all = Object.keys(P), ids = [], nogrp = [], names = {}, stat = { A: 0, D: 0, full: 0, max: 0 }, isOff = {};
    all.forEach(function (id) {
      if (O[id]) { isOff[id] = true; ids.push(id); }
      else if (D[id]) { isOff[id] = false; ids.push(id); }
      else nogrp.push(id);
    });
    var grp = groupsOf(P);
    var byG = {}; ids.forEach(function (id) { (byG[grp[id]] = byG[grp[id]] || []).push(id); });
    var numb = {};
    Object.keys(byG).forEach(function (g) {
      var list = byG[g];
      function spread(a) { var s = 0; list.forEach(function (o) { s += Math.hypot(P[a].x - P[o].x, P[a].y - P[o].y); }); return s; }
      function byCentre(a, b) { return spread(a) - spread(b) || (a < b ? -1 : 1); }
      var ordered = list.filter(function (i) { return isOff[i]; }).sort(byCentre)
        .concat(list.filter(function (i) { return !isOff[i]; }).sort(byCentre));
      ordered.forEach(function (id, i) { numb[id] = (+g) + (i < 10 ? '0' : '') + i; });
    });
    ids.forEach(function (id) {
      var v = P[id], full = v.pop >= CFG.FULL_POP, mx = v.pts >= CFG.MAX_POINTS;
      var word = isOff[id] ? NAME_OFF : NAME_DEF; if (full) word = word.toUpperCase();
      names[id] = numb[id] + ' ' + word + (mx ? '.' : '');
      stat[isOff[id] ? 'A' : 'D']++; if (full) stat.full++; if (mx) stat.max++;
    });
    return { names: names, stat: stat, isOff: isOff, nogrp: nogrp };
  }

  /* ---------- zbieranie danych: tylko po kliknieciu guzika ---------- */
  function collect() {
    if (!onOverview || mode !== 'prod') { note = 'Wejdz w Produkcje (wszystkie albo grupa Off / Deff).'; return; }
    var data = parseProd(document), n = Object.keys(data).length, kind = viewKind();
    if (!n) { note = 'Nie widze tabeli z wioskami.'; return; }
    if (kind === 'other') { note = 'To nie jest grupa Off ani Deff ani wszystkie. Nic nie zapisano.'; return; }
    if (kind === 'all') {
      if (totalVillages && n < totalVillages) {
        note = 'Widok pokazuje ' + n + ' z ' + totalVillages + ' wiosek - dodaj &page=-1. Nic nie zapisano.'; return;
      }
      store.prod = { t: Date.now(), d: data }; note = 'Zapisano: Produkcja (' + n + ' wiosek).';
    } else {
      var ids = {}; Object.keys(data).forEach(function (id) { ids[id] = 1; });
      store[kind] = { t: Date.now(), d: ids }; note = 'Zapisano: grupa ' + (kind === 'off' ? 'Off' : 'Deff') + ' (' + n + ' wiosek).';
    }
    save(store);
  }

  /* ---------- pobieranie danych: 1 klikniecie = 3 odczyty przegladu Produkcji (tylko GET, bez zadnych akcji w grze) ---------- */
  var busy = false;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function prodUrl(g) {
    var sit = (gd.player && String(gd.player.sitter) !== '0') ? '&t=' + gd.player.id : '';
    return '/game.php?village=' + (gd.village ? gd.village.id : '') + '&screen=overview_villages&mode=prod&group=' + g + '&page=-1' + sit;
  }
  async function getDoc(g) {
    var html = await $.get(prodUrl(g));
    return new DOMParser().parseFromString(html, 'text/html');
  }
  async function fetchAll() {
    if (busy) return; busy = true;
    var cur = String(gd.group_id || '0');
    try {
      var seq = [['off', groupIdOf('off')], ['def', groupIdOf('def')], ['prod', '0']], got = {};
      for (var i = 0; i < seq.length; i++) {
        $('#cls_fetch').text('Pobieram ' + (i + 1) + '/3...');
        if (i) await sleep(300);
        var doc = await getDoc(seq[i][1]);
        if (!doc.querySelector('#production_table')) throw new Error('Brak tabeli Produkcji (' + seq[i][0] + ') - jestes zalogowany? Nic nie zapisano.');
        var data = parseProd(doc), n = Object.keys(data).length;
        if (seq[i][0] === 'prod' && (!n || (totalVillages && n < totalVillages))) throw new Error('Produkcja pokazuje ' + n + ' z ' + totalVillages + ' wiosek. Nic nie zapisano.');
        got[seq[i][0]] = data;
      }
      var mk = function (d, ids) { var o = d; if (ids) { o = {}; Object.keys(d).forEach(function (k) { o[k] = 1; }); } return { t: Date.now(), d: o }; };
      store.off = mk(got.off, true); store.def = mk(got.def, true); store.prod = mk(got.prod, false); save(store);
      note = 'Pobrano: ' + Object.keys(got.prod).length + ' wiosek, Off ' + Object.keys(got.off).length + ', Deff ' + Object.keys(got.def).length + '.';
      if (cur !== '0') { await sleep(300); try { await getDoc(cur); } catch (e) {} }   // gra pamieta ostatnio ogladana grupe - wracam do Twojej
    } catch (e) { note = 'Blad: ' + (e && e.message ? e.message : e); }
    busy = false; render();
  }

  /* ---------- zmiana nazw ---------- */
  var done = {};   // id -> nazwa juz wyslana do QuickEdit (gra odswieza etykiete z opoznieniem)
  function rows() {
    var out = [];
    if (!cls || !cls.names) return out;
    $('#production_table .quickedit-vn').each(function () {
      var $s = $(this), id = String($s.data('id')), t = cls.names[id];
      if (!t || done[id] === t) return;
      var $l = $s.find('.quickedit-label'), shown = ($l.text() || '').trim();
      if ($l.attr('data-text') === t || shown.indexOf(t) === 0) { done[id] = t; return; }
      out.push({ $s: $s, t: t, id: id });
    });
    return out;
  }
  function renameOne($s, target, id) {
    done[id] = target;
    $s.find('.rename-icon').first().trigger('click');
    var $in = $s.find('input[type="text"]').first(); $in.val(target);
    var $ok = $s.find('input[type="button"], input[type="submit"], button').first();
    if ($ok.length) $ok.trigger('click'); else { var e = $.Event('keydown'); e.which = e.keyCode = 13; $in.trigger(e); }
  }
  function refresh() {
    $('#production_table .cls-btn').remove();
    if (!(onOverview && mode === 'prod') || !cls || !cls.names) return;
    var left = rows(); $('#cls_left').text(left.length);
    left.forEach(function (r) {
      $('<a href="#" class="btn cls-btn" style="margin-left:6px">&rarr; ' + r.t + '</a>').appendTo(r.$s)
        .on('click', function (ev) { ev.preventDefault(); renameOne(r.$s, r.t, r.id); refresh(); });
    });
  }

  /* ---------- panel ---------- */
  if (document.getElementById('cls_fab')) return;
  function ageH(k) { return store[k] ? (Date.now() - store[k].t) / 36e5 : null; }
  function stepUrl(m) {
    var v = gd.village ? gd.village.id : '';
    var g = m === 'prod' ? '0' : groupIdOf(m);
    return '/game.php?village=' + v + '&screen=overview_villages&mode=prod&group=' + g + '&page=-1';
  }
  var $fab = $('<a id="cls_fab" href="#" style="position:fixed;right:10px;bottom:70px;z-index:99999;background:#7d510f;color:#fff;' +
    'padding:10px 14px;border-radius:22px;font-weight:bold;box-shadow:0 2px 6px #0008;text-decoration:none">Nazwy</a>');
  var $box = $('<div id="cls_box" style="display:none;position:fixed;right:10px;bottom:120px;z-index:99999;width:min(340px,92vw);' +
    'max-height:70vh;overflow:auto;background:#f4e4bc;border:2px solid #7d510f;border-radius:6px;padding:10px;font-size:13px"></div>');
  $('body').append($fab, $box);
  var isOpen = false;
  $fab.on('click', function (e) { e.preventDefault(); isOpen = !isOpen; $box.toggle(isOpen); if (isOpen) render(); else refresh(); });

  function render() {
    cls = classify();
    var h = '<b>Nazwy wg kodu</b> <span style="float:right"><a href="#" id="cls_close">&times;</a></span><br/>', next = null;
    STEPS.forEach(function (s) {
      var a = ageH(s[0]), ok = a !== null && a <= CFG.MAX_AGE_H;
      if (!ok && !next) next = s;
      h += (ok ? '&#10003; ' : '&#9675; ') + s[1] + ': ' + (a === null ? 'brak' : Math.round(a) + ' h temu') + '<br/>';
    });
    h += '<br/><a href="#" class="btn" id="cls_fetch">Pobierz dane (1 klik)</a> <span style="color:#555">3 odczyty: Off, Deff, wszystkie</span><br/>';
    if (note) h += '<i>' + note + '</i><br/>';
    if (cls.miss) h += '<br/><i>Brakuje: ' + cls.miss.join(', ') + '</i><br/>';
    if (cls.nogrp && cls.nogrp.length) {
      h += '<br/><b style="color:#a00">Bez grupy Off/Deff: ' + cls.nogrp.length + '</b> (nie zmieniam ich nazw): ' +
        cls.nogrp.map(function (id) { var v = store.prod.d[id]; return v.x + '|' + v.y; }).join(', ') + '<br/>';
    }
    if (cls.names) {
      var st = cls.stat;
      h += '<br/>Taxi: ' + st.A + ' | Bolt: ' + st.D + ' | DUZE (pelna zagroda): ' + st.full + ' | kropka (9k+): ' + st.max + '<br/>';
      if (onOverview && mode === 'prod') {
        h += (gd.group_id && String(gd.group_id) !== '0' ? '<i>Widok grupy - zmieniam tylko widoczne wioski.</i><br/>' : '') +
          'Do zmiany: <b id="cls_left">0</b> <a href="#" class="btn" id="cls_next">Zmien nastepna</a>';
      } else {
        h += '<a href="#" class="btn" id="cls_gorename">Przejdz do Produkcji &rarr;</a>';
      }
    }
    $box.html(h);
    $('#cls_close').on('click', function (e) { e.preventDefault(); isOpen = false; $box.hide(); });
    $('#cls_fetch').on('click', function (e) { e.preventDefault(); fetchAll(); });
    $('#cls_gorename').on('click', function (e) { e.preventDefault(); location.href = stepUrl('prod'); });
    $('#cls_next').on('click', function (e) {
      e.preventDefault(); var left = rows();
      if (!left.length) { UI.SuccessMessage('Wszystkie widoczne nazwy gotowe.'); return; }
      renameOne(left[0].$s, left[0].t, left[0].id); refresh();   // 1 klikniecie = 1 wioska
    });
    refresh();
  }
})();
