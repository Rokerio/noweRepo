// ==UserScript==
// @name         Dysponent Grup – wysyłka
// @namespace    dysponent-grup-wysylka
// @version      1.8.0
// @updateURL    https://raw.githubusercontent.com/Rokerio/noweRepo/main/dysponent-grup-wysylka.user.js
// @downloadURL  https://raw.githubusercontent.com/Rokerio/noweRepo/main/dysponent-grup-wysylka.user.js
// @description  Jak Dysponent Grup, ale zamiast „Poproś o surowce” wysyła bezpośrednio: dla wybranych grup biorców (uzupełnij do X% / pod budowę) dobiera najbliższych dawców z wybranych grup i pokazuje listę wysyłek. Po kliknięciu „Wyślij” wiersz znika, więc następną klikasz w tym samym miejscu. Guzik 🧠 Doradca: pobiera dane i układa raport (przelewające się spichlerze, zagroda/spichlerz 30, handlarz, z limitem blokady kupców). W Ratuszu przy każdym budynku jest przycisk 📦 (oraz „Następny z Menedżera”), który wysyła brakujące na budowę surowce w ten sam sposób.
// @author       Roker
// @match        https://*.plemiona.pl/game.php*
// @match        https://*.die-staemme.de/game.php*
// @match        https://*.tribalwars.net/game.php*
// @match        https://*.tribalwars.co.uk/game.php*
// @match        https://*.tribalwars.us/game.php*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
// rejestr wersji dla Sprawdzacza skryptów (localStorage, osobny na każdym urządzeniu)
try{var __r=JSON.parse(localStorage.getItem('gdp_registry')||'{}');__r['dysponent-grup-wysylka']={v:'1.8.0',t:Date.now()};localStorage.setItem('gdp_registry',JSON.stringify(__r));}catch(e){}


/* global game_data, jQuery, UI, Dialog, TribalWars */

