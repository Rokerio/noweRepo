// ==UserScript==
// @name         Dostawy MK - drzewo do celu (bicie monet)
// @namespace    dostawy-mk-drzewo
// @version      2.2.1
// @updateURL    https://raw.githubusercontent.com/Rokerio/noweRepo/main/dostawy-mk-drzewo.user.js
// @downloadURL  https://raw.githubusercontent.com/Rokerio/noweRepo/main/dostawy-mk-drzewo.user.js
// @description  Menedżer konta > Dostawy: (1) zaopatrzenie nowych wiosek pod budowę i rekrutację, (2) liczy najszybsze trasy (każda wioska jeden cel, przerzuty przez wioski z kupcami) do wioski bijącej monety i po kliknięciu podmienia harmonogramy dostaw.
// @author       Roker
// @match        https://*.plemiona.pl/game.php*screen=am_market*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/* global game_data, jQuery, UI */

(function () {
	'use strict';

	// ================= USTAWIENIA DOMYŚLNE (zmienisz też w panelu) =================
	const DEF = {
		cfgVer: 2,                   // wersja ustawień - starsze zapisane ustawienia są pomijane
		targets: '606|543',          // cele (wioski bijące monety), po przecinku, np. '606|543, 604|536'
		exclude: '',                 // wioski pomijane, współrzędne po przecinku
		targetGroup: '0',            // grupa, z której wybierasz cele (lista do zaznaczenia w panelu)
		fromGroup: '0',              // grupa wiosek, które wysyłają (0 = wszystkie)
		interval: '00:01',           // co ile powtarzać dostawę (format jak w Menedżerze, 00:01 = co minutę)
		minutesPerField: 4.8,        // czas kupca na 1 pole (świat 233: 4,8 min)
		maxHops: 3,
		maxDist: 30,                 // wioski dalej niż tyle pól od najbliższego celu są pomijane (inne miejsce na mapie)
		minPerRes: 1,                // najmniejsza paczka na turę (tys. jednego surowca)
		splitRes: false,             // false = jedna dostawa D+G+Ż razem (np. 1000/1000/1000), true = osobna na każdy surowiec
		maxPerRes: 10,               // największa paczka na turę (tys. jednego surowca)
		replaceInterval: 5,          // do usunięcia zaznacz domyślnie harmonogramy powtarzane co <= tyle minut
		realEvery: 0,                // co ile minut Menedżer naprawdę wysyła (0 = sam oszacuj z kupców; zwykle ~2 min, choć ustawione 00:01)
		protect: true,               // ochrona przed przelaniem: symulacja i ograniczenie surowców, które by się przelały
		protectHours: 8,             // na ile godzin naprzód liczyć (np. na noc)
		prodPerHour: 0,              // produkcja wioski w tys. jednego surowca na godz. (0 = z bieżącej wioski)
		coinCost: [28, 30, 25],      // koszt monety w tys. (drewno, glina, żelazo) - tyle zjada mennica
		minExchange: 200,            // wymiana u handlarza (stała opłata PP) opłaca się od tylu tys. surowca naraz
		calm: false,                 // tryb spokojny: zamiast na pełnych obrotach - tyle, ile trzeba na X monet na dobę
		coinsPerDay: 130,            // tryb spokojny: monet na dobę (1 szlachcic = tyle monet, ile wynosi następny limit)
		prodMode: false,             // wolne zsyłanie z produkcji: każda wioska co godzinę prosto do najbliższej mennicy
		prodShare: 50,               // ...tyle % swojej godzinnej produkcji
		devShare: 100,               // ...a wioska rozwinięta (pełna zagroda najwyższego poziomu i dużo punktów) tyle %
		devPopMax: 24000,            // rozwinięta: zagroda co najmniej tyle miejsc (24000 = poziom 30)
		devPopFill: 95,              // ...zapełniona co najmniej w tylu %
		devPoints: 9000              // ...i wioska ma co najmniej tyle punktów
	};
	// ===============================================================================

	if (typeof game_data === 'undefined' || typeof jQuery === 'undefined') { return; }
	if (game_data.screen !== 'am_market' || /mode=edit/.test(location.search)) { return; }
	const $ = jQuery;
	const NS = 'DostawyMK';
	const sitter = (game_data.player.sitter !== '0') ? '&t=' + game_data.player.id : '';
	const num = s => Number(String(s).replace(/\D/g, '')) || 0;
	const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
	const sleep = ms => new Promise(r => setTimeout(r, ms));
	const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
	const coordOf = t => { const m = String(t).match(/(\d{1,3})\|(\d{1,3})/g); return m ? m[m.length - 1] : null; };
	const msg = {
		ok: (t, d) => (typeof UI !== 'undefined' ? UI.SuccessMessage(t, d || 5000) : console.log(t)),
		err: (t, d) => (typeof UI !== 'undefined' ? UI.ErrorMessage(t, d || 8000) : console.warn(t))
	};

	let S = Object.assign({}, DEF);
	try { const c = JSON.parse(localStorage.getItem(NS + '_cfg_' + game_data.world) || '{}'); if (c.cfgVer === DEF.cfgVer) { Object.assign(S, c); } } catch (e) { /* ignore */ }
	const saveCfg = () => { try { localStorage.setItem(NS + '_cfg_' + game_data.world, JSON.stringify(S)); } catch (e) { /* ignore */ } };

	// ================= DANE =================
	// wioski: zapasy i kupcy z przeglądu produkcji
	// grupy wiosek (z menu grup w przeglądzie)
	let groups = null;
	function parseGroups(doc) {
		const out = [];
		doc.find('.group-menu-item[data-group-id]').each(function () {
			const id = String(this.dataset.groupId);
			if (out.some(g => g.id === id)) { return; }
			out.push({ id: id, name: id === '0' ? 'wszystkie' : this.textContent.trim().replace(/^[[>]\s*|\s*[\]<]$/g, '') });
		});
		const all = out.filter(g => g.id === '0');
		return (all.length ? all : [{ id: '0', name: 'wszystkie' }]).concat(out.filter(g => g.id !== '0'));
	}
	// aktywna grupa w grze (lista harmonogramów jest nią filtrowana!)
	const pageGroup = () => String($('strong.group-menu-item[data-group-id]').first().attr('data-group-id') || (typeof game_data !== 'undefined' && game_data.group_id) || '0');
	// przegląd ustawia w grze aktywną grupę - po odczycie innej grupy przywracamy poprzednią (i czekamy na to)
	const homeGroup = pageGroup();
	const vCache = {};
	async function loadVillages(group) {
		group = String(group || '0');
		if (vCache[group]) { return vCache[group]; }
		const html = await $.get('/game.php?screen=overview_villages&mode=prod&group=' + group + '&page=-1' + sitter);
		if (group !== homeGroup) { try { await $.get('/game.php?screen=am_market&group=' + homeGroup + sitter); } catch (e) { /* ignore */ } }
		const doc = $(new DOMParser().parseFromString(html, 'text/html'));
		if (!groups) { groups = parseGroups(doc); }
		const table = doc.find('#production_table')[0];
		if (!table) { throw 'Nie odczytano przeglądu produkcji.'; }
		const out = [];
		for (let i = 1; i < table.rows.length; i++) {
			const row = table.rows[i];
			if (row.cells.length < 6) { continue; }
			const q = $(row.cells[1]).find('.quickedit-vn')[0];
			const c = coordOf(row.cells[1].textContent);
			if (!q || !c) { continue; }
			const res = (row.cells[3].textContent.replace(/\./g, '').match(/\d+/g) || []).map(Number);
			const tr = (row.cells[5].textContent.match(/\d+/g) || [0, 0]).map(Number);
			const [x, y] = c.split('|').map(Number);
			out.push({
				id: String(q.dataset.id), name: $(q).find('.quickedit-label').text().trim().replace(/\s*\(\d+\|\d+\).*$/, ''),
				coords: c, x: x, y: y,
				stock: Math.floor(((res[0] || 0) + (res[1] || 0) + (res[2] || 0)) / 1000),
				res: [res[0] || 0, res[1] || 0, res[2] || 0],
				points: num(row.cells[2].textContent),
				merchants: tr[1] || 0, freeMerchants: tr[0] || 0,
				cap: num(row.cells[4].textContent) || 400000,
				pop: ((row.cells[6] ? row.cells[6].textContent : '').match(/(\d[\d.]*)\s*\/\s*(\d[\d.]*)/) || [0, '0', '0']).slice(1, 3).map(num)
			});
		}
		if (!out.length && group === '0') { throw 'Brak wiosek w przeglądzie produkcji.'; }
		vCache[group] = out;
		setTimeout(() => { delete vCache[group]; }, 20000);	// świeże zapasy przy kolejnym liczeniu
		return out;
	}

	// istniejące harmonogramy z tej strony
	function readRoutes(ctx) {
		const out = [];
		(ctx ? $(ctx) : $(document)).find('input[name="trading_routes[]"]').each(function () {
			const tr = $(this).closest('tr');
			const td = tr.children('td');
			const time = (td.eq(5).text().match(/\d+:\d+/) || [''])[0];
			const recurring = td.eq(5).find('img[src*="recurring"]').length > 0;
			const [h, m] = time ? time.split(':').map(Number) : [99, 99];
			out.push({
				id: this.value,
				start: coordOf(td.eq(1).text()), startName: td.eq(1).text().trim(),
				target: coordOf(td.eq(2).text()), targetName: td.eq(2).text().trim(),
				res: (() => {							// [drewno, glina, żelazo] wg ikon - harmonogram może mieć tylko jeden surowiec
					const r = [0, 0, 0];
					td.eq(3).find('.nowrap').each(function () {
						const k = ['wood', 'stone', 'iron'].findIndex(n => $(this).find('.' + n).length);
						if (k > -1) { r[k] += num(this.textContent); }
					});
					return r;
				})(),
				time: time, minutes: recurring ? h * 60 + m : Infinity, cb: this
			});
		});
		return out;
	}

	// ================= DRZEWO TRAS =================
	// każda wioska ma jeden cel; 1) najwolniejsza wioska kończy jak najszybciej, 2) każda inna też
	// (suma kwadratów czasów), 3) najmniej pracy kupców; najwyżej maxHops przystanków po drodze
	function buildTree(nodes, sinks) {
		const n = nodes.length, mpf = S.minutesPerField, wave = turnMinutes();
		const M = nodes.map(v => v.merchants || 0);
		const stock = nodes.map(v => v.stock);
		const pos = j => (j < 0 ? sinks[-j - 1] : nodes[j]);
		const trip = (i, j) => Math.max(2 * dist(nodes[i], pos(j)) * mpf, wave);
		function evaluate(par) {
			const depth = new Array(n);
			for (let i = 0; i < n; i++) {
				let k = i, d = 0;
				const seen = new Set();
				while (k >= 0) { if (seen.has(k)) { return null; } seen.add(k); k = par[k]; d++; }
				if (d - 1 > S.maxHops) { return null; }
				depth[i] = d;
			}
			const F = stock.slice();
			[...Array(n).keys()].sort((a, b) => depth[b] - depth[a]).forEach(i => { if (par[i] >= 0) { F[par[i]] += F[i]; } });
			let max = 0, work = 0, sq = 0;
			const load = new Array(n);
			for (let i = 0; i < n; i++) {
				const t = F[i] * trip(i, par[i]);
				load[i] = F[i] > 0 ? (M[i] > 0 ? t / M[i] : Infinity) : 0;
				if (isFinite(load[i])) { max = Math.max(max, load[i]); sq += (load[i] / 60) * (load[i] / 60); }
				work += t;
			}
			return { max: max, sq: sq, work: work, F: F, load: load };
		}
		const better = (a, b) => a.max < b.max - 1e-6 || (Math.abs(a.max - b.max) <= 1e-6 && (a.sq < b.sq - 1e-6 || (Math.abs(a.sq - b.sq) <= 1e-6 && a.work < b.work - 1e-6)));
		const opts = sinks.map((m, k) => -k - 1).concat([...Array(n).keys()].filter(j => M[j] > 0));
		const nearest = i => -1 - sinks.map((m, k) => [dist(nodes[i], m), k]).sort((a, b) => a[0] - b[0])[0][1];
		function search(par) {
			let cur = evaluate(par), imp = true;
			while (imp) {
				imp = false;
				for (let i = 0; i < n; i++) {
					if (!stock[i] && !par.some(p => p === i)) { continue; }
					for (const j of opts) {
						if (j === i || j === par[i]) { continue; }
						const o = par[i]; par[i] = j;
						const e = evaluate(par);
						if (e && better(e, cur)) { cur = e; imp = true; } else { par[i] = o; }
					}
				}
			}
			return { par: par, ev: cur };
		}
		let seed = 987654321;
		const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
		let best = search(nodes.map((v, i) => nearest(i)));
		for (let r = 0; r < 25; r++) {
			const st = best.par.slice();
			for (let i = 0; i < n; i++) { if (rnd() < 0.35) { const j = opts[Math.floor(rnd() * opts.length)]; if (j !== i) { st[i] = j; } } }
			if (!evaluate(st)) { continue; }
			const res = search(st);
			if (better(res.ev, best.ev)) { best = res; }
		}
		const direct = Math.max(0, ...nodes.map((v, i) => (stock[i] && M[i] ? stock[i] * trip(i, nearest(i)) / M[i] : 0)));
		return { par: best.par, ev: best.ev, direct: direct, pos: pos };
	}

	// paczka na turę (tys. każdego surowca): tyle, ile kupcy wioski zdążą obrócić na turę - wioska wysyła na pełnych obrotach.
	// Za mała paczka dławi pośredników (dostają od kilku wiosek więcej, niż sami mogą oddać na minutę).
	function packFor(v, to) {
		const turn = turnMinutes();
		const trip = Math.max(2 * dist(v, to) * S.minutesPerField, turn);
		const cap = v.merchants * turn / trip;				// tys. na turę (wszystkie surowce)
		const per = Math.min(S.maxPerRes, Math.max(S.minPerRes, Math.ceil(cap / 3)), Math.max(1, Math.floor(v.merchants / 3)));
		return [per, per, per];
	}
	function intervalMinutes() {
		const m = String(S.interval).match(/^(\d+):(\d+)$/);
		return m ? Math.max(1, Number(m[1]) * 60 + Number(m[2])) : 1;
	}
	// rzeczywisty odstęp między wysyłkami jednej trasy: Menedżer nie nadąża co minutę (ustawione 00:01 -> realnie ~2 min)
	let measured = null;		// { every, n } z ostatniego liczenia
	function turnMinutes() {
		if (S.realEvery > 0) { return Math.max(intervalMinutes(), S.realEvery); }
		return Math.max(intervalMinutes(), measured && measured.n >= 3 ? measured.every : 2);
	}
	// oszacowanie z kupców: trasa, której nadawca ma zapas, w stanie ustalonym ma zajętych kupców = kupcy_na_wysyłkę * kurs / odstęp
	function measureEvery(routes, villages) {
		const by = {};
		villages.forEach(v => { by[v.coords] = v; });
		const fromCount = {};
		routes.forEach(r => { fromCount[r.start] = (fromCount[r.start] || 0) + 1; });
		const est = [];
		routes.forEach(r => {
			const v = by[r.start], t = by[r.target];
			if (!v || !t || r.minutes > S.replaceInterval || fromCount[r.start] !== 1) { return; }
			const need = (r.res[0] + r.res[1] + r.res[2]) / 1000;
			const busy = (v.merchants || 0) - (v.freeMerchants || 0);
			const trip = 2 * dist(v, t) * S.minutesPerField;
			const ample = r.res.every((x, k) => v.res[k] >= Math.max(20000, 10 * x));	// zapas - trasa nie stoi z braku surowca
			if (!need || !ample || busy < need * 2 || busy >= v.merchants - need || trip < 10) { return; }	// wszyscy zajęci = limit kupców, nic nie mówi o odstępie
			est.push(need * trip / busy);
		});
		if (!est.length) { return null; }
		est.sort((a, b) => a - b);
		return { every: Math.min(10, Math.max(1, Math.round(est[Math.floor(est.length / 2)] * 10) / 10)), n: est.length };
	}

	// koszt monety w danej mennicy (z Pałacu, z bonusem flagi) albo z ustawień
	const coinCostOf = v => (v && v.coinCost) || S.coinCost;
	const fmtTime = m => { m = Math.max(1, Math.min(23 * 60 + 59, Math.round(m))); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
	let nobleInfo = null;
	// Pałac mennicy: koszt monety, limit szlachciców, ile monet brakuje do następnego
	async function readMint(v) {
		const html = await $.get(`/game.php?village=${v.id}&screen=snob${sitter}`);
		const doc = new DOMParser().parseFromString(html, 'text/html');
		const afterIcon = ic => { let t = '', n = ic.nextSibling; while (n && !(n.nodeType === 1 && /\bicon\b/.test(n.className || ''))) { t += n.textContent; n = n.nextSibling; } return num(t); };
		let cost = null;
		[...doc.querySelectorAll('th')].filter(th => /Wybij monety/i.test(th.textContent)).forEach(th => {
			const tr = th.closest('tr') && th.closest('tr').nextElementSibling;
			if (!tr || cost) { return; }
			const c = ['wood', 'stone', 'iron'].map(k => { const ic = tr.querySelector('.icon.' + k + ', span.' + k); return ic ? afterIcon(ic) / 1000 : 0; });
			if (c.every(x => x >= 5 && x <= 100)) { cost = c; }
		});
		const text = doc.body ? doc.body.textContent.replace(/\s+/g, ' ') : '';
		const miss = text.match(/brakuje jeszcze:?\s*(\d+)\s*złot/i);
		const lim = text.match(/Obecny limit szlachciców:?\s*(\d+)/i);
		return { cost: cost, missing: miss ? +miss[1] : null, limit: lim ? +lim[1] : null };
	}

	// tryb spokojny: każda trasa wiezie tyle, żeby mennice dostały surowce na S.coinsPerDay monet na dobę
	// (nie mniej niż produkcja wiosek za trasą - żeby nic się w nich nie przelewało); paczka 1 tys., rzadsze powtarzanie
	function calmPlan(plan, sinks) {
		const prodDayK = prodPerMinute() * 1440 * 3 / 1000;
		const kids = new Map();
		plan.forEach(p => { if (!kids.has(p.to)) { kids.set(p.to, []); } kids.get(p.to).push(p); });
		const sub = p => 1 + (kids.get(p.v) || []).reduce((a, c) => a + sub(c), 0);
		const weight = p => p.F + prodDayK * sub(p);
		const sinkW = sinks.map(t => (kids.get(t) || []).reduce((a, p) => a + weight(p), 0));
		const totW = sinkW.reduce((a, b) => a + b, 0) || 1;
		const sinkOf = p => { let x = p, h = 0; while (x && !x.isSink && h < 10) { const to = x.to; x = plan.find(q => q.v === to); h++; } return x ? x.to : null; };
		const turn = turnMinutes();
		plan.forEach(p => {
			const si = sinks.indexOf(sinkOf(p));
			if (si < 0) { return; }
			const costK = coinCostOf(sinks[si]).reduce((a, b) => a + b, 0);
			const Rs = S.coinsPerDay * (sinkW[si] / totW) * costK / 1440;		// tys./min do tej mennicy
			let rate = Rs * weight(p) / (sinkW[si] || 1);
			rate = Math.max(rate, prodDayK * sub(p) / 1440);					// co najmniej produkcja wiosek za trasą
			rate = Math.min(rate, p.v.merchants / Math.max(2 * p.d * S.minutesPerField, turn));	// i nie więcej niż kupcy uciągną
			let per = S.minPerRes, every = 3 * per / Math.max(rate, 1e-6);
			if (every < turn) { per = Math.min(S.maxPerRes, Math.max(1, Math.ceil(rate * turn / 3))); every = turn; }
			p.pack = [per, per, per];
			p.every = Math.min(23 * 60 + 59, Math.max(intervalMinutes(), Math.round(every)));
			p.rate = 3 * per / p.every;
		});
		// ile monet na dobę naprawdę dojedzie
		return sinks.map(t => {
			const costK = coinCostOf(t).reduce((a, b) => a + b, 0);
			return Math.round(plan.filter(p => p.to === t).reduce((a, p) => a + (p.rate || 0), 0) * 1440 / costK);
		});
	}

	// ================= WOLNE ZSYŁANIE Z PRODUKCJI =================
	// produkcja kopalni: 30 * 1,163118^(poziom-1) na godz. (poziom 30 = 2400), razy prędkość świata i bonusy -
	// ten mnożnik bierzemy z bieżącej wioski (game_data: produkcja i poziomy kopalń)
	const mineBase = l => (l > 0 ? 30 * Math.pow(1.163118, l - 1) : 5);
	function prodFactors() {
		const gv = (typeof game_data !== 'undefined' && game_data.village) || {};
		const b = gv.buildings || {};
		return ['wood', 'stone', 'iron'].map(k => {
			const ph = Number(gv[k + '_prod']) * 3600, l = Number(b[k]);
			return ph > 0 && l >= 0 ? ph / mineBase(l) : null;
		});
	}
	// poziomy tartaku / cegielni / huty wszystkich wiosek z przeglądu Budynki
	let mineLevels = null;
	async function loadMines() {
		const html = await $.get('/game.php?screen=overview_villages&mode=buildings&group=0&page=-1' + sitter);
		if (homeGroup !== '0') { try { await $.get('/game.php?screen=am_market&group=' + homeGroup + sitter); } catch (e) { /* ignore */ } }
		const doc = new DOMParser().parseFromString(html, 'text/html');
		const tbl = doc.querySelector('#buildings_table') || [...doc.querySelectorAll('table')].find(t => t.querySelector('img[src*="buildings/wood"]'));
		if (!tbl) { return null; }
		const head = [...tbl.querySelectorAll('tr')].find(tr => tr.querySelector('img[src*="buildings/"]'));
		if (!head) { return null; }
		const col = {};
		[...head.children].forEach((th, i) => { const im = th.querySelector('img[src*="buildings/"]'); const m = im && im.getAttribute('src').match(/buildings\/(?:\w+\/)?([a-z_]+)\d*\.(?:png|webp|gif)/); if (m && !(m[1] in col)) { col[m[1]] = i; } });
		if (!('wood' in col)) { return null; }
		const out = {};
		[...tbl.querySelectorAll('tr')].forEach(tr => {
			const c = coordOf(tr.textContent);
			if (!c || tr === head) { return; }
			const cells = [...tr.children];
			out[c] = ['wood', 'stone', 'iron'].map(k => num(cells[col[k]] && cells[col[k]].textContent));
		});
		return Object.keys(out).length ? out : null;
	}
	function prodPerHour(v) {
		const f = prodFactors();
		const avgF = f.filter(Boolean).reduce((a, b) => a + b, 0) / (f.filter(Boolean).length || 1);
		const lv = mineLevels && mineLevels[v.coords];
		if (lv) { return lv.map((l, k) => mineBase(l) * (f[k] || avgF || 1)); }
		const fb = prodPerMinute() * 60;			// brak poziomów - jak bieżąca wioska
		return [fb, fb, fb];
	}
	const isDeveloped = v => v.pop && v.pop[1] >= S.devPopMax && v.pop[0] >= v.pop[1] * S.devPopFill / 100 && (v.points || 0) >= S.devPoints;
	// każda wioska co godzinę prosto do najbliższej mennicy: część swojej godzinnej produkcji (rozwinięta - więcej)
	function prodPlan(nodes, sinks) {
		return nodes.map(v => {
			const to = sinks.slice().sort((a, b) => dist(v, a) - dist(v, b))[0];
			const dev = isDeveloped(v);
			const share = (dev ? S.devShare : S.prodShare) / 100;
			const ph = prodPerHour(v);
			const pack = ph.map(x => Math.floor(x * share / 100) / 10);		// tys., co 100 szt.
			return { v: v, to: to, isSink: true, d: dist(v, to), F: Math.round(pack.reduce((a, b) => a + b, 0) * 10) / 10, h: 0, pack: pack, every: 60, dev: dev, share: share, ph: ph };
		}).filter(p => p.v.merchants > 0 && p.pack.some(x => x > 0));
	}

	// ================= SYMULACJA I OCHRONA PRZED PRZELANIEM =================
	function prodPerMinute() {
		if (S.prodPerHour > 0) { return S.prodPerHour * 1000 / 60; }
		const gv = (typeof game_data !== 'undefined' && game_data.village) || {};
		const ps = [gv.wood_prod, gv.stone_prod, gv.iron_prod].map(Number).filter(x => x > 0);
		return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length * 60 : 0;
	}

	// minuta po minucie: kupcy (zajęci wracają), surowce w wioskach, dostawy co turę, bicie monet w celach, pojemność spichlerzy.
	// routes: [{ s, t, pack:[d,g,ż] tys. }]. Zwraca stany, przelania (tylko z dostaw) i monety.
	function simulate(routes, villages, sinks, minutes) {
		const turn = turnMinutes(), mpf = S.minutesPerField, prod = prodPerMinute();
		const N = minutes + 1;
		const st = new Map();
		villages.forEach(v => st.set(v, { r: v.res.slice(), cap: v.cap || 400000, busy: Math.max(0, (v.merchants || 0) - (v.freeMerchants || 0)), ret: new Float64Array(N + 1), peak: v.res.slice(), lost: [0, 0, 0], fullAt: [null, null, null] }));
		// kupcy w drodze na starcie wracają równomiernie w czasie jednego kursu
		villages.forEach(v => {
			const x = st.get(v), rt = routes.find(r => r.s === v);
			const T = Math.max(1, Math.round(rt ? 2 * dist(v, rt.t) * mpf : 60));
			for (let j = 0; j < T && j < N; j++) { x.ret[j] += x.busy / T; }
		});
		const arr = Array.from({ length: N + 1 }, () => []);
		const coins = sinks.map(() => 0);
		routes.forEach(r => { r.sent = [0, 0, 0]; r.trip = 2 * dist(r.s, r.t) * mpf; r.need = Math.ceil(r.pack[0] + r.pack[1] + r.pack[2] - 1e-9); });
		for (let m = 0; m < N; m++) {
			st.forEach(x => { x.busy = Math.max(0, x.busy - x.ret[m]); });
			arr[m].forEach(a => {
				const x = st.get(a.t);
				for (let k = 0; k < 3; k++) {
					x.r[k] += a.res[k];
					if (x.r[k] > x.cap) { x.lost[k] += x.r[k] - x.cap; x.r[k] = x.cap; if (x.fullAt[k] === null) { x.fullAt[k] = m; } }
					if (x.r[k] > x.peak[k]) { x.peak[k] = x.r[k]; }
				}
			});
			if (prod) { st.forEach(x => { for (let k = 0; k < 3; k++) { x.r[k] = Math.min(x.cap, x.r[k] + prod); } }); }
			sinks.forEach((v, i) => {
				const x = st.get(v);
				if (x.exAt === undefined && ratioDiff(x.r).filter(d => d > 0).reduce((a, b) => a + b, 0) >= S.minExchange) { x.exAt = m; }
				const cc = coinCostOf(v);
				const n = Math.floor(Math.min(x.r[0] / (cc[0] * 1000), x.r[1] / (cc[1] * 1000), x.r[2] / (cc[2] * 1000)));
				if (n > 0) { for (let k = 0; k < 3; k++) { x.r[k] -= n * cc[k] * 1000; } coins[i] += n; }
			});
			for (const r of routes) {
				if (!r.need) { continue; }
				if (m < (r.nextAt || 0)) { continue; }			// każda trasa ma swoje powtarzanie (tryb spokojny: rzadziej)
				r.nextAt = m + Math.max(turn, r.every || 0);
				const x = st.get(r.s);
				// wspólna dostawa = jedna paczka D+G+Ż; osobne = każdy surowiec rusza sam
				const parts = S.splitRes ? [0, 1, 2].filter(k => r.pack[k] > 0).map(k => { const q = [0, 0, 0]; q[k] = r.pack[k]; return q; }) : [r.pack];
				for (const q of parts) {
					const need = Math.ceil(q[0] + q[1] + q[2] - 1e-9);
					if ((r.s.merchants || 0) - x.busy < need) { continue; }
					if (q.some((p, k) => x.r[k] < p * 1000)) { continue; }
					for (let k = 0; k < 3; k++) { x.r[k] -= q[k] * 1000; r.sent[k] += q[k] * 1000; }
					x.busy += need;
					const back = Math.min(N, m + Math.max(1, Math.round(r.trip)));
					x.ret[back] += need;
					const at = m + Math.max(1, Math.round(r.trip / 2));
					if (at < N) { arr[at].push({ t: r.t, res: q.map(p => p * 1000) }); }
				}
			}
		}
		return { st: st, coins: coins };
	}

	// zmniejsza paczki tras, które przelewają spichlerz odbiorcy (mennicy albo pośrednika): po 1 tys. danego surowca,
	// najpierw trasa, która tego surowca najwięcej dowozi, a nadawca ma u siebie miejsce
	function protect(plan, villages, sinks) {
		const minutes = Math.round(S.protectHours * 60);
		const routes = plan.map(p => ({ p: p, s: p.v, t: p.to, pack: p.pack.slice(), orig: p.pack.slice(), every: p.every }));
		const before = simulate(routes.map(r => ({ s: r.s, t: r.t, pack: r.orig, every: r.every })), villages, sinks, minutes);
		let cur = simulate(routes, villages, sinks, minutes);
		const blocked = new Set();
		for (let it = 0; it < 80; it++) {
			let worst = null;
			cur.st.forEach((x, v) => x.lost.forEach((l, k) => {
				if (l >= 1000 && !blocked.has(v.coords + k) && (!worst || l > worst.l)) { worst = { v: v, k: k, l: l }; }
			}));
			if (!worst) { break; }
			const k = worst.k;
			const cand = routes.filter(r => r.t === worst.v && r.pack[k] > 0 && r.sent[k] > 0).sort((a, b) => {
				const roomA = cur.st.get(a.s).peak[k] < a.s.cap * 0.9 ? 1 : 0, roomB = cur.st.get(b.s).peak[k] < b.s.cap * 0.9 ? 1 : 0;
				return roomB - roomA || b.sent[k] - a.sent[k];
			});
			if (!cand.length) { blocked.add(worst.v.coords + k); continue; }
			cand[0].pack[k] = Math.max(0, Math.round((cand[0].pack[k] - 1) * 10) / 10);
			cur = simulate(routes, villages, sinks, minutes);
		}
		const changes = routes.filter(r => r.pack.some((x, k) => x !== r.orig[k]));
		routes.forEach(r => { r.p.pack = r.pack; });
		return { before: before, after: cur, changes: changes, minutes: minutes };
	}

	// ile wymienić w mennicy, żeby surowce były w proporcji monety
	function exchangeAdvice(v) {
		const c = S.coinCost, tot = v.res[0] + v.res[1] + v.res[2];
		const n = tot / (c[0] + c[1] + c[2]);
		const diff = v.res.map((x, k) => Math.round((x - c[k] * n) / 1000));
		const names = ['drewna', 'gliny', 'żelaza'];
		const give = diff.map((d, k) => (d > 5 ? d + 'k ' + names[k] : '')).filter(Boolean);
		const take = diff.map((d, k) => (d < -5 ? -d + 'k ' + names[k] : '')).filter(Boolean);
		return give.length && take.length ? 'oddaj ' + give.join(' i ') + ' → weź ' + take.join(' i ') : 'proporcja w porządku';
	}

	// ile oddać / wziąć, żeby wioska miała surowce w proporcji monety (tys., + = nadmiar)
	function ratioDiff(res) {
		const c = S.coinCost, tot = res[0] + res[1] + res[2];
		const n = tot / (c[0] + c[1] + c[2]);
		return res.map((x, k) => Math.round((x - c[k] * n) / 1000));
	}

	// gdzie i na co wymieniać: dla każdej mennicy jej grupa (wioski, które do niej spływają) -
	// najpierw wioski, które stoją z braku surowca albo mają największy nadmiar jednego (jedna wymiana = dużo surowca)
	function exchangeReport(plan, sinks, sim) {
		const RN = ['drewno', 'glina', 'żelazo'], RG = ['drewna', 'gliny', 'żelaza'];
		const sinkOf = p => { let x = p, h = 0; while (x && !x.isSink && h < 10) { const to = x.to; x = plan.find(q => q.v === to); h++; } return x ? x.to : null; };
		const url = v => '/game.php?village=' + v.id + '&screen=market&mode=exchange' + sitter;
		const clock = m => { const d = new Date(Date.now() + m * 60000); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };
		const MIN = S.minExchange;
		let h = `<div class="vis" style="margin-top:8px;padding:6px"><b>Wymiana - gdzie i na co</b> <span class="grey">(cel: proporcja monety ${S.coinCost.join(':')}; tys. surowca; jedna wymiana opłaca się od ${MIN}k)</span>`;
		sinks.forEach(sink => {
			const members = plan.filter(p => sinkOf(p) === sink).map(p => p.v).concat([sink]);
			const tot = [0, 1, 2].map(k => members.reduce((a, v) => a + v.res[k], 0));
			const sum = tot[0] + tot[1] + tot[2];
			const cc = coinCostOf(sink);
			const now = Math.floor(Math.min(...tot.map((x, k) => x / (cc[k] * 1000))));
			const best = Math.floor(sum / ((cc[0] + cc[1] + cc[2]) * 1000));
			const gd = ratioDiff(tot);
			h += `<p style="margin:6px 0 2px 0"><b>${esc(sink.name)}</b> - w grupie ${tot.map(x => Math.round(x / 1000) + 'k').join(' / ')}: bez wymiany ~<b>${now}</b> monet, po wymianie ~<b>${best}</b>. ` +
				(best - now >= 1 ? `Brakuje: ${gd.map((d, k) => (d < -5 ? -d + 'k ' + RG[k] : '')).filter(Boolean).join(', ')}; nadmiar: ${gd.map((d, k) => (d > 5 ? d + 'k ' + RG[k] : '')).filter(Boolean).join(', ')}.` : 'Proporcja w porządku.') + '</p>';
			if (best - now < 1) { return; }
			const all = members.map(v => {
				const d = ratioDiff(v.res);
				const amount = d.filter(x => x > 0).reduce((a, b) => a + b, 0);
				const p = plan.find(q => q.v === v);
				const stuck = p ? [0, 1, 2].filter(k => p.pack[k] > 0 && v.res[k] < p.pack[k] * 1000) : [];
				return { v: v, d: d, amount: amount, stuck: stuck, isSink: v === sink };
			});
			const rows = all.filter(r => r.amount >= MIN).sort((a, b) => b.isSink - a.isSink || b.amount - a.amount).slice(0, 12);
			// mennica: teraz albo kiedy uzbiera się opłacalna porcja
			const sr = all.find(r => r.isSink);
			const x = sim && sim.st.get(sink);
			if (sr && sr.amount < MIN) {
				h += `<p style="margin:2px 0">${esc(sink.name)}: teraz tylko ${sr.amount}k nadmiaru - ` + (x && x.exAt !== undefined ? `opłacalna porcja (${MIN}k) uzbiera się ok. <b>${clock(x.exAt)}</b> (wg symulacji)` : `w symulacji nie uzbiera się ${MIN}k`) + '.</p>';
			}
			// rozproszony nadmiar: po trochu w wielu wioskach - lepiej zwieźć do mennicy i wymienić tam hurtem
			const small = all.filter(r => !r.isSink && r.amount >= 20 && r.amount < MIN);
			if (small.length) {
				const sm = small.reduce((a, r) => a + r.amount, 0);
				const stuckN = small.filter(r => r.stuck.length).length;
				h += `<p style="margin:2px 0" class="grey">W ${small.length} wioskach jest po trochu nadmiaru (razem ${sm}k, ${stuckN} z nich stoi) - za mało na osobną wymianę w każdej.` +
					(S.splitRes ? ' Przy osobnych dostawach i tak zjedzie do mennicy - wymieniaj tam hurtem.' : ' Zaznacz „osobna dostawa na każdy surowiec”: nadmiar zjedzie do mennicy i wymienisz go tam hurtem (po ' + MIN + 'k+).') + '</p>';
			}
			if (!rows.length) { return; }
			h += `<table class="vis" style="width:100%"><tr><th>Gdzie</th><th>Oddaj</th><th>Weź</th><th>Po wymianie (D/G/Ż)</th><th>Uwagi</th></tr>` + rows.map(r => {
				const after = r.v.res.map((x, k) => Math.round(x / 1000 - r.d[k]));
				return `<tr class="row_b"><td><a href="${url(r.v)}">${esc(r.v.name)}</a></td>` +
					`<td>${r.d.map((x, k) => (x > 0 ? x + 'k ' + RG[k] : '')).filter(Boolean).join(', ')}</td>` +
					`<td><b>${r.d.map((x, k) => (x < 0 ? -x + 'k ' + RG[k] : '')).filter(Boolean).join(', ')}</b></td>` +
					`<td>${after.join(' / ')}</td>` +
					`<td>${r.isSink ? 'mennica - bije od razu' : r.stuck.length ? '<span style="color:#a00">dostawa stoi - brak ' + r.stuck.map(k => RG[k]).join(', ') + '</span>' : 'potem równe paczki'}</td></tr>`;
			}).join('') + '</table>';
		});
		return h + `<span class="grey">Nazwa wioski otwiera jej rynek. Pokazane są tylko wymiany od ${MIN}k - próg zmienisz w panelu.</span></div>`;
	}

	// trasy założone przez ten skrypt (żeby rzadkie trasy trybu spokojnego nie były brane za zaopatrzenie innych wiosek)
	const OWNKEY = NS + '_own_' + game_data.world;
	const ownPairs = () => { try { return new Set(JSON.parse(localStorage.getItem(OWNKEY) || '[]')); } catch (e) { return new Set(); } };
	const isFunnel = (r, own) => r.minutes <= S.replaceInterval || own.has(r.start + '>' + r.target);

	// ================= PANEL =================
	let state = null;

	function panel() {
		const box = $(`<div id="${NS}" class="vis" style="margin:0 0 12px 0;padding:6px">
			<h3 style="margin:0 0 6px 0">Dostawy pod bicie monet - drzewo tras</h3>
			<table class="vis" style="width:100%">
				<tr><td style="width:220px">Cele - wybierz z grupy</td><td><select id="${NS}_tg"><option value="${esc(S.targetGroup)}">wczytuję grupy…</option></select>
					<div id="${NS}_tl" style="margin-top:4px;max-height:160px;overflow:auto"></div></td></tr>
				<tr><td>Cele (współrzędne)</td><td><input id="${NS}_t" size="30" value="${esc(S.targets)}"> <span class="grey">zaznaczone wyżej; można też wpisać ręcznie po przecinku</span></td></tr>
				<tr><td>Wysyłają wioski z grupy</td><td><select id="${NS}_fg"><option value="${esc(S.fromGroup)}">wczytuję grupy…</option></select></td></tr>
				<tr><td>Powtarzanie</td><td><input id="${NS}_i" size="5" value="${esc(S.interval)}"> <span class="grey">jak w Menedżerze, 00:01 = co minutę</span></td></tr>
				<tr><td>Menedżer realnie wysyła co</td><td><input id="${NS}_re" size="3" value="${S.realEvery || ''}" placeholder="auto"> min <span class="grey">puste = skrypt oszacuje z zajętych kupców (zwykle ~2 min, mimo ustawionego 00:01)</span></td></tr>
				<tr><td>Pomiń wioski</td><td><input id="${NS}_x" size="24" value="${esc(S.exclude)}"> <span class="grey">współrzędne po przecinku</span> · dalej niż <input id="${NS}_md" size="2" value="${S.maxDist}"> pól od celu pomijaj</td></tr>
				<tr><td>Przystanki / paczka</td><td>najwyżej <input id="${NS}_hops" size="2" value="${S.maxHops}"> przystanki, paczka min <input id="${NS}_minp" size="2" value="${S.minPerRes}"> max <input id="${NS}_max" size="3" value="${S.maxPerRes}"> tys. jednego surowca na turę</td></tr>
				<tr><td>Ochrona przed przelaniem</td><td><label><input type="checkbox" id="${NS}_prot" ${S.protect ? 'checked' : ''}> licz na</label> <input id="${NS}_ph" size="2" value="${S.protectHours}"> h naprzód <span class="grey">(np. na noc) - zmniejsza paczki, które przelałyby spichlerz mennicy albo pośrednika</span></td></tr>
				<tr><td>Wolne zsyłanie z produkcji</td><td><label><input type="checkbox" id="${NS}_pm" ${S.prodMode ? 'checked' : ''}> co godzinę prosto do najbliższej mennicy</label> <input id="${NS}_ps" size="3" value="${S.prodShare}">% produkcji wioski, rozwinięta <input id="${NS}_ds" size="3" value="${S.devShare}">%<br><span class="grey">rozwinięta = zagroda ≥ <input id="${NS}_dpm" size="5" value="${S.devPopMax}"> miejsc, zajęta ≥ <input id="${NS}_dpf" size="2" value="${S.devPopFill}">%, wioska ≥ <input id="${NS}_dp" size="5" value="${S.devPoints}"> pkt</span></td></tr>
				<tr><td>Tryb spokojny</td><td><label><input type="checkbox" id="${NS}_calm" ${S.calm ? 'checked' : ''}> zamiast pełnych obrotów: surowce na</label> <input id="${NS}_cpd" size="4" value="${S.coinsPerDay}"> monet na dobę <span class="grey">(1 szlachcic dziennie = tyle monet, ile wynosi następny limit szlachciców, np. 127)</span></td></tr>
				<tr><td>Wymiana opłaca się od</td><td><input id="${NS}_mx" size="4" value="${S.minExchange}"> tys. surowca naraz <span class="grey">(np. 10 PP za wymianę u handlarza)</span></td></tr>
				<tr><td>Rodzaj dostawy</td><td><label><input type="checkbox" id="${NS}_split" ${S.splitRes ? 'checked' : ''}> osobna dostawa na każdy surowiec</label> <span class="grey">(odznaczone = jedna dostawa drewno + glina + żelazo razem, np. 1000/1000/1000)</span></td></tr>
			</table>
			<div style="margin:6px 0"><input type="button" class="btn" id="${NS}_calc" value="Policz trasy"></div>
			<div id="${NS}_out"></div>
		</div>`);
		const host = $('h3').filter(function () { return /Utwórz harmonogram dostaw/.test($(this).text()); }).first();
		if (host.length) { host.before(box); } else { $('#content_value').prepend(box); }
		$('#' + NS + '_calc').on('click', () => calc().catch(e => { console.error(e); msg.err('Dostawy: ' + (e.message || e)); }));
		$('#' + NS + '_tg').on('change', function () { S.targetGroup = this.value; saveCfg(); targetList().catch(er => msg.err('Dostawy: ' + (er.message || er))); });
		$('#' + NS + '_fg').on('change', function () { S.fromGroup = this.value; saveCfg(); if (state) { state.excluded = null; } });
		$('#' + NS + '_t').on('change', () => { S.targets = $('#' + NS + '_t').val().trim(); saveCfg(); });
		// grupy z menu na tej stronie - bez wczytywania czegokolwiek przy otwarciu strony
		groups = parseGroups($(document));
		const opts = groups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
		$('#' + NS + '_tg').html(opts).val(groups.some(g => g.id === S.targetGroup) ? S.targetGroup : '0');
		$('#' + NS + '_fg').html(opts).val(groups.some(g => g.id === S.fromGroup) ? S.fromGroup : '0');
		$('#' + NS + '_tl').html(`<a href="#" id="${NS}_tshow">pokaż wioski z tej grupy</a>`);
		$('#' + NS + '_tshow').on('click', e => { e.preventDefault(); targetList().catch(er => msg.err('Dostawy: ' + (er.message || er))); });
	}

	const targetCoords = () => String(S.targets).split(/[,;\s]+/).map(coordOf).filter(Boolean);
	// lista wiosek z wybranej grupy do zaznaczenia jako cele (kilka naraz)
	async function targetList() {
		const box = $('#' + NS + '_tl').html('<span class="grey">wczytuję…</span>');
		const list = await loadVillages($('#' + NS + '_tg').val() || '0');
		const sel = targetCoords();
		box.html(list.length ? list.slice().sort((a, b) => a.name.localeCompare(b.name)).map(v =>
			`<label style="white-space:nowrap;margin-right:10px;display:inline-block"><input type="checkbox" class="${NS}_tc" value="${v.coords}" ${sel.indexOf(v.coords) > -1 ? 'checked' : ''}> ${esc(v.name)} <span class="grey">(${v.coords})</span></label>`).join('')
			: '<span class="grey">brak wiosek w tej grupie</span>');
		box.find('.' + NS + '_tc').on('change', function () {
			let t = targetCoords().filter(c => c !== this.value);
			if (this.checked) { t.push(this.value); }
			S.targets = t.join(', ');
			$('#' + NS + '_t').val(S.targets);
			saveCfg();
		});
	}

	async function calc() {
		S.targets = $('#' + NS + '_t').val().trim();
		S.fromGroup = $('#' + NS + '_fg').val() || S.fromGroup;
		S.interval = $('#' + NS + '_i').val().trim();
		S.realEvery = Math.max(0, Number(String($('#' + NS + '_re').val()).replace(',', '.')) || 0);
		const ex0 = S.exclude;
		S.exclude = $('#' + NS + '_x').val().trim();
		S.maxHops = Math.max(1, num($('#' + NS + '_hops').val()));
		S.maxDist = Math.max(1, num($('#' + NS + '_md').val()));
		S.minPerRes = Math.max(1, num($('#' + NS + '_minp').val()));
		S.splitRes = $('#' + NS + '_split').prop('checked');
		S.protect = $('#' + NS + '_prot').prop('checked');
		S.minExchange = Math.max(1, num($('#' + NS + '_mx').val()) || 200);
		S.calm = $('#' + NS + '_calm').prop('checked');
		S.prodMode = $('#' + NS + '_pm').prop('checked');
		S.prodShare = Math.max(1, num($('#' + NS + '_ps').val()) || 50);
		S.devShare = Math.max(1, num($('#' + NS + '_ds').val()) || 100);
		S.devPopMax = num($('#' + NS + '_dpm').val()) || 24000;
		S.devPopFill = num($('#' + NS + '_dpf').val()) || 95;
		S.devPoints = num($('#' + NS + '_dp').val());
		S.coinsPerDay = Math.max(1, num($('#' + NS + '_cpd').val()) || 130);
		S.protectHours = Math.max(1, Math.min(24, Number(String($('#' + NS + '_ph').val()).replace(',', '.')) || 8));
		S.maxPerRes = Math.max(S.minPerRes, num($('#' + NS + '_max').val()));
		if (ex0 !== S.exclude && state) { state.excluded = null; }
		saveCfg();
		const out = $('#' + NS + '_out');
		// lista harmonogramów filtrowana grupą - skrypt nie widziałby części tras do usunięcia
		if (pageGroup() !== '0' && $('form[name=market]').length) {
			out.html('<b>Lista harmonogramów jest filtrowana grupą.</b> Przełączam na „wszystkie” - potem kliknij „Policz trasy” jeszcze raz.');
			const u = new URL(location.href);
			['action', 'h'].forEach(k => u.searchParams.delete(k));
			u.searchParams.set('group', '0');
			setTimeout(() => { location.href = u.toString(); }, 1200);
			return;
		}
		out.html('Wczytuję wioski…');
		const villages = await loadVillages('0');
		const sinkCoords = targetCoords();
		const sinks = sinkCoords.map(c => villages.find(v => v.coords === c)).filter(Boolean);
		if (!sinks.length) { throw 'Zaznacz cel (albo wpisz współrzędne) - nie znaleziono ' + (S.targets || 'żadnego') + ' wśród Twoich wiosek.'; }
		// wysyłają tylko wioski z wybranej grupy (cele nie wysyłają)
		const fromSet = new Set((S.fromGroup && S.fromGroup !== '0' ? await loadVillages(S.fromGroup) : villages).map(v => v.coords));
		const senders = villages.filter(v => fromSet.has(v.coords) && sinks.indexOf(v) < 0);
		let excluded = state && state.excluded ? state.excluded : null;
		if (!excluded) {
			// wioski zaopatrywane innymi harmonogramami (np. nowe wioski) - domy\u015Blnie nie wysy\u0142aj\u0105
			excluded = {};
			S.exclude.split(/[,;\s]+/).map(coordOf).filter(Boolean).forEach(c => { excluded[c] = true; });
			const own = ownPairs();
			readRoutes().filter(r => !isFunnel(r, own) && r.target).forEach(r => { excluded[r.target] = true; });
		}
		// bez kupców nic nie wyśle (a psułaby całe liczenie), za daleko = inne miejsce na mapie
		const far = v => Math.min(...sinks.map(t => dist(v, t))) > S.maxDist;
		const why = v => (excluded[v.coords] ? 'pominięta' : !v.merchants ? 'brak kupców - pominięta' : far(v) ? 'za daleko (> ' + S.maxDist + ' pól) - pominięta' : '');
		const nodes = senders.filter(v => !why(v));
		measured = measureEvery(readRoutes(), villages);
		out.html('Liczę trasy i symulację…');
		await sleep(30);
		const tree = buildTree(nodes, sinks);
		const routes = readRoutes();
		let plan = nodes.map((v, i) => {
			const j = tree.par[i], to = tree.pos(j), isSink = j < 0;
			return { v: v, to: to, isSink: isSink, d: dist(v, to), F: tree.ev.F[i], h: tree.ev.load[i] / 60, pack: packFor(v, to) };
		}).filter(p => p.v.merchants > 0);	// także puste - produkcja na bieżąco
		// Pałac mennic: koszt monety (bonus flagi) i ile brakuje do szlachcica
		for (const t of sinks) {
			try { const m = await readMint(t); if (m.cost) { t.coinCost = m.cost; } if (m.limit) { nobleInfo = m; } } catch (e) { /* zostaje z ustawień */ }
		}
		let calmCoins = null, prodInfo = null;
		if (S.prodMode) {
			try { mineLevels = await loadMines(); } catch (e) { mineLevels = null; }
			plan = prodPlan(nodes, sinks);
			const perH = plan.reduce((a, p) => a + p.pack.reduce((x, y) => x + y, 0), 0);	// tys./h
			const costK = sinks.reduce((a, t) => a + coinCostOf(t).reduce((x, y) => x + y, 0), 0) / sinks.length;
			prodInfo = { dev: plan.filter(p => p.dev).length, n: plan.length, perH: perH, coins: Math.round(perH * 24 / costK), levels: !!mineLevels };
		} else if (S.calm) { calmCoins = calmPlan(plan, sinks); }
		// symulacja na kilka godzin: czy coś się przeleje; z ochroną - od razu poprawione paczki
		const simVillages = villages.filter(v => nodes.indexOf(v) > -1 || sinks.indexOf(v) > -1);
		let prot = null;
		try {
			if (S.protect) { prot = protect(plan, simVillages, sinks); } else {
				const minutes = Math.round(S.protectHours * 60);
				const b = simulate(plan.map(p => ({ s: p.v, t: p.to, pack: p.pack, every: p.every })), simVillages, sinks, minutes);
				prot = { before: b, after: null, changes: [], minutes: minutes };
			}
		} catch (e) { console.error('Dostawy: symulacja', e); }
		state = { villages: villages, sinks: sinks, plan: plan, routes: routes, excluded: excluded };

		const fmt = x => x.toFixed(1).replace('.', ',');
		let html = `<p><b>Czas zesłania całego zapasu:</b> ${fmt(tree.ev.max / 60)} h
			<span class="grey">(gdyby każda wioska wysyłała prosto do celu: ${fmt(tree.direct / 60)} h; zapasy z przeglądu, kupcy na pełnym obrocie)</span><br>
			${nobleInfo ? `Szlachcice: limit ${nobleInfo.limit}, do następnego brakuje <b>${nobleInfo.missing}</b> monet; kolejny będzie kosztował ${nobleInfo.limit + 2} monet.<br>` : ''}
			Koszt monety: ${sinks.map(t => esc(t.name) + ' ' + coinCostOf(t).join('/') + 'k').join(', ')}<br>
			${prodInfo ? `<b>Wolne zsyłanie z produkcji:</b> co godzinę ${prodInfo.n - prodInfo.dev} wiosek po ${S.prodShare}% produkcji, ${prodInfo.dev} rozwiniętych po ${S.devShare}% → do mennic ok. <b>${fmt(prodInfo.perH)} tys./h</b> ≈ <b>${prodInfo.coins}</b> monet na dobę. <span class="grey">${prodInfo.levels ? 'Produkcja z poziomów kopalń (przegląd Budynki).' : 'Nie odczytałem poziomów kopalń - przyjęta produkcja bieżącej wioski dla wszystkich.'} Rozwinięta = zagroda ≥ ${S.devPopMax} miejsc zajęta w ≥ ${S.devPopFill}% i ≥ ${S.devPoints} pkt.</span><br>` : ''}
			${calmCoins ? `<b>Tryb spokojny:</b> cel ${S.coinsPerDay} monet/dobę → dojedzie na ok. <b>${calmCoins.reduce((a, b) => a + b, 0)}</b> (${sinks.map((t, i) => esc(t.name) + ' ' + calmCoins[i]).join(', ')}) - co najmniej tyle, ile wioski produkują, żeby się nie przelewały.<br>` : ''}
			Menedżer wysyła realnie co <b>${fmt(turnMinutes())} min</b> <span class="grey">(${S.realEvery > 0 ? 'wpisane ręcznie' : measured && measured.n >= 3 ? 'zmierzone z kupców ' + measured.n + ' tras' : 'za mało danych do pomiaru - przyjęte 2 min'}) - paczki są na tyle większe</span></p>
			<table class="vis" style="width:100%"><tr><th>Uwzgl.</th><th>Wioska</th><th>Wysyła do</th><th>Pola</th><th>Kurs</th><th>Kupcy</th><th>Przepływ</th><th>Paczka (D/G/Ż tys.)</th><th>Co</th></tr>`;
		const sinkNames = sinks.map(v => esc(v.name)).join(', ');
		html = html.replace('<table', `<p class="grey" style="margin:0 0 4px 0">Cele: <b>${sinkNames}</b> · wysyła ${senders.length} wiosek${S.fromGroup !== '0' ? ' z grupy ' + esc((groups.find(g => g.id === S.fromGroup) || {}).name || S.fromGroup) : ''}</p><table`);
		senders.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(v => {
			const p = plan.find(x => x.v === v);
			const ex = !!excluded[v.coords];
			html += `<tr class="row_b"><td><input type="checkbox" class="${NS}_inc" data-c="${v.coords}" ${ex ? '' : 'checked'}></td><td>${esc(v.name)} (${v.coords})</td>` +
				(p ? `<td>${p.isSink ? '<b>' : ''}${esc(p.to.name)}${p.isSink ? ' ★</b>' : ''}</td><td>${fmt(p.d)}</td><td>${Math.round(2 * p.d * S.minutesPerField)} min</td><td>${v.merchants}</td><td>${p.ph ? fmt(p.F) + ' tys./h (' + Math.round(p.share * 100) + '%' + (p.dev ? ' ★' : '') + ')' : p.F + ' tys.'}</td><td>${p.pack.map(x => fmt(x)).join(' / ')}</td><td>${fmtTime(p.every || intervalMinutes())}</td>`
					: `<td colspan="7" class="grey">${why(v) || 'nic do wysłania'}</td>`) + '</tr>';
		});
		html += '</table>';
		// trasy, które teraz nie ruszą: brakuje jednego surowca na paczkę (przy wspólnej dostawie stoi wtedy cała)
		const stuck = [0, 1, 2].map(k => plan.filter(p => p.pack[k] > 0 && p.v.res[k] < p.pack[k] * 1000));
		const stuckN = new Set([].concat(...stuck)).size;
		if (stuckN) {
			html += `<p style="color:#a00;margin:6px 0">Teraz stoi ${stuckN} z ${plan.length} tras - brakuje: ${['drewna', 'gliny', 'żelaza'].map((n, k) => stuck[k].length ? n + ' (' + stuck[k].length + ')' : '').filter(Boolean).join(', ')}.` +
				(S.splitRes ? '' : ' <span class="grey">Przy wspólnej dostawie D+G+Ż wioska bez jednego surowca nie wysyła nic - zaznacz „osobna dostawa na każdy surowiec”, żeby reszta jechała dalej (np. do wymiany w mennicy).</span>') + '</p>';
		}
		if (prot) { html += simReport(prot, sinks); }
		try { html += exchangeReport(plan, sinks, prot && (prot.after || prot.before)); } catch (e) { console.error('Dostawy: wymiana', e); }

		html += `<p style="margin-top:8px"><b>Istniejące harmonogramy do usunięcia</b> <span class="grey">(domyślnie: trasy zwózki - co ≤ ${S.replaceInterval} min albo założone tym skryptem)</span></p><table class="vis" style="width:100%"><tr><th>Usuń</th><th>Start</th><th>Cel</th><th>Paczka</th><th>Co</th></tr>`;
		// takie same jak w planie zostają (kroki dla nich skrypt pominie) - przy poprawkach klikasz tylko zmienione trasy
		const want = {};
		plan.forEach(p => planRes(p).forEach(res => { const key = p.v.coords + '>' + p.to.coords + ':' + res.join(',') + '@' + tmin(fmtTime(p.every || intervalMinutes())); want[key] = (want[key] || 0) + 1; }));
		const own = ownPairs();
		routes.forEach(r => {
			const key = r.start + '>' + r.target + ':' + r.res.join(',') + '@' + tmin(r.time);
			const same = isFunnel(r, own) && want[key] > 0;
			if (same) { want[key]--; }
			const samePair = plan.some(p => p.v.coords === r.start && p.to.coords === r.target);
			const def = !same && ((isFunnel(r, own) && fromSet.has(r.start)) || samePair);	// tylko trasy wiosek, które teraz wysyłają
			html += `<tr class="row_b"><td><input type="checkbox" class="${NS}_del" value="${r.id}" ${def ? 'checked' : ''}></td><td>${esc(r.startName)}</td><td>${esc(r.targetName)}</td><td>${r.res.map(x => x / 1000).join(' / ')}</td><td>${esc(r.time)}</td></tr>`;
		});
		const btnSteps = `<input type="button" class="btn" id="${NS}_apply" value="Przygotuj kroki (klikasz każdy)" style="margin:2px 6px 2px 0">`;
		const btnAll = `<input type="button" class="btn" id="${NS}_all" value="⚡ Zrób wszystko sam${isPhone ? ' (telefon)' : ''}" style="margin:2px 6px 2px 0;${isPhone ? 'font-weight:bold;outline:2px solid #c1a264' : ''}">`;
		html += `</table><div style="margin:8px 0">${isPhone ? btnAll + btnSteps : btnSteps + btnAll}<br><span class="grey" style="font-size:11px">Usuwa zaznaczone i tworzy brakujące harmonogramy (takie same jak w planie zostają). „Zrób wszystko sam” robi to bez klikania, po kolei z przerwą ~0,5–1 s.</span></div><div id="${NS}_log" class="grey"></div>`;
		out.html(html);

		out.find('.' + NS + '_inc').on('change', function () {
			if (this.checked) { delete state.excluded[this.dataset.c]; } else { state.excluded[this.dataset.c] = true; }
			calc().catch(e => msg.err('Dostawy: ' + (e.message || e)));
		});
		$('#' + NS + '_apply').on('click', function () {
			if (this.classList.contains('btn-disabled')) { return; }
			this.classList.add('btn-disabled');
			try { apply(); } catch (e) { console.error(e); msg.err('Dostawy: ' + (e.message || e)); }
		});
		const logEl = () => $('#' + NS + '_log').css({ fontSize: '12px' });
		const preview = () => {
			try {
				const st = buildSteps();
				const nD = st.filter(x => x.t === 'del').reduce((a, x) => a + x.ids.length, 0), nN = st.filter(x => x.t === 'new').length;
				logEl().css('color', st.length ? '' : '#070').html(st.length
					? `Do zrobienia: usunąć <b>${nD}</b>, utworzyć <b>${nN}</b> harmonogramów.`
					: `<b>✔ Wszystkie harmonogramy są już takie jak w planie</b> - nic do zmiany (${readRoutes().length} na liście). Po zmianie ustawień kliknij „Policz trasy” jeszcze raz.`);
				return st;
			} catch (e) { logEl().css('color', '#a00').text('Błąd przy układaniu kroków: ' + (e.message || e)); console.error(e); return null; }
		};
		preview();
		$('#' + NS + '_all').on('click', function () {
			if (this.classList.contains('btn-disabled')) { logEl().css('color', '#a00').text('Już działa albo skończone - kliknij „Policz trasy”, żeby ułożyć od nowa.'); return; }
			const steps = preview();
			if (!steps) { return; }
			if (!steps.length) { msg.ok('Dostawy: nic do zmiany - wszystko jest jak w planie.'); return; }
			const nDel = steps.filter(x => x.t === 'del').reduce((a, x) => a + x.ids.length, 0), nNew = steps.filter(x => x.t === 'new').length;
			$('#' + NS + '_log').text('Usuwam ' + nDel + ' i tworzę ' + nNew + ' harmonogramów…');
			this.classList.add('btn-disabled'); $('#' + NS + '_apply').addClass('btn-disabled');
			runAll(steps).catch(e => { console.error(e); msg.err('Dostawy: ' + (e.message || e)); logEl().css('color', '#a00').text('Błąd: ' + (e.message || e) + ' - wyślij mi zrzut.'); });
		});
	}

	// harmonogramy jednej trasy: jeden D+G+Ż albo osobny na każdy surowiec; same zera = brak harmonogramu
	function planRes(p) {
		if (!S.splitRes) { return p.pack.some(x => x > 0) ? [p.pack.map(x => Math.round(x * 1000))] : []; }
		return [0, 1, 2].filter(k => p.pack[k] > 0).map(k => { const r = [0, 0, 0]; r[k] = Math.round(p.pack[k] * 1000); return r; });
	}

	function simReport(prot, sinks) {
		const clock = m => { const d = new Date(Date.now() + m * 60000); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };
		const K = n => Math.round(n / 1000) + 'k';
		const RN = ['drewno', 'glina', 'żelazo'];
		const lostList = sim => {
			const out = [];
			sim.st.forEach((x, v) => x.lost.forEach((l, k) => { if (l >= 1000) { out.push(`${esc(v.name)}: ${RN[k]} ${K(l)} (pełne od ${clock(x.fullAt[k])})`); } }));
			return out;
		};
		const b = prot.before, a = prot.after;
		const lb = lostList(b), la = a ? lostList(a) : [];
		let h = `<div class="vis" style="margin-top:8px;padding:6px"><b>Symulacja na ${S.protectHours} h (do ${clock(prot.minutes)})</b> <span class="grey">- zapasy teraz, kupcy, produkcja ~${Math.round(prodPerMinute() * 60 / 100) / 10} tys./h, mennica bije od razu</span><br>`;
		h += 'Monety: ' + sinks.map((v, i) => `${esc(v.name)} <b>${b.coins[i]}${a ? ' → ' + a.coins[i] : ''}</b>`).join(', ') + '<br>';
		h += lb.length ? `<span style="color:#a00">Bez zmian przeleje się: ${lb.join('; ')}</span><br>` : 'Nic się nie przeleje.<br>';
		if (a) {
			if (prot.changes.length) {
				h += `<b>Ochrona zmienia ${prot.changes.length} tras</b> (wysyłają mniej, nadmiar zostaje u nich):<table class="vis" style="width:100%"><tr><th>Trasa</th><th>Było</th><th>Teraz</th></tr>` +
					prot.changes.map(r => `<tr class="row_b"><td>${esc(r.s.name)} → ${esc(r.t.name)}</td><td>${r.orig.join(' / ')}</td><td><b>${r.pack.join(' / ')}</b></td></tr>`).join('') + '</table>';
				h += la.length ? `<span style="color:#a00">Nadal się przeleje: ${la.join('; ')}</span><br>` : '<span style="color:#070">Po zmianach nic się nie przeleje.</span><br>';
				h += '<span class="grey">Po tym czasie kliknij „Policz trasy” jeszcze raz - paczki wrócą do pełnych.</span><br>';
			}
		} else if (lb.length) { h += '<span class="grey">Zaznacz „Ochrona przed przelaniem”, a skrypt sam zmniejszy paczki, które to powodują.</span><br>'; }
		return h + '</div>';
	}

	// ================= ZAPIS =================
	function apply() { startQueue(buildSteps()); }

	function buildSteps() {
		const steps = [];
		const del = $('.' + NS + '_del:checked').map(function () { return this.value; }).get();
		if (del.length) { steps.push({ t: 'del', ids: del, label: 'Usuń ' + del.length + ' starych harmonogramów' }); }
		// osobny harmonogram na ka\u017Cdy surowiec: brak jednego surowca nie blokuje pozosta\u0142ych
		// trasy, które zostają (niezaznaczone do usunięcia) i są takie jak w planie - nie twórz ich drugi raz
		const keep = {};
		readRoutes().filter(r => del.indexOf(r.id) < 0).forEach(r => { const key = r.start + '>' + r.target + ':' + r.res.join(',') + '@' + tmin(r.time); keep[key] = (keep[key] || 0) + 1; });
		state.plan.forEach(p => planRes(p).forEach(res => {
			const time = fmtTime(p.every || intervalMinutes());
			const key = p.v.coords + '>' + p.to.coords + ':' + res.join(',') + '@' + tmin(time);
			if (keep[key] > 0) { keep[key]--; return; }
			steps.push({ t: 'new', label: p.v.name + ' \u2192 ' + p.to.name + ': ' + res.map(x => x / 1000).join(' / ') + ' tys. (D/G/\u017B) co ' + time,
				d: { sx: p.v.x, sy: p.v.y, tx: p.to.x, ty: p.to.y, res: res, time: time } });
		}));
		try {
			const own = ownPairs();
			state.plan.forEach(p => own.add(p.v.coords + '>' + p.to.coords));
			localStorage.setItem(OWNKEY, JSON.stringify([...own]));
		} catch (e) { /* ignore */ }
		return steps;
	}

	// =====================================================================
	// TRYB „SAM WYSYŁA” (wygodny na telefonie): jedno kliknięcie - skrypt sam kasuje i tworzy harmonogramy,
	// po kolei z przerwą, sprawdzając po każdym, czy gra go zapisała. Uwaga: regulamin gry - jedno kliknięcie = jedna akcja.
	// =====================================================================
	const isPhone = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent || '');
	let batchStop = false;
	async function postForm(action, body) {
		const r = await fetch(action, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
		return new DOMParser().parseFromString(await r.text(), 'text/html');
	}
	function newRouteBody(f, d) {
		const set = (n, v) => { const el = f.elements[n]; if (el) { el.value = v; } };
		set('start_x', d.sx); set('start_y', d.sy); set('target_x', d.tx); set('target_y', d.ty);
		['start_input_target', 'target_input_target'].forEach((n, i) => { const el = f.elements[n]; if (el) { el.value = i ? d.tx + '|' + d.ty : d.sx + '|' + d.sy; } });
		set('resources[wood]', d.res[0] || ''); set('resources[stone]', d.res[1] || ''); set('resources[iron]', d.res[2] || '');
		for (let k = 1; k <= 7; k++) { const el = f.elements['days[' + k + ']']; if (el) { el.checked = true; } }
		if (f.elements.is_recurring) { f.elements.is_recurring.checked = true; }
		if (f.elements.is_arrival_time) { f.elements.is_arrival_time.checked = false; }
		set('time', d.time);
		return new URLSearchParams(new FormData(f));
	}
	async function runAll(steps) {
		const log = $('#' + NS + '_log').css({ color: '', fontSize: '12px' });
		const f = document.forms.market;
		const delForm = $('input[name="trading_routes[]"]').first().closest('form')[0];
		if (!f) { msg.err('Nie znalazłem formularza „Utwórz harmonogram dostaw”.'); return; }
		batchStop = false;
		let routes = readRoutes(), done = 0, skipped = 0;
		const bar = $(`<div id="${NS}_qbar" class="info_box" style="margin:0 0 10px 0;padding:8px;font-size:13px"><b>Dostawy - robię sam:</b> <span id="${NS}_bprog">0 / ${steps.length}</span> <a href="#" id="${NS}_bstop" style="margin-left:10px">zatrzymaj</a><div id="${NS}_bnow" class="grey"></div></div>`);
		$('#content_value').prepend(bar);
		$('#' + NS + '_bstop').on('click', e => { e.preventDefault(); batchStop = true; });
		for (let i = 0; i < steps.length; i++) {
			if (batchStop) { msg.err('Dostawy: zatrzymane po ' + done + ' krokach.'); break; }
			const st = steps[i];
			$('#' + NS + '_bprog').text((i + 1) + ' / ' + steps.length);
			$('#' + NS + '_bnow').text(st.label);
			if (st.t === 'new' && verify(st, routes)) { skipped++; continue; }		// już jest - nie twórz drugiego
			let ok = false, err = '';
			for (let attempt = 0; attempt < 2 && !ok; attempt++) {
				try {
					let doc;
					if (st.t === 'del') {
						const ids = st.ids.filter(id => routes.some(r => r.id === id));
						if (!ids.length) { ok = true; break; }
						const body = new URLSearchParams();
						ids.forEach(id => body.append('trading_routes[]', id));
						doc = await postForm(delForm.action, body);
					} else {
						doc = await postForm(f.action, newRouteBody(f, st.d));
					}
					const fresh = readRoutes(doc);
					if (fresh.length || doc.querySelector('form[name=market]')) { routes = fresh; }
					ok = verify(st, routes);
					if (!ok) { err = $(doc).find('.error_box').text().replace(/\s+/g, ' ').trim(); await sleep(1500); }
				} catch (e) { err = e.message || String(e); await sleep(1500); }
			}
			if (!ok) {
				log.css('color', '#a00').text('Zatrzymane na kroku ' + (i + 1) + ': ' + st.label + (err ? ' - gra: ' + err : ' - gra nie zapisała.') + ' Kliknij „Policz trasy” jeszcze raz.');
				msg.err('Dostawy: krok się nie udał - zatrzymuję.');
				break;
			}
			done++;
			await sleep(450 + Math.random() * 500);			// spokojnie, jak człowiek
		}
		$('#' + NS + '_bnow').text('Gotowe: ' + done + ' kroków' + (skipped ? ', pominięte (już były): ' + skipped : '') + '. Odświeżam stronę…');
		if (!batchStop) { msg.ok('Dostawy: zrobione ' + done + ' kroków.', 6000); setTimeout(() => location.reload(), 1500); }
	}

	// =====================================================================
	// KOLEJKA KROKÓW: skrypt wypełnia formularz, Ty klikasz „Utwórz” / „Skasuj”
	// =====================================================================
	const QKEY = NS + '_queue_' + game_data.world;
	const loadQ = () => { try { return JSON.parse(localStorage.getItem(QKEY) || 'null'); } catch (e) { return null; } };
	const saveQ = q => { try { if (q && (q.steps.length || q.pending)) { localStorage.setItem(QKEY, JSON.stringify(q)); } else { localStorage.removeItem(QKEY); } } catch (e) { /* ignore */ } };

	const QVER = 3;	// wersja listy kroków - stara lista (np. paczki 1/1/1 sprzed aktualizacji) jest odrzucana

	function startQueue(steps) {
		if (!steps.length) { msg.err('Nic do ustawienia.'); return; }
		saveQ({ v: QVER, steps: steps, total: steps.length, done: 0, pending: null });
		runQueue();
	}

	// czy krok się udał (po przeładowaniu strony)
	// czas porównujemy jako minuty (gra może pisać 0:12 albo 00:12)
	const tmin = t => { const m = String(t || '').match(/(\d+):(\d+)/); return m ? +m[1] * 60 + +m[2] : null; };
	const sameTime = (a, b) => { const x = tmin(a), y = tmin(b); return x === null || y === null || x === y; };
	function verify(step, routes) {
		routes = routes || readRoutes();
		if (step.t === 'del') { return !routes.some(r => step.ids.indexOf(r.id) > -1); }
		const d = step.d;
		return routes.some(r => r.start === d.sx + '|' + d.sy && r.target === d.tx + '|' + d.ty &&
			r.res.length === 3 && r.res.every((x, k) => x === d.res[k]) && sameTime(r.time, d.time));
	}

	// świeża lista harmonogramów (Safari potrafi pokazać po zapisie starą stronę z pamięci)
	async function fetchRoutes() {
		const u = new URL(location.href);
		['action', 'h', 'mode'].forEach(k => u.searchParams.delete(k));
		u.searchParams.set('screen', 'am_market');
		u.searchParams.set('_', Date.now());
		const html = await $.ajax({ url: u.pathname + u.search, cache: false });
		return readRoutes(new DOMParser().parseFromString(html, 'text/html'));
	}

	// koniec kolejki: gra wpisuje w formularz ostatnią trasę - wyczyść go, żeby kolejny Enter nie zrobił duplikatu
	function finished(q) {
		saveQ(null);
		const f = document.forms.market;
		if (f) {
			['start_x', 'start_y', 'target_x', 'target_y', 'resources[wood]', 'resources[stone]', 'resources[iron]', 'time'].forEach(n => { if (f.elements[n]) { f.elements[n].value = ''; } });
			$(f).off('submit.' + NS).on('submit.' + NS, () => {
				if (f.elements.start_x && !f.elements.start_x.value) { msg.err('Dostawy: formularz jest pusty - kolejka już skończona.'); return false; }
			});
		}
		try { document.activeElement && document.activeElement.blur(); } catch (e) { /* ignore */ }
		msg.ok('Dostawy: wszystkie kroki zrobione (' + q.done + ').', 8000);
		$('#content_value').prepend(`<div id="${NS}_qbar" class="success_box" style="margin:0 0 10px 0;padding:8px">Dostawy: wszystkie kroki zrobione (${q.done}). Formularz wyczyszczony - nic więcej nie klikaj.</div>`);
	}

	async function runQueue() {
		$('#' + NS + '_qbar').remove();
		const q = loadQ();
		if (!q) { return; }
		if (q.v !== QVER) {
			saveQ(null);
			msg.err('Dostawy: usuni\u0119to star\u0105 list\u0119 krok\u00F3w (sprzed aktualizacji skryptu). Kliknij \u201EPolicz trasy\u201D i \u201EPrzygotuj kroki\u201D jeszcze raz.', 10000);
			return;
		}
		// lista harmonogramów filtrowana grupą = skrypt nie widzi wszystkich tras -> przełącz na „wszystkie” (raz)
		if (pageGroup() !== '0' && $('input[name="trading_routes[]"]').length + $('form[name=market]').length) {
			let tries = 0;
			try { tries = Number(sessionStorage.getItem(NS + '_grp') || 0); sessionStorage.setItem(NS + '_grp', tries + 1); } catch (e) { /* ignore */ }
			if (tries < 2) {
				$('#content_value').prepend(`<div id="${NS}_qbar" class="info_box" style="margin:0 0 10px 0;padding:8px">Dostawy: lista harmonogramów jest filtrowana grupą - przełączam na „wszystkie”…</div>`);
				const u = new URL(location.href);
				['action', 'h'].forEach(k => u.searchParams.delete(k));
				u.searchParams.set('group', '0');
				location.href = u.toString();
				return;
			}
		}
		try { sessionStorage.removeItem(NS + '_grp'); } catch (e) { /* ignore */ }
		if (q.pending) {
			let ok = verify(q.pending);
			if (!ok) { try { ok = verify(q.pending, await fetchRoutes()); } catch (e) { /* zostaje nie */ } }
			if (ok || q.pending.t === 'del') {
				if (ok) { q.done++; } else { q.steps.unshift(q.pending); }	// ponowne kasowanie niczego nie psuje
				q.pending = null;
				saveQ(q);
			} else {
				// nie zgaduj - nowy harmonogram tworzony drugi raz to duplikat
				const gameErr = $('.error_box').text().replace(/\s+/g, ' ').trim();
				const pb = $(`<div id="${NS}_qbar" class="error_box" style="margin:0 0 10px 0;padding:8px;font-size:13px">
					<b>Dostawy:</b> nie widzę na liście harmonogramu <b>${esc(q.pending.label)}</b>${gameErr ? '<br>Gra: ' + esc(gameErr) : ''}<br>
					<a href="#" id="${NS}_qre">Utwórz go jeszcze raz</a> · <a href="#" id="${NS}_qok">jest zapisany - dalej</a> · <a href="#" id="${NS}_qstop2">przerwij</a></div>`);
				$('#content_value').prepend(pb);
				$('#' + NS + '_qre').on('click', e => { e.preventDefault(); q.steps.unshift(q.pending); q.pending = null; saveQ(q); runQueue(); });
				$('#' + NS + '_qok').on('click', e => { e.preventDefault(); q.done++; q.pending = null; saveQ(q); runQueue(); });
				$('#' + NS + '_qstop2').on('click', e => { e.preventDefault(); saveQ(null); pb.remove(); msg.ok('Przerwano.'); });
				return;
			}
			if (!q.steps.length) { finished(q); return; }
		}
		let step = q.steps[0];
		// taki harmonogram już jest (np. zapisany wcześniej) - nie twórz drugiego
		while (step && step.t === 'new' && verify(step)) { q.steps.shift(); q.done++; step = q.steps[0]; }
		saveQ(q);
		if (!step) { finished(q); return; }
		// usuwanie: jeśli harmonogramów już nie ma, pomiń krok
		if (step.t === 'del') {
			step.ids = step.ids.filter(id => $('input[name="trading_routes[]"][value="' + id + '"]').length);
			if (!step.ids.length) { q.steps.shift(); q.done++; saveQ(q); return runQueue(); }
		}
		const bar = $(`<div id="${NS}_qbar" class="info_box" style="margin:0 0 10px 0;padding:8px;font-size:13px">
			<b>Dostawy - krok ${q.done + 1} z ${q.total}:</b> ${esc(step.label)}<br>
			<span class="grey">Formularz wypełniony - kliknij podświetlony przycisk <b>${step.t === 'del' ? '„Skasuj”' : '„Utwórz”'}</b>.</span>
			<a href="#" id="${NS}_qskip" style="margin-left:10px">pomiń krok</a> · <a href="#" id="${NS}_qstop">przerwij</a></div>`);
		$('#content_value').prepend(bar);
		$('#' + NS + '_qskip').on('click', e => { e.preventDefault(); q.steps.shift(); q.total--; saveQ(q); runQueue(); });
		$('#' + NS + '_qstop').on('click', e => { e.preventDefault(); saveQ(null); bar.remove(); msg.ok('Przerwano.'); });

		let btn;
		if (step.t === 'del') {
			$('input[name="trading_routes[]"]').each(function () { this.checked = step.ids.indexOf(this.value) > -1; });
			const form = $('input[name="trading_routes[]"]').first().closest('form');
			btn = form.find('input[type=submit]').first();
			let sent = false;
			form.off('submit.' + NS).on('submit.' + NS, () => {
				if (sent) { return false; }			// podwójne kliknięcie
				sent = true; q.steps.shift(); q.pending = step; saveQ(q);
			});
		} else {
			const f = document.forms.market;
			if (!f) { msg.err('Nie znalazłem formularza „Utwórz harmonogram dostaw”.'); return; }
			const d = step.d;
			const set = (n, v) => { const el = f.elements[n]; if (el) { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); } };
			const fill = () => {
			set('start_x', d.sx); set('start_y', d.sy); set('target_x', d.tx); set('target_y', d.ty);
			['start_input_target', 'target_input_target'].forEach((n, i) => { const el = f.elements[n]; if (el) { el.value = i ? d.tx + '|' + d.ty : d.sx + '|' + d.sy; } });
			set('resources[wood]', d.res[0] || ''); set('resources[stone]', d.res[1] || ''); set('resources[iron]', d.res[2] || '');	// puste pole = 0 (jak przy r\u0119cznym wpisaniu)
			for (let k = 1; k <= 7; k++) { const el = f.elements['days[' + k + ']']; if (el && !el.checked) { el.click(); if (!el.checked) { el.checked = true; } } }
			const all = document.getElementById('market_days_select_all'); if (all) { all.checked = true; }
			const rec = f.elements.is_recurring; if (rec && !rec.checked) { rec.click(); if (!rec.checked) { rec.checked = true; } }
			const arr = f.elements.is_arrival_time; if (arr && arr.checked) { arr.click(); arr.checked = false; }
			set('time', d.time);
			};
			fill();
			btn = $(f).find('input[type=submit]').first();
			let sent = false;
			$(f).off('submit.' + NS).on('submit.' + NS, () => {
				if (sent) { return false; }			// podwójne kliknięcie = drugi taki sam harmonogram
				// wartości jeszcze raz tuż przed wysłaniem - nic (gra, przeglądarka) nie podmieni trasy
				const pre = [f.elements.start_x.value, f.elements.start_y.value, f.elements.target_x.value, f.elements.target_y.value].join(',');
				fill();
				if (pre !== [d.sx, d.sy, d.tx, d.ty].join(',')) { console.warn('Dostawy: formularz był zmieniony', pre); }
				sent = true; q.steps.shift(); q.pending = step; saveQ(q);
			});
		}
		if (btn && btn.length) {
			btn.css({ outline: '3px solid #c1a264', 'box-shadow': '0 0 8px #c1a264' });
			try { btn[0].scrollIntoView({ block: 'center' }); } catch (e) { /* stara przegl\u0105darka */ }
			btn[0].focus();
		}
	}

	// =====================================================================
	// ZAOPATRZENIE NOWYCH WIOSEK: ile surowców na godzinę wioska przerobi (budowa + rekrutacja)
	// =====================================================================
	const SUP_DEF = { count: 4, interval: '01:00', buildFactor: 1.0, recruit: 'spear,light', recruitFactor: 1.0 };
	let SS = Object.assign({}, SUP_DEF);
	try { Object.assign(SS, JSON.parse(localStorage.getItem(NS + '_sup_' + game_data.world) || '{}')); } catch (e) { /* ignore */ }
	const saveSup = () => { try { localStorage.setItem(NS + '_sup_' + game_data.world, JSON.stringify(SS)); } catch (e) { /* ignore */ } };
	const secOf = t => { const m = String(t).match(/(\d+):(\d{2}):(\d{2})(?!.*\d+:\d{2}:\d{2})/); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0; };
	const villageUrl = (id, screen) => '/game.php?village=' + id + '&screen=' + screen + sitter;
	let sup = null;

	// dane wioski z jej strony (game_data w <script>)
	function gameDataOf(html) {
		const g = k => { const m = html.match(new RegExp('"' + k + '":([0-9.]+)')); return m ? Number(m[1]) : 0; };
		return { prod: [g('wood_prod'), g('stone_prod'), g('iron_prod')], have: [g('wood'), g('stone'), g('iron')], storage: g('storage_max') };
	}

	// Ratusz: koszt i czas następnego poziomu każdego budynku -> tempo wydawania przy ciągłej budowie
	async function readBuild(v) {
		const html = await $.get(villageUrl(v.id, 'main'));
		const doc = $(new DOMParser().parseFromString(html, 'text/html'));
		const rows = [];
		doc.find('#buildings tr[id^="main_buildrow_"]').each(function () {
			const cost = ['wood', 'stone', 'iron'].map(r => Number($(this).find('td.cost_' + r).attr('data-cost')) || 0);
			const tcell = $(this).children('td').filter(function () { return /^\s*\d+:\d{2}:\d{2}\s*$/.test(this.textContent); }).first();
			const sec = tcell.length ? secOf(tcell.text()) : 0;
			if (sec > 0 && cost.some(c => c > 0)) { rows.push({ b: this.id.replace('main_buildrow_', ''), cost: cost, sec: sec }); }
		});
		const gd = gameDataOf(html);
		if (!rows.length) { return { rate: [0, 0, 0], rows: 0, gd: gd }; }
		// ciągła budowa: średnie tempo = suma kosztów / suma czasów (budynki stawiane po kolei)
		const sumC = [0, 1, 2].map(k => rows.reduce((s, r) => s + r.cost[k], 0));
		const sumT = rows.reduce((s, r) => s + r.sec, 0);
		return { rate: sumC.map(c => c / sumT * 3600), rows: rows.length, gd: gd };
	}

	// koszary/stajnia: koszt i czas 1 jednostki -> tempo przy ciągłej rekrutacji
	async function readRecruit(v, screen, wanted) {
		const html = await $.get(villageUrl(v.id, screen));
		const units = {};
		const re = /id="([a-z]+)_0_cost_(wood|stone|iron|time)"[^>]*>([\s\S]*?)<\/span>/g;
		let m;
		while ((m = re.exec(html))) {
			const u = units[m[1]] = units[m[1]] || {};
			u[m[2]] = m[2] === 'time' ? secOf(m[3]) : num(m[3].replace(/<[^>]+>/g, ''));
		}
		const u = wanted.map(w => units[w]).find(x => x && x.time > 0);
		const name = wanted.find(w => units[w] && units[w].time > 0);
		if (!u) { return { rate: [0, 0, 0], unit: null, found: Object.keys(units) }; }
		return { rate: [u.wood || 0, u.stone || 0, u.iron || 0].map(c => c / u.time * 3600), unit: name };
	}

	function supplyPanel() {
		const box = $(`<div id="${NS}_sup" class="vis" style="margin:0 0 12px 0;padding:6px">
			<h3 style="margin:0 0 6px 0">Zaopatrzenie nowych wiosek (budowa + rekrutacja)</h3>
			<table class="vis" style="width:100%">
				<tr><td style="width:220px">Ile najmniejszych wiosek</td><td><input id="${NS}_sc" size="3" value="${SS.count}"> <span class="grey">wg punktów; potem możesz zaznaczyć inne</span></td></tr>
				<tr><td>Dostawa co</td><td><input id="${NS}_si" size="5" value="${esc(SS.interval)}"> <span class="grey">01:00 = co godzinę</span></td></tr>
				<tr><td>Rekrutacja (jednostki)</td><td><input id="${NS}_sr" size="16" value="${esc(SS.recruit)}"> <span class="grey">koszary/stajnia, np. spear,light; puste = bez rekrutacji</span></td></tr>
				<tr><td>Mnożniki</td><td>budowa ×<input id="${NS}_sbf" size="3" value="${SS.buildFactor}"> rekrutacja ×<input id="${NS}_srf" size="3" value="${SS.recruitFactor}"></td></tr>
			</table>
			<div style="margin:6px 0"><input type="button" class="btn" id="${NS}_scalc" value="Policz zaopatrzenie"></div>
			<div id="${NS}_sout"></div>
		</div>`);
		$('#' + NS).before(box);
		$('#' + NS + '_scalc').on('click', () => supplyCalc(null).catch(e => { console.error(e); msg.err('Zaopatrzenie: ' + (e.message || e)); }));
	}

	async function supplyCalc(chosen) {
		SS.count = Math.max(1, num($('#' + NS + '_sc').val()));
		SS.interval = $('#' + NS + '_si').val().trim();
		SS.recruit = $('#' + NS + '_sr').val().trim();
		SS.buildFactor = Number(String($('#' + NS + '_sbf').val()).replace(',', '.')) || 1;
		SS.recruitFactor = Number(String($('#' + NS + '_srf').val()).replace(',', '.')) || 0;
		saveSup();
		const out = $('#' + NS + '_sout').html('Wczytuję wioski…');
		const villages = await loadVillages();
		const sinks = String(S.targets).split(/[,;\s]+/).map(coordOf).filter(Boolean);
		const sel = chosen || villages.slice().sort((a, b) => a.points - b.points).slice(0, SS.count).map(v => v.coords);
		const wanted = SS.recruit.split(/[,;\s]+/).filter(Boolean);
		const hm = String(SS.interval).match(/^(\d+):(\d+)$/);
		const hours = hm ? Math.max(1 / 60, (+hm[1]) + (+hm[2]) / 60) : 1;

		const rows = [];
		const drain = {};	// ile ju\u017C przypisano ka\u017Cdemu \u017Ar\u00F3d\u0142u (na jedn\u0105 dostaw\u0119)
		for (const v of villages.filter(x => sel.indexOf(x.coords) > -1)) {
			out.html('Czytam ' + esc(v.name) + '…');
			const b = await readBuild(v);
			let rec = [0, 0, 0], recNote = [];
			if (wanted.length && SS.recruitFactor > 0) {
				for (const scr of ['barracks', 'stable']) {
					try {
						const r = await readRecruit(v, scr, wanted);
						if (r.unit) { rec = rec.map((x, k) => x + r.rate[k]); recNote.push(r.unit); }
					} catch (e) { /* brak budynku */ }
					await sleep(200);
				}
			}
			const need = [0, 1, 2].map(k => Math.max(0, b.rate[k] * SS.buildFactor + rec[k] * SS.recruitFactor - b.gd.prod[k] * 3600));
			const pack = need.map(n => n > 0 ? Math.ceil(n * hours / 1000) * 1000 : 0)
				.map(p => b.gd.storage ? Math.min(p, Math.floor(b.gd.storage * 0.5 / 1000) * 1000) : p);
			// źródło: najbliższa wioska spoza nowych i spoza celów, z zapasem i kupcami
			const units = (pack[0] + pack[1] + pack[2]) / 1000;
			// \u017Ar\u00F3d\u0142o: spo\u015Br\u00F3d 4 najbli\u017Cszych wiosek ta, kt\u00F3rej zostanie najwi\u0119cej po dotychczas przypisanych dostawach (r\u00F3wne drenowanie)
			const cand = villages.filter(x => sel.indexOf(x.coords) < 0 && sinks.indexOf(x.coords) < 0 && x.merchants >= units)
				.sort((a, c) => dist(a, v) - dist(c, v)).slice(0, 4);
			const left = x => (x.res[0] + x.res[1] + x.res[2]) - (drain[x.coords] || 0) * 24 / hours;
			const src = cand.sort((a, c) => left(c) - left(a))[0];
			if (src) { drain[src.coords] = (drain[src.coords] || 0) + pack[0] + pack[1] + pack[2]; }
			rows.push({ v: v, b: b, rec: rec, recNote: recNote, need: need, pack: pack, src: src });
			await sleep(200);
		}
		sup = { rows: rows, sel: sel, hours: hours };

		const k = n => (n / 1000).toFixed(1).replace('.', ',');
		let html = `<table class="vis" style="width:100%"><tr><th>Wioska</th><th>Pkt</th><th>Budowa /h</th><th>Rekrutacja /h</th><th>Produkcja /h</th><th>Brakuje /h</th><th>Dostawa co ${esc(SS.interval)}</th><th>Skąd</th></tr>`;
		rows.forEach(r => {
			html += `<tr class="row_b"><td>${esc(r.v.name)}</td><td>${r.v.points}</td>` +
				`<td>${r.b.rows ? r.b.rate.map(k).join(' / ') : '<span class="grey">brak danych</span>'}</td>` +
				`<td>${r.recNote.length ? r.rec.map(k).join(' / ') + ' <span class="grey">(' + r.recNote.join(', ') + ')</span>' : '-'}</td>` +
				`<td>${r.b.gd.prod.map(x => k(x * 3600)).join(' / ')}</td><td>${r.need.map(k).join(' / ')}</td>` +
				`<td><b>${r.pack.map(x => x / 1000).join(' / ')}</b> tys.</td><td>${r.src ? esc(r.src.name) + ' (' + dist(r.src, r.v).toFixed(1) + ' p.)' : '<span class="error">brak</span>'}</td></tr>`;
		});
		html += '</table><p class="grey">Wartości w tys. (drewno / glina / żelazo). Budowa = średnie tempo przy ciągłym stawianiu budynków z Ratusza, rekrutacja = ciągłe szkolenie wybranych jednostek.</p>';
		html += `<p><b>Wybierz wioski:</b> ${villages.slice().sort((a, b) => a.points - b.points).map(v =>
			`<label style="white-space:nowrap;margin-right:8px"><input type="checkbox" class="${NS}_ssel" value="${v.coords}" ${sel.indexOf(v.coords) > -1 ? 'checked' : ''}> ${esc(v.name)} (${v.points})</label>`).join(' ')}
			<input type="button" class="btn" id="${NS}_srecalc" value="Przelicz"></p>`;
		const old = readRoutes().filter(r => sel.indexOf(r.target) > -1);
		html += `<p>Istniejące dostawy do tych wiosek (zostaną usunięte): ${old.length ? old.map(r => esc(r.startName) + ' → ' + esc(r.targetName)).join(', ') : 'brak'}</p>`;
		html += `<input type="button" class="btn" id="${NS}_sapply" value="Przygotuj kroki (${rows.filter(r => r.src && r.pack.some(x => x > 0)).length} dostaw, klikasz ka\u017Cd\u0105)"> <span id="${NS}_slog" class="grey"></span>`;
		out.html(html);
		$('#' + NS + '_srecalc').on('click', () => supplyCalc($('.' + NS + '_ssel:checked').map(function () { return this.value; }).get()).catch(e => msg.err('Zaopatrzenie: ' + (e.message || e))));
		$('#' + NS + '_sapply').on('click', function () {
			if (this.classList.contains('btn-disabled')) { return; }
			this.classList.add('btn-disabled');
			try { supplyApply(old); } catch (e) { console.error(e); msg.err('Zaopatrzenie: ' + (e.message || e)); }
		});
	}

	function supplyApply(old) {
		const steps = [];
		if (old.length) { steps.push({ t: 'del', ids: old.map(r => r.id), label: 'Usuń ' + old.length + ' starych dostaw do nowych wiosek' }); }
		sup.rows.filter(x => x.src && x.pack.some(p => p > 0)).forEach(r => [0, 1, 2].forEach(k => {
			if (!r.pack[k]) { return; }
			const res = [0, 0, 0]; res[k] = r.pack[k];
			steps.push({ t: 'new', label: r.src.name + ' \u2192 ' + r.v.name + ': ' + (r.pack[k] / 1000) + ' tys. ' + ['drewno', 'glina', '\u017Celazo'][k] + ' co ' + SS.interval,
				d: { sx: r.src.x, sy: r.src.y, tx: r.v.x, ty: r.v.y, res: res, time: SS.interval } });
		}));
		startQueue(steps);
	}

	try { panel(); supplyPanel(); runQueue().catch(e => console.error(e)); } catch (e) { console.error(e); }
})();