(function () {
	'use strict';

	// ================= USTAWIENIA =================
	const S = {
		fillPercent: 80,							// tryb "uzupełnij": domyślnie do ilu % spichlerza (zmieniasz w oknie skryptu)
		capToEcoCost: true,							// tryb "uzupełnij": nie więcej, niż kosztuje poziom ecoLevel tartaku/cegielni/huty (na surowiec: największy z trzech)
		storageLevel: 30,							// tryb "pod budowę": docelowy poziom spichlerza
		ecoLevel: 23,								// poziom tartaku / cegielni / huty żelaza ("eko")
		ecoBuildings: ['wood', 'stone', 'iron'],
		levelsAhead: 1,								// tryb "pod budowę": na ile kolejnych poziomów naraz
		onlyIdle: true,								// tryb "pod budowę": tylko wioski z pustą kolejką budowy
		donorReserve: [0, 0, 0],					// ile ZOSTAWIĆ w wiosce-dawcy (drewno, glina, żelazo)
		tradersSafeguard: 0,						// ilu kupców zostawić w wiosce-dawcy
		maxTime: 0,									// maks. czas transportu w minutach (0 = bez limitu)
		minutesPerField: 4.8,						// czas kupca na 1 pole (świat 233: 4,8)
		carry: 1000,								// ile niesie jeden kupiec
		safetyMargin: 0,							// bufor w dawcy (surowce, które zostają ponad rezerwę)
		skipSuppliedDonors: true,					// pomiń dawców, do których ktoś wiezie surowce (pewnie zbierają na budowę) – można przełączyć w oknie
		suppliedThreshold: 1000,					// od ilu surowców w drodze uznać wioskę za zaopatrywaną
		collectRatio: null,							// tryb "uzupełnij": null = po prostu do X%; [28, 30, 25] = biorca dostaje w proporcji (np. pod monety), nadal do X% spichlerza
		nextBuild: {								// tryb "następna budowa": co uznać za następny budynek wioski bez budowy (czytane z Ratusza)
			strategy: 'cheapest',					// 'cheapest' = najtańszy budynek, na który wioska ma miejsce w spichlerzu; 'priority' = pierwszy z listy priority
			priority: ['storage', 'farm', 'main', 'wood', 'stone', 'iron', 'market', 'smith', 'barracks', 'stable', 'garage'],
			exclude: ['wall', 'statue', 'place', 'snob', 'church', 'first_church', 'watchtower', 'hide'],	// tych budynków nie liczymy
			maxCapFill: 0.9							// koszt budynku musi mieścić się w tylu % spichlerza wioski
		},
		equalizeTol: 0.05,							// tryb "wyrównaj": różnice mniejsze niż tyle spichlerza wioski (5%) pomijamy, żeby nie wozić drobiazgów
		minDonorTraders: 50,						// Ratusz: dawca = tylko wioska z co najmniej tylu kupcami ŁĄCZNIE (poziom rynku) – małe wioski nie oddają na budowę (0 = bez progu)
		showManagerNext: true,						// Ratusz: pasek „Następny z Menedżera” (zakładka pobierana dopiero po kliknięciu)
		advisor: {									// 🧠 Doradca
			lockHours: 15,							// domyślny limit blokady kupców (zmieniany w oknie; skrypt podpowiada wartość)
			keepMerchantsPct: 30,					// gdy blokada dłuższa niż limit i wioska mogłaby się znów przelać: zostaw tyle % kupców
			riskHours: 12,							// wioska zagrożona = któryś surowiec zapełni się w mniej niż tyle godzin
			fullPct: 97,							// od ilu % spichlerza surowiec liczy się jako pełny
			reliefTo: 70,							// przelewająca się wioska oddaje do tylu % spichlerza
			recvTo: 60,							// biorca odciążenia nie dostaje ponad tyle % spichlerza (zapas na produkcję)
			minRecv: 5000,							// biorca odciążenia: minimalny brak (suma), żeby nie rozdrabniać wysyłek
			donorKeepPct: 50,						// dawcy na budowę (spoza przelewających) zostawiają u siebie tyle % spichlerza
			farmSlack: 100,							// zagroda „pełna”, gdy wolne miejsce w niej ≤ tyle
			storageLevel: 30,						// docelowy poziom spichlerza
			minDonorTraders: 50,					// dawca na budowę: min. kupców łącznie (0 = bez progu)
			gameSpeed: 0,							// 0 = prędkość świata z konfiguracji gry; wpisz liczbę, jeśli skrypt źle ją odczyta
			npcPP: 10,								// koszt jednej umowy u handlarza (PP) wg okna gry
			npcNeedsMerchants: true,				// okno handlarza ogranicza kwotę do tego, co uniosą wolni kupcy (ustaw false, jeśli wymiana działa bez kupców)
			mixTol: 4,								// miks surowców: dopuszczalny rozstrzał % zapełnienia między surowcami w wiosce (punkty proc.)
			mixMin: 20000,							// miks: nie rób umów na mniej niż tyle surowca (10 PP się nie opłaca)
			ppBudget: 300							// miks: maks. PP na jedno wykonanie planu (0 = bez limitu)
		},
		minCall: 1000,								// cel z mniejszym brakiem (suma) pomijamy
		considerIncoming: true,						// odejmij surowce już jadące do celu
		checkMainFallback: true,					// tryb "pod budowę": gdy przegląd budynków nie pokazuje kolejki – sprawdź Ratusz
		clickDelay: 150,							// ms blokady po kliknięciu „Wyślij”
		sendDelay: 400,								// ms między wysyłkami przy „Wyślij wszystko”
		requestDelay: 250							// ms między zapytaniami o przeglądy
	};
	// ==============================================

	const NS = 'Dysponent_Wysylka';
	const RES = ['wood', 'stone', 'iron'];
	const RES_PL = ['Drewno', 'Glina', 'Żelazo'];
	const B_PL = { storage: 'Spichlerz', wood: 'Tartak', stone: 'Cegielnia', iron: 'Huta żelaza' };

	if (typeof game_data === 'undefined' || typeof jQuery === 'undefined') return;
	const $ = jQuery;
	const SEL_KEY = NS + '_sel_' + game_data.world;
	const inert = html => $(new DOMParser().parseFromString(html, 'text/html'));
	const sitter = (game_data.player.sitter !== '0') ? '&t=' + game_data.player.id : '';
	const num = s => Number(String(s == null ? '' : s).replace(/\D/g, '')) || 0;
	const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
	const resSpan = (r, v) => `<span class="res ${RES[r]}" style="padding:1px 1px 1px 18px;">${Math.round(v).toLocaleString('pl-PL')}</span>`;
	const sleep = ms => new Promise(r => setTimeout(r, ms));
	const sum3 = a => a[0] + a[1] + a[2];
	const short = name => String(name).replace(/\s*\(\d+\|\d+\).*$/, '').trim();
	const fmtMin = m => { m = Math.round(m); return m >= 60 ? Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min' : m + ' min'; };
	const vnumOf = name => { const m = String(name).match(/^\s*(\d+)/); return m ? +m[1] : null; };
	const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
	const ovUrl = (mode, group) => `/game.php?village=${game_data.village.id}&screen=overview_villages&mode=${mode}&group=${group}&page=-1${sitter}`;

	const msg = {
		ok: (t, d) => (typeof UI !== 'undefined' ? UI.SuccessMessage(t, d || 4000) : console.log(t)),
		info: (t, d) => (typeof UI !== 'undefined' ? UI.InfoMessage(t, d || 4000) : console.log(t)),
		err: (t, d) => (typeof UI !== 'undefined' ? UI.ErrorMessage(t, d || 8000) : console.warn(t))
	};
	function handleError(e) {
		console.error('[Dysponent Grup – wysyłka]', e);
		msg.err('Dysponent Grup – wysyłka: ' + (e && e.message ? e.message : e));
	}
	async function get(url) { await sleep(S.requestDelay); return $.get(url); }

	// ================= WYBÓR GRUP (pamiętany per świat) =================
	const toArr = x => Array.isArray(x) ? x.map(String) : (x ? [String(x)] : []);
	function loadSel() {
		let o = {};
		try { o = JSON.parse(localStorage.getItem(SEL_KEY) || 'null') || {}; } catch (e) { /* ignore */ }
		const pct = Number(o.pct);
		return {
			recip: toArr(o.recip), donor: toArr(o.donor),
			excl: typeof o.excl === 'string' ? o.excl : '',
			rFrom: Number(o.rFrom) > 0 ? Number(o.rFrom) : 0,
			rTo: Number(o.rTo) > 0 ? Number(o.rTo) : 0,
			keep: typeof o.keep === 'boolean' ? o.keep : false,
			allDon: typeof o.allDon === 'boolean' ? o.allDon : false,
			order: o.order === 'full' ? 'full' : 'near',
			skipSup: typeof o.skipSup === 'boolean' ? o.skipSup : S.skipSuppliedDonors,
			mode: o.mode === 'build' ? 'build' : o.mode === 'next' ? 'next' : o.mode === 'eq' ? 'eq' : 'fill',
			eqSep: typeof o.eqSep === 'boolean' ? o.eqSep : false,
			pct: pct >= 10 && pct <= 100 ? pct : S.fillPercent,
			eco: typeof o.eco === 'boolean' ? o.eco : S.capToEcoCost,
			ecoLevel: Number(o.ecoLevel) >= 1 && Number(o.ecoLevel) <= 30 ? Number(o.ecoLevel) : S.ecoLevel,
			stor: typeof o.stor === 'boolean' ? o.stor : false,
			storLevel: Number(o.storLevel) >= 1 && Number(o.storLevel) <= 30 ? Number(o.storLevel) : S.storageLevel
		};
	}
	function saveSel(o) { try { localStorage.setItem(SEL_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } }

	const cleanGroupName = s => String(s).replace(/[\[\]<>]/g, '').replace(/\s+/g, ' ').trim();
	function currentGroupId() {
		const st = $('strong.group-menu-item').first().text();
		if (st && /wszystkie|all|alle/i.test(st)) return '0';
		const fromUrl = new URLSearchParams(location.search).get('group');
		if (fromUrl != null && /^\d+$/.test(fromUrl)) return fromUrl;
		if (typeof game_data.group_id !== 'undefined' && game_data.group_id !== null) return String(game_data.group_id);
		return '0';
	}
	function readGroups($root) {
		const find = sel => ($root ? $root.find(sel) : $(sel));
		const groups = [], seen = new Set();
		find('a.group-menu-item[href*="group="]').each(function () {
			const id = (this.getAttribute('href').match(/[?&]group=(\d+)/) || [])[1];
			if (!id || id === '0' || seen.has(id)) return;
			seen.add(id);
			groups.push({ id, name: cleanGroupName($(this).text()) });
		});
		const cur = $root ? '0' : currentGroupId();
		if (cur !== '0' && !seen.has(cur)) {
			const name = cleanGroupName($('strong.group-menu-item').first().text());
			groups.push({ id: cur, name: name || ('grupa ' + cur) });
		}
		return groups;
	}

	// ================= DANE Z PRZEGLĄDÓW =================
	async function loadCosts() {
		const def = {
			storage: { base: [60, 50, 40], fac: [1.265, 1.27, 1.245] },
			farm: { base: [45, 40, 30], fac: [1.3, 1.3, 1.3] },
			wood: { base: [50, 60, 40], fac: [1.25, 1.275, 1.245] },
			stone: { base: [65, 50, 40], fac: [1.27, 1.265, 1.24] },
			iron: { base: [75, 65, 70], fac: [1.252, 1.275, 1.24] }
		};
		let root = null;
		try {
			const xml = await $.ajax({ url: '/interface.php?func=get_building_info', dataType: 'text' });
			root = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
		} catch (e) { /* domyślne */ }
		const out = {};
		for (const key of ['storage', ...S.ecoBuildings, 'farm']) {
			let base = def[key].base, fac = def[key].fac;
			const el = root && Array.from(root.children).find(c => c.tagName === key);
			if (el) {
				const txt = n => { const x = el.querySelector(n); return x ? parseFloat(x.textContent) : NaN; };
				const b = RES.map(r => txt(r)), f = RES.map(r => txt(r + '_factor'));
				if (b.every(isFinite) && f.every(isFinite)) { base = b; fac = f; }
			}
			out[key] = lvl => RES.map((r, i) => Math.round(base[i] * Math.pow(fac[i], lvl - 1)));
		}
		return out;
	}

	async function loadIds(group) {
		const $p = inert(await get(ovUrl('prod', group)));
		const ids = new Set();
		$p.find('#production_table .quickedit-vn[data-id]').each(function () { ids.add(Number(this.getAttribute('data-id'))); });
		return ids;
	}

	// surowce, spichlerz, kupcy i współrzędne wiosek z danej grupy
	async function loadProd(group) {
		const $p = inert(await get(ovUrl('prod', group)));
		const out = {};
		$p.find('#production_table tr').each(function () {
			const tr = $(this);
			const vn = tr.find('.quickedit-vn[data-id]').first();
			if (!vn.length) return;
			const name = vn.text().replace(/\s+/g, ' ').trim();
			const xy = name.match(/\((\d+)\|(\d+)\)/);
			const resTd = tr.find('span.wood').first().closest('td');
			if (!xy || !resTd.length) return;
			const tds = tr.children('td');
			const i = tds.index(resTd);
			const id = Number(vn.attr('data-id'));
			const tm = (tds.eq(i + 2).text().match(/(\d+)\s*\/\s*(\d+)/) || [0, 0, 0]);
			out[id] = {
				id, name, x: +xy[1], y: +xy[2],
				res: RES.map(r => num(resTd.find('.' + r).first().text())),
				cap: num(tds.eq(i + 1).text()),
				tradersFree: +tm[1], tradersTotal: +tm[2],
				pop: (tds.eq(i + 3).text().match(/(\d+)\s*\/\s*(\d+)/) || [0, 0, 0])[1] | 0,
				popMax: (tds.eq(i + 3).text().match(/(\d+)\s*\/\s*(\d+)/) || [0, 0, 0])[2] | 0,
				building: tds.eq(i + 4).length ? (tds.eq(i + 4).find('img, li, a').length > 0 || tds.eq(i + 4).text().trim() !== '') : null
			};
		});
		return out;
	}

	async function loadBuildings(group, extra) {
		const keys = ['storage', ...S.ecoBuildings, ...(extra || [])];
		const $p = inert(await get(ovUrl('buildings', group)));
		const table = $p.find('#buildings_table');
		if (!table.length) throw new Error('Brak przeglądu budynków (konto premium?).');
		const head = table.find('tr').first().children().toArray();
		const colOf = {};
		keys.forEach(k => {
			colOf[k] = head.findIndex(th => $(th).find('img[src*="/' + k + '"], img[src*="' + k + '."], .building-' + k + ', a[href*="order=' + k + '"]').length);
		});
		const out = {};
		table.find('tr').each(function () {
			const tr = $(this);
			const vn = tr.find('.quickedit-vn[data-id]').first();
			if (!vn.length) return;
			const lv = {};
			keys.forEach(k => {
				let cell = tr.find('td.b_' + k);
				if (!cell.length && colOf[k] >= 0) cell = tr.children().eq(colOf[k]);
				lv[k] = cell.length ? num(cell.text()) : null;
			});
			const q = tr.find('[id^="building_order_"], ul.building_order').first();
			out[Number(vn.attr('data-id'))] = { lv, building: q.length ? q.find('li, img').length > 0 : null };
		});
		return out;
	}

	// następny budynek wioski: z Ratusza bierzemy budynki, które da się rozbudować, i wybieramy wg S.nextBuild
	async function pickNext(v) {
		const N = S.nextBuild;
		const $p = inert(await get(`/game.php?village=${v.id}&screen=main${sitter}`));
		const out = [];
		$p.find('tr[id^="main_buildrow_"]').each(function () {
			const key = this.id.replace('main_buildrow_', '');
			if (N.exclude.includes(key)) return;
			const tr = $(this);
			const cost = RES.map(r => { const td = tr.find('td.cost_' + r).first(); if (!td.length) return NaN; const d = td.attr('data-cost'); return d != null && d !== '' ? Number(d) : num(td.text()); });
			if (!cost.every(isFinite) || !cost.some(n => n > 0)) return;
			const opts = tr.find('td.build_options').text().replace(/\s+/g, ' ');
			if (/wymagan|maksymaln|osi[ąa]gn|requires|maximum/i.test(opts) && !tr.find('a.btn-build').length) return;
			const first = tr.children('td').first();
			const nm = (first.find('a').first().text() || '').trim() || B_PL[key] || key;
			const m = first.text().match(/(?:Poziom|Level|Stufe)\s*(\d+)/i);
			const na = tr.find('a.btn-build').first().attr('data-level-next');
			out.push({ key, label: nm, cost, level: na ? Number(na) - 1 : (m ? Number(m[1]) : 0) });
		});
		const room = Math.floor(v.cap * N.maxCapFill);
		const fit = out.filter(o => o.cost.every(c => c <= room));
		if (!fit.length) return null;
		if (N.strategy === 'priority') for (const k of N.priority) { const f = fit.find(o => o.key === k); if (f) return f; }
		return fit.sort((a, b) => sum3(a.cost) - sum3(b.cost))[0];
	}

	async function isBuilding(id) {
		const $p = inert(await get(`/game.php?village=${id}&screen=main${sitter}`));
		return $p.find('#buildqueue tr[class*="buildorder_"]').length > 0;
	}

	async function readIncomingPerVillage() {
		const map = {};
		const $p = inert(await get('/game.php?screen=overview_villages&mode=trader&type=inc&page=-1' + sitter));
		const table = $p.find('#trades_table')[0];
		if (!table) return map;
		$(table).find('tr').each(function () {
			const tr = $(this);
			let id = tr.find('.village_anchor[data-id]').last().attr('data-id');
			if (!id) {
				const a = tr.find('a[href*="id="]').last()[0];
				if (a) id = (a.getAttribute('href').match(/[?&]id=(\d+)/) || [])[1];
			}
			if (!id) return;
			const res = [0, 0, 0];
			let found = false;
			tr.find('.nowrap, .res').each(function () {
				const el = $(this);
				const r = RES.findIndex(n => el.find('.' + n).length || el.hasClass(n));
				if (r === -1) return;
				res[r] += num(el.text());
				found = true;
			});
			if (!found) return;
			id = Number(id);
			if (!map[id]) map[id] = [0, 0, 0];
			for (let r = 0; r < 3; r++) map[id][r] += res[r];
		});
		return map;
	}

	// ================= DZIENNIK WYSYŁEK =================
	// Własna księga wysłanych transportów – gdy przegląd „Transporty” ich jeszcze nie pokaże, kolejne uruchomienie i tak je odejmie.
	const LKEY = NS + '_ledger', LOG = NS + '_log', RSKEY = NS + '_regsched_' + game_data.world, RGKEY = NS + '_regmap_' + game_data.world;
	let lastCollect = null;
	const lsGet = key => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; } };
	const lsSet = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ } };
	function recordSend(s) {
		const now = Date.now();
		const ttl = Math.min(180, s.leg * 1.1 + 3) * 60000;
		const l = lsGet(LKEY).filter(e => e.exp > now);
		l.push({ to: s.to, res: s.res, exp: now + ttl });
		lsSet(LKEY, l);
		if (s.reg) {
			if (lastCollect) { try { localStorage.setItem(RGKEY, JSON.stringify(lastCollect)); } catch (e) { /* ignore */ } }
			const q = lsGet(RSKEY).filter(e => e.arr > now - 6 * 3600000);
			q.push({ to: s.to, toName: s.toName, from: s.fromName, res: s.res, ts: now, arr: now + s.leg * 60000 });
			lsSet(RSKEY, q.slice(-300));
		}
		const g = lsGet(LOG);
		g.push({ ts: now, from: s.fromName, to: s.toName, res: s.res });
		lsSet(LOG, g.slice(-100));
	}
	function mergeLedger(incoming) {
		const now = Date.now(), led = {};
		lsGet(LKEY).filter(e => e.exp > now).forEach(e => {
			led[e.to] = led[e.to] || [0, 0, 0];
			for (let r = 0; r < 3; r++) led[e.to][r] += e.res[r];
		});
		for (const id of Object.keys(led)) {
			const cur = incoming[id] || [0, 0, 0];
			incoming[id] = cur.map((n, r) => Math.max(n, led[id][r]));
		}
		return incoming;
	}

	// ================= BRAKI BIORCÓW =================
	const goalOf = (cap, pct, limit) => {
		const pctCap = Math.floor(cap * pct / 100);
		return RES.map((n, r) => (limit ? Math.min(pctCap, limit[r]) : pctCap));
	};
	const fillNeed = (res, inc, cap, pct, limit) => {
		const pctCap = Math.floor(cap * pct / 100);
		const goal = goalOf(cap, pct, limit);
		return res.map((h, r) => {
			const have = h + inc[r];
			const raw = goal[r] - have;
			if (raw <= 0) return 0;
			const up = Math.ceil(raw / 1000) * 1000;
			return have + up <= pctCap ? up : Math.floor(raw / 1000) * 1000;
		});
	};
	// z proporcją: cel = największy zestaw w proporcji ratio, który mieści się w X% spichlerza (i w limicie eko, jeśli jest)
	const ratioNeed = (res, inc, cap, pct, limit, ratio) => {
		const goal = goalOf(cap, pct, limit);
		const k = Math.min(...RES.map((n, r) => goal[r] / ratio[r]));
		return res.map((h, r) => Math.max(0, Math.floor((k * ratio[r] - h - inc[r]) / 1000) * 1000));
	};
	const fillWhat = plan => plan.ecoCap
		? `do kosztu ${plan.capText} (maks. ${plan.pct}% spichlerza)`
		: `do ${plan.pct}% spichlerza`;

	function pickBuilding(v, ecoLevel) {
		if (v.lv.storage !== null && v.lv.storage < S.storageLevel) return 'storage';
		const eco = S.ecoBuildings.filter(k => v.lv[k] !== null && v.lv[k] < ecoLevel).sort((a, b) => v.lv[a] - v.lv[b]);
		return eco[0] || null;
	}

	// ================= DOBÓR DAWCÓW =================
	// items: biorcy w kolejności ważności (każdy: target, v, need, headroom); donors: dawcy z surowcami i kupcami
	function allocate(items, donors, order, reserve, lock) {
		const mpf = S.minutesPerField, carry = S.carry;
		const st = donors.map(d => ({
			d, stock: d.res.slice(),
			cap: Math.max(0, d.tradersFree - S.tradersSafeguard) * carry,
			avail: d.res.map((n, r) => Math.max(0, n - Math.max(S.donorReserve[r], reserve ? reserve[r] : 0, d.keepOwn ? d.keepOwn[r] : 0) - S.safetyMargin))
		}));
		const sends = [], unmet = [];
		for (const it of items) {
			const left = it.need.slice();
			const head = it.headroom.slice();
			const order_ = st.map(x => ({ x, t: dist(x.d, it.v) * mpf }))
				.filter(o => o.x.d.id !== it.target && (!S.maxTime || o.t <= S.maxTime))
				.sort((a, b) => a.t - b.t);
			if (order === 'full') {		// od najpełniejszych spichlerzy (po tym, co zostało do wzięcia); remis = bliższy
				const fl = o => sum3(o.x.avail) / (3 * Math.max(1, o.x.d.cap));
				order_.sort((a, b) => fl(b) - fl(a) || a.t - b.t);
			}
			for (const { x, t } of order_) {
				if (left.every(n => n <= 0)) break;
				const res = [0, 0, 0];
				let room = x.cap;
				// blokada kupców: gdy wracają dłużej niż limit, a wioska zdążyłaby się przelać – zostaw część kupców
				if (lock && 2 * t / 60 > lock.lockH && !lock.safe(x, 2 * t / 60)) room = Math.max(0, x.cap - Math.ceil((x.d.tradersTotal || 0) * lock.keepPct / 100) * carry);
				for (const r of [0, 1, 2].sort((a, b) => left[b] - left[a])) {
					const want = Math.max(0, left[r]);
					if (!want) continue;
					const limit = Math.floor(Math.min(x.avail[r], room, head[r]) / carry) * carry;
					const up = Math.ceil(want / carry) * carry;
					const n = up <= limit ? up : Math.floor(Math.min(want, limit) / carry) * carry;
					if (n >= carry) { res[r] = n; x.avail[r] -= n; room -= n; left[r] -= n; head[r] -= n; }
				}
				const total = sum3(res);
				if (total < carry) continue;
				x.cap -= total;
				res.forEach((n, r) => { x.stock[r] -= n; });
				sends.push({
					from: x.d.id, fromName: x.d.name, to: it.target, toName: it.name, res,
					merchants: total / carry, dist: dist(x.d, it.v), leg: t, what: it.what, prio: items.indexOf(it)
				});
			}
			if (left.some(n => n > 0)) unmet.push({ name: it.name, left: left.map(n => Math.max(0, n)) });
		}
		sends.forEach((s, i) => { s.i = i; s.done = false; });
		return { sends, unmet };
	}

	// ================= PLAN =================
	async function buildPlan(sel) {
		msg.info('Dysponent Grup – wysyłka: zbieram dane…', 3000);
		const cur = currentGroupId();
		const recipGroups = toArr(sel.recip), donorGroups = toArr(sel.donor);
		const fill = sel.mode === 'fill';
		const isEq = sel.mode === 'eq';		// wyrównanie: bogatsze wioski grupy(grup) oddają, uboższe dostają do średniego zapełnienia
		const isCost = sel.mode === 'cost' && Array.isArray(sel.cost);		// Ratusz: koszt konkretnego budynku dla jednej wioski
		const isNext = sel.mode === 'next';		// następna budowa: tylko wioski bez budowy, surowce na następny budynek
		const pct = sel.pct;
		const range = sel.rFrom > 0 && sel.rTo >= sel.rFrom;		// tryb zakresu numerów: bogatsze wioski z zakresu karmią słabsze z tego samego zakresu
		const overlap = !sel.allDon && recipGroups.some(g => donorGroups.includes(g));		// ta sama grupa biorców i dawców: bogate wioski grupy karmią słabe z tej samej grupy
		const exclNums = new Set((String(sel.excl || '').match(/\d+/g) || []).map(Number));	// wioski, które nie mają dawać
		const inRange = v => { const n = vnumOf(v.name); return n !== null && n >= sel.rFrom && n <= sel.rTo; };
		const groupSets = {};
		let all = {}, recipIds = new Set(), donorIds = null, costs = null, bld = null, incoming = {};
		try {
			all = await loadProd('0');
			if (sel.village) recipIds.add(sel.village);		// z Rynku: biorcą jest tylko ta wioska
			else if (isNext && !recipGroups.length && !range) Object.values(all).forEach(v => recipIds.add(v.id));
			else if (range && !recipGroups.length) Object.values(all).forEach(v => { if (inRange(v)) recipIds.add(v.id); });
			else for (const g of recipGroups) { const ids = await loadIds(g); groupSets[g] = ids; ids.forEach(id => recipIds.add(id)); }
			if (range && !sel.village) [...recipIds].forEach(id => { if (!all[id] || !inRange(all[id])) recipIds.delete(id); });
			if (sel.mode === 'build' || sel.eco || sel.stor || sel.keep) costs = await loadCosts();
			if (sel.mode === 'build' || isNext) bld = await loadBuildings('0');
			if (donorGroups.length && !sel.allDon && !range) {
				donorIds = new Set();
				for (const g of donorGroups) (await loadIds(g)).forEach(id => donorIds.add(id));
			}
		} finally {
			try { await get(ovUrl('prod', cur)); } catch (e) { /* ignore */ }
		}
		if (S.considerIncoming) {
			try { incoming = await readIncomingPerVillage(); }
			catch (e) { msg.err('Nie udało się odczytać transportów przychodzących – liczę z dziennika wysyłek.', 5000); }
		}
		mergeLedger(incoming);

		const villages = [...recipIds].map(id => all[id]).filter(Boolean);
		if (!villages.length) throw new Error('Grupa biorców jest pusta.');
		const skippedDonors = [];
		// dawcy: zwykle wszystko poza biorcami (z wybranych grup); w trybie zakresu – reszta zakresu, czyli wioski, którym nic nie brakuje
		const makeDonors = excludeIds => Object.values(all)
			.filter(v => !exclNums.has(vnumOf(v.name)) && !excludeIds.has(v.id) && (!range || inRange(v)) && (!donorIds || donorIds.has(v.id)) && v.tradersFree > S.tradersSafeguard)
			.filter(v => !isCost || !S.minDonorTraders || v.tradersTotal >= S.minDonorTraders)
			.filter(v => {
				const inc = incoming[v.id];
				if (!sel.skipSup || !inc || sum3(inc) < S.suppliedThreshold) return true;
				skippedDonors.push({ name: v.name, inc });
				return false;
			});

		const groups = readGroups();
		const nameOf = id => (groups.find(g => g.id === id) || { name: 'grupa ' + id }).name;
		const ecoLevel = Number(sel.ecoLevel) >= 1 ? Number(sel.ecoLevel) : S.ecoLevel;
		// limit na surowiec = największy koszt spośród: tartak/cegielnia/huta na poziomie eko i/albo spichlerz na wybranym poziomie
		const capList = [];
		if (fill && costs) {
			if (sel.eco) S.ecoBuildings.forEach(k => capList.push(costs[k](ecoLevel)));
			if (sel.stor) capList.push(costs.storage(Number(sel.storLevel) || S.storageLevel));
		}
		// dawcy zostawiają u siebie koszt eko (i spichlerza, jeśli zaznaczony) – żeby sami mogli budować
		let keepVec = null;
		if (sel.keep && costs) {
			const kl = S.ecoBuildings.map(k => costs[k](ecoLevel));
			if (sel.stor) kl.push(costs.storage(Number(sel.storLevel) || S.storageLevel));
			keepVec = RES.map((r, i) => Math.max(...kl.map(c => c[i])));
		}
		const ecoCap = capList.length ? RES.map((r, i) => Math.max(...capList.map(c => c[i]))) : null;
		const capText = [sel.eco ? `eko ${ecoLevel} lvl` : '', sel.stor ? `spichlerza ${Number(sel.storLevel) || S.storageLevel} lvl` : ''].filter(Boolean).join(' / ');
		const plan = {
			mode: isCost ? 'cost' : isEq ? 'eq' : isNext ? 'next' : fill ? 'fill' : 'build', pct, ecoCap, ecoLevel, capText,
			recipName: sel.village ? short(game_data.village.name) : (isNext && !recipGroups.length && !range ? 'wszystkie wioski bez budowy' : range && !recipGroups.length ? `wioski ${sel.rFrom}–${sel.rTo}` : recipGroups.map(nameOf).join(', ')),
			donorName: donorGroups.length && !sel.allDon ? donorGroups.map(nameOf).join(', ') : 'wszystkie pozostałe wioski',
			nRecip: villages.length, nDonors: 0,
			ready: [], busy: [], unknown: [], noNext: [], eqInfo: [], sends: [], unmet: [], skippedDonors, ratio: Array.isArray(S.collectRatio) ? S.collectRatio : null
		};
		const ratio = Array.isArray(S.collectRatio) ? S.collectRatio.map(n => Math.max(1, Number(n) || 1)) : null;
		let eqPre = null;
		const items = [];
		const mk = (v, need, what, extra) => {
			const inc = incoming[v.id] || [0, 0, 0];
			return Object.assign({ target: v.id, name: v.name, v, need, what, headroom: RES.map((n, r) => Math.max(0, v.cap - v.res[r] - inc[r])) }, extra);
		};

		if (fill) {
			villages.forEach(v => {
				const inc = incoming[v.id] || [0, 0, 0];
				const need = ratio ? ratioNeed(v.res, inc, v.cap, pct, ecoCap, ratio) : fillNeed(v.res, inc, v.cap, pct, ecoCap);
				const goal = goalOf(v.cap, pct, ecoCap), gs = sum3(goal);
				const fillRatio = gs ? RES.reduce((s, n, i) => s + Math.min(v.res[i] + inc[i], goal[i]), 0) / gs : 1;
				if (sum3(need) >= S.minCall) items.push(mk(v, need, fillWhat(plan), { ratio: fillRatio }));
				else plan.ready.push(v.name);
			});
			// ta sama grupa po obu stronach / zakres: najpierw najsłabsze (najmniejszy spichlerz), potem najpustsze; inaczej tylko najpustsze
			items.sort((a, b) => (range || overlap) ? (a.v.cap - b.v.cap || a.ratio - b.ratio) : a.ratio - b.ratio);
		} else if (isCost) {
			const v = villages[0], inc = incoming[v.id] || [0, 0, 0];
			if (sel.cost.some(c => c > v.cap)) throw new Error('Koszt przekracza pojemność spichlerza – najpierw rozbuduj spichlerz.');
			const lack = sel.cost.map((c, r) => Math.max(0, c - v.res[r] - inc[r]));
			const need = lack.map((n, r) => Math.min(n, Math.max(0, v.cap - v.res[r] - inc[r])));		// nie przelej spichlerza
			plan.cost = { cost: sel.cost, lack, inc, what: sel.what || 'budowa' };
			if (sum3(need) > 0) items.push(mk(v, need, sel.what || 'budowa', {}));
			else plan.ready.push(v.name);
		} else if (isEq) {
			if (sel.village) throw new Error('Wyrównanie działa na grupach – wybierz je w oknie „Dysponent – grupy”.');
			// pule: wszystkie zaznaczone grupy razem albo każda osobno (wioska w kilku grupach trafia do pierwszej)
			const pools = [];
			if (sel.eqSep && recipGroups.length > 1 && !range) {
				const used = new Set();
				recipGroups.forEach(g => { const ids = [...(groupSets[g] || [])].filter(id => all[id] && !used.has(id)); ids.forEach(id => used.add(id)); if (ids.length) pools.push({ name: nameOf(g), vs: ids.map(id => all[id]) }); });
			} else pools.push({ name: plan.recipName, vs: villages });
			eqPre = { sends: [], unmet: [], donors: [] };
			for (const pool of pools) {
				const vs = pool.vs.filter(v => v.cap > 0);
				if (vs.length < 2) continue;
				const lvl = v => v.res.map((h, r) => h + ((incoming[v.id] || [0, 0, 0])[r]));
				// docelowe zapełnienie na surowiec = średnia całej puli (nie wyżej niż suwak %)
				const ratioR = RES.map((_, r) => Math.min(pct / 100, vs.reduce((a, v) => a + lvl(v)[r], 0) / vs.reduce((a, v) => a + v.cap, 0)));
				plan.eqInfo.push({ name: pool.name, n: vs.length, ratio: ratioR });
				const eqItems = [], eqDonors = [];
				vs.forEach(v => {
					const T = RES.map((_, r) => Math.floor(ratioR[r] * v.cap)), L = lvl(v), tol = S.equalizeTol * v.cap;
					const need = RES.map((_, r) => { const d = T[r] - L[r]; return d >= tol && d >= S.minCall ? d : 0; });
					if (sum3(need) >= S.minCall) { eqItems.push(mk(v, need, 'wyrównanie', { fillR: sum3(L) / (3 * v.cap) })); return; }
					const surplus = RES.map((_, r) => v.res[r] - T[r]);
					if (surplus.some((x, r) => x >= tol && x >= S.minCall) && !exclNums.has(vnumOf(v.name)) && v.tradersFree > S.tradersSafeguard) {
						v.keepOwn = T;		// oddaje tylko to, co ponad średnią puli
						const inc = incoming[v.id];
						if (sel.skipSup && inc && sum3(inc) >= S.suppliedThreshold) skippedDonors.push({ name: v.name, inc }); else eqDonors.push(v);
					} else plan.ready.push(v.name);
				});
				eqItems.sort((a, b) => a.fillR - b.fillR || a.v.cap - b.v.cap);	// najpierw najbardziej puste
				eqItems.forEach(i => items.push(i));
				const r = allocate(eqItems, eqDonors, sel.order, keepVec);
				eqPre.sends.push(...r.sends); eqPre.unmet.push(...r.unmet); eqPre.donors.push(...eqDonors);
			}
		} else if (isNext) {
			villages.forEach(v => Object.assign(v, bld[v.id] || { lv: {}, building: null }));
			for (const v of villages) {
				if (v.building === null && S.checkMainFallback) v.building = await isBuilding(v.id);
				if (S.onlyIdle !== false && v.building === true) { plan.busy.push(v.name); continue; }
				if (v.building === null) plan.unknown.push(v.name);
				const nb = await pickNext(v);
				if (!nb) { plan.noNext.push(v.name); continue; }
				v.keepOwn = nb.cost;		// wioska bez budowy nie oddaje tego, co sama zaraz wyda
				const inc = incoming[v.id] || [0, 0, 0];
				const need = nb.cost.map((c, r) => Math.max(0, c - v.res[r] - inc[r]));
				if (sum3(need) >= S.minCall) items.push(mk(v, need, `${nb.label} ${nb.level} → ${nb.level + 1}`, { }));
				else plan.ready.push(v.name);
			}
			items.sort((a, b) => a.v.cap - b.v.cap);		// najpierw najsłabsze (najmniejszy spichlerz)
		} else {
			villages.forEach(v => Object.assign(v, bld[v.id] || { lv: {}, building: null }));
			const keys = ['storage', ...S.ecoBuildings];
			villages.forEach(v => keys.forEach(k => { if (v.lv[k] === undefined) v.lv[k] = null; }));
			if (villages.every(v => keys.every(k => v.lv[k] === null))) throw new Error('Nie odczytałem poziomów budynków z przeglądu budynków.');
			const todo = [];
			for (const v of villages) {
				const key = pickBuilding(v, ecoLevel);
				if (!key) { plan.ready.push(v.name); continue; }
				todo.push({ v, key });
			}
			if (S.checkMainFallback) for (const t of todo) if (t.v.building === null) t.v.building = await isBuilding(t.v.id);
			for (const { v, key } of todo) {
				if (S.onlyIdle && v.building === true) { plan.busy.push(v.name); continue; }
				if (v.building === null) plan.unknown.push(v.name);
				const target = key === 'storage' ? S.storageLevel : ecoLevel;
				const level = v.lv[key];
				const to = Math.min(target, level + S.levelsAhead);
				const want = [0, 0, 0];
				for (let l = level + 1; l <= to; l++) costs[key](l).forEach((c, r) => { want[r] += c; });
				const inc = incoming[v.id] || [0, 0, 0];
				const need = want.map((w, r) => Math.max(0, Math.min(w, v.cap) - v.res[r] - inc[r]));
				if (sum3(need) >= S.minCall) items.push(mk(v, need, `${B_PL[key]} ${level} → ${to}`, { key, level }));
				else plan.ready.push(v.name);
			}
			items.sort((a, b) => (a.key === 'storage' ? 0 : 1) - (b.key === 'storage' ? 0 : 1) || a.level - b.level);
		}
		plan.nItems = items.length;
		plan.weakFirst = !!(range || overlap || isNext);
		plan.range = range ? `${sel.rFrom}–${sel.rTo}` : null;
		plan.keepVec = keepVec;
		plan.order = sel.order;
		const donors = eqPre ? eqPre.donors : makeDonors(range || overlap || isNext ? new Set(items.map(i => i.target)) : recipIds);
		plan.nDonors = donors.length;
		plan.exclNums = [...exclNums];
		if (isEq) plan.donorName = 'ta sama pula (wioski powyżej średniego zapełnienia)';
		if (range) plan.donorName = `wioski ${sel.rFrom}–${sel.rTo}, którym nic nie brakuje`;
		const { sends, unmet } = eqPre ? { sends: eqPre.sends.map((x, i) => Object.assign(x, { i, done: false })), unmet: eqPre.unmet } : allocate(items, donors, sel.order, keepVec);
		plan.sends = sends; plan.unmet = unmet;
		// podsumowania: ile brakuje biorcom, ile wysyłamy, ile nadal brakuje, ile mają wszystkie wioski razem
		const addUp = arrs => RES.map((r, i) => arrs.reduce((a, x) => a + (x[i] || 0), 0));
		plan.sum = {
			need: addUp(items.map(i => i.need)),
			sent: addUp(sends.map(x => x.res)),
			unmet: addUp(unmet.map(u => u.left)),
			stockAll: addUp(Object.values(all).map(v => v.res)),
			stockRecip: addUp(villages.map(v => v.res)),
			capAll: Object.values(all).reduce((a, v) => a + v.cap, 0),
			nAll: Object.keys(all).length
		};
		return plan;
	}

	// ================= WYSYŁKA =================
	function sendOne(s) {
		return new Promise(resolve => {
			let done = false;
			const timer = setTimeout(() => { if (!done) { done = true; resolve(false); } }, 8000);
			TribalWars.post('market', { ajaxaction: 'map_send', village: s.from },
				{ target_id: s.to, wood: s.res[0], stone: s.res[1], iron: s.res[2] },
				e => {
					if (done) return;
					done = true; clearTimeout(timer);
					recordSend(s);
					msg.ok(e && e.message ? e.message : 'Wysłano', 1200);
					resolve(true);
				}, false);
		});
	}

	// ================= UI =================
	let plan = null, lock = false, busy = false;

	function rowHtml(s) {
		return `<tr class="row_a" id="${NS}_row_${s.i}">
			<td style="white-space:nowrap">${esc(short(s.fromName))} → <b>${esc(short(s.toName))}</b> <span class="grey">${esc(s.what)}</span></td>
			<td style="text-align:right">${s.dist.toFixed(1)}</td>
			<td style="text-align:right">${fmtMin(s.leg)}</td>
			<td style="text-align:right">${s.merchants}</td>
			<td style="white-space:nowrap">${s.res.map((n, r) => n ? resSpan(r, n) : '').join(' ')}</td>
			<td><a href="#" class="btn ${NS}_go" data-i="${s.i}">Wyślij</a></td></tr>`;
	}
	function updateLeft() {
		const left = plan.sends.filter(s => !s.done).length;
		$('#' + NS + '_left').text(left);
		if (!left && !$('#' + NS + '_end').length) $('#' + NS + '_table').after(`<p id="${NS}_end"><b>Wszystko wysłane.</b></p>`);
	}
	function addFailed(s) {
		if (!$('#' + NS + '_failed').length) $('#' + NS + '_table').after(`<div id="${NS}_failed"><h4>Bez potwierdzenia wysyłki</h4><table class="vis" style="width:100%"><tbody></tbody></table></div>`);
		const row = $(`<tr class="row_b"><td>${esc(short(s.fromName))} → <b>${esc(short(s.toName))}</b></td><td>${s.res.map((n, r) => n ? resSpan(r, n) : '').join(' ')}</td><td><a href="#" class="btn">Ponów</a></td></tr>`);
		row.find('a').on('click', async function (e) {
			e.preventDefault();
			row.remove();
			if (!(await sendOne(s))) addFailed(s);
		});
		$('#' + NS + '_failed tbody').append(row);
	}

	// wyrównanie roześle nadmiar jednego surowca wszędzie – ostrzeż, gdy miks na koncie jest mocno nierówny
	function mixWarn(p) {
		if (!p.sum || !p.sum.capAll) return '';
		const f = p.sum.stockAll.map(x => x / p.sum.capAll), spread = (Math.max(...f) - Math.min(...f)) * 100;
		if (spread <= 8) return '';
		return `<b style="color:#a00">⚠ Miks surowców na koncie jest nierówny (${f.map((x, r) => RES_PL[r].toLowerCase() + ' ' + Math.round(x * 100) + '%').join(' · ')}).</b> Wyrównanie roześle nadmiar do wszystkich wiosek – najpierw wymień nadmiar u handlarza (🧠 Doradca → Miks surowców). `;
	}
	function showPlan() {
		const p = plan;
		const tot = [0, 1, 2].map(r => p.sends.reduce((a, s) => a + s.res[r], 0));
		const merchants = p.sends.reduce((a, s) => a + s.merchants, 0);
		const explain = p.mode === 'cost'
			? `Zamawiam surowce na budowę: <b>${esc(p.cost.what)}</b> – koszt ${p.cost.cost.map((n, r) => resSpan(r, n)).join(' ')}, brakuje ${p.cost.lack.map((n, r) => resSpan(r, n)).join(' ')}${sum3(p.cost.inc) ? ', już w drodze ' + p.cost.inc.map((n, r) => resSpan(r, n)).join(' ') : ''}. Dawcy z małych wiosek (mniej niż ${S.minDonorTraders} kupców łącznie) nie oddają.`
			: p.mode === 'eq'
			? `${mixWarn(p)}Wyrównuję zapełnienie spichlerzy: ${p.eqInfo.map(e => `<b>${esc(e.name)}</b> (${e.n} wiosek, średnio ${e.ratio.map(x => Math.round(x * 100) + '%').join(' / ')})`).join('; ') || 'za mało wiosek w grupie'}. Wioski poniżej średniej dostają, powyżej oddają tylko nadwyżkę ponad średnią. Różnice poniżej ${Math.round(S.equalizeTol * 100)}% spichlerza pomijam.`
			: p.mode === 'next'
			? `Każdej wiosce bez budowy zamawiam surowce na jej następny budynek (${S.nextBuild.strategy === 'priority' ? 'wg listy priorytetów' : 'najtańszy, na który ma miejsce w spichlerzu'}). Wioski z budową są pomijane, a te bez budowy nie oddają tego, co same wydadzą.`
			: p.mode === 'fill'
			? (p.ecoCap ? `Uzupełniam biorców do kosztu: ${p.capText} (na surowiec ${p.ecoCap.map((n, r) => resSpan(r, n)).join(' ')}), nie ponad ${p.pct}% spichlerza.`
				: `Uzupełniam biorców do <b>${p.pct}%</b> spichlerza.`)
			: `Biorca = brakuje spichlerza ${S.storageLevel} albo ${S.ecoBuildings.map(k => B_PL[k]).join('/')} ${p.ecoLevel}.`;
		const unmetTxt = p.unmet.slice(0, 12).map(u => `${esc(short(u.name))}: ${u.left.map((n, r) => n ? resSpan(r, n) : '').join(' ')}`).join('<br>');
		Dialog.show(NS, `
			<h3>Dysponent Grup – wysyłka</h3>
			<div style="max-height:70vh;overflow:auto;-webkit-overflow-scrolling:touch">
				<p>Biorcy: <b>${esc(p.recipName)}</b> (${p.nRecip} wiosek, do uzupełnienia ${p.nItems}) · dawcy: <b>${esc(p.donorName)}</b> (${p.nDonors} wiosek)<br>
				Wysyłek: <b id="${NS}_left">${p.sends.length}</b> · kupców: <b>${Math.round(merchants)}</b> · razem: ${tot.map((n, r) => n ? resSpan(r, n) : '').join(' ') || '–'}<br>
				<span class="grey">${explain} ${p.ratio ? `Proporcja ${p.ratio.join(' : ')}. ` : ''}${p.weakFirst ? 'Najpierw najsłabsze wioski (najmniejszy spichlerz). ' : ''}${p.keepVec ? `Dawcy zostawiają ${p.keepVec.map((n, r) => resSpan(r, n)).join(' ')}. ` : ''}${p.order === 'full' ? 'Dawcy od najpełniejszych spichlerzy.' : 'Dawcy wybierani od najbliższego.'} Kliknięty wiersz znika, następny staje w tym samym miejscu.</span></p>
				<table class="vis" style="width:100%"><tbody>
					<tr><th></th><th>${RES_PL.join('</th><th>')}</th><th>Razem</th></tr>
					${[['Brakuje biorcom (łącznie)', p.sum.need], ['Wysyłamy teraz', p.sum.sent], ['Nadal brakuje po wysyłce', p.sum.unmet], ['Stan biorców', p.sum.stockRecip], [`Stan wszystkich wiosek razem (${p.sum.nAll})`, p.sum.stockAll]]
						.map(([l, a]) => `<tr class="row_b"><td>${l}</td>${a.map((n, r) => `<td>${resSpan(r, n)}</td>`).join('')}<td><b>${Math.round(sum3(a)).toLocaleString('pl-PL')}</b></td></tr>`).join('')}
				</tbody></table>
				<p class="grey" style="margin-top:2px">Pojemność wszystkich spichlerzy: ${p.sum.capAll.toLocaleString('pl-PL')} na surowiec.</p>
				${p.sends.length ? `<p><a href="#" class="btn" id="${NS}_all">▶ Wyślij wszystko</a></p>
				<table class="vis" id="${NS}_table" style="width:100%"><tbody><tr><th>Skąd → dokąd</th><th>Pól</th><th>Czas</th><th>Kupców</th><th>Surowce</th><th></th></tr>${p.sends.map(rowHtml).join('')}</tbody></table>`
				: `<table id="${NS}_table"><tbody></tbody></table><p>Nic do wysłania – biorcy nie potrzebują teraz surowców albo dawcy nie mają nadwyżki/kupców.</p>`}
				${p.unmet.length ? `<p class="error">Brakuje dawców dla (${p.unmet.length}):<br>${unmetTxt}</p>` : ''}
				${p.exclNums.length ? `<p class="grey">Wykluczone z dawania: ${p.exclNums.join(', ')}</p>` : ''}
				${p.skippedDonors.length ? `<p class="grey">Dawcy pominięci, bo coś do nich jedzie (pewnie budują) (${p.skippedDonors.length}): ${p.skippedDonors.map(x => esc(short(x.name))).join(', ')}</p>` : ''}
				${p.ready.length ? `<p class="grey">Mają już dość (${p.ready.length}): ${p.ready.map(n => esc(short(n))).join(', ')}</p>` : ''}
				${p.busy.length ? `<p class="grey">Pominięte, bo coś się buduje (${p.busy.length}): ${p.busy.map(n => esc(short(n))).join(', ')}</p>` : ''}
				${p.noNext.length ? `<p class="grey">Bez następnego budynku do zamówienia (spichlerz za mały albo brak budynków do rozbudowy) (${p.noNext.length}): ${p.noNext.map(n => esc(short(n))).join(', ')}</p>` : ''}
				${p.unknown.length ? `<p class="grey">Nie ustaliłem kolejki budowy: ${p.unknown.map(n => esc(short(n))).join(', ')}</p>` : ''}
			</div>`);

		bindSend();
	}

	// obsługa przycisków „Wyślij” i „Wyślij wszystko” (wspólna dla planu i Doradcy)
	function bindSend() {
		$(document).off('click.' + NS).on('click.' + NS, '.' + NS + '_go', function (e) {
			e.preventDefault();
			if (lock) return;
			const s = plan.sends[Number($(this).attr('data-i'))];
			if (!s || s.done) return;
			s.done = true;
			lock = true; setTimeout(() => { lock = false; }, S.clickDelay);
			const $row = $('#' + NS + '_row_' + s.i);
			const $next = $row.nextAll('tr').find('.' + NS + '_go').first();
			$row.remove();
			if ($next.length) $next[0].focus();
			updateLeft();
			sendOne(s).then(ok => { if (!ok) { addFailed(s); msg.err('Brak potwierdzenia wysyłki z ' + short(s.fromName), 6000); } });
		});
		$(document).off('click.' + NS + 'all').on('click.' + NS + 'all', '#' + NS + '_all', async function (e) {
			e.preventDefault();
			if (busy) return;
			const todo = plan.sends.filter(s => !s.done);
			if (!todo.length || !confirm('Wysłać ' + todo.length + ' transportów?')) return;
			busy = true;
			const btn = $(this);
			let ok = 0, fail = 0;
			for (const s of todo) {
				s.done = true;
				$('#' + NS + '_row_' + s.i).remove();
				updateLeft();
				if (await sendOne(s)) ok++; else { fail++; addFailed(s); }
				btn.text(`⏳ ${ok + fail}/${todo.length}`);
				await sleep(S.sendDelay);
			}
			btn.text(`Gotowe: ${ok} wysłanych` + (fail ? `, ${fail} bez potwierdzenia` : ''));
			busy = false;
		});
	}

	async function runPlanner(sel) {
		plan = await buildPlan(sel);
		lock = false; busy = false;
		showPlan();
	}

	// okno wyboru trybu i grup
	// ================= ULUBIONE =================
	// Zapisane zestawy ustawień. Dwa najczęściej używane dostają własne przyciski do szybkiego klikania.
	const FAV_KEY = NS + '_fav_' + game_data.world;
	function loadFavs() {
		try { const a = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); return Array.isArray(a) ? a.filter(f => f && f.name && f.sel) : []; } catch (e) { return []; }
	}
	function saveFavs(a) { try { localStorage.setItem(FAV_KEY, JSON.stringify(a)); } catch (e) { /* ignore */ } }
	const stable = o => JSON.stringify(o, Object.keys(o).sort());
	const topFavs = () => loadFavs().sort((a, b) => (b.uses || 0) - (a.uses || 0)).slice(0, 2).filter(f => (f.uses || 0) > 0 || loadFavs().length <= 2);
	function bumpFav(sel) {		// każde uruchomienie z ustawieniami zgodnymi z ulubionym liczy się do jego użyć
		const a = loadFavs(), key = stable(sel), f = a.find(x => stable(Object.assign(loadSel(), x.sel)) === key);
		if (f) { f.uses = (f.uses || 0) + 1; saveFavs(a); }
	}
	function runSel(next) {
		saveSel(next);
		bumpFav(next);
		return runPlanner(next);
	}
	function favButtons(styleExtra) {
		return topFavs().map(f => $(`<a href="#" class="btn ${NS}_favbtn" style="margin:4px 6px 4px 0;${styleExtra || ''}" title="Ulubione: ${esc(f.name)} (użyć: ${f.uses || 0})">⭐ ${esc(f.name)}</a>`)
			.on('click', e => { e.preventDefault(); runSel(Object.assign(loadSel(), f.sel)).catch(handleError); }));
	}

	// na stronach bez paska grup (np. Rynek) lista grup jest pobierana z przeglądu wiosek
	async function getGroups() {
		let g = readGroups();
		if (g.length) return g;
		g = readGroups(inert(await get(ovUrl('prod', '0'))));
		return g;
	}
	function showLauncherDialog(groups) {
		groups = groups || readGroups();
		if (!groups.length) { msg.err('Nie znalazłem paska grup na tej stronie.'); return; }
		const sel = loadSel();
		const boxes = (name, chosen) => groups.map(g =>
			`<label style="display:block;white-space:nowrap"><input type="checkbox" name="${NS}_${name}" value="${g.id}" ${chosen.includes(g.id) ? 'checked' : ''}> ${esc(g.name)}</label>`).join('');
		const favRows = () => loadFavs().sort((a, b) => (b.uses || 0) - (a.uses || 0)).map((f, i) =>
			`<tr class="row_b"><td>${i < 2 ? '⭐ ' : ''}<b>${esc(f.name)}</b> <span class="grey">(użyć: ${f.uses || 0})</span></td>
				<td><a href="#" class="btn ${NS}_favrun" data-n="${esc(f.name)}">▶ Uruchom</a> <a href="#" class="btn ${NS}_favload" data-n="${esc(f.name)}">↩ Wczytaj do formularza</a> <a href="#" class="${NS}_favdel" data-n="${esc(f.name)}">✖</a></td></tr>`).join('');
		Dialog.show(NS, `
			<h3>Dysponent Grup – wysyłka</h3>
			<div id="${NS}_favbox"><table class="vis" style="width:100%"><tr><th colspan="2">Ulubione (dwa najczęściej używane mają własne przyciski)</th></tr><tbody id="${NS}_favrows">${favRows() || '<tr><td colspan="2" class="grey">Brak – ustaw formularz niżej, wpisz nazwę i kliknij „★ Zapisz”.</td></tr>'}</tbody></table>
			<p>Nazwa: <input type="text" id="${NS}_favname" style="width:160px" placeholder="np. Bolt karmi słabsze"> <a href="#" class="btn" id="${NS}_favsave">★ Zapisz jako ulubione</a></p></div>
			<p><label><input type="radio" name="${NS}_mode" value="fill" ${sel.mode === 'fill' ? 'checked' : ''}> Uzupełnij do
				<input type="range" id="${NS}_pct" min="10" max="100" step="5" value="${sel.pct}" style="width:120px;vertical-align:middle"> <b id="${NS}_pctv">${sel.pct}%</b> spichlerza</label><br>
			&nbsp;&nbsp;&nbsp;<label><input type="checkbox" id="${NS}_eco" ${sel.eco ? 'checked' : ''}> ale nie więcej, niż kosztuje poziom</label>
			<input type="range" id="${NS}_ecolv" min="5" max="30" step="1" value="${sel.ecoLevel}" style="width:120px;vertical-align:middle"> <b id="${NS}_ecolvv">${sel.ecoLevel}</b> tartaku / cegielni / huty (na surowiec)<br>
			&nbsp;&nbsp;&nbsp;<label><input type="checkbox" id="${NS}_stor" ${sel.stor ? 'checked' : ''}> i poziom spichlerza</label>
			<input type="range" id="${NS}_storlv" min="5" max="30" step="1" value="${sel.storLevel}" style="width:120px;vertical-align:middle"> <b id="${NS}_storlvv">${sel.storLevel}</b> (limit = największy z kosztów)<br>
			<label><input type="radio" name="${NS}_mode" value="build" ${sel.mode === 'build' ? 'checked' : ''}> Pod budowę: spichlerz ${S.storageLevel} / ${S.ecoBuildings.map(k => B_PL[k]).join(', ')} (poziom z suwaka powyżej)</label><br>
			<label><input type="radio" name="${NS}_mode" value="next" ${sel.mode === 'next' ? 'checked' : ''}> <b>Następna budowa</b>: wioski <b>bez budowy</b> dostają surowce na następny budynek (z Ratusza; bez zaznaczonych biorców = wszystkie wioski)</label><br>
			<label><input type="radio" name="${NS}_mode" value="eq" ${sel.mode === 'eq' ? 'checked' : ''}> <b>Wyrównaj</b> surowce w zaznaczonych grupach biorców (do średniego zapełnienia spichlerzy)</label>
			<label style="margin-left:10px"><input type="checkbox" id="${NS}_eqsep" ${sel.eqSep ? 'checked' : ''}> każdą grupę osobno</label></p>
			<table class="vis" style="width:100%">
				<tr><th>Biorcy (wioski w potrzebie)</th><th>Dawcy (lepiej rozwinięte)</th></tr>
				<tr class="row_b"><td style="vertical-align:top">${boxes('r', sel.recip)}</td><td style="vertical-align:top">${boxes('d', sel.donor)}</td></tr>
			</table>
			<p>Wykluczeni dawcy (numery wiosek, które <b>nie</b> mają dawać, po przecinku): <input type="text" id="${NS}_excl" value="${esc(sel.excl || '')}" style="width:180px" placeholder="np. 301, 304"></p>
			<p><b>Zakres numerów wiosek</b> (opcjonalnie): od <input type="number" id="${NS}_rfrom" min="0" value="${sel.rFrom || ''}" style="width:60px"> do <input type="number" id="${NS}_rto" min="0" value="${sel.rTo || ''}" style="width:60px"><br>
			<span class="grey">Po wpisaniu zakresu (np. 300–399) biorcami są wioski z tego zakresu (albo tylko z zaznaczonych grup biorców), a dawcami reszta zakresu – bogatsze karmią słabsze. Grupy dawców są wtedy ignorowane.</span></p>
			<p>Kolejność dawców: <label><input type="radio" name="${NS}_order" value="near" ${sel.order !== 'full' ? 'checked' : ''}> najbliżsi</label> <label><input type="radio" name="${NS}_order" value="full" ${sel.order === 'full' ? 'checked' : ''}> najpełniejsi (z największym zapasem względem spichlerza)</label></p>
			<p><label><input type="checkbox" id="${NS}_alldon" ${sel.allDon ? 'checked' : ''}> dawcą może być każda wioska poza biorcami (ignoruj grupy dawców)</label><br>
			<label><input type="checkbox" id="${NS}_keep" ${sel.keep ? 'checked' : ''}> dawcy zostawiają u siebie koszt eko (i spichlerza, jeśli zaznaczony) – sami mogą budować</label></p>
			<p><label><input type="checkbox" id="${NS}_skipsup" ${sel.skipSup ? 'checked' : ''}> pomijaj dawców, do których coś jedzie (zbierają na budowę)</label></p>
			<p class="grey">Zaznacz jedną lub kilka grup w każdej kolumnie. Ta sama grupa może być po obu stronach: wtedy wioski grupy, którym brakuje, dostają od tych, którym nic nie brakuje. Bez zaznaczenia dawców skrypt bierze ze wszystkich wiosek poza biorcami.</p>
			<p><a href="#" class="btn" id="${NS}_run">Sprawdź</a></p>
		`);
		$('#' + NS + '_pct').on('input', function () { $('#' + NS + '_pctv').text(this.value + '%'); });
		$('#' + NS + '_storlv').on('input', function () { $('#' + NS + '_storlvv').text(this.value); });
		$('#' + NS + '_ecolv').on('input', function () { $('#' + NS + '_ecolvv').text(this.value); });
		const picked = name => $('input[name="' + NS + '_' + name + '"]:checked').map(function () { return this.value; }).get();
		const collect = () => {
			const recip = picked('r'), donor = picked('d');
			const mv = $('input[name="' + NS + '_mode"]:checked').val(), mode = mv === 'build' ? 'build' : mv === 'next' ? 'next' : mv === 'eq' ? 'eq' : 'fill';
			const pct = Number($('#' + NS + '_pct').val());
			const rFrom = Number($('#' + NS + '_rfrom').val()) || 0, rTo = Number($('#' + NS + '_rto').val()) || 0;
			if (mode !== 'next' && !recip.length && !(rFrom > 0 && rTo >= rFrom)) { msg.err('Zaznacz co najmniej jedną grupę biorców albo wpisz zakres numerów wiosek.'); return null; }
			if (rFrom > 0 && rTo < rFrom) { msg.err('Zakres numerów: „do” musi być co najmniej równe „od”.'); return null; }
			return { recip, donor, mode, eqSep: $('#' + NS + '_eqsep').is(':checked'), rFrom, rTo, excl: $('#' + NS + '_excl').val() || '', allDon: $('#' + NS + '_alldon').is(':checked'), keep: $('#' + NS + '_keep').is(':checked'), order: $('input[name="' + NS + '_order"]:checked').val() === 'full' ? 'full' : 'near', skipSup: $('#' + NS + '_skipsup').is(':checked'), pct: pct >= 10 && pct <= 100 ? pct : sel.pct, eco: $('#' + NS + '_eco').is(':checked'), ecoLevel: Number($('#' + NS + '_ecolv').val()) || sel.ecoLevel, stor: $('#' + NS + '_stor').is(':checked'), storLevel: Number($('#' + NS + '_storlv').val()) || sel.storLevel };
		};
		const fillForm = o => {		// wczytanie ulubionego do formularza
			$('input[name="' + NS + '_r"], input[name="' + NS + '_d"]').each(function () { const n = this.name.endsWith('_r') ? o.recip : o.donor; this.checked = toArr(n).includes(this.value); });
			$('input[name="' + NS + '_mode"][value="' + o.mode + '"]').prop('checked', true); $('#' + NS + '_eqsep').prop('checked', !!o.eqSep);
			$('input[name="' + NS + '_order"][value="' + (o.order === 'full' ? 'full' : 'near') + '"]').prop('checked', true);
			$('#' + NS + '_pct').val(o.pct).trigger('input'); $('#' + NS + '_ecolv').val(o.ecoLevel).trigger('input'); $('#' + NS + '_storlv').val(o.storLevel).trigger('input');
			$('#' + NS + '_eco').prop('checked', !!o.eco); $('#' + NS + '_stor').prop('checked', !!o.stor);
			$('#' + NS + '_excl').val(o.excl || ''); $('#' + NS + '_rfrom').val(o.rFrom || ''); $('#' + NS + '_rto').val(o.rTo || '');
			$('#' + NS + '_alldon').prop('checked', !!o.allDon); $('#' + NS + '_keep').prop('checked', !!o.keep); $('#' + NS + '_skipsup').prop('checked', !!o.skipSup);
		};
		const redrawFavs = () => $('#' + NS + '_favrows').html(favRows() || '<tr><td colspan="2" class="grey">Brak ulubionych.</td></tr>');
		$('#' + NS + '_run').on('click', e => {
			e.preventDefault();
			const next = collect();
			if (next) runSel(next).catch(handleError);
		});
		$('#' + NS + '_favsave').on('click', e => {
			e.preventDefault();
			const name = String($('#' + NS + '_favname').val() || '').trim();
			if (!name) return msg.err('Wpisz nazwę ulubionego.');
			const next = collect();
			if (!next) return;
			const a = loadFavs(), old = a.find(f => f.name === name);
			if (old) { old.sel = next; } else a.push({ name, sel: next, uses: 0 });
			saveFavs(a); redrawFavs(); msg.ok('Zapisano ulubione: ' + name, 2500);
		});
		$(document).off('click.' + NS + 'fav').on('click.' + NS + 'fav', '.' + NS + '_favrun, .' + NS + '_favload, .' + NS + '_favdel', function (e) {
			e.preventDefault();
			const name = $(this).attr('data-n'), a = loadFavs(), f = a.find(x => x.name === name);
			if (!f) return;
			if ($(this).hasClass(NS + '_favdel')) { saveFavs(a.filter(x => x !== f && x.name !== name)); redrawFavs(); return; }
			if ($(this).hasClass(NS + '_favload')) { fillForm(Object.assign(loadSel(), f.sel)); return; }
			f.uses = (f.uses || 0) + 1; saveFavs(a);
			const next = Object.assign(loadSel(), f.sel); saveSel(next);
			runPlanner(next).catch(handleError);
		});
	}

	function initLauncher() {
		if ($('#' + NS + '_launch').length) return;
		const btn = $(`<a href="#" id="${NS}_launch" class="btn" style="margin:4px 0 4px 6px">📦 Dysponent – wysyłka</a>`)
			.on('click', e => { e.preventDefault(); try { showLauncherDialog(); } catch (ex) { handleError(ex); } });
		const fb = favButtons('margin-left:6px');
		const host = $('#content_value h2, #content_value h3').first();
		const adv = advButton('margin-left:6px'), reg = regButton();
		host.length ? host.after(btn, adv, reg, ...fb) : $('#content_value').prepend(btn, adv, reg, ...fb);
	}

	// Rynek > Poproś o surowce: ta sama logika dla bieżącej wioski, z ostatnio zapisanymi ustawieniami (tryb, %, dawcy)
	function initMarket() {
		if ($('#' + NS + '_market').length) return;
		const btn = $(`<a href="#" id="${NS}_market" class="btn" style="margin:4px 6px 4px 0" title="Wyślij do tej wioski surowce od najbliższych dawców (ustawienia z okna na przeglądzie wiosek)">📦 Dysponent – ta wioska</a>`)
			.on('click', e => {
				e.preventDefault();
				// ta wioska = zawsze tryb „uzupełnij” (pełne 1000): zapisany zakres numerów / wyrównanie / następna budowa z okna grup tu nie obowiązują
				const sel = Object.assign(loadSel(), { village: game_data.village.id, recip: [], mode: 'fill', rFrom: 0, rTo: 0, eqSep: false });
				btn.addClass('btn-disabled');
				runPlanner(sel).catch(handleError).then(() => btn.removeClass('btn-disabled'));
			});
		const btnG = $(`<a href="#" id="${NS}_market_g" class="btn" style="margin:4px 6px 4px 0" title="Wybierz grupy biorców i dawców, tryb i kolejność">📦 Dysponent – grupy</a>`)
			.on('click', async e => {
				e.preventDefault();
				try {
					const groups = await getGroups();
					if (!groups.length) return msg.err('Nie znalazłem grup.');
					showLauncherDialog(groups);
				} catch (ex) { handleError(ex); }
			});
		const gameBtn = $('input.btn, button.btn, a.btn').filter(function () {
			return /Poproś o surowce|Request resources|Rohstoffe anfordern/i.test(this.value || $(this).text());
		}).first();
		const fb = favButtons();
		if (gameBtn.length) gameBtn.before(btn, btnG, advButton(), regButton(), ...fb);
		else { const l = $('#village_list').first(); l.length ? l.before(btn, btnG, advButton(), regButton(), ...fb) : $('#content_value').prepend(btn, btnG, advButton(), regButton(), ...fb); }
	}

	// ================= DORADCA =================
	// Guzik „🧠 Doradca”: pobiera dane (surowce, spichlerze, kupcy, zagroda, poziomy budynków, transporty, prędkość świata)
	// i układa raport: co się przelewa i gdzie to wysłać, gdzie brakuje spichlerza 30 / zagrody, co wymienić u handlarza.
	// Kupców nie wyczerpuje „na hura”: patrz opts.lockH / opts.keepPct.
	const ADV_KEY = NS + '_adv_' + game_data.world;
	const floor1000 = n => Math.max(0, Math.floor(n / 1000) * 1000);
	const ttfTxt = h => !isFinite(h) ? '–' : h < 1 ? Math.round(h * 60) + ' min' : h.toFixed(1) + ' h';
	// produkcja kopalni na godzinę (szacunek ze wzoru gry; mnożnik prędkości świata)
	const prodPerHour = (level, speed) => level > 0 ? 30 * Math.pow(1.163118, level - 1) * speed : 5 * speed;
	const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };

	function loadAdv() {
		let o = {};
		try { o = JSON.parse(localStorage.getItem(ADV_KEY) || 'null') || {}; } catch (e) { /* ignore */ }
		const pick = (k, d, lo, hi) => { const v = Number(o[k]); return o[k] !== undefined && isFinite(v) && v >= lo && v <= hi ? v : d; };
		return { lockH: pick('lockH', S.advisor.lockHours, 1, 96), riskH: pick('riskH', S.advisor.riskHours, 1, 96), keepPct: pick('keepPct', S.advisor.keepMerchantsPct, 0, 90),
			mixTol: pick('mixTol', S.advisor.mixTol, 0.5, 40), mixMin: pick('mixMin', S.advisor.mixMin, 1000, 1000000), ppBudget: pick('ppBudget', S.advisor.ppBudget, 0, 100000) };
	}
	const saveAdv = o => { try { localStorage.setItem(ADV_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } };

	// ---- miks surowców: w każdej wiosce wymiana u handlarza (1:1) nadmiaru jednego surowca na braki pozostałych ----
	// Cel: wszystkie trzy surowce mają w wiosce to samo % spichlerza (średnia z wioski), więc potem „Wyrównaj” rozsyła
	// już po równo, a nie samą glinę. Wymiana jest lokalna i natychmiastowa – nie zużywa transportów między wioskami.
	function mixPlan(villages, o0, freeM) {
		const A = S.advisor, carry = S.carry;
		const o = Object.assign({ mixTol: A.mixTol, mixMin: A.mixMin, ppBudget: A.ppBudget }, o0), tol = o.mixTol / 100;
		const tot = [0, 0, 0]; let capAll = 0;
		villages.forEach(v => { RES.forEach((_, r) => { tot[r] += v.res[r] + v.inc[r]; }); capAll += v.cap; });
		const gFill = tot.map(x => x / Math.max(1, capAll));
		const all = [];
		let nOk = 0;
		for (const v of villages) {
			const cur = RES.map((_, r) => v.res[r] + v.inc[r]);
			const fills = cur.map(x => x / v.cap);
			if (Math.max(...fills) - Math.min(...fills) <= tol) { nOk++; continue; }
			const m = (cur[0] + cur[1] + cur[2]) / 3;
			const sell = [], buy = [];
			RES.forEach((_, r) => {
				const d = cur[r] - m;
				if (d > 0) sell.push({ r, amt: Math.min(d, v.res[r]) });				// sprzedać można tylko to, co już jest w wiosce
				else if (d < 0) buy.push({ r, amt: Math.min(-d, Math.max(0, v.cap - cur[r])) });
			});
			sell.sort((a, b) => b.amt - a.amt); buy.sort((a, b) => b.amt - a.amt);
			const limit = A.npcNeedsMerchants ? Math.max(0, freeM(v)) * carry : Infinity;
			while (sell.length && buy.length) {
				const s_ = sell[0], b_ = buy[0], x = Math.min(s_.amt, b_.amt);
				const a = floor1000(Math.min(x, limit));
				if (a >= o.mixMin) all.push({ v, sell: s_.r, buy: b_.r, amount: a, pp: A.npcPP, done: false });
				s_.amt -= x; b_.amt -= x;
				if (s_.amt <= 0.5) sell.shift();
				if (b_.amt <= 0.5) buy.shift();
			}
		}
		all.sort((a, b) => b.amount - a.amount);
		const deals = [], deferred = [];
		let pp = 0;
		for (const d of all) {
			if (o.ppBudget > 0 && pp + d.pp > o.ppBudget) { deferred.push(d); continue; }
			pp += d.pp; deals.push(d);
		}
		return { gFill, spread: (Math.max(...gFill) - Math.min(...gFill)) * 100, deals, deferred, pp, amount: deals.reduce((a, d) => a + d.amount, 0), nOk, nVillages: new Set(deals.map(d => d.v.id)).size };
	}

	// czysta logika – bez DOM; ctx: villages (z polami z loadProd + lv), incoming, costs, speed, opts {lockH, riskH, keepPct, order, skipSup}
	function adviseCore(ctx) {
		const { villages, incoming, costs, speed, opts } = ctx, A = S.advisor, carry = S.carry;
		const full = A.fullPct / 100, reliefTo = A.reliefTo / 100, recvTo = A.recvTo / 100;
		villages.forEach(v => {
			v.inc = incoming[v.id] || [0, 0, 0];
			v.prod = ['wood', 'stone', 'iron'].map(k => v.lv && v.lv[k] != null ? prodPerHour(v.lv[k], speed) : 0);
			v.ttf = RES.map((_, r) => v.prod[r] > 0 ? Math.max(0, (v.cap - v.res[r] - v.inc[r]) / v.prod[r]) : Infinity);
			v.over = RES.map((_, r) => v.ttf[r] < opts.riskH || v.res[r] + v.inc[r] >= v.cap * full);
			v.keepOwn = null;
		});
		const mk = (v, need, what, extra) => Object.assign({ target: v.id, name: v.name, v, need, what, headroom: RES.map((_, r) => Math.max(0, v.cap - v.res[r] - v.inc[r])) }, extra);

		// 1) blokady rozwoju: zagroda pełna / spichlerz poniżej docelowego (tylko wioski bez budowy)
		const blocks = [], ready = [], notes = [];
		for (const v of villages) {
			if (v.building === true) continue;
			const lv = v.lv || {};
			const cands = [];
			if (v.popMax > 0 && v.popMax - v.pop <= A.farmSlack && lv.farm != null && lv.farm < 30) cands.push({ key: 'farm', label: 'Zagroda', lvl: lv.farm, prio: 0 });
			if (lv.storage != null && lv.storage < A.storageLevel) cands.push({ key: 'storage', label: 'Spichlerz', lvl: lv.storage, prio: 1 });
			if (!cands.length) continue;
			const pick = cands.find(c => costs[c.key] && costs[c.key](c.lvl + 1).every(x => x <= v.cap));
			if (!pick) { notes.push(`${short(v.name)}: ${cands.map(c => c.label).join(', ')} – koszt przekracza spichlerz`); continue; }
			const cost = costs[pick.key](pick.lvl + 1);
			const need = cost.map((c, r) => Math.max(0, Math.min(c - v.res[r] - v.inc[r], v.cap - v.res[r] - v.inc[r])));
			const what = `${pick.label} ${pick.lvl} → ${pick.lvl + 1}`;
			if (sum3(need) <= 0) { ready.push({ v, what }); continue; }
			blocks.push(mk(v, need, '🏗 ' + what, { cost, prio: pick.prio }));
		}
		blocks.sort((a, b) => a.prio - b.prio || a.v.cap - b.v.cap);
		const blockIds = new Set(blocks.map(b => b.target));

		// 2) przelewające się wioski i to, co mogą oddać
		const overV = villages.filter(v => v.over.some(Boolean));
		const isOver = new Set(overV.map(v => v.id));
		const exc = new Map();
		overV.forEach(v => {
			const own = (blocks.find(b => b.target === v.id) || { cost: [0, 0, 0] }).cost;		// to, co sama zaraz wyda na budowę
			v.keepOwn = RES.map((_, r) => v.over[r] ? Math.max(Math.floor(reliefTo * v.cap), own[r]) : v.res[r]);
			exc.set(v.id, RES.map((_, r) => v.over[r] ? floor1000(v.res[r] - v.keepOwn[r]) : 0));
		});
		const donA = overV.filter(v => sum3(exc.get(v.id)) >= carry);

		// 3) biorcy odciążenia: wioski z miejscem, najsłabsze (najmniejszy spichlerz) najpierw
		const wantR = RES.map((_, r) => donA.reduce((a, v) => a + exc.get(v.id)[r], 0));
		const relief = [];
		if (wantR.some(n => n >= carry)) villages.forEach(v => {
			if (isOver.has(v.id) || blockIds.has(v.id)) return;
			const need = RES.map((_, r) => wantR[r] >= carry ? floor1000(recvTo * v.cap - v.res[r] - v.inc[r]) : 0);
			if (sum3(need) >= A.minRecv) relief.push(mk(v, need, '🌊 odciążenie', { fillR: sum3(v.res) / (3 * v.cap) }));
		});
		relief.sort((a, b) => a.v.cap - b.v.cap || a.fillR - b.fillR);

		// 4) dobór kupców z blokadą: najpierw przelewające się (blokady rozwoju mają pierwszeństwo), potem bogate wioski – tylko na blokady
		const lock = { lockH: opts.lockH, keepPct: opts.keepPct, safe: (x, lh) => RES.every((_, r) => x.stock[r] + x.d.inc[r] + x.d.prod[r] * lh < x.d.cap * full) };
		const rA = allocate(blocks.concat(relief), donA, opts.order || 'near', null, lock);
		const got = {};
		const addGot = s => { const g = got[s.to] || (got[s.to] = [0, 0, 0]); s.res.forEach((n, r) => { g[r] += n; }); };
		rA.sends.forEach(addGot);
		const items2 = blocks.map(it => { const g = got[it.target] || [0, 0, 0]; return Object.assign({}, it, { need: it.need.map((n, r) => Math.max(0, n - g[r])), headroom: it.headroom.map((h, r) => Math.max(0, h - g[r])) }); }).filter(it => sum3(it.need) > 0);
		const donB = villages.filter(v => !isOver.has(v.id) && !blockIds.has(v.id) && v.tradersFree > S.tradersSafeguard
			&& (!A.minDonorTraders || v.tradersTotal >= A.minDonorTraders)
			&& !(opts.skipSup && sum3(v.inc) >= S.suppliedThreshold));
		donB.forEach(v => { v.keepOwn = RES.map(() => Math.floor(A.donorKeepPct / 100 * v.cap)); });
		const rB = items2.length ? allocate(items2, donB, opts.order || 'near', null, lock) : { sends: [], unmet: [] };
		rB.sends.forEach(addGot);
		const sends = rA.sends.concat(rB.sends);
		sends.forEach((s, i) => { s.i = i; s.done = false; });
		const out = {};
		sends.forEach(s => { const o = out[s.from] || (out[s.from] = { res: [0, 0, 0], merch: 0 }); s.res.forEach((n, r) => { o.res[r] += n; }); o.merch += s.merchants; });

		// 5) handlarz (stała oferta 1:1): wymiana tego, czego nie da się wysłać
		const npc = [], npcKey = new Set();
		const npcUsed = {};
		const freeM = v => Math.max(0, v.tradersFree - ((out[v.id] || {}).merch || 0) - (npcUsed[v.id] || 0));
		const addNpc = (v, sell, buy, amount, why) => {
			const k = v.id + ':' + sell + ':' + buy;
			amount = Math.min(floor1000(amount), freeM(v) * carry);		// okno handlarza: maks. tyle, ile uniosą wolni kupcy
			if (amount < 1000 || npcKey.has(k)) return;
			npcKey.add(k);
			npcUsed[v.id] = (npcUsed[v.id] || 0) + amount / carry;
			npc.push({ v, sell, buy, amount, pp: A.npcPP, why });
		};
		// a) blokady, którym nadal brakuje: wymień własną nadwyżkę innego surowca
		for (const b of blocks) {
			const g = got[b.target] || [0, 0, 0], v = b.v;
			for (const s of [0, 1, 2]) {
				const miss = b.need[s] - g[s];
				if (miss <= 0) continue;
				const q = [0, 1, 2].filter(x => x !== s).map(x => ({ x, spare: v.res[x] - b.cost[x] })).filter(o => o.spare >= 1000).sort((a, c) => c.spare - a.spare)[0];
				if (q) addNpc(v, q.x, s, Math.min(Math.ceil(miss / 1000) * 1000, floor1000(q.spare)), 'brakuje na ' + b.what);
			}
		}
		// b) przelewające się, którym nie udało się odciążyć wysyłką: wymień nadmiar na to, czego wiosce brakuje
		for (const v of donA) {
			const ex = exc.get(v.id), o = (out[v.id] || { res: [0, 0, 0] }).res;
			const left = ex.map((n, r) => floor1000(n - o[r]));
			const r = [0, 1, 2].sort((a, c) => left[c] - left[a])[0];
			if (left[r] < 1000) continue;
			const blk = blocks.find(b => b.target === v.id), g = got[v.id] || [0, 0, 0];
			let s = -1;
			if (blk) s = [0, 1, 2].filter(x => x !== r && blk.need[x] - g[x] > 0).sort((a, c) => (blk.need[c] - g[c]) - (blk.need[a] - g[a]))[0];
			if (s === undefined || s < 0) s = [0, 1, 2].filter(x => x !== r && !v.over[x]).sort((a, c) => (v.res[a] + v.inc[a]) - (v.res[c] + v.inc[c]))[0];
			if (s === undefined) continue;
			const room = floor1000(recvTo * v.cap - v.res[s] - v.inc[s]);
			if (room < 1000) continue;
			addNpc(v, r, s, Math.min(left[r], room), 'przelewa się: ' + RES_PL[r].toLowerCase());
		}

		const mix = mixPlan(villages, opts, freeM);

		// podsumowania
		const tot = RES.map((_, r) => villages.reduce((a, v) => a + v.res[r], 0));
		const capAll = villages.reduce((a, v) => a + v.cap, 0);
		const refill = [];
		donA.forEach(v => RES.forEach((_, r) => { if (exc.get(v.id)[r] > 0 && v.prod[r] > 0) refill.push(v.cap * (full - reliefTo) / v.prod[r]); }));
		const med = median(refill);
		return {
			sends, npc, mix, blocks, ready, notes, overV, donA, exc, out, got, tot, capAll,
			suggestLock: med == null ? null : Math.max(4, Math.min(48, Math.round(med))),
			noQueue: overV.filter(v => v.building === false && !(out[v.id] || { merch: 0 }).merch).map(v => v.name),
			stats: { n: villages.length, over: overV.length, farm: blocks.filter(b => /Zagroda/.test(b.what)).length + ready.filter(x => /Zagroda/.test(x.what)).length, storage: blocks.filter(b => /Spichlerz/.test(b.what)).length + ready.filter(x => /Spichlerz/.test(x.what)).length }
		};
	}

	// ---------- pobieranie danych ----------
	async function readSpeed() {
		if (S.advisor.gameSpeed > 0) return { v: S.advisor.gameSpeed, guess: false };
		try {
			const xml = await $.ajax({ url: '/interface.php?func=get_config', dataType: 'text' });
			const el = new DOMParser().parseFromString(xml, 'text/xml').querySelector('config > speed, speed');
			const v = el ? parseFloat(el.textContent) : NaN;
			if (isFinite(v) && v > 0) return { v, guess: false };
		} catch (e) { /* ignore */ }
		return { v: 1, guess: true };
	}
	async function readReturns() {		// kiedy wrócą kupcy (przegląd transportów: „Powrót”)
		const map = {};
		try {
			const $p = inert(await get('/game.php?screen=overview_villages&mode=trader&type=return&page=-1' + sitter));
			$p.find('#trades_table tr').each(function () {
				const tr = $(this), a = tr.find('a[href*="info_village"]').first()[0];
				if (!a) return;
				const id = Number((a.getAttribute('href').match(/[?&]id=(\d+)/) || [])[1]);
				const t = (tr.find('.timer').first().text().match(/(\d+):(\d+):(\d+)/) || []);
				if (!id || !t.length) return;
				const sec = (+t[1]) * 3600 + (+t[2]) * 60 + (+t[3]);
				map[id] = Math.min(map[id] == null ? Infinity : map[id], sec);
			});
		} catch (e) { /* ignore */ }
		return map;
	}
	async function advFetch() {
		msg.info('Doradca: pobieram dane…', 3000);
		const cur = currentGroupId();
		let all = {}, bld = {}, costs = null, noBld = false;
		try {
			all = await loadProd('0');
			try { bld = await loadBuildings('0', ['farm']); } catch (e) { noBld = true; }
			costs = await loadCosts();
		} finally { try { await get(ovUrl('prod', cur)); } catch (e) { /* ignore */ } }
		const villages = Object.values(all).map(v => Object.assign(v, { lv: (bld[v.id] || {}).lv || {} }));
		if (!villages.length) throw new Error('Nie odczytałem przeglądu produkcji.');
		let incoming = {};
		try { incoming = await readIncomingPerVillage(); } catch (e) { msg.err('Nie udało się odczytać transportów przychodzących – liczę z dziennika wysyłek.', 5000); }
		mergeLedger(incoming);
		const speed = await readSpeed();
		const returns = await readReturns();
		return { villages, incoming, costs, speed: speed.v, speedGuess: speed.guess, noBld, returns, ts: Date.now() };
	}

	// ---------- okno raportu ----------
	let advData = null;
	const vlink = v => `<a href="/game.php?village=${v.id}&screen=overview${sitter}">${esc(short(v.name))}</a>`;
	const marketLink = v => `/game.php?village=${v.id}&screen=market&mode=other_offer${sitter}`;
	const resList = a => a.map((n, r) => n ? resSpan(r, n) : '').join(' ');

	// ---------- handlarz: wykonanie wymiany (formularz „Akceptuj” z Rynku > Handel, oferta „Handlarz”) ----------
	function parseGameDataVillage(html) {
		const k = 'TribalWars.updateGameData(', i = html.indexOf(k);
		if (i < 0) return null;
		const st = i + k.length;
		let d = 0, j = st;
		for (; j < html.length; j++) { const c = html[j]; if (c === '{') d++; else if (c === '}') { d--; if (!d) { j++; break; } } }
		try { return (JSON.parse(html.slice(st, j)) || {}).village || null; } catch (e) { return null; }
	}
	// jedna umowa: pobiera stronę oferty, sprawdza stan, wysyła formularz i POTWIERDZA po zmianie stanów wioski
	async function npcDeal(d) {
		const html0 = await get(`/game.php?village=${d.v.id}&screen=market&mode=other_offer${sitter}`);
		const form = inert(html0).find('#merchant_exchange_form')[0];
		if (!form) throw new Error(`Nie widzę oferty handlarza w ${short(d.v.name)} (brak Rynku / konta premium?).`);
		const before = parseGameDataVillage(html0);
		if (!before) throw new Error('Nie odczytałem stanu wioski ze strony Rynku.');
		const S_ = RES[d.sell], B_ = RES[d.buy];
		// świeży stan: nie sprzedaj więcej niż jest i nie kupuj ponad spichlerz
		const amount = floor1000(Math.min(d.amount, before[S_], before.storage_max - before[B_]));
		if (amount < 1000) return { skip: true };
		await sleep(S.sendDelay);
		const html1 = await $.post(form.getAttribute('action'), { res_buy: B_, res_sell: S_, sell: amount });
		const after = parseGameDataVillage(String(html1));
		if (!after) return { ok: false, why: 'brak odpowiedzi z nowym stanem' };
		const gain = after[B_] - before[B_], loss = before[S_] - after[S_];
		return { ok: gain >= amount * 0.5 && loss >= amount * 0.5, gain, loss, amount, after };
	}
	let advMix = null, mixBusy = false;
	async function runMix(list) {
		if (mixBusy) return;
		const todo = list.filter(d => !d.done);
		if (!todo.length) return;
		mixBusy = true;
		const stat = t => $('#' + NS + '_mixstat').html(t);
		let n = 0, pp = 0, stopped = '';
		try {
			for (const d of todo) {
				stat(`💱 ${n + 1}/${todo.length}: ${esc(short(d.v.name))} – ${RES_PL[d.sell].toLowerCase()} → ${RES_PL[d.buy].toLowerCase()}…`);
				let r;
				try { r = await npcDeal(d); } catch (e) { stopped = e.message || String(e); break; }
				if (r.skip) { d.done = true; $('#' + NS + '_mix_' + d.k).css('opacity', .4).find('.' + NS + '_mixgo').replaceWith('<span class="grey">pominięte</span>'); continue; }
				if (!r.ok) { stopped = `nie potwierdzono wymiany w ${short(d.v.name)} (${r.why || `+${r.gain} / −${r.loss}`}). Sprawdź stan wioski i PP – dalej nie idę.`; break; }
				d.done = true; n++; pp += d.pp;
				d.v.res = [r.after.wood, r.after.stone, r.after.iron].map(Math.floor);
				$('#' + NS + '_mix_' + d.k).css('opacity', .4).find('.' + NS + '_mixgo').replaceWith(`<span style="color:#060">✓ ${r.amount}</span>`);
			}
		} finally { mixBusy = false; }
		stat(`${stopped ? '✖ ' + esc(stopped) + '<br>' : ''}Wymieniono: <b>${n}</b> umów (~${pp} PP). ${n ? '<a href="#" id="' + NS + '_mixre">Przelicz plan</a>' : ''}`);
		$('#' + NS + '_mixre').on('click', e => { e.preventDefault(); renderAdvice(); });
	}
	function bindMix() {
		$(document).off('click.' + NS + 'mix').on('click.' + NS + 'mix', '.' + NS + '_mixgo', function (e) {
			e.preventDefault();
			const d = advMix && advMix.deals[Number(this.getAttribute('data-i'))];
			if (d) runMix([d]).catch(handleError);
		}).on('click.' + NS + 'mix', '#' + NS + '_mixall', function (e) {
			e.preventDefault();
			if (!advMix) return;
			const list = advMix.deals.filter(d => !d.done);
			if (!list.length) return;
			if (!confirm(`Wymienić u handlarza ${list.length} umów w ${new Set(list.map(d => d.v.id)).size} wioskach?\nKoszt: ok. ${list.length * S.advisor.npcPP} PP.\nSkrypt sprawdza każdą wymianę i zatrzyma się przy pierwszym problemie.`)) return;
			runMix(list).catch(handleError);
		});
	}

	function renderAdvice() {
		const o = loadAdv(), sel = loadSel();
		const rep = adviseCore(Object.assign({ opts: Object.assign({}, o, { order: sel.order, skipSup: sel.skipSup }) }, advData));
		plan = { sends: rep.sends }; lock = false; busy = false;
		const st = rep.stats, d = advData;
		const when = new Date(d.ts).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
		const retTxt = v => d.returns[v.id] != null ? ` · kupcy wolni za ~${fmtMin(d.returns[v.id] / 60)}` : '';
		const overRows = rep.overV.map(v => {
			const o_ = rep.out[v.id], ex = rep.exc.get(v.id);
			return `<tr class="row_b"><td>${vlink(v)}</td><td>${RES.map((_, r) => v.over[r] ? `${resSpan(r, v.res[r])} <span class="grey">${Math.round(100 * v.res[r] / v.cap)}% · pełny za ${ttfTxt(v.ttf[r])}</span>` : '').filter(Boolean).join('<br>')}</td>
				<td>${o_ ? 'wysyłam ' + resList(o_.res) : '<span class="grey">–</span>'}${sum3(ex) < S.carry ? ' <span class="grey">(nic ponad ' + S.advisor.reliefTo + '%)</span>' : ''}${v.tradersFree < 1 ? '<span class="grey"> brak wolnych kupców' + retTxt(v) + '</span>' : ''}</td></tr>`;
		}).join('');
		const blockRows = rep.blocks.map(b => {
			const g = rep.got[b.target] || [0, 0, 0], miss = b.need.map((n, r) => Math.max(0, n - g[r]));
			return `<tr class="row_b"><td>${vlink(b.v)}</td><td>${esc(b.what.replace('🏗 ', ''))}</td><td>${resList(b.cost)}</td><td>${sum3(g) ? resList(g) : '<span class="grey">–</span>'}</td><td>${sum3(miss) ? '<span style="color:#a00">' + resList(miss) + '</span>' : '<span style="color:#060">ok</span>'}</td></tr>`;
		}).join('');
		const npcRows = rep.npc.map(n => `<tr class="row_b"><td>${vlink(n.v)}</td><td>sprzedaj ${resSpan(n.sell, n.amount)}</td><td>kup ${resList(RES.map((_, r) => r === n.buy ? n.amount : 0))}</td><td>${n.pp} PP</td><td class="grey">${esc(n.why)}</td><td><a href="${marketLink(n.v)}" class="btn">Handlarz</a></td></tr>`).join('');
		const mx = rep.mix;
		advMix = mx;
		mx.deals.forEach((d, i) => { d.k = i; });
		const mixRows = mx.deals.slice(0, 60).map((d, i) => `<tr class="row_b" id="${NS}_mix_${i}"><td>${vlink(d.v)}</td><td>${resSpan(d.sell, d.amount)}</td><td>→ ${resList(RES.map((_, r) => r === d.buy ? d.amount : 0))}</td><td>${d.pp} PP</td><td><a href="#" class="btn ${NS}_mixgo" data-i="${i}">Wymień</a></td></tr>`).join('');
		const sugg = rep.suggestLock;
		Dialog.show(NS, `
			<h3>🧠 Doradca – wysyłka</h3>
			<div style="max-height:75vh;overflow:auto;-webkit-overflow-scrolling:touch">
			<p class="grey">Dane z ${when} · ${st.n} wiosek · prędkość świata ×${d.speed}${d.speedGuess ? ' <b style="color:#a00">(nie odczytałem z gry – ustaw advisor.gameSpeed)</b>' : ''} · produkcja liczona z poziomów kopalni (szacunek)${d.noBld ? ' · <b style="color:#a00">brak przeglądu budynków – bez prognozy przepełnienia i poziomów</b>' : ''}</p>
			<table class="vis" style="width:100%"><tbody><tr class="row_b"><td>
				Limit blokady kupców: <input type="number" id="${NS}_a_lock" min="1" max="96" value="${o.lockH}" style="width:45px"> h
				${sugg ? `<span class="grey">sugerowane: <b>${sugg} h</b> (tyle zwykle zajmuje przelewającej się wiosce ponowne zapełnienie po odciążeniu)</span> <a href="#" id="${NS}_a_use" data-v="${sugg}">użyj</a>` : ''}<br>
				Zagrożona, gdy pełna za mniej niż <input type="number" id="${NS}_a_risk" min="1" max="96" value="${o.riskH}" style="width:45px"> h ·
				przy dłuższej blokadzie zostaw <input type="number" id="${NS}_a_keep" min="0" max="90" value="${o.keepPct}" style="width:45px">% kupców
				<a href="#" class="btn" id="${NS}_a_calc">Przelicz</a> <a href="#" class="btn" id="${NS}_a_refetch">↻ Pobierz dane</a>
			</td></tr></tbody></table>
			<h4>💱 Miks surowców (handlarz)</h4>
			<p>Konto: ${RES.map((_, r) => RES_PL[r].toLowerCase() + ' <b>' + (mx.gFill[r] * 100).toFixed(1) + '%</b>').join(' · ')} – rozstrzał <b>${mx.spread.toFixed(1)} pp</b>${mx.spread <= o.mixTol ? ' <span style="color:#060">(w normie)</span>' : ''}.
			Dopuszczalny rozstrzał w wiosce <input type="number" id="${NS}_a_mtol" min="0.5" max="40" step="0.5" value="${o.mixTol}" style="width:45px"> pp ·
			min. umowa <input type="number" id="${NS}_a_mmin" min="1000" step="1000" value="${o.mixMin}" style="width:65px"> ·
			budżet <input type="number" id="${NS}_a_mpp" min="0" step="10" value="${o.ppBudget}" style="width:55px"> PP (0 = bez limitu) <a href="#" class="btn" id="${NS}_a_calc2">Przelicz</a><br>
			${mx.deals.length ? `Plan: <b>${mx.deals.length}</b> umów w ${mx.nVillages} wioskach, przerzut ~${mx.amount.toLocaleString('pl-PL')} surowca, koszt <b>${mx.pp} PP</b>${mx.deferred.length ? ` <span class="grey">(jeszcze ${mx.deferred.length} umów poza budżetem)</span>` : ''}.
			<a href="#" class="btn" id="${NS}_mixall">💱 Wymień wszystko (${mx.pp} PP)</a>` : '<span class="grey">Nic do wymiany przy tych ustawieniach.</span>'}
			<span id="${NS}_mixstat" class="grey"></span><br>
			<span class="grey">Każda wioska zamienia swój nadmiar jednego surowca (1:1, natychmiast, bez transportów) na braki pozostałych, tak by wszystkie trzy miały to samo % spichlerza. Potem uruchom tryb <b>Wyrównaj</b> – roześle już po równo, a nie samą glinę. Skrypt sprawdza stan wioski po każdej umowie i przerywa przy problemie.</span></p>
			${mx.deals.length ? `<table class="vis" style="width:100%"><tbody><tr><th>Wioska</th><th>Sprzedaj</th><th>Kup</th><th>Koszt</th><th></th></tr>${mixRows}</tbody></table>${mx.deals.length > 60 ? `<p class="grey">…i ${mx.deals.length - 60} kolejnych (użyj „Wymień wszystko”).</p>` : ''}` : ''}
			<p><b>Podsumowanie:</b> przelewa się lub zagrożonych: <b>${st.over}</b> · zagroda pełna / spichlerz &lt; ${S.advisor.storageLevel}: <b>${rep.blocks.length + rep.ready.length}</b> (zagroda ${st.farm}, spichlerz ${st.storage}) · wysyłek: <b id="${NS}_left">${rep.sends.length}</b> · do wymiany u handlarza: <b>${rep.npc.length}</b><br>
			<span class="grey">Stan wszystkich wiosek: ${RES.map((_, r) => resSpan(r, rep.tot[r]) + ' <span class="grey">' + Math.round(100 * rep.tot[r] / Math.max(1, rep.capAll / 1)) + '%</span>').join(' ')} (pojemność ${rep.capAll.toLocaleString('pl-PL')} na surowiec)</span></p>
			${rep.sends.length ? `<p><a href="#" class="btn" id="${NS}_all">▶ Wyślij wszystko</a></p>
				<table class="vis" id="${NS}_table" style="width:100%"><tbody><tr><th>Skąd → dokąd</th><th>Pól</th><th>Czas</th><th>Kupców</th><th>Surowce</th><th></th></tr>${rep.sends.map(rowHtml).join('')}</tbody></table>`
				: `<table id="${NS}_table"><tbody></tbody></table><p>Nic do wysłania.</p>`}
			${rep.overV.length ? `<h4>Przelewające się / zagrożone (${rep.overV.length})</h4><table class="vis" style="width:100%"><tbody><tr><th>Wioska</th><th>Surowce</th><th>Co z tym</th></tr>${overRows}</tbody></table>` : '<p class="grey">Żadna wioska nie jest zagrożona przepełnieniem.</p>'}
			${rep.noQueue.length ? `<p class="grey">Przelewają się i mają <b>pustą kolejkę budowy</b> – najprościej wydać na budowę: ${rep.noQueue.slice(0, 20).map(n => esc(short(n))).join(', ')}</p>` : ''}
			${rep.blocks.length || rep.ready.length ? `<h4>Rozbudowa: zagroda / spichlerz ${S.advisor.storageLevel}</h4>${rep.blocks.length ? `<table class="vis" style="width:100%"><tbody><tr><th>Wioska</th><th>Budynek</th><th>Koszt</th><th>Wysyłam</th><th>Nadal brakuje</th></tr>${blockRows}</tbody></table>` : ''}
				${rep.ready.length ? `<p class="grey">Mają już surowce – zleć budowę: ${rep.ready.map(x => esc(short(x.v.name)) + ' (' + esc(x.what) + ')').join(', ')}</p>` : ''}` : ''}
			${rep.notes.length ? `<p class="error">${rep.notes.map(esc).join('<br>')}</p>` : ''}
			${rep.npc.length ? `<h4>Handlarz (1:1, natychmiast, ${S.advisor.npcPP} PP za umowę)</h4><table class="vis" style="width:100%"><tbody><tr><th>Wioska</th><th>Sprzedaj</th><th>Kup</th><th>Koszt</th><th>Po co</th><th></th></tr>${npcRows}</tbody></table>
				<p class="grey">Giełdy Premium nie proponuję (zwykle pełna). Kwotę wpisz w oknie handlarza; skrypt niczego sam nie wymienia, bo to kosztuje PP.</p>` : ''}
			</div>`);
		$('#' + NS + '_a_calc, #' + NS + '_a_calc2').on('click', e => { e.preventDefault(); applyAdvOpts(); renderAdvice(); });
		bindMix();
		$('#' + NS + '_a_refetch').on('click', e => { e.preventDefault(); applyAdvOpts(); runAdvisor(true).catch(handleError); });
		$('#' + NS + '_a_use').on('click', e => { e.preventDefault(); $('#' + NS + '_a_lock').val($(e.currentTarget).attr('data-v')); applyAdvOpts(); renderAdvice(); });
		bindSend();
	}
	function applyAdvOpts() {
		const g = (id, d, lo, hi) => { const v = Number($('#' + NS + id).val()); return isFinite(v) && v >= lo && v <= hi ? v : d; };
		const o = loadAdv();
		saveAdv({ lockH: g('_a_lock', o.lockH, 1, 96), riskH: g('_a_risk', o.riskH, 1, 96), keepPct: g('_a_keep', o.keepPct, 0, 90),
			mixTol: g('_a_mtol', o.mixTol, 0.5, 40), mixMin: g('_a_mmin', o.mixMin, 1000, 1000000), ppBudget: g('_a_mpp', o.ppBudget, 0, 100000) });
	}
	async function runAdvisor(refetch) {
		if (!advData || refetch) advData = await advFetch();
		renderAdvice();
	}
	function advButton(style) {
		return $(`<a href="#" class="btn ${NS}_advbtn" style="margin:4px 6px 4px 0;${style || ''}" title="Pobierz dane i doradź: przelewające się wioski, zagroda/spichlerz 30, handlarz">🧠 Doradca</a>`)
			.on('click', e => {
				e.preventDefault();
				const b = $(e.currentTarget);
				b.addClass('btn-disabled');
				runAdvisor(true).catch(handleError).then(() => b.removeClass('btn-disabled'));
			});
	}

	// ================= REJONY: ZWÓZ NADMIARU DO CENTRALI =================
	// Wioski dzielone są na rejony wg położenia (k-średnich po współrzędnych). W każdym rejonie centralą jest wioska
	// najbliżej środka (spośród tych z dużym spichlerzem). Do centrali zwozimy z najbliższych wiosek surowiec, którego
	// jest na koncie za dużo, aż centrala będzie miała X% spichlerza tego surowca – tam go potem wymieniasz u handlarza.
	const REG_KEY = NS + '_reg_' + game_data.world;
	function loadReg() {
		let o = {};
		try { o = JSON.parse(localStorage.getItem(REG_KEY) || 'null') || {}; } catch (e) { /* ignore */ }
		const n = (k, d, lo, hi) => { const v = Number(o[k]); return o[k] !== undefined && isFinite(v) && v >= lo && v <= hi ? v : d; };
		return { res: o.res === 'auto' || [0, 1, 2].includes(Number(o.res)) && o.res !== undefined && o.res !== 'auto' ? (o.res === 'auto' ? 'auto' : Number(o.res)) : 'auto',
			k: n('k', 0, 0, 60), fillPct: n('fillPct', 90, 30, 100), keepPct: n('keepPct', 10, 0, 90), cross: typeof o.cross === 'boolean' ? o.cross : true, mode: ['auto', 'collect', 'dist'].includes(o.mode) ? o.mode : 'auto' };
	}
	const saveReg = o => { try { localStorage.setItem(REG_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } };

	// k-średnich po współrzędnych; deterministyczne (start: najdalsze od siebie wioski)
	function kmeans(vs, k) {
		const n = vs.length;
		if (k <= 1 || n <= 1) return [vs.slice()];
		k = Math.min(k, n);
		const cx = vs.reduce((a, v) => a + v.x, 0) / n, cy = vs.reduce((a, v) => a + v.y, 0) / n;
		const d2 = (a, b) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
		const first = vs.slice().sort((a, b) => d2(a, { x: cx, y: cy }) - d2(b, { x: cx, y: cy }) || a.id - b.id)[0];
		let cs = [{ x: first.x, y: first.y }];
		while (cs.length < k) {
			let best = null, bd = -1;
			for (const v of vs) { const d = Math.min(...cs.map(c => d2(v, c))); if (d > bd || (d === bd && best && v.id < best.id)) { bd = d; best = v; } }
			cs.push({ x: best.x, y: best.y });
		}
		let asg = new Array(n).fill(0);
		for (let it = 0; it < 30; it++) {
			let moved = false;
			vs.forEach((v, i) => {
				let b = 0, bd = Infinity;
				cs.forEach((c, ci) => { const d = d2(v, c); if (d < bd) { bd = d; b = ci; } });
				if (asg[i] !== b) { asg[i] = b; moved = true; }
			});
			cs = cs.map((c, ci) => {
				const m = vs.filter((_, i) => asg[i] === ci);
				return m.length ? { x: m.reduce((a, v) => a + v.x, 0) / m.length, y: m.reduce((a, v) => a + v.y, 0) / m.length } : c;
			});
			if (!moved) break;
		}
		return cs.map((_, ci) => vs.filter((_, i) => asg[i] === ci)).filter(g => g.length);
	}

	// czysta logika (bez DOM)
	function regionPlan(villages, incoming, o, skipSup) {
		if (o.k > 0) return regionPlanK(villages, incoming, o, skipSup, Math.min(o.k, villages.length));
		// auto: najwięcej rejonów (= najkrótsze trasy), przy których nadmiar wystarcza na napełnienie wszystkich central
		let best = null;
		for (let k = Math.max(1, Math.floor(villages.length / 3)); k >= 1; k--) {
			const p = regionPlanK(villages, incoming, o, skipSup, k);
			p.auto = true;
			if (!best || p.unmet < best.unmet) best = p;
			if (p.unmet < S.carry) { best = p; break; }
		}
		return best;
	}
	function regionPlanK(villages, incoming, o, skipSup, kForced) {
		const carry = S.carry;
		villages.forEach(v => { v.inc = incoming[v.id] || [0, 0, 0]; v.keepOwn = null; });
		const tot = [0, 0, 0]; let capAll = 0;
		villages.forEach(v => { RES.forEach((_, r) => { tot[r] += v.res[r] + v.inc[r]; }); capAll += v.cap; });
		const gFill = tot.map(x => x / Math.max(1, capAll));
		const r = o.res === 'auto' ? gFill.indexOf(Math.max(...gFill)) : Number(o.res);
		const k = kForced;
		const groups = kmeans(villages, k);
		const regions = groups.map(g => {
			const maxCap = Math.max(...g.map(v => v.cap));
			const cand = g.filter(v => v.cap >= 0.8 * maxCap);
			const hub = cand.slice().sort((a, b) => g.reduce((s, v) => s + dist(a, v), 0) - g.reduce((s, v) => s + dist(b, v), 0) || a.id - b.id)[0];
			const need = floor1000(o.fillPct / 100 * hub.cap - hub.res[r] - hub.inc[r]);
			return { hub, members: g, need, got: 0, left: need, sends: [] };
		});
		const hubIds = new Set(regions.map(x => x.hub.id));
		const eligible = villages.filter(v => !hubIds.has(v.id) && v.tradersFree > S.tradersSafeguard && !(skipSup && sum3(v.inc) >= S.suppliedThreshold));
		eligible.forEach(v => { v.keepOwn = RES.map((_, i) => i === r ? Math.floor(o.keepPct / 100 * v.cap) : v.res[i]); });
		const usedRes = {}, usedM = {};
		const take = (donors, reg) => {
			const vec = RES.map((_, i) => i === r ? reg.left : 0);
			if (vec[r] < carry || !donors.length) return;
			const head = RES.map((_, i) => i === r ? Math.max(0, reg.hub.cap - reg.hub.res[r] - reg.hub.inc[r] - reg.got) : 0);
			const item = { target: reg.hub.id, name: reg.hub.name, v: reg.hub, need: vec, headroom: head, what: `🗺️ ${RES_PL[r].toLowerCase()} do centrali` };
			const { sends } = allocate([item], donors, 'near', null);
			sends.forEach(s => {
				s.reg = true;
				reg.sends.push(s); reg.got += s.res[r]; reg.left = Math.max(0, reg.need - reg.got);
				const u = usedRes[s.from] || (usedRes[s.from] = [0, 0, 0]);
				s.res.forEach((n, i) => { u[i] += n; });
				usedM[s.from] = (usedM[s.from] || 0) + s.merchants;
			});
		};
		const rest = list => list.map(v => Object.assign({}, v, { res: v.res.map((n, i) => n - ((usedRes[v.id] || [0, 0, 0])[i])), tradersFree: v.tradersFree - (usedM[v.id] || 0) }));
		// 1) z własnego rejonu
		regions.forEach(reg => take(rest(eligible.filter(v => reg.members.includes(v))), reg));
		// 2) brakujące – od najbliższych z pozostałych rejonów
		if (o.cross) regions.filter(x => x.left >= carry).sort((a, b) => b.left - a.left).forEach(reg => take(rest(eligible), reg));
		const sends = [].concat(...regions.map(x => x.sends));
		sends.forEach((s, i) => { s.i = i; s.done = false; });
		return { r, gFill, k: groups.length, regions, sends, moved: sends.reduce((a, s) => a + s.res[r], 0), unmet: regions.reduce((a, x) => a + x.left, 0) };
	}

	// Drugi etap: po wymianie u handlarza centrala rozsyła nadwyżki do wiosek swojego rejonu (do średniej rejonu).
	function regionDist(villages, incoming, o) {
		let saved = null;
		try { saved = JSON.parse(localStorage.getItem(RGKEY) || 'null'); } catch (e) { /* ignore */ }
		villages.forEach(v => { v.inc = incoming[v.id] || [0, 0, 0]; v.keepOwn = null; });
		const byId = {}; villages.forEach(v => { byId[v.id] = v; });
		let groups = [];
		if (saved && saved.regions && saved.regions.length) groups = saved.regions.map(g => ({ hub: byId[g.hub], members: g.members.map(i => byId[i]).filter(Boolean) })).filter(g => g.hub && g.members.length);
		const skipR = saved && saved.r !== undefined ? saved.r : -1;
		if (!groups.length) {
			const k = o.k > 0 ? Math.min(o.k, villages.length) : Math.max(1, Math.round(villages.length / 12));
			groups = kmeans(villages, k).map(g => {
				const mc = Math.max(...g.map(v => v.cap));
				const hub = g.filter(v => v.cap >= 0.8 * mc).sort((a, b) => g.reduce((q, v) => q + dist(a, v), 0) - g.reduce((q, v) => q + dist(b, v), 0) || a.id - b.id)[0];
				return { hub, members: g };
			});
		}
		const regions = groups.map(g => {
			const all = g.members.includes(g.hub) ? g.members : g.members.concat(g.hub);
			const hub = g.hub;
			const capSum = all.reduce((a, v) => a + v.cap, 0);
			const mean = RES.map((_, i) => all.reduce((a, v) => a + v.res[i] + v.inc[i], 0) / Math.max(1, capSum));
			// dawcą jest KAŻDA wioska rejonu, która ma dany surowiec ponad średnią rejonu (centrala po wymianie też)
			const donors = all.filter(v => v.tradersFree > S.tradersSafeguard).map(v => Object.assign({}, v, {
				keepOwn: RES.map((_, i) => i === skipR ? v.res[i] : Math.max(Math.ceil(mean[i] * v.cap), Math.floor(o.keepPct / 100 * v.cap)))
			}));
			const items = all.map(v => ({
				target: v.id, name: v.name, v,
				need: RES.map((_, i) => i === skipR ? 0 : floor1000(Math.max(0, mean[i] * v.cap - v.res[i] - v.inc[i]))),
				headroom: RES.map((_, i) => Math.max(0, v.cap - v.res[i] - v.inc[i])), what: '🗺️ w rejonie'
			})).filter(it => it.need.some(n => n >= S.carry)).sort((a, b) => sum3(b.need) - sum3(a.need));
			const out = items.length && donors.length ? allocate(items, donors, 'near', null).sends : [];
			const gave = out.reduce((a, s) => a.map((n, i) => n + s.res[i]), [0, 0, 0]);
			const wantedSum = items.reduce((a, it) => a + sum3(it.need), 0), gaveSum = sum3(gave);
			const surplus = all.reduce((a, v) => a + RES.reduce((q, _, i) => q + (i === skipR ? 0 : Math.max(0, v.res[i] - Math.max(Math.ceil(mean[i] * v.cap), Math.floor(o.keepPct / 100 * v.cap)))), 0), 0);
			const why = !items.length ? '✔ wioski rejonu mają już średnią'
				: !donors.length ? '⛔ w całym rejonie brak wolnych kupców – poczekaj, aż wrócą'
				: surplus < S.carry ? `⚠ nikt w rejonie nie ma nadwyżki ponad średnią (średnio ${Math.round(100 * (mean[0] + mean[1] + mean[2]) / 3)}% spichlerza) – najpierw zwieź/wymień`
				: gaveSum < wantedSum ? 'kupców/nadwyżek starcza na część – resztę dośle następnym razem' : '';
			return { hub, why, members: all, mean, sends: out, gave, wanted: items.reduce((a, it) => a.map((n, i) => n + it.need[i]), [0, 0, 0]) };
		});
		const sends = [].concat(...regions.map(x => x.sends));
		// etap 2: między rejonami – do średniej całego konta (to, czego nie dało się wyrównać wewnątrz rejonów)
		let cross = 0;
		if (o.cross) {
			const st = villages.map(v => Object.assign({}, v, { res: v.res.slice() }));
			const by = {}; st.forEach(v => { by[v.id] = v; });
			sends.forEach(s => { s.res.forEach((n, i) => { by[s.from].res[i] -= n; by[s.to].res[i] += n; }); by[s.from].tradersFree -= s.merchants; });
			const capAll = st.reduce((a, v) => a + v.cap, 0);
			const gm = RES.map((_, i) => st.reduce((a, v) => a + v.res[i] + v.inc[i], 0) / Math.max(1, capAll));
			const donors = st.filter(v => v.tradersFree > S.tradersSafeguard).map(v => { v.keepOwn = RES.map((_, i) => i === skipR ? v.res[i] : Math.max(Math.ceil(gm[i] * v.cap), Math.floor(o.keepPct / 100 * v.cap))); return v; });
			const items = st.map(v => ({
				target: v.id, name: v.name, v,
				need: RES.map((_, i) => i === skipR ? 0 : floor1000(Math.max(0, gm[i] * v.cap - v.res[i] - v.inc[i]))),
				headroom: RES.map((_, i) => Math.max(0, v.cap - v.res[i] - v.inc[i])), what: '🗺️ między rejonami'
			})).filter(it => it.need.some(n => n >= S.carry)).sort((a, b) => sum3(b.need) - sum3(a.need));
			if (items.length && donors.length) {
				const ex = allocate(items, donors, 'near', null).sends;
				ex.forEach(s => { s.cross = true; });
				cross = ex.length; sends.push(...ex);
			}
		}
		sends.forEach((s, i) => { s.i = i; s.done = false; });
		const moved = sends.reduce((a, s) => a + sum3(s.res), 0);
		return { mode: 'dist', cross, skipR, regions, sends, moved, hasSaved: !!(saved && saved.regions) };
	}
	function distHtml(rep, when) {
		const merchants = rep.sends.reduce((a, s) => a + s.merchants, 0);
		const rows = rep.regions.slice().sort((a, b) => sum3(b.wanted) - sum3(a.wanted)).map(x => `<tr class="row_b"><td>${vlink(x.hub)}</td><td>${x.members.length}</td><td>${sum3(x.gave) ? resList(x.gave) : '<span class="grey">–</span>'}</td><td>${sum3(x.wanted) - sum3(x.gave) >= S.carry ? '<span style="color:#a00">' + resList(x.wanted.map((n, i) => Math.max(0, n - x.gave[i]))) + '</span>' : '<span style="color:#060">ok</span>'}</td><td>${x.why || ''}</td></tr>`).join('');
		return `<p>Wyrównuję w rejonach: wioski z nadwyżką (centrale po wymianie, ale też każda przepełniona) oddają najbliższym, które mają mniej niż <b>średnia rejonu</b> (osobno dla każdego surowca)${rep.skipR >= 0 ? ', <b>bez ' + RES_PL[rep.skipR].toLowerCase() + '</b> (to zwoziłeś)' : ''}. Wysyłek: <b id="${NS}_left">${rep.sends.length}</b>${rep.cross ? ' <span class="grey">(w tym ' + rep.cross + ' między rejonami)</span>' : ''} · kupców: <b>${Math.round(merchants)}</b> · razem ${sum3(rep.sends.reduce((a, s) => a.concat([s]), []).reduce((a, s) => s.res.map((n, i) => n + a[i]), [0, 0, 0])).toLocaleString('pl-PL')}
			${rep.hasSaved ? '' : '<br><span class="grey">Brak zapisanego podziału z zwózki – podzieliłem wioski na nowo.</span>'}</p>
			${rep.sends.length ? `<p><a href="#" class="btn" id="${NS}_all">▶ Wyślij wszystko</a></p>
				<table class="vis" id="${NS}_table" style="width:100%"><tbody><tr><th>Skąd → dokąd</th><th>Pól</th><th>Czas</th><th>Kupców</th><th>Surowce</th><th></th></tr>${rep.sends.map(rowHtml).join('')}</tbody></table>`
				: `<table id="${NS}_table"><tbody></tbody></table><p>Nic do rozesłania – patrz kolumna „Uwagi” (np. brak nadwyżek ponad średnią rejonu albo brak kupców).</p>`}
			<h4>Centrale</h4><table class="vis" style="width:100%"><tbody><tr><th>Centrala</th><th>Wiosek</th><th>Rozesłano</th><th>Nadal brakuje</th><th>Uwagi</th></tr>${rows}</tbody></table>`;
	}

	let regData = null;
	async function regFetch() {
		msg.info('Rejony: pobieram dane…', 3000);
		const cur = currentGroupId();
		let all = {};
		try { all = await loadProd('0'); } finally { try { await get(ovUrl('prod', cur)); } catch (e) { /* ignore */ } }
		const villages = Object.values(all);
		if (!villages.length) throw new Error('Nie odczytałem przeglądu produkcji.');
		let incoming = {};
		try { incoming = await readIncomingPerVillage(); } catch (e) { msg.err('Nie udało się odczytać transportów przychodzących – liczę z dziennika wysyłek.', 5000); }
		mergeLedger(incoming);
		return { villages, incoming, ts: Date.now() };
	}
	function renderRegions() {
		const o = loadReg(), sel = loadSel();
		let rep = null;
		if (o.mode !== 'collect') { const d = regionDist(regData.villages, regData.incoming, o); if (o.mode === 'dist' || d.sends.length) rep = d; }
		if (!rep) rep = regionPlan(regData.villages, regData.incoming, o, sel.skipSup);
		plan = { sends: rep.sends }; lock = false; busy = false;
		const when = new Date(regData.ts).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
		const modeSel = `Tryb <select id="${NS}_r_mode"><option value="auto"${o.mode === 'auto' ? ' selected' : ''}>auto (rozsyłaj, gdy są nadwyżki)</option><option value="collect"${o.mode === 'collect' ? ' selected' : ''}>zwóz do centrali</option><option value="dist"${o.mode === 'dist' ? ' selected' : ''}>rozsyłaj z centrali</option></select> · `;
		const settings = `<table class="vis" style="width:100%"><tbody><tr class="row_b"><td>${modeSel}
				Surowiec <select id="${NS}_r_res"><option value="auto"${o.res === 'auto' ? ' selected' : ''}>auto (najwyższy %)</option>${RES.map((_, i) => `<option value="${i}"${o.res === i ? ' selected' : ''}>${RES_PL[i].toLowerCase()}</option>`).join('')}</select> ·
				rejonów <input type="number" id="${NS}_r_k" min="0" max="60" value="${o.k}" style="width:45px"> <span class="grey">(0 = auto)</span><br>
				centrala do <input type="number" id="${NS}_r_fill" min="30" max="100" value="${o.fillPct}" style="width:45px">% ·
				dawcy zostawiają <input type="number" id="${NS}_r_keep" min="0" max="90" value="${o.keepPct}" style="width:45px">% spichlerza ·
				<label><input type="checkbox" id="${NS}_r_cross"${o.cross ? ' checked' : ''}> łącz też między rejonami</label>
				<a href="#" class="btn" id="${NS}_r_calc">Przelicz</a> <a href="#" class="btn" id="${NS}_r_refetch">↻ Pobierz dane</a>
			</td></tr></tbody></table>`;
		const wire = () => {
			const apply = () => {
				const g = (id, d, lo, hi) => { const v = Number($('#' + NS + id).val()); return isFinite(v) && v >= lo && v <= hi ? v : d; };
				const rv = $('#' + NS + '_r_res').val();
				saveReg({ res: rv === 'auto' ? 'auto' : Number(rv), k: g('_r_k', o.k, 0, 60), fillPct: g('_r_fill', o.fillPct, 30, 100), keepPct: g('_r_keep', o.keepPct, 0, 90), cross: $('#' + NS + '_r_cross').is(':checked'), mode: $('#' + NS + '_r_mode').val() });
			};
			$('#' + NS + '_r_calc').on('click', e => { e.preventDefault(); apply(); renderRegions(); });
			$('#' + NS + '_r_refetch').on('click', e => { e.preventDefault(); apply(); runRegions(true).catch(handleError); });
			bindSend();
		};
		if (rep.mode === 'dist') {
			Dialog.show(NS, `<h3>🗺️ Rejony – rozsyłka z central</h3><div style="max-height:75vh;overflow:auto;-webkit-overflow-scrolling:touch"><p class="grey">Dane z ${when} · ${regData.villages.length} wiosek</p>${settings}${distHtml(rep, when)}</div>`);
			wire();
			return;
		}
		lastCollect = { r: rep.r, regions: rep.regions.map(x => ({ hub: x.hub.id, members: x.members.map(v => v.id) })) };
		const r = rep.r, merchants = rep.sends.reduce((a, s) => a + s.merchants, 0);
		const mean = rep.gFill.reduce((a, x) => a + x, 0) / 3;
		const order = [0, 1, 2].sort((a, b) => rep.gFill[a] - rep.gFill[b]);
		const lackest = order[0], mostest = order[2];
		const balHtml = `<p><b>Bilans konta:</b> ${order.slice().reverse().map(i => `${resSpan(i, 0).replace(/>[^<]*</, '>' + RES_PL[i].toLowerCase() + '<')} <b>${(rep.gFill[i] * 100).toFixed(1)}%</b> <span class="grey">(${(rep.gFill[i] - mean >= 0 ? '+' : '') + ((rep.gFill[i] - mean) * 100).toFixed(1)} pp od średniej)</span>`).join(' · ')}<br>
			${(rep.gFill[mostest] - rep.gFill[lackest]) * 100 < 1 ? '<span style="color:#060">Surowce są wyrównane.</span>' : `<b>👉 Najbardziej brakuje: ${RES_PL[lackest].toLowerCase()}</b> (${(rep.gFill[lackest] * 100).toFixed(1)}%), najwięcej jest: ${RES_PL[mostest].toLowerCase()}. ${rep.sends.length ? '' : 'Centrale mają już ' + RES_PL[r].toLowerCase() + ', więc wymień u handlarza w centralach na ' + RES_PL[lackest].toLowerCase() + ' (podpowiedź w kolumnie „Wymień").'}`}</p>`;
		const exch = h => {
			const got = rep.regions.find(x => x.hub === h).got;
			const fill = RES.map((_, i) => (h.res[i] + h.inc[i] + (i === r ? got : 0)) / h.cap);
			const m = fill.reduce((a, x) => a + x, 0) / 3, hi = fill.indexOf(Math.max(...fill));
			const ex = Math.floor((fill[hi] - m) * h.cap / 1000) * 1000;
			const defs = RES.map((_, i) => i === hi ? 0 : Math.max(0, m - fill[i]) * h.cap), sd = defs.reduce((a, x) => a + x, 0);
			if (ex < 1000 || sd < 1000) return '<span class="grey">–</span>';
			const use = Math.min(ex, sd);
			const parts = defs.map((d, i) => d > 0 ? resSpan(i, Math.floor(use * d / sd / 1000) * 1000) : '').filter(Boolean);
			return parts.length ? `${esc(RES_PL[hi].toLowerCase())} → ${parts.join(' ')}` : '<span class="grey">–</span>';
		};
		const regRows = rep.regions.slice().sort((a, b) => b.need - a.need).map(x => {
			const h = x.hub, after = h.res[r] + h.inc[r] + x.got;
			return `<tr class="row_b"><td>${vlink(h)}</td><td>${x.members.length}</td><td>${Math.round(100 * (h.res[r] + h.inc[r]) / h.cap)}% → <b>${Math.round(100 * after / h.cap)}%</b> <span class="grey">(${h.cap.toLocaleString('pl-PL')})</span></td><td>${x.got ? resSpan(r, x.got) : '<span class="grey">–</span>'}</td><td>${exch(h)}</td><td>${x.left >= S.carry ? '<span style="color:#a00">' + resSpan(r, x.left) + '</span>' : (x.need < S.carry ? '<span class="grey">już pełna</span>' : '<span style="color:#060">ok</span>')}</td></tr>`;
		}).join('');
		const hhmm = t => { const d = new Date(t), td = new Date(); const c = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); return d.toDateString() === td.toDateString() ? c : d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }) + ' ' + c; };
		const nowT = Date.now();
		const ev = lsGet(RSKEY).filter(e => e.arr > nowT - 3600000).map(e => ({ to: e.to, toName: e.toName, from: e.from, res: e.res, arr: e.arr, sent: true }))
			.concat(rep.sends.map(s => ({ to: s.to, toName: s.toName, from: s.fromName, res: s.res, arr: nowT + s.leg * 60000, sent: false })));
		const byHub = {};
		ev.forEach(e => { (byHub[e.to] = byHub[e.to] || { name: e.toName, list: [] }).list.push(e); });
		const schedRows = Object.keys(byHub).map(id => {
			const h = byHub[id], l = h.list.sort((a, b) => a.arr - b.arr), last = l[l.length - 1], sum = l.reduce((a, e) => a + e.res[r], 0);
			const state = l.every(e => e.sent) ? (last.arr <= nowT ? '✅ dotarło' : '🚚 w drodze') : (l.some(e => e.sent) ? '🚚 część w drodze, reszta w planie' : '🕓 plan (gdy wyślesz teraz)');
			return { last: last.arr, html: `<tr class="row_a"><td>${esc(short(h.name))}</td><td>${l.length}</td><td>${resSpan(r, sum)}</td><td>${hhmm(l[0].arr)}</td><td><b>${hhmm(last.arr)}</b>${last.arr > nowT ? ' <span class="grey">(za ' + fmtMin((last.arr - nowT) / 60000) + ')</span>' : ''}</td><td>${state}</td></tr>` };
		}).sort((a, b) => a.last - b.last).map(x => x.html).join('');
		const schedHtml = schedRows ? `<h4>📅 Harmonogram zwózek</h4><table class="vis" style="width:100%"><tbody><tr><th>Centrala</th><th>Dostaw</th><th>Razem</th><th>Pierwsza</th><th>Wszystko będzie</th><th>Status</th></tr>${schedRows}</tbody></table>
			<details><summary>Wszystkie dostawy wg godziny</summary><table class="vis" style="width:100%"><tbody>${ev.slice().sort((a, b) => a.arr - b.arr).map(e => `<tr class="row_b"><td>${hhmm(e.arr)}</td><td>${esc(short(e.from))} → ${esc(short(e.toName))}</td><td>${resSpan(r, e.res[r])}</td><td>${e.sent ? '🚚' : '🕓'}</td></tr>`).join('')}</tbody></table></details>` : '';
		Dialog.show(NS, `
			<h3>🗺️ Rejony – zwóz do centrali</h3>
			<div style="max-height:75vh;overflow:auto;-webkit-overflow-scrolling:touch">
			<p class="grey">Dane z ${when} · ${regData.villages.length} wiosek</p>
			${settings}
			${balHtml}
			<p>Zwożę: <b>${RES_PL[r].toLowerCase()}</b> (na koncie ${rep.gFill.map((x, i) => RES_PL[i].toLowerCase() + ' ' + (x * 100).toFixed(1) + '%').join(' · ')}) · rejonów: <b>${rep.regions.length}</b>${rep.auto ? ' <span class="grey">(auto)</span>' : ''} · wysyłek: <b id="${NS}_left">${rep.sends.length}</b> · kupców: <b>${Math.round(merchants)}</b> · razem ${resSpan(r, rep.moved)}${rep.unmet >= S.carry ? ` · <span style="color:#a00">nadal brakuje centralom ${resSpan(r, rep.unmet)}</span>` : ''}<br>
			<span class="grey">Centrala = wioska najbliżej środka rejonu (z dużym spichlerzem). Dawcy: najbliższe wioski, od najbliższej; każdy oddaje ${RES_PL[r].toLowerCase()} do ${o.keepPct}% swojego spichlerza, w pełnych tysiącach.</span></p>
			${rep.sends.length ? `<p><a href="#" class="btn" id="${NS}_all">▶ Wyślij wszystko</a></p>
				<table class="vis" id="${NS}_table" style="width:100%"><tbody><tr><th>Skąd → dokąd</th><th>Pól</th><th>Czas</th><th>Kupców</th><th>Surowce</th><th></th></tr>${rep.sends.map(rowHtml).join('')}</tbody></table>`
				: `<table id="${NS}_table"><tbody></tbody></table><p>Nic do wysłania.</p>`}
			${schedHtml}
			<h4>Centrale</h4><table class="vis" style="width:100%"><tbody><tr><th>Centrala</th><th>Wiosek</th><th>${esc(RES_PL[r])} w centrali</th><th>Zwożę</th><th>Wymień</th><th>Brakuje</th></tr>${regRows}</tbody></table>
			</div>`);
		wire();
	}
	async function runRegions(refetch) {
		if (!regData || refetch) regData = await regFetch();
		renderRegions();
	}
	function regButton(style) {
		return $(`<a href="#" class="btn ${NS}_regbtn" style="margin:4px 6px 4px 0;${style || ''}" title="Podziel wioski na rejony i zwieź nadmiar surowca do środkowych wiosek">🗺️ Rejony</a>`)
			.on('click', e => {
				e.preventDefault();
				const b = $(e.currentTarget);
				b.addClass('btn-disabled');
				runRegions(true).catch(handleError).then(() => b.removeClass('btn-disabled'));
			});
	}

	// ================= RATUSZ =================
	// Przycisk 📦 przy budynku i „Następny z Menedżera”: brakujące na budowę surowce wysyłane są tak samo jak w pozostałych trybach
	// (lista wysyłek, wiersz znika po kliknięciu). Dawcy wg ostatnio zapisanych ustawień okna „Dysponent – grupy”.
	function requestBuild(cost, what) {
		const v = game_data.village;
		const have = [v.wood, v.stone, v.iron].map(Math.floor);
		if (cost.some(c => c > v.storage_max)) return msg.err('Koszt przekracza pojemność spichlerza – najpierw rozbuduj spichlerz.');
		if (cost.every((c, i) => c <= have[i])) return msg.info('Masz już wystarczająco surowców na ten budynek.');
		const sel = Object.assign(loadSel(), { village: v.id, recip: [], rFrom: 0, rTo: 0, mode: 'cost', cost, what });
		runPlanner(sel).catch(handleError);
	}

	const BUILDINGS = Object.keys(game_data.village.buildings || {});
	const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
	const costOfRow = row => RES.map(r => Number($(row).find('td.cost_' + r).attr('data-cost')) || 0);

	function initMain() {
		const rows = $('#buildings tr[id^="main_buildrow_"]');
		if (!rows.length) return;
		rows.each(function () {
			const row = this;
			if ($(row).find('.' + NS + '_btn').length) return;
			const cost = costOfRow(row);
			if (cost.every(c => c === 0)) return;
			$(`<a href="#" class="btn ${NS}_btn" title="Wyślij brakujące surowce z innych wiosek" style="display:inline-block;margin-left:6px;padding:0 3px;font-size:10px;line-height:14px;vertical-align:middle">📦</a>`)
				.on('click', e => {
					e.preventDefault();
					try { requestBuild(cost, rowLabel(row)); } catch (ex) { handleError(ex); }
				})
				.appendTo($(row).find('td').first());
		});
		if (S.showManagerNext) showManagerButton();
	}
	function rowLabel(row) {
		const first = $(row).children('td').first();
		const nm = clean(first.find('a').first().text()) || row.id.replace('main_buildrow_', '');
		const na = $(row).find('a.btn-build').first().attr('data-level-next');
		const m = first.text().match(/(?:Poziom|Level|Stufe)\s*(\d+)/i);
		const lv = na ? Number(na) - 1 : (m ? Number(m[1]) : null);
		return lv === null ? nm : `${nm} ${lv} → ${lv + 1}`;
	}

	// ----- Menedżer Budowy: następny budynek (zakładka w Ratuszu, ramka „Następne zlecenie budowy”) -----
	function buildingFromIcon(el) {
		const $el = $(el);
		for (const node of $el.find('[class*="building-"]').addBack('[class*="building-"]').get()) {
			const m = (node.getAttribute('class') || '').match(/building-([a-z_]+)/);
			if (m && BUILDINGS.includes(m[1])) return m[1];
		}
		for (const a of $el.find('a[href*="screen="]').get()) {
			const m = (a.getAttribute('href') || '').match(/screen=([a-z_]+)/);
			if (m && BUILDINGS.includes(m[1])) return m[1];
		}
		for (const img of $el.find('img').get()) {
			const m = (img.getAttribute('src') || '').match(/buildings\/(?:mid\/|big\/)?([a-z_]+?)\d*\.(?:png|webp|gif)/);
			if (m && BUILDINGS.includes(m[1])) return m[1];
		}
		const withData = $el.find('[data-building]').attr('data-building');
		return withData && BUILDINGS.includes(withData) ? withData : null;
	}
	function buildingFromName(name) {
		const n = clean(name).toLowerCase();
		let found = null;
		$('#buildings tr[id^="main_buildrow_"]').each(function () {
			const rowName = clean($(this).find('td').first().find('a').first().text()).toLowerCase();
			if (rowName && (rowName === n || n.startsWith(rowName))) { found = this.id.replace('main_buildrow_', ''); return false; }
		});
		return found;
	}
	function managerTabUrl() {
		const links = $('a').filter(function () { return /^(Menedżer Budowy|Build(ing)? Manager|Bau-?Manager)$/i.test(clean($(this).text())); }).get();
		const tab = links.find(a => /screen=main/.test(a.getAttribute('href') || ''));
		return tab ? tab.getAttribute('href') : null;
	}
	function boxByHeader($root, re) {
		const head = $root.find('th, h3, h4, div, span, strong, td').filter(function () { return re.test(clean($(this).text())); }).first();
		if (!head.length) return null;
		if (!head.is('th')) { const sib = head.nextAll(); return sib.length ? sib : head.parent().nextAll().first(); }
		return head.closest('table').find('td').filter(function () { return !$.contains(this, head[0]); });
	}
	async function readManagerNext() {
		const url = managerTabUrl();
		if (!url) return { managed: false, reason: 'no-tab' };
		const html = await $.get(url);
		const $page = inert(html);
		const statusBox = boxByHeader($page, /^(Status wioski|Village status|Dorfstatus)$/i);
		const status = statusBox ? clean(statusBox.text()) : '';
		const nextBox = boxByHeader($page, /^(Następne zlecenie budowy|Next build(ing)? order|Nächster Bauauftrag)$/i);
		if (!nextBox || !nextBox.length) return { managed: /kontrol|control|verwalt/i.test(status), status, next: null, raw: ($page.find('#content_value').html() || html) };
		const name = clean(nextBox.text());
		return { managed: true, status, next: { name, building: buildingFromIcon(nextBox) || buildingFromName(name) }, raw: nextBox.parent().html() };
	}
	function copyDiagnostics(text) {
		const t = String(text).slice(0, 6000);
		const fallback = () => Dialog.show(NS + '_diag', `<p>Zaznacz i skopiuj:</p><textarea style="width:100%;height:200px">${esc(t)}</textarea>`);
		if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => msg.ok('Skopiowano – wklej mi to w czacie.'), fallback);
		else fallback();
	}
	function showManagerButton() {
		$('#' + NS + '_am').remove();
		const bar = $(`<div id="${NS}_am" class="info_box" style="margin:6px 0;padding:6px 8px"></div>`);
		$('#buildings').before(bar);
		$('<a href="#" class="btn">🏗️ Następny z Menedżera</a>').on('click', e => { e.preventDefault(); run(); }).appendTo(bar);
		function run() {
			$('#buildings tr[id^="main_buildrow_"]').css('outline', '').find('td').css('background', '');
			showManagerNext(bar).catch(handleError).then(() => {
				$('<a href="#" title="Sprawdź ponownie" style="margin-left:8px">↻</a>').on('click', e => { e.preventDefault(); run(); }).appendTo(bar);
			});
		}
	}
	async function showManagerNext(bar) {
		bar.text('🏗️ Menedżer budowy: wczytuję…');
		let data;
		try { data = await readManagerNext(); } catch (e) { bar.text('🏗️ Menedżer budowy: nie udało się pobrać zakładki menedżera.'); return; }
		if (data.reason === 'no-tab') { bar.text('🏗️ Menedżer budowy: brak zakładki „Menedżer Budowy” w Ratuszu (wioska niezarządzana albo brak konta premium).'); return; }
		if (!data.next) {
			bar.html('🏗️ Menedżer budowy: ' + (data.status ? esc(data.status) + ' ' : '') + (data.managed ? 'Brak następnego zlecenia (szablon zrealizowany?). ' : 'Wioska nie ma przypisanego szablonu. '));
			$('<a href="#">Kopiuj diagnostykę</a>').on('click', e => { e.preventDefault(); copyDiagnostics(data.raw); }).appendTo(bar);
			return;
		}
		const { name, building } = data.next;
		const row = building ? $('#main_buildrow_' + building) : $();
		const baseLvl = building ? (Number(game_data.village.buildings[building]) || 0) : 0;
		const queued = building ? $('#buildqueue tr[class*="buildorder_' + building + '"]').length : 0;
		const nextLvl = baseLvl + queued + 1;
		let html = `🏗️ Menedżer budowy – następny: <strong>${esc(name)}</strong>` + (building ? ` → poziom ${nextLvl}` : '') + (queued ? ` <span class="grey">(${queued} już w kolejce)</span>` : '');
		if (!row.length) {
			bar.html(html + ' – <span class="grey">nie znalazłem tego budynku na liście Ratusza</span> ');
			$('<a href="#">Kopiuj diagnostykę</a>').on('click', e => { e.preventDefault(); copyDiagnostics(data.raw); }).appendTo(bar);
			return;
		}
		row.css('outline', '2px solid #c1a264').find('td').css('background', 'rgba(193,162,100,.25)');
		const cost = costOfRow(row[0]);
		const v = game_data.village, have = [v.wood, v.stone, v.iron].map(Math.floor);
		const lack = cost.map((c, i) => Math.max(0, c - have[i]));
		if (cost.some(c => c > 0)) {
			html += '<br>Koszt: ' + cost.map((n, r) => resSpan(r, n)).join(' ');
			html += lack.some(n => n > 0) ? ' · <span style="color:#a00">brakuje: ' + lack.map((n, r) => resSpan(r, n)).join(' ') + '</span> ' : ' · <span style="color:#060">surowce są</span>';
		}
		if (data.status) html += `<br><span class="grey">${esc(data.status)}</span>`;
		bar.html(html);
		if (lack.some(n => n > 0)) {
			$('<a href="#" class="btn" style="margin-left:6px">📦 Wyślij</a>')
				.on('click', e => { e.preventDefault(); try { requestBuild(cost, rowLabel(row[0])); } catch (ex) { handleError(ex); } })
				.appendTo(bar);
		}
		$('<a href="#" style="margin-left:8px">↓ pokaż</a>').on('click', e => { e.preventDefault(); row[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); }).appendTo(bar);
	}

	if (typeof module !== 'undefined' && module.exports) module.exports = { regionDist, adviseCore, allocate, prodPerHour, mixPlan, npcDeal, regionPlan, kmeans, _renderReg: d => { regData = d; renderRegions(); }, _render: d => { advData = d; renderAdvice(); } };

	try {
		if (game_data.screen === 'market' && location.href.includes('mode=call')) initMarket();
		else if (game_data.screen === 'overview_villages') initLauncher();
		else if (game_data.screen === 'main') initMain();
	} catch (e) { handleError(e); }
})();
