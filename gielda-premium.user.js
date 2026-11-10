// ==UserScript==
// @name         Plemiona - Giełda Premium: alarm + wypełniacz
// @namespace    tw.gielda.wypelniacz
// @version      5.56
// @updateURL    https://raw.githubusercontent.com/Rokerio/noweRepo/main/gielda-premium.user.js
// @downloadURL  https://raw.githubusercontent.com/Rokerio/noweRepo/main/gielda-premium.user.js
// @description  Jeden skrypt do Giełdy Premium. Per surowiec ustawiasz poziom kursu (surowca za 1 PP): przy kursie >= limitu kupna / <= limitu sprzedaży skrypt alarmuje (dźwięk, powiadomienie, opcjonalnie telefon), a po kliknięciu "Kalkuluj najlepszą ofertę" wpisuje do formularza ilość dla jednego surowca z najlepszą ceną. Zapisuje też historię kursów. Potwierdzenie oferty w grze klikasz sam.
// @author       Roker
// @match        https://*.plemiona.pl/game.php*
// @grant        unsafeWindow
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @grant        GM_openInTab
// @connect      ntfy.sh
// @connect      api.pushover.net
// @connect      discord.com
// @connect      api.telegram.org
// @run-at       document-idle
// ==/UserScript==
// rejestr wersji dla Sprawdzacza skryptów (localStorage, osobny na każdym urządzeniu)
try{var __r=JSON.parse(localStorage.getItem('gdp_registry')||'{}');__r['gielda-premium']={v:'5.56',t:Date.now()};localStorage.setItem('gdp_registry',JSON.stringify(__r));}catch(e){}


(function () {
    'use strict';

    const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;

    // Na innych stronach gry dziala tylko "po zalogowaniu" i wczytanie przegladu wiosek (koniec pliku).
    const NA_GIELDZIE = /screen=market/.test(location.search) && /mode=exchange/.test(location.search);

    // ================= KONFIGURACJA =================
    const CONFIG = {
        limitSprzedazyStaly: 1900, // limit sprzedazy (kurs <=) - wspolny dla wszystkich kontynentow; puste pole / brak zapisu = ta wartosc
        // --- wypelniacz ---
        minPartiaKupna: 3000, // wioska do kupna musi pomiescic co najmniej tyle (lub tyle, ile limit pozwala kupic)
        zapasMagazynu: 0.02, // przy kupnie zostaw 2% pojemnosci magazynu wolne (produkcja rosnie, zeby nie przepelnic)
        rezerwaKupcow: 2,    // tylu kupcow zawsze zostaje wolnych
        minWypelnienie: 0.9, // ostatni kupiec ma byc zapelniony co najmniej w tylu (0.9 = min. 900 z 1000)
        rozrzutMax: 0.25,    // rozrzut: zamiast zawsze maksimum skrypt losuje do 25% mniej PP (min. 1 PP); 0 = wylaczony

        // --- alarm ---
        histereza: 10,       // o tyle kurs musi wrocic, zeby warunek sie zwolnil
        powtarzajCo: 60_000, // przypominaj co 60 s dopoki warunek trwa
        sygnalow: 3,         // (nieuzywane - patrz poziomy)
        // Natezenie alarmu zalezy od glebokosci przekroczenia limitu (w % limitu):
        //   sprzedaz: 1 - kurs/limit  (kurs spadl ponizej limitu),  kupno: kurs/limit - 1.
        // od - minimalna glebokosc, beepy/dl - liczba i dlugosc pikniec (s), co - przypominanie (ms, 0 = bez),
        // syrena - ciagly alarm "biegnij": spadek o 70% (np. limit 1400 -> kurs 420 i nizej).
        poziomy: [
            { od: 0,    beepy: 1, dl: 0.12, glosnosc: 0.06, co: 0 },
            { od: 0.10, beepy: 1, dl: 0.15, glosnosc: 0.08, co: 300_000 },
            { od: 0.20, beepy: 2, dl: 0.18, glosnosc: 0.10, co: 300_000 },
            { od: 0.30, beepy: 3, dl: 0.20, glosnosc: 0.12, co: 300_000 },
            { od: 0.40, beepy: 4, dl: 0.25, glosnosc: 0.16, co: 300_000 },
            { od: 0.50, beepy: 5, dl: 0.30, glosnosc: 0.20, co: 8_000 },
            { od: 0.60, beepy: 7, dl: 0.30, glosnosc: 0.26, co: 5_000 },
            { od: 0.70, syrena: true, glosnosc: 0.30, co: 7_000 },
        ],
        log: true,           // zapisuj historie kursow (CSV: gieldaCSV())

        // ---- POWIADOMIENIA NA TELEFON ----
        // Wymaga otwartej karty - to ona wysyla zadanie. Wybierz JEDEN kanal,
        // wpisz dane i ustaw wlaczone: true.
        push: {
            wlaczone: false,

            // 'ntfy' - najprostszy, darmowy, bez rejestracji.
            //   1. zainstaluj apke ntfy (Android/iOS)
            //   2. wymysl DLUGA losowa nazwe kanalu - kto ja zna, ten czyta
            //   3. zasubskrybuj ja w apce i wpisz ponizej
            // 'discord'  - webhook z ustawien kanalu na serwerze
            // 'telegram' - bot od @BotFather + wlasne chatId
            // 'pushover' - platny jednorazowo, token aplikacji + klucz uzytkownika
            kanal: 'ntfy',

            ntfyTemat: 'zmien-to-na-cos-losowego-8f3k2',
            discordWebhook: '',
            telegramToken: '',
            telegramChatId: '',
            pushoverToken: '',
            pushoverUser: '',

            // Nie wysylaj czesciej niz co tyle ms (osobno dla kazdego surowca).
            // Przypomnienia co 60 s zostaja lokalne - na telefon leci tylko
            // pierwsze wejscie w warunek.
            odstep: 15 * 60_000,
        },
    };
    // ================================================

    const RES = ['wood', 'stone', 'iron'];
    const NAZWY = { wood: 'Drewno', stone: 'Glina', iron: 'Żelazo' };
    const SWIAT = location.hostname.split('.')[0];
    // Zapis wiosek osobno dla kazdego konta (zastepstwo = inne wioski na tym samym swiecie).
    const GRACZ = (W.game_data && W.game_data.player && W.game_data.player.id) ? '_' + W.game_data.player.id : '';
    // Nowa karta nie dziedziczy sessionStorage (GM_openInTab) - znaczniki "wypelnij po przejsciu" przekazujemy przez localStorage (waznosc 20 s).
    const KEY_H = 'pe_handoff_' + SWIAT + GRACZ;
    try {
        const h = JSON.parse(localStorage.getItem(KEY_H));
        const id = W.game_data && W.game_data.village && String(W.game_data.village.id);
        if (h && Date.now() - h.t < 20_000 && (String(h.cel) === id || /^n/.test(String(h.cel)))) {
            for (const [k, v] of Object.entries(h.ss || {})) if (v !== null) sessionStorage.setItem(k, v);
            localStorage.removeItem(KEY_H);
        }
    } catch { /* brak */ }
    // W zastepstwie adresy gry maja parametr t= - zachowujemy go przy przejsciach i zapytaniach.
    const TQ = (() => { const t = new URLSearchParams(location.search).get('t'); return t ? '&t=' + encodeURIComponent(t) : ''; })();
    const T_START = Date.now();
    const KEY = 'pe_wypelniacz';
    const LOG_KEY = 'pe_log';

    const fmt = n => Math.round(n).toLocaleString('pl-PL');


    // ================= USTAWIENIA =================
    // Jedno miejsce prawdy: limity per surowiec. Te same liczby sa progami alarmu
    // i limitami wypelniacza.
    //   buy  - kupuj / alarm "TANIO", gdy kurs >= buy
    //   sell - sprzedawaj / alarm "DROGO", gdy kurs <= sell
    function domyslne() {
        const o = { budzet: null, auto: true, dzwiek: true, rozrzut: true, otworz: false, monety: false, monetyMin: 50, mennice: false, kupnoDoSlabej: true, kupnoPkt: 2000, sprzedazMinPkt: 2000, grupaKupna: '', grupaSprzedazy: '', kupnoNadmiar: null, sprzedazDoPelna: false, jedynka: true, nadmiarOkno: 2, nadmiarPrzerwa: 15, pokazDostawy: true, potok: false, nowaKarta: false };
        for (const r of RES) o[r] = { buy: null, sell: CONFIG.limitSprzedazyStaly, alarmBuy: true, alarmSell: true };
        return o;
    }

    const liczbaLubNull = v => (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : null;

    function wczytajUstawienia() {
        const ST = domyslne();
        try {
            const z = JSON.parse(localStorage.getItem(KEY));
            if (z && typeof z === 'object') {
                for (const r of RES) {
                    if (!z[r]) continue;
                    ST[r].buy = liczbaLubNull(z[r].buy);
                    ST[r].sell = liczbaLubNull(z[r].sell) || CONFIG.limitSprzedazyStaly;
                    if (typeof z[r].alarmBuy === 'boolean') ST[r].alarmBuy = z[r].alarmBuy;
                    if (typeof z[r].alarmSell === 'boolean') ST[r].alarmSell = z[r].alarmSell;
                }
                ST.budzet = liczbaLubNull(z.budzet);
                if (typeof z.auto === 'boolean') ST.auto = z.auto;
                if (typeof z.dzwiek === 'boolean') ST.dzwiek = z.dzwiek;
                if (typeof z.rozrzut === 'boolean') ST.rozrzut = z.rozrzut;
                if (typeof z.otworz === 'boolean') ST.otworz = z.otworz;
                if (typeof z.monety === 'boolean') ST.monety = z.monety;
                if (typeof z.mennice === 'boolean') ST.mennice = z.mennice;
                if (typeof z.kupnoDoSlabej === 'boolean') ST.kupnoDoSlabej = z.kupnoDoSlabej;
                if ('kupnoPkt' in z) ST.kupnoPkt = liczbaLubNull(z.kupnoPkt);
                if ('sprzedazMinPkt' in z) ST.sprzedazMinPkt = liczbaLubNull(z.sprzedazMinPkt);
                if (typeof z.sprzedazDoPelna === 'boolean') ST.sprzedazDoPelna = z.sprzedazDoPelna;
                if (typeof z.jedynka === 'boolean') ST.jedynka = z.jedynka;
                if (typeof z.potok === 'boolean') ST.potok = z.potok;
                if (typeof z.pokazDostawy === 'boolean') ST.pokazDostawy = z.pokazDostawy;
                if (typeof z.nowaKarta === 'boolean') ST.nowaKarta = z.nowaKarta;
                if (liczbaLubNull(z.nadmiarOkno)) ST.nadmiarOkno = z.nadmiarOkno;
                if (liczbaLubNull(z.nadmiarPrzerwa)) ST.nadmiarPrzerwa = z.nadmiarPrzerwa;
                if ('kupnoNadmiar' in z) ST.kupnoNadmiar = liczbaLubNull(z.kupnoNadmiar);
                if (typeof z.grupaKupna === 'string') ST.grupaKupna = z.grupaKupna;
                if (typeof z.grupaSprzedazy === 'string') ST.grupaSprzedazy = z.grupaSprzedazy;
                if (liczbaLubNull(z.monetyMin)) ST.monetyMin = z.monetyMin;
                return ST;
            }
        } catch { /* uszkodzony zapis */ }

        // Pierwsze uruchomienie: przenies progi ze starego skryptu "alarm kursu".
        try {
            const a = JSON.parse(localStorage.getItem('pe_ustawienia_' + SWIAT));
            if (a && Number.isFinite(a.kup) && Number.isFinite(a.sprzedaj)) {
                for (const r of RES) {
                    ST[r].buy = a.kup;
                    ST[r].sell = a.sprzedaj;
                    if (typeof a.alarmy?.[r]?.kup === 'boolean') ST[r].alarmBuy = a.alarmy[r].kup;
                    if (typeof a.alarmy?.[r]?.sprzedaj === 'boolean') ST[r].alarmSell = a.alarmy[r].sprzedaj;
                }
                if (typeof a.dzwiek === 'boolean') ST.dzwiek = a.dzwiek;
            }
        } catch { /* brak starego zapisu */ }
        return ST;
    }

    const ST = wczytajUstawienia();

    function zapiszUstawienia() {
        try { localStorage.setItem(KEY, JSON.stringify(ST)); } catch { /* brak miejsca / zablokowane */ }
    }


    // ================= MODEL CENY GRY =================
    //   cena (PP za 1 szt) = base - elasticity * magazyn / (pojemnosc + modifier)
    // Kupno zabiera surowiec z magazynu gieldy -> cena rosnie w trakcie.
    // Sprzedaz dokłada surowiec -> cena spada w trakcie. Podatek: kupno 3%, sprzedaz 0.
    // Kurs w tabeli gry = ile surowca dostajesz za 1 PP = 1 / (cena * (1 + podatek kupna)).
    // Ten sam kurs (jak w tabeli) jest miara dla alarmu i dla limitow kupna i sprzedazy.
    function model() {
        const d = W.PremiumExchange && W.PremiumExchange.data;
        if (!d || !d.stock || !d.capacity || !d.constants || !d.rates) return null;
        const c = d.constants;
        const m = { tb: d.tax ? d.tax.buy : 0.03, ts: d.tax ? d.tax.sell : 0, s: {} };
        for (const r of RES) {
            m.s[r] = {
                p0: d.rates[r],
                k: c.resource_price_elasticity / (d.capacity[r] + c.stock_size_modifier),
                stock: d.stock[r],
                cap: d.capacity[r],
            };
        }
        return m;
    }

    // Kurs jak w tabeli giełdy. Najpewniejsze zrodlo to wlasna metoda gry.
    function kursTabeli(m, r) {
        const pe = W.PremiumExchange;
        if (typeof pe?.calculateRateForOnePoint === 'function') {
            try {
                const v = pe.calculateRateForOnePoint(r);
                if (Number.isFinite(v)) return v;
            } catch { /* metoda moze zniknac po aktualizacji gry */ }
        }
        return Math.floor(1 / (m.s[r].p0 * (1 + m.tb)));
    }

    const kosztKupna = (m, r, n) => n * (m.s[r].p0 + m.s[r].k * n / 2) * (1 + m.tb);
    const zwrotSprzedazy = (m, r, n) => n * (m.s[r].p0 - m.s[r].k * n / 2) * (1 - m.ts);


    // ================= STAN WIOSKI / KONTA =================
    function liczba(txt) {
        const n = parseInt(String(txt).replace(/\D/g, ''), 10);
        return Number.isFinite(n) ? n : null;
    }

    // Surowce w drodze do tej wioski ("Przybywające" w oknie rynku) - zajmą miejsce w magazynie.
    // Punkty tej wioski (game_data.village.points).
    function punktyWioski() {
        const v = W.game_data && W.game_data.village;
        const n = v ? liczba(v.points) : null;
        return n === null ? 0 : n;
    }

    function przybywajace() {
        const out = { wood: 0, stone: 0, iron: 0 };
        for (const th of document.querySelectorAll('#market_status_bar th')) {
            if (!/Przybywaj/i.test(th.textContent)) continue;
            for (const sp of th.querySelectorAll('.nowrap')) {
                const ic = sp.querySelector('.icon');
                const r = ic && RES.find(x => ic.classList.contains(x));
                if (r) out[r] += liczba(sp.textContent) || 0;
            }
        }
        return out;
    }

    function wioska(r) {
        const v = W.game_data && W.game_data.village;
        let ma = v ? Number(v[r]) : NaN;
        if (!Number.isFinite(ma)) { const el = document.getElementById(r); ma = el ? liczba(el.textContent) : 0; }
        let max = v ? Number(v.storage_max) : NaN;
        if (!Number.isFinite(max)) { const el = document.getElementById('storage'); max = el ? liczba(el.textContent) : Infinity; }
        const przyb = przybywajace()[r] || 0;
        return { ma, max, przyb, wolne: Math.max(0, max - ma - przyb) };
    }

    function punktyPremium() {
        const p = W.game_data && W.game_data.player && Number(W.game_data.player.pp);
        if (Number.isFinite(p)) return p;
        const el = document.getElementById('premium_points');
        return el ? (liczba(el.textContent) || 0) : 0;
    }

    function wolniKupcy() {
        const e = document.getElementById('market_merchant_available_count');
        const n = e ? liczba(e.textContent) : null;
        return n === null ? 0 : n;
    }

    // Ile unosi jeden kupiec (zwykle 1000).
    function naKupca() {
        const get = id => { const e = document.getElementById(id); return e ? liczba(e.textContent) : null; };
        const wolni = get('market_merchant_available_count');
        const max = get('market_merchant_max_transport');
        return wolni > 0 && max !== null ? max / wolni : 1000;
    }

    // Udzwig dostepny dla skryptu = wolni kupcy minus rezerwa.
    function udzwigKupcow() {
        const get = id => { const e = document.getElementById(id); return e ? liczba(e.textContent) : null; };
        const wolni = get('market_merchant_available_count');
        const max = get('market_merchant_max_transport');
        if (wolni === null || max === null) return Infinity;
        const naKupca = wolni > 0 ? max / wolni : 1000;
        return Math.max(0, wolni - CONFIG.rezerwaKupcow) * naKupca;
    }


    // ================= WYPELNIACZ: ILOSCI =================
    // Najmniejszy z limitow + nazwa tego, ktory zadecydowal.
    function najmniejszy(lista) {
        let best = lista[0];
        for (const x of lista) if (x[0] < best[0]) best = x;
        return { n: Math.max(0, Math.floor(best[0])), powod: best[1] };
    }

    // Rozrzut: zamiast zawsze brac maksimum PP, losujemy z przedzialu [(1-rozrzutMax)*max, max], min. 1 PP.
    // Ilosci nie sa wtedy za kazdym razem takie same przy tych samych kursach i limitach.
    // Limity kursu i budzetu nadal obowiazuja - rozrzut idzie tylko w dol.
    // Tryb "kup tanio -> sprzedaj na dawcy": bez rozrzutu, sprzedaz tylko do limitu (nie do pelna).
    const rozrzutOn = () => ST.rozrzut && !ST.potok;
    // W trybie potoku limit sprzedazy surowca, ktory przed chwila kupiles, to co najmniej kurs sprzed zakupu:
    // sprzedaz ma tylko oddac gieldzie to, co wzieles (zamiast zgadywac limit recznie).
    function limitSprzedazy(r) {
        const baza = ST[r].sell;
        if (!ST.potok) return baza;
        try {
            const f = JSON.parse(sessionStorage.getItem('pe_potok_cel'));
            if (f && f.r === r && Date.now() - f.t < 30 * 60_000 && Number.isFinite(f.kurs)) return Math.max(baza || 0, f.kurs);
        } catch { /* brak */ }
        return baza;
    }
    const doPelna = () => ST.sprzedazDoPelna && !ST.potok;
    // Gielda wypchnieta na maksa: wolnego miejsca zostalo mniej, niz warte jest 1 PP (kurs wtedy jest zly, wiec limit
    // sprzedazy nie zadziala). Gra i tak zaokragla oferte w gore do pelnego PP, wiec wpisanie 1 szt. daje oferte
    // za 1 PP - gra sama dobiera ilosc (reszta miejsca na gieldzie). Warunek: surowiec w wiosce + wolny kupiec.
    function jedynkaSprzedaz(m, r) {
        if (!ST.jedynka) return null;
        const a = m.s[r], w = wioska(r);
        const miejsce = Math.floor(a.cap - a.stock);
        const nJedenPP = Math.floor((a.p0 - Math.sqrt(Math.max(0, a.p0 * a.p0 - 2 * a.k / (1 - m.ts)))) / a.k);
        if (!(miejsce >= 1) || miejsce >= nJedenPP) return null;   // gielda nie jest jeszcze na maksa
        if ((w.ma || 0) < 1 || wolniKupcy() < 1) return null;
        return { r, typ: 'sell', n: 1, pp: 1, miejsce, jedynka: true };
    }
    function losujPP(pMax) {
        if (!rozrzutOn() || CONFIG.rozrzutMax <= 0 || pMax <= 1) return pMax;
        const odjac = Math.floor(Math.random() * (pMax * CONFIG.rozrzutMax + 1));
        return Math.max(1, pMax - odjac);
    }

    // Gra rozlicza w calych PP: ilosc, ktora wpiszesz, po "Kalkuluj" jest dopasowywana do pelnej
    // kwoty PP (w gore). Dlatego rozsadne sa tylko ilosci lezace na granicy pelnych PP:
    //   kupno:    n szt. kosztuje P PP:  n = (-p0 + sqrt(p0^2 + 2kP/(1+tb))) / k   (w dol)
    //   sprzedaz: n szt. daje P PP:      n = (p0 - sqrt(p0^2 - 2kP/(1-ts))) / k   (w dol!)
    // Przy sprzedazy tez w DOL: gra liczy PP z zaokragleniem w gore, wiec 1607 szt. warte 1.004 PP
    // gra wycenia na 2 PP i podbija do 3268 szt. Ilosc wartosci <= P daje dokladnie P PP.
    // Kazdy kupiec unosi 1000, wiec z calkowitych P wybieramy takie, przy ktorym ostatni kupiec jest
    // prawie pelny (zeby nie wiozl 100-200 szt.). Z tych o wypelnieniu >= minWypelnienie bierzemy
    // najwieksze P; jesli zadne nie spelnia progu - to z najlepszym wypelnieniem.
    function dobierzIlosc(m, r, x, typ) {
        const a = m.s[r], per = naKupca();
        const wartosc = typ === 'buy' ? kosztKupna(m, r, x.n) : zwrotSprzedazy(m, r, x.n);
        const ilosc = typ === 'buy'
            ? P => Math.floor((-a.p0 + Math.sqrt(a.p0 * a.p0 + 2 * a.k * P / (1 + m.tb))) / a.k)
            : P => Math.floor((a.p0 - Math.sqrt(Math.max(0, a.p0 * a.p0 - 2 * a.k * P / (1 - m.ts)))) / a.k);
        // przy sprzedazy ilosc tuz pod granica P (wartosc 0.9998 PP) tez liczy sie jako P PP
        let pMax = Math.floor(wartosc + 1e-6);
        if (typ === 'sell' && pMax < 1 && x.n >= ilosc(1)) pMax = 1;
        if (pMax < 1) return { n: 0, pp: 0, powod: x.powod + ' (poniżej 1 PP)' };
        let best = null;
        const kand = [];
        // wypelnienie ostatniego kupca liczy sie tylko wsrod ilosci bliskich maksimum (>= ~90% maksymalnych PP, max 1 PP mniej),
        // zeby preferencja "pelny kupiec" nie ucinala duzej sprzedazy do kilku PP
        const dolnaP = Math.max(1, Math.min(pMax - 1, Math.ceil(pMax * 0.9)));
        for (let P = dolnaP; P <= pMax; P++) {
            const n = Math.min(x.n, ilosc(P));
            if (n < 1) continue;
            const kupcy = Math.ceil(n / per);
            const fill = (n - (kupcy - 1) * per) / per; // jak pelny jest ostatni kupiec
            const ok = fill >= CONFIG.minWypelnienie;
            const c = { n, pp: P, kupcy, fill, ok, ostatni: n - (kupcy - 1) * per, powod: x.powod };
            kand.push(c);
            const lepszy = !best
                || (ok && !best.ok)
                || (ok === best.ok && P > best.pp);   // wsrod rownie dobrych (pelny kupiec albo zaden) bierzemy najwiecej PP
            if (lepszy) best = c;
        }
        if (!best) return { n: 0, pp: 0, powod: x.powod };
        // sprzedaz "za jednym strzalem": bierzemy najwieksza mozliwa ilosc, bez dbania o pelnego ostatniego kupca
        if (typ === 'sell' && doPelna()) return kand[kand.length - 1];

        // rozrzut: losujemy sposrod rownie dobrych ilosci (tak samo pelni kupcy), nie tylko maksimum
        if (rozrzutOn() && CONFIG.rozrzutMax > 0 && !(typ === 'sell' && doPelna())) {
            const minP = Math.max(1, Math.ceil(best.pp * (1 - CONFIG.rozrzutMax)));
            const pula = kand.filter(c => c.pp >= minP && (best.ok ? c.ok : c.fill >= best.fill - 0.15));
            if (pula.length > 1) {
                const wybrany = pula[Math.floor(Math.random() * pula.length)];
                if (wybrany !== best) return Object.assign({}, wybrany, { powod: x.powod + ' · rozrzut: ' + wybrany.pp + ' zamiast ' + best.pp + ' PP' });
            }
        }
        return best;
    }

    // KUPNO: dowozi giełda wlasnymi kupcami, wiec kupcow gracza nie oszczedzamy i nie ma rezerwy.
    // Gra rozlicza w calych PP, wiec liczymy ile PP wydac:
    //   - do limitu kursu: tyle PP, zeby kurs po zakupie zszedl nie nizej niz L (zaokraglone w dol),
    //   - ale co najmniej 1 PP - jesli kurs jest teraz >= limit, kupujemy chocby za 1 PP,
    //     nawet jesli po zakupie kurs spadnie lekko ponizej limitu,
    //   - nie wiecej niz pozwala magazyn giełdy, miejsce w wiosce i budzet.
    //   cena krancowa po n szt: (p0 + k*n)*(1+tb) = 1/L  ->  nLimit
    function ileKupic(m, r, L, budzet) {
        const a = m.s[r], t = 1 + m.tb, w = wioska(r);
        const nLimit = Math.max(0, (1 / (L * t) - a.p0) / a.k);
        const zapas = Number.isFinite(w.max) ? Math.floor(w.max * CONFIG.zapasMagazynu) : 0;
        const extra = nadmiar(idWioski(), w.max);
        const nTwarde = Math.min(a.stock, Math.max(0, w.wolne + extra - zapas));
        const eps = 1e-6;

        let pp = Math.floor(kosztKupna(m, r, nLimit) + eps);
        let powod = 'limit kursu';
        if (pp < 1) { pp = 1; powod = 'kurs tuż nad limitem – min. 1 PP'; }

        const pTwardy = Math.floor(kosztKupna(m, r, nTwarde) + eps);
        if (pTwardy < pp) { pp = pTwardy; powod = a.stock <= w.wolne + extra ? 'magazyn giełdy' : 'miejsce w magazynie wioski'; }

        const pBudzet = Math.floor(budzet + eps);
        if (pBudzet < pp) { pp = pBudzet; powod = 'budżet PP'; }

        if (pp < 1) return { n: 0, pp: 0, powod: powod + ' (poniżej 1 PP)' };
        const ppMax = pp;
        pp = losujPP(pp);
        if (pp < ppMax) powod += ' · rozrzut: ' + pp + ' zamiast ' + ppMax + ' PP';
        // najwieksza ilosc za pp PP: cena n szt = n*(p0 + k*n/2)*(1+tb) = pp
        const n = (-a.p0 + Math.sqrt(a.p0 * a.p0 + 2 * a.k * pp / t)) / a.k;
        return { n: Math.min(Math.floor(n), Math.floor(nTwarde)), pp, powod };
    }

    // SPRZEDAZ: dopoki kurs (jak w tabeli) po sprzedazy jest <= limit L [surowca za 1 PP].
    //   kurs po n szt = 1 / ((p0 - k*n)*(1+tb))  <=  L   ->  n <= (p0 - 1/(L*(1+tb))) / k
    // Tak jak przy kupnie: jesli kurs jest teraz <= limit, sprzedajemy co najmniej za 1 PP.
    // Kupcy to preferencja, nie twardy warunek: najpierw probujemy z rezerwa i dobraniem ilosci
    // pod pelnych kupcow, a jak to nie wystarcza nawet na 1 PP - uzywamy wszystkich wolnych kupcow.
    function ileSprzedac(m, r, L) {
        const a = m.s[r], w = wioska(r);
        const nLimit0 = Math.max(0, (a.p0 - 1 / (L * (1 + m.tb))) / a.k);
        const nJedenPP = Math.floor((a.p0 - Math.sqrt(Math.max(0, a.p0 * a.p0 - 2 * a.k / (1 - m.ts)))) / a.k);
        const baza = najmniejszy([
            [doPelna() ? Infinity : Math.max(nLimit0, nJedenPP), nLimit0 < nJedenPP ? 'kurs tuż pod limitem – min. 1 PP' : 'limit kursu'],
            [a.cap - a.stock, 'pojemność giełdy'],
            [w.ma, 'zasoby wioski'],
            // powyzej p0/k cena spadlaby do zera i zwrot zaczalby MALEC - to jest realne maksimum sprzedazy
            [Math.floor(a.p0 / a.k), 'maksimum wartości (dalej cena spada do zera)'],
        ]);
        if (baza.n < nJedenPP) return { n: 0, pp: 0, powod: baza.powod + ' (poniżej 1 PP)' };

        const wolni = wolniKupcy();
        const warianty = [
            [udzwigKupcow(), 'udźwig kupców (z rezerwą ' + CONFIG.rezerwaKupcow + ')'],
            [wolni * naKupca(), 'udźwig kupców (bez rezerwy – inaczej nie starczy na 1 PP)'],
        ];
        for (const [cap, opis] of warianty) {
            const x = { n: Math.min(baza.n, cap), powod: cap < baza.n ? opis : baza.powod };
            const wyn = dobierzIlosc(m, r, x, 'sell');
            if (wyn.n > 0) return wyn;
        }
        return { n: 0, pp: 0, powod: 'za mało wolnych kupców na 1 PP (potrzeba ' + fmt(nJedenPP) + ' szt., kupców: ' + wolni + ')' };
    }


    // ================= WPISYWANIE DO FORMULARZA =================
    function wpisz(name, wartosc) {
        const inp = document.querySelector('input[name="' + name + '"]');
        if (!inp) return false;
        inp.value = wartosc === '' ? '' : String(wartosc);
        // gra liczy koszt na zdarzeniach pola - odpalamy wszystkie typowe
        for (const ev of ['input', 'keyup', 'change']) inp.dispatchEvent(new Event(ev, { bubbles: true }));
        return true;
    }

    function wyczyscFormularz() {
        for (const typ of ['buy', 'sell']) for (const r of RES) wpisz(typ + '_' + r, '');
    }


    // ================= ODCZYT KURSOW =================
    function odczytaj() {
        const out = {};
        const m = model();
        for (const res of RES) {
            let kurs = null;
            if (m) kurs = kursTabeli(m, res);
            if (kurs === null) {
                const el = document.querySelector('#premium_exchange_rate_' + res);
                const mm = el && el.textContent.replace(/[\s ]/g, '').match(/\d+/);
                if (mm) kurs = parseInt(mm[0], 10);
            }
            const st = document.querySelector('#premium_exchange_stock_' + res);
            const stock = st ? parseInt(st.textContent.replace(/\D/g, ''), 10) : null;
            if (kurs) out[res] = { kurs, stock };
        }
        return out;
    }


    // ================= ALARM =================
    let ctx = null;
    function audio() { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); return ctx; }

    function ton(t, dl, f, gl, typ) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = typ || 'sine'; o.frequency.value = f;
        o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(gl, t);
        g.gain.setValueAtTime(gl, t + dl - 0.02);
        g.gain.linearRampToValueAtTime(0.0001, t + dl);
        o.start(t); o.stop(t + dl);
    }

    // Piknięcia: im wyższy poziom, tym wiecej, dluzsze i glosniejsze. Syrena = naprzemienne dwa tony ok. 6 s.
    function dzwiek(poz, wysoki) {
        try {
            audio();
            const t0 = ctx.currentTime;
            if (poz.syrena) {
                for (let i = 0; i < 12; i++) ton(t0 + i * 0.5, 0.5, i % 2 ? 660 : 990, poz.glosnosc, 'square');
            } else {
                for (let i = 0; i < poz.beepy; i++) ton(t0 + i * (poz.dl + 0.15), poz.dl, wysoki ? 1046 : 523, poz.glosnosc);
            }
        } catch { /* audio wymaga kliknięcia gdzies na stronie */ }
    }

    function poziomZ(glebokosc) {
        let idx = 0;
        CONFIG.poziomy.forEach((p, i) => { if (glebokosc >= p.od) idx = i; });
        return idx;
    }

    function alarm(tekst, wysoki, idx, tylkoDzwiek) {
        const poz = CONFIG.poziomy[idx];
        const tekstP = (poz.syrena ? '🚨 BIEGNIJ! ' : '') + tekst;
        if (tylkoDzwiek) { if (ST.dzwiek) dzwiek(poz, wysoki); return; }   // przypomnienie: sam dzwiek, bez nowego powiadomienia
        console.log('%c[GIELDA] ' + tekstP, 'color:#0a0;font-weight:bold');
        if (typeof GM_notification === 'function') {
            GM_notification({ title: poz.syrena ? 'GIEŁDA – ALARM' : 'Gielda Premium', text: tekstP, timeout: 0 });
        } else if (window.Notification && Notification.permission === 'granted') {
            new Notification('Gielda Premium', { body: tekstP, requireInteraction: true });
        }
        document.title = '>>> ' + tekstP;
        if (ST.dzwiek) dzwiek(poz, wysoki);
    }

    // UWAGA: push wysyla karta przegladarki. Zamknieta karta = brak powiadomien.
    const ostatniPush = {};

    function wyslijPush(tekst, klucz) {
        const P = CONFIG.push;
        if (!P.wlaczone) return;

        const teraz = Date.now();
        if (teraz - (ostatniPush[klucz] || 0) < P.odstep) return;
        ostatniPush[klucz] = teraz;

        const zadanie = zbudujZadanie(P, tekst);
        if (!zadanie) {
            console.warn('[GIELDA] push: brak konfiguracji dla kanalu', P.kanal);
            return;
        }

        const gotowe = () => console.log('[GIELDA] push wyslany:', P.kanal);
        const blad = e => console.warn('[GIELDA] push nieudany:', e);

        if (typeof GM_xmlhttpRequest === 'function') {
            GM_xmlhttpRequest({
                method: 'POST',
                url: zadanie.url,
                headers: zadanie.headers,
                data: zadanie.body,
                onload: r => (r.status >= 200 && r.status < 300) ? gotowe() : blad('HTTP ' + r.status),
                onerror: blad,
            });
        } else {
            fetch(zadanie.url, { method: 'POST', headers: zadanie.headers, body: zadanie.body })
                .then(r => r.ok ? gotowe() : blad('HTTP ' + r.status))
                .catch(blad);
        }
    }

    function zbudujZadanie(P, tekst) {
        const json = { 'Content-Type': 'application/json' };

        switch (P.kanal) {
            case 'ntfy':
                if (!P.ntfyTemat) return null;
                return {
                    url: 'https://ntfy.sh/' + P.ntfyTemat,
                    headers: { 'Title': 'Gielda Premium', 'Priority': 'high', 'Tags': 'moneybag' },
                    body: tekst,
                };

            case 'discord':
                if (!P.discordWebhook) return null;
                return {
                    url: P.discordWebhook,
                    headers: json,
                    body: JSON.stringify({ content: '**Gielda Premium**\n' + tekst }),
                };

            case 'telegram':
                if (!P.telegramToken || !P.telegramChatId) return null;
                return {
                    url: `https://api.telegram.org/bot${P.telegramToken}/sendMessage`,
                    headers: json,
                    body: JSON.stringify({ chat_id: P.telegramChatId, text: 'Gielda Premium\n' + tekst }),
                };

            case 'pushover':
                if (!P.pushoverToken || !P.pushoverUser) return null;
                return {
                    url: 'https://api.pushover.net/1/messages.json',
                    headers: json,
                    body: JSON.stringify({
                        token: P.pushoverToken, user: P.pushoverUser,
                        title: 'Gielda Premium', message: tekst, priority: 1,
                    }),
                };

            default:
                return null;
        }
    }

    // Czy giełda w ogóle przyjmie / wyda choć 1 PP? Pełny magazyn giełdy = nie da się sprzedać,
    // pusty = nie da się kupić. Wtedy alarm nie ma sensu (nie da się nic zrobić).
    function blokada(m, r, tryb) {
        if (!m) return null;
        const a = m.s[r];
        if (tryb === 'sprzedaj') {
            const nJ = Math.floor((a.p0 - Math.sqrt(Math.max(0, a.p0 * a.p0 - 2 * a.k / (1 - m.ts)))) / a.k);
            return a.cap - a.stock < Math.max(1, nJ) ? 'magazyn giełdy pełny' : null;
        }
        const nJ = Math.floor((-a.p0 + Math.sqrt(a.p0 * a.p0 + 2 * a.k / (1 + m.tb))) / a.k);
        return a.stock < Math.max(1, nJ) ? 'magazyn giełdy pusty' : null;
    }

    // stan zatrzasku alarmu: { wood: {tryb:'kup'|'sprzedaj'|null, ostatni:0} }
    const stan = {};

    function sprawdz(dane) {
        const teraz = Date.now();

        for (const [res, { kurs, stock }] of Object.entries(dane)) {
            const L = ST[res];
            const s = stan[res] = stan[res] || { tryb: null, ostatni: 0 };
            const h = CONFIG.histereza;

            // z histereza: raz aktywny warunek trzyma sie, dopoki kurs
            // nie cofnie sie o 'h' - inaczej migotanie na granicy progu
            let tryb = null;
            if (s.tryb === 'kup') {
                tryb = L.buy !== null && kurs >= L.buy - h ? 'kup' : null;
            } else if (s.tryb === 'sprzedaj') {
                tryb = L.sell !== null && kurs <= L.sell + h ? 'sprzedaj' : null;
            } else if (L.buy !== null && kurs >= L.buy) {
                tryb = 'kup';
            } else if (L.sell !== null && kurs <= L.sell) {
                tryb = 'sprzedaj';
            }

            // gielda nie przyjmie/nie wyda surowca -> nie alarmujemy (warunek traktujemy jak niespelniony)
            const powodBlokady = tryb ? blokada(model(), res, tryb) : null;
            if (powodBlokady) {
                if (s.blokada !== powodBlokady) console.log(`[GIELDA] ${NAZWY[res]}: kurs spełnia limit, ale ${powodBlokady} – bez alarmu`);
                s.blokada = powodBlokady;
                tryb = null;
            } else s.blokada = null;

            // stan zatrzasku liczymy zawsze, ale dzwonimy tylko dla wlaczonych
            const aktywny = tryb && (tryb === 'kup' ? L.alarmBuy : L.alarmSell);
            const glebokosc = !tryb ? 0 : tryb === 'kup' ? kurs / L.buy - 1 : 1 - kurs / L.sell;
            const idx = aktywny ? poziomZ(Math.max(0, glebokosc)) : 0;
            const poz = CONFIG.poziomy[idx];
            const nowy = aktywny && tryb !== s.tryb;
            const eskalacja = aktywny && !nowy && idx > (s.poziom || 0);   // gleboko -> natychmiast mocniejszy sygnal
            const czasNaPrzypomnienie = aktywny && poz.co > 0 && teraz - s.ostatni >= poz.co;

            if (nowy || eskalacja || czasNaPrzypomnienie) {
                s.ostatni = teraz;
                const pr = Math.round(glebokosc * 100);
                const opis = tryb === 'kup'
                    ? `${NAZWY[res]} ${kurs}/PP - TANIO (prog ${L.buy}, +${pr}%), kup surowce`
                    : `${NAZWY[res]} ${kurs}/PP - DROGO (prog ${L.sell}, −${pr}%), sprzedaj surowce`;
                const pelny = opis + (stock ? `, magazyn ${stock}` : '');
                alarm(pelny, tryb === 'kup', idx, !nowy && !eskalacja);
                if (nowy || (eskalacja && poz.syrena)) wyslijPush(pelny, res + '_' + tryb + (poz.syrena ? '_syrena' : ''));
            }
            s.poziom = aktywny ? idx : 0;

            if (!tryb && s.tryb && !s.blokada) {
                console.log(`[GIELDA] ${NAZWY[res]} wrocilo miedzy progi (${kurs}/PP)`);
            }
            s.tryb = tryb;
        }
    }


    // ================= LOG KURSOW =================
    let ostatni = null;
    function zapiszLog(dane) {
        if (!CONFIG.log) return;
        const w = { t: Date.now(), wood: dane.wood?.kurs, stone: dane.stone?.kurs, iron: dane.iron?.kurs };
        if (ostatni && w.wood === ostatni.wood && w.stone === ostatni.stone && w.iron === ostatni.iron) return;
        const l = logArr();
        l.push(w);
        if (l.length > LOG_MAX + 500) l.splice(0, l.length - LOG_MAX);
        logDirty = true;
        ostatni = w;
    }

    // Historia trzymana w pamieci, na dysk (localStorage) co minute i przy zamknieciu karty.
    const LOG_MAX = 20000;
    let logBuf = null, logDirty = false;
    function logArr() {
        if (!logBuf) {
            try { logBuf = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { logBuf = []; }
            if (!Array.isArray(logBuf)) logBuf = [];
        }
        return logBuf;
    }
    function flushLog() {
        if (!logDirty) return;
        try { localStorage.setItem(LOG_KEY, JSON.stringify(logBuf.slice(-LOG_MAX))); logDirty = false; }
        catch { /* quota - sprobujemy przy nastepnym razie */ }
    }
    setInterval(flushLog, 60_000);
    window.addEventListener('pagehide', flushLog);


    // ================= INTERFEJS =================
    let panel = null, statusEl = null;
    const komorkiKursu = {}; // res -> element z biezacym kursem

    function el(tag, css, txt) {
        const e = document.createElement(tag);
        if (css) e.style.cssText = css;
        if (txt !== undefined) e.textContent = txt;
        return e;
    }

    function pole(id, wartosc, szer) {
        const i = el('input', 'width:' + (szer || 70) + 'px;max-width:100%;box-sizing:border-box');
        i.type = 'number'; i.min = '0'; i.step = '1'; i.id = id;
        i.value = wartosc === undefined || wartosc === null ? '' : wartosc;
        i.placeholder = '—';
        return i;
    }

    function checkbox(id, zaznaczony, podpis, tytul) {
        const w = el('label', 'margin-left:8px;font-size:11px;white-space:normal;display:inline-block;max-width:100%;cursor:pointer');
        const cb = el('input', 'vertical-align:middle;margin:0 2px 0 0');
        cb.type = 'checkbox'; cb.id = id; cb.checked = !!zaznaczony;
        if (tytul) w.title = tytul;
        w.appendChild(cb); w.appendChild(document.createTextNode(podpis));
        return w;
    }

    function limitZPola(id) {
        const e = document.getElementById(id);
        const v = e ? parseFloat(e.value) : NaN;
        return Number.isFinite(v) && v > 0 ? v : null;
    }
    const zaznaczone = (id, domyslnie) => { const e = document.getElementById(id); return e ? e.checked : domyslnie; };

    // Pola -> ustawienia (i na dysk).
    function zczytajZPol() {
        if (!panel) return;
        for (const r of RES) {
            ST[r].buy = limitZPola('pew_buy_' + r);
            ST[r].sell = limitZPola('pew_sell_' + r) || CONFIG.limitSprzedazyStaly;
            { const e = document.getElementById('pew_sell_' + r); if (e && e.value === '') e.value = ST[r].sell; }
            ST[r].alarmBuy = zaznaczone('pew_abuy_' + r, ST[r].alarmBuy);
            ST[r].alarmSell = zaznaczone('pew_asell_' + r, ST[r].alarmSell);
        }
        ST.budzet = limitZPola('pew_budzet');
        ST.auto = zaznaczone('pew_auto', ST.auto);
        ST.dzwiek = zaznaczone('pew_dzwiek', ST.dzwiek);
        ST.rozrzut = zaznaczone('pew_rozrzut', ST.rozrzut);
        ST.otworz = zaznaczone('pew_otworz', ST.otworz);
        ST.monety = zaznaczone('pew_monety', ST.monety);
        ST.mennice = zaznaczone('pew_mennice', ST.mennice);
        ST.kupnoDoSlabej = zaznaczone('pew_kupno_slaba', ST.kupnoDoSlabej);
        ST.kupnoPkt = limitZPola('pew_kupno_pkt');
        ST.sprzedazMinPkt = limitZPola('pew_sprzedaz_pkt');
        ST.kupnoNadmiar = limitZPola('pew_nadmiar');
        ST.pokazDostawy = zaznaczone('pew_pokaz_dostawy', ST.pokazDostawy);
        ST.nowaKarta = zaznaczone('pew_nowa_karta', ST.nowaKarta);
        zastosujDostawy();
        ST.nadmiarOkno = limitZPola('pew_nad_okno') || ST.nadmiarOkno;
        ST.nadmiarPrzerwa = limitZPola('pew_nad_przerwa') || ST.nadmiarPrzerwa;
        ST.sprzedazDoPelna = zaznaczone('pew_do_pelna', ST.sprzedazDoPelna);
        ST.jedynka = zaznaczone('pew_jedynka', ST.jedynka);
        ST.potok = zaznaczone('pew_potok', ST.potok);
        pokazPotok();
        { const gk = document.getElementById('pew_grupa_kupna'), gs = document.getElementById('pew_grupa_sprzedazy');
          if (gk) ST.grupaKupna = gk.value || ''; if (gs) ST.grupaSprzedazy = gs.value || ''; }
        if (document.getElementById('pew_mennica_tu')) ustawMennice(idWioski(), zaznaczone('pew_mennica_tu', false));
        ST.monetyMin = limitZPola('pew_monety_min') || ST.monetyMin;
        zapiszUstawienia();
    }

    // Zmiana progu/alarmu: zapisz, zresetuj zatrzask i ocen od nowa.
    function poZmianie(res) {
        zczytajZPol();
        if (res) delete stan[res]; else Object.keys(stan).forEach(k => delete stan[k]);
        uruchom();
    }

    function zbudujPanel(form) {
        panel = el('div', 'margin:0 0 12px 0;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere;word-wrap:break-word');
        panel.id = 'pe-wypelniacz';
        panel.style.clear = 'both';

        const box = el('table', 'width:100%;max-width:100%;table-layout:fixed'); box.className = 'vis';
        const cg = el('colgroup'); for (const w of ['20%', '22%', '29%', '29%']) cg.appendChild(el('col', 'width:' + w)); box.appendChild(cg);
        const th = el('th', '', 'Giełda Premium: alarm + wypełniacz v' + (typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : '?')); th.colSpan = 4;
        const head = el('tr'); head.appendChild(th); box.appendChild(head);

        const od = el('td', 'font-size:11px'); od.colSpan = 4;
        od.textContent = 'Kurs = ile surowca za 1 PP (jak w tabeli giełdy). Jedna liczba robi dwie rzeczy: alarm (☑) odzywa się, gdy kurs jest ≥ limitu kupna / ≤ limitu sprzedaży, a „Kalkuluj” wypełnia ilość dla jednego surowca z najlepszą ceną (kupuję dopóki kurs po zakupie ≥ limitu; sprzedaję dopóki kurs po sprzedaży ≤ limitu). Puste pole = pomiń.';
        const opis = el('tr'); opis.appendChild(od); box.appendChild(opis);

        const naglowek = el('tr');
        for (const t of ['Surowiec', 'Kurs teraz', 'Kupuj / TANIO, gdy kurs ≥', 'Sprzedawaj / DROGO, gdy kurs ≤']) naglowek.appendChild(el('th', '', t));
        box.appendChild(naglowek);

        for (const r of RES) {
            const tr = el('tr');
            tr.appendChild(el('td', 'font-weight:bold', NAZWY[r]));

            const teraz = el('td', 'overflow-wrap:anywhere');
            komorkiKursu[r] = teraz;
            tr.appendChild(teraz);

            const k = el('td');
            k.appendChild(pole('pew_buy_' + r, ST[r].buy));
            k.appendChild(checkbox('pew_abuy_' + r, ST[r].alarmBuy, 'alarm', 'alarm przy kursie ≥ limitu kupna: ' + NAZWY[r].toLowerCase()));
            tr.appendChild(k);

            const s = el('td');
            s.appendChild(pole('pew_sell_' + r, ST[r].sell));
            s.appendChild(checkbox('pew_asell_' + r, ST[r].alarmSell, 'alarm', 'alarm przy kursie ≤ limitu sprzedaży: ' + NAZWY[r].toLowerCase()));
            tr.appendChild(s);

            box.appendChild(tr);
        }

        const ust = el('tr'); const ustTd = el('td'); ustTd.colSpan = 4;
        const auto = checkbox('pew_auto', ST.auto, 'Wypełniaj automatycznie po kliknięciu „Kalkuluj najlepszą ofertę”');
        auto.style.marginLeft = '0';
        ustTd.appendChild(auto);
        ustTd.appendChild(checkbox('pew_dzwiek', ST.dzwiek, 'dźwięk alarmu'));
        ustTd.appendChild(checkbox('pew_rozrzut', ST.rozrzut, 'rozrzut ilości (nie zawsze maksimum)', 'losuje do ' + Math.round(CONFIG.rozrzutMax * 100) + '% mniej PP niż maksimum, min. 1 PP'));
        ustTd.appendChild(checkbox('pew_pokaz_dostawy', ST.pokazDostawy, 'pokaż wszystkie dostawy', 'zaznaczone = cała lista „kiedy przychodzą surowce”; odznaczone = tylko ostatnia dostawa'));
        ustTd.appendChild(checkbox('pew_otworz', ST.otworz, 'po zalogowaniu otwórz giełdę', 'po wejściu do gry (ekran przeglądu) jednorazowo przechodzi na giełdę premium'));
        ustTd.appendChild(checkbox('pew_nowa_karta', ST.nowaKarta, 'przejścia do wiosek otwieraj w nowej karcie', 'przyciski „Następna / Najlepsza wioska”, kontynenty i „Sprzedaj na dawcy” otworzą wioskę w nowej karcie zamiast w tej (przeglądarka może zapytać o zgodę na wyskakujące okna)'));
        const mon = el('div', 'margin-top:4px');
        mon.appendChild(checkbox('pew_monety', ST.monety, 'wybijanie monet: wioski z mniej niż', 'zaznaczone = wioski z małą liczbą wolnych kupców nie sprzedają na giełdzie (kupno bez zmian)'));
        mon.appendChild(pole('pew_monety_min', ST.monetyMin, 50));
        mon.appendChild(el('span', 'font-size:11px;margin-left:4px', 'wolnych kupców nie sprzedają'));
        ustTd.appendChild(mon);
        const men = el('div', 'margin-top:4px');
        men.appendChild(checkbox('pew_mennice', ST.mennice, 'sprzedawaj tylko z wiosek-mennic', 'zaznaczone = wioski nieoznaczone jako mennica nie wypełniają sprzedaży (kupno bez zmian)'));
        men.appendChild(checkbox('pew_mennica_tu', czyMennica(idWioski()), 'ta wioska to mennica', 'oznacza tę wioskę jako mennicę (zapamiętane)'));
        ustTd.appendChild(men);
        const ks = el('div', 'margin-top:4px');
        ks.appendChild(checkbox('pew_kupno_slaba', ST.kupnoDoSlabej, 'przechodź do najlepszej wioski: kupno → najsłabsza, sprzedaż → najlepsza', 'kupno: inna wioska ma wyraźnie mniej tego surowca (≤70% i o 2000+); sprzedaż: inna daje o 25%+ (min. 0,5 PP) większy zysk. „Kalkuluj” przenosi tam, potem klikasz go sam'));
        ks.appendChild(el('span', 'font-size:11px;margin-left:10px', 'kupuj tylko do wiosek poniżej '));
        ks.appendChild(pole('pew_kupno_pkt', ST.kupnoPkt, 55));
        ks.appendChild(el('span', 'font-size:11px;margin-left:4px', 'punktów (puste = bez limitu)'));
        const sp = el('div', 'margin-top:4px');
        sp.appendChild(el('span', 'font-size:11px', 'sprzedawaj tylko z wiosek od '));
        sp.appendChild(pole('pew_sprzedaz_pkt', ST.sprzedazMinPkt, 55));
        sp.appendChild(el('span', 'font-size:11px;margin-left:4px', 'punktów (puste = bez limitu) – nierozwinięte wioski nie sprzedają'));
        ustTd.appendChild(ks);
        ustTd.appendChild(sp);
        const gr = el('div', 'margin-top:4px;font-size:11px');
        gr.appendChild(el('span', '', 'Grupy (z gry): kupuj tylko do grupy '));
        const sk = el('select', 'max-width:100%'); sk.id = 'pew_grupa_kupna'; sk.title = 'np. świeżo przejęte wioski – kupione surowce idą tylko tam (zamiast limitu punktów)';
        const ss = el('select', 'max-width:100%;margin-left:4px'); ss.id = 'pew_grupa_sprzedazy'; ss.title = 'sprzedaż tylko z wiosek tej grupy (zamiast limitu punktów)';
        gr.appendChild(sk); gr.appendChild(el('span', 'margin-left:8px', 'sprzedawaj tylko z grupy ')); gr.appendChild(ss);
        gr.appendChild(el('span', 'margin-left:6px', '(lista grup pojawia się po „Odśwież wioski”)'));
        ustTd.appendChild(gr);
        const ng = el('div', 'margin-top:4px;font-size:11px');
        ng.title = 'Dostawa z giełdy idzie ok. 1,5 h – w tym czasie zużyjesz surowce. Kupno planuje wtedy miejsce = wolne + ten % pojemności magazynu. Uwaga: to, co przyjdzie ponad pojemność, przepada.';
        ng.appendChild(el('span', '', 'Kupuj ponad stan magazynu: do +'));
        ng.appendChild(pole('pew_nadmiar', ST.kupnoNadmiar, 55));
        ng.appendChild(el('span', 'margin-left:4px', '% pojemności (puste = nie; tylko wioski z grupy kupna, a bez grupy – wszystkie). Okno '));
        ng.appendChild(pole('pew_nad_okno', ST.nadmiarOkno, 35));
        ng.appendChild(el('span', 'margin-left:4px', 'min, potem przerwa '));
        ng.appendChild(pole('pew_nad_przerwa', ST.nadmiarPrzerwa, 35));
        ng.appendChild(el('span', 'margin-left:4px', 'min'));
        ng.appendChild(el('span', 'font-weight:bold', '')).id = 'pew_nad_stan';
        ustTd.appendChild(ng);
        const pt = el('div', 'margin-top:4px');
        pt.appendChild(checkbox('pew_potok', ST.potok, 'tryb: kup tanio w nowej wiosce → sprzedaj na dawcy', 'po kupnie (i potwierdzeniu w grze) pojawia się przycisk „Sprzedaj na dawcy”, który przenosi do najlepszej wioski-dawcy i wypełnia sprzedaż do limitu. W tym trybie: bez rozrzutu i bez sprzedaży „do pełna”'));
        ustTd.appendChild(pt);
        const dp = el('div', 'margin-top:4px');
        dp.appendChild(checkbox('pew_do_pelna', ST.sprzedazDoPelna, 'sprzedaż za jednym strzałem: do pełnej pojemności giełdy', 'gdy kurs ≤ limit sprzedaży, wpisuje max co się da (zasoby wioski, kupcy, wolne miejsce na giełdzie) – kurs może spaść daleko poniżej limitu. Limit sprzedaży działa tylko jako start'));
        ustTd.appendChild(dp);
        const jp = el('div', 'margin-top:4px');
        jp.appendChild(checkbox('pew_jedynka', ST.jedynka, 'giełda wypchnięta na maksa (wolnego miejsca < 1 PP): wpisz 1 szt. i niech gra sama dobierze sprzedaż za 1 PP', 'gdy żaden limit nie jest spełniony, ale na giełdzie zostało mniej miejsca niż warte jest 1 PP, gra i tak zaokrągla ofertę w górę do pełnego PP – wpisanie 1 szt. daje ofertę za 1 PP (np. 200 szt.). Wybieram surowiec z najmniejszą ilością wolnego miejsca. Ofertę oglądasz i potwierdzasz sam w grze'));
        ustTd.appendChild(jp);
        ust.appendChild(ustTd); box.appendChild(ust);

        const bud = el('tr'); bud.appendChild(el('td', '', 'Budżet PP na kupno'));
        const bd = el('td'); bd.colSpan = 3;
        bd.appendChild(pole('pew_budzet', ST.budzet, 90));
        bd.appendChild(el('span', 'font-size:11px;margin-left:6px', '(puste = wszystkie moje PP)'));
        bud.appendChild(bd); box.appendChild(bud);

        const przyc = el('div', 'margin:6px 0;max-width:100%;line-height:2');
        const bW = el('input', 'margin-right:6px'); bW.type = 'button'; bW.className = 'btn'; bW.value = 'Wypełnij (podgląd)';
        const bC = el('input'); bC.type = 'button'; bC.className = 'btn'; bC.value = 'Wyczyść formularz';
        bW.onclick = wypelnij; bC.onclick = () => { wyczyscFormularz(); pokazStatus([]); };
        przyc.appendChild(bW); przyc.appendChild(bC);
        bN = przyciskLink('Następna wioska ▶', celNastepna, nastepnaWKontynencie, 'margin-left:12px;margin-right:6px');
        bN.title = 'następna wioska z TEGO kontynentu (ta sama giełda); prawy przycisk / środkowy / Ctrl+klik = nowa karta';
        bB = przyciskLink('Najlepsza wioska ★', celNajlepsza, idzDoNajlepszej, '');
        bB.title = 'najlepsza wioska wg limitów (w obrębie tego kontynentu); prawy przycisk / środkowy / Ctrl+klik = nowa karta';
        przyc.appendChild(bN); przyc.appendChild(bB);
        const bP = el('input', 'margin-left:6px'); bP.type = 'button'; bP.className = 'btn'; bP.value = 'Odśwież wioski';
        bP.title = 'wczytuje przegląd produkcji (zapasy i kupców wszystkich wiosek)';
        bP.onclick = () => wczytajPrzeglad(true);
        przyc.appendChild(bP);

        kontEl = el('div', 'margin:2px 0 4px 0;font-size:11px;max-width:100%;line-height:2');
        statusEl = el('div', 'font-size:11px;margin-top:4px;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere');

        // Kolejnosc: przyciski i status na gorze (zaraz pod "Kalkuluj"), ustawienia pod spodem.
        dostawyEl = el('div', 'font-size:11px;margin-top:4px;padding:3px 5px;border:1px solid #c1a264;background:#fff5da;max-height:300px;overflow-y:auto;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere');
        const bD = el('input', 'margin-left:6px'); bD.type = 'button'; bD.className = 'btn'; bD.value = 'Dostawy';
        bD.title = 'kiedy przychodzą surowce do TEJ wioski (z zakładki Rynek → Transporty); odświeża tylko ten przycisk';
        bD.onclick = () => wczytajDostawy(true);
        przyc.appendChild(bD); bDostawy = bD;
        bPotok = el('input', 'margin-left:6px;outline:2px solid #c0392b;display:none'); bPotok.type = 'button'; bPotok.className = 'btn'; bPotok.value = '▶ Sprzedaj na dawcy';
        bPotok.onclick = idzNaDawce;
        przyc.appendChild(bPotok);
        panel.appendChild(przyc); panel.appendChild(kontEl); odswiezKont(); panel.appendChild(statusEl); panel.appendChild(dostawyEl); panel.appendChild(box);

        // zmiany pol zapisuja sie od razu i przeliczaja alarm
        panel.addEventListener('change', e => {
            const m = /^pew_(?:buy|sell|abuy|asell)_(wood|stone|iron)$/.exec(e.target.id || '');
            if (m) poZmianie(m[1]); else zczytajZPol();
            if (/^pew_grupa_(kupna|sprzedazy)$/.test(e.target.id || '')) {
                const g = e.target.value;
                if (!g) { pokazStatus(['Grupa wyłączona – obowiązują limity punktów.']); return; }
                pobierzGrupe(g).then(set => pokazStatus([set ? 'Grupa „' + nazwaGrupy(g) + '”: ' + set.size + ' wiosek.' : 'Nie udało się wczytać grupy – spróbuj „Odśwież wioski”.']));
            }
        });

        // Pod formularzem, czyli pod przyciskiem "Kalkuluj najlepszą ofertę".
        form.parentNode.insertBefore(panel, form.nextSibling);
        wypelnijSelecty();
        zastosujDostawy(); pokazDostawy(); pokazNadmiar(); pokazPotok();
        setInterval(() => { pokazNadmiar(); pokazPotok(); }, 3000);
        if (!dostawyTimer) dostawyTimer = setInterval(pokazDostawy, 30_000);
        if (!grupy().lista.length) wczytajListeGrup();
        odswiezWiersze(odczytaj());
    }

    // Biezacy kurs i znacznik "KUP / SPRZEDAJ" w tabelce.
    function odswiezWiersze(dane) {
        for (const [res, d] of Object.entries(dane)) {
            const k = komorkiKursu[res];
            if (!k) continue;
            const L = ST[res];
            let tekst = '', kier = null;
            if (L.buy !== null && d.kurs >= L.buy) { tekst = '▲ KUP'; kier = 'kup'; }
            else if (L.sell !== null && d.kurs <= L.sell) { tekst = '▼ SPRZEDAJ'; kier = 'sprzedaj'; }

            // warunek spelniony, ale alarm wylaczony - pokazujemy przygaszone
            const mm = model();
            const blok = kier && mm ? blokada(mm, res, kier) : null;
            const wyciszony = kier && (blok || !(kier === 'kup' ? L.alarmBuy : L.alarmSell));
            const gl = kier === 'kup' ? d.kurs / L.buy - 1 : kier === 'sprzedaj' ? 1 - d.kurs / L.sell : 0;
            k.textContent = `${d.kurs}/PP` + (tekst ? '  ' + tekst + ' ' + (kier === 'kup' ? '+' : '−') + Math.round(gl * 100) + '%' + (blok ? ' (' + blok + ')' : wyciszony ? ' (alarm wył.)' : '') : '');
            k.style.fontWeight = kier && !wyciszony ? 'bold' : 'normal';
            k.style.opacity = wyciszony ? '.5' : '1';
        }
    }

    // ================= DOSTAWY: KIEDY PRZYCHODZA SUROWCE =================
    // Zrodlo: przeglad handlarzy (przychodzace) - ta sama lista, co w grze: Przeglady > Handlarze.
    const KEY_D = 'pe_dostawy_' + SWIAT + GRACZ;
    let dostawyEl = null, dostawyTimer = null, bDostawy = null, bPotok = null;
    // Dostawy zapamietane osobno dla kazdej wioski; odswieza je tylko przycisk "Dostawy" (nic nie pobiera samo).
    const dostawyWszystkie = () => { try { return JSON.parse(localStorage.getItem(KEY_D)) || {}; } catch { return {}; } };
    const dostawy = () => dostawyWszystkie()[idWioski()] || { t: 0, lista: [] };

    function czasZWiersza(tr) {
        const tm = tr.querySelector('.timer[data-endtime], [data-endtime]');
        if (tm && Number(tm.getAttribute('data-endtime')) > 1e9) return Number(tm.getAttribute('data-endtime')) * 1000;
        const odl = tr.querySelector('.timer, .countdown');
        const mo = odl && /(\d+):(\d{2}):(\d{2})/.exec(odl.textContent);
        if (mo) return Date.now() + ((+mo[1]) * 3600 + (+mo[2]) * 60 + (+mo[3])) * 1000;
        const mt = /(dzisiaj|dzi[śs]|jutro)\s+o\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/i.exec(tr.textContent);
        if (mt) {
            const d = new Date(); d.setHours(+mt[2], +mt[3], +(mt[4] || 0), 0);
            if (/jutro/i.test(mt[1])) d.setDate(d.getDate() + 1);
            return d.getTime();
        }
        return null;
    }

    function dostawyZDoc(doc) {
        const out = [];
        // tylko tabela "Transporty przychodzace" (pierwsza tabela "Twoje transporty" to wyslane przez te wioske)
        const h = [...doc.querySelectorAll('h3, h4')].find(x => /przychodz/i.test(x.textContent));
        let tab = h ? h.nextElementSibling : null;
        while (tab && tab.tagName !== 'TABLE') tab = tab.nextElementSibling;
        for (const tr of (tab || doc).querySelectorAll('tr')) {
            if (!tr.querySelector('td')) continue;
            const t = czasZWiersza(tr);
            if (!t) continue;
            const sur = { wood: 0, stone: 0, iron: 0 };
            let jest = false;
            for (const sp of tr.querySelectorAll('.nowrap, .res')) {
                const ic = sp.querySelector('.icon') || sp;
                const r = RES.find(x => ic.classList && ic.classList.contains(x));
                const n = r ? liczba(sp.textContent) : null;
                if (r && n) { sur[r] += n; jest = true; }
            }
            if (!jest) continue;
            const a = tr.querySelector('a[href*="village="]');
            out.push({ n: a ? a.textContent.trim().replace(/\s+/g, ' ') : '?', t, wood: sur.wood, stone: sur.stone, iron: sur.iron });
        }
        return out;
    }

    function zastosujDostawy() { pokazDostawy(); }

    function pokazDostawy() {
        if (!dostawyEl) return;
        const d = dostawy(), teraz0 = Date.now();
        const lista = d.lista.filter(x => x.t > teraz0 - 60_000).sort((a, b) => a.t - b.t);
        dostawyEl.textContent = '';
        if (!d.t) { dostawyEl.appendChild(el('div', '', 'Dostawy tej wioski: kliknij „Dostawy”, by wczytać.')); return; }
        if (!lista.length) { dostawyEl.appendChild(el('div', '', 'Dostawy tej wioski: brak przybywających (stan sprzed ' + Math.round((teraz0 - d.t) / 60000) + ' min).')); return; }
        const nazwa = { wood: 'drewna', stone: 'gliny', iron: 'żelaza' };
        const hm = t => new Date(t).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
        const hm0 = t => new Date(t).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
        const nazwa0 = { wood: 'drewna', stone: 'gliny', iron: 'żelaza' };
        if (!ST.pokazDostawy) {
            // tryb skrocony: tylko ostatnia (najpozniej przychodzaca) dostawa
            const o = lista[lista.length - 1], min0 = Math.max(0, Math.round((o.t - teraz0) / 60000));
            dostawyEl.appendChild(el('div', '', 'Ostatnia dostawa: za ' + (min0 >= 60 ? Math.floor(min0 / 60) + ' h ' + (min0 % 60) + ' min' : min0 + ' min') + ' (' + hm0(o.t) + ') · ' + RES.filter(r => o[r]).map(r => '+' + fmt(o[r]) + ' ' + nazwa0[r]).join(', ') + ' · łącznie dostaw: ' + lista.length));
            return;
        }
        dostawyEl.appendChild(el('div', 'font-weight:bold', 'Dostawy tej wioski (' + lista.length + '), najbliższa za ' + Math.max(0, Math.round((lista[0].t - teraz0) / 60000)) + ' min (stan sprzed ' + Math.round((teraz0 - d.t) / 60000) + ' min):'));
        for (const x of lista) {
            const min = Math.max(0, Math.round((x.t - teraz0) / 60000));
            const co = RES.filter(r => x[r]).map(r => '+' + fmt(x[r]) + ' ' + nazwa[r]).join(', ');
            dostawyEl.appendChild(el('div', '', 'za ' + (min >= 60 ? Math.floor(min / 60) + ' h ' + (min % 60) + ' min' : min + ' min') + ' (' + hm(x.t) + ') · ' + co));
        }
    }

    async function wczytajDostawy(reczny) {
        let probka = '';
        try {
            const url = '/game.php?village=' + idWioski() + TQ + '&screen=market&mode=transports';
            const html = await (await fetch(url, { credentials: 'same-origin' })).text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const lista = dostawyZDoc(doc);
            const t = doc.querySelector('table.vis, table');
            probka = 'adres: ' + url + '\n' + (t ? t.outerHTML : html).replace(/\s+/g, ' ').slice(0, 1800);
            if (lista.length || /Transporty przychodz|Twoje transporty/i.test(doc.body ? doc.body.textContent : html)) {
                const wszystkie = dostawyWszystkie();
                wszystkie[idWioski()] = { t: Date.now(), lista };
                try { localStorage.setItem(KEY_D, JSON.stringify(wszystkie)); } catch { /* pelny */ }
                pokazDostawy();
                return lista.length;
            }
        } catch (e) { probka = 'wyjątek: ' + e.message; }
        if (reczny && dostawyEl) {
            dostawyEl.textContent = '';
            dostawyEl.appendChild(el('div', 'color:#8b1a1a', 'Nie rozpoznałem listy dostaw. Skopiuj poniższy tekst (dotknij pole, zaznacz wszystko, kopiuj) i wklej do rozmowy z Claude.'));
            const ta = el('textarea', 'width:100%;box-sizing:border-box;height:80px;font-size:10px;margin-top:4px');
            ta.readOnly = true; ta.value = probka; ta.onclick = () => ta.select();
            dostawyEl.appendChild(ta);
        }
        return 0;
    }

    function pokazStatus(linie, blad) {
        if (!statusEl) return;
        statusEl.textContent = '';
        statusEl.style.color = blad ? '#8b1a1a' : '';
        for (const l of linie) statusEl.appendChild(el('div', '', l));
    }


    // ================= WIOSKI: NASTEPNA / NAJLEPSZA =================
    // Jedno klikniecie = jedno przejscie (zadnych automatycznych petli po wioskach).
    // Skrypt zapamietuje stan kazdej wioski, w ktorej otworzysz gielde (zapasy, kupcy, magazyn),
    // wiec "Najlepsza wioska" wybiera z tych zapisanych danych - bez pytania serwera.
    let bN = null, bB = null, kontEl = null;
    const KEY_W = 'pe_wioski_' + SWIAT + GRACZ;
    const idWioski = () => Number(W.game_data && W.game_data.village && W.game_data.village.id);

    function wioski() { try { return JSON.parse(localStorage.getItem(KEY_W)) || {}; } catch { return {}; } }

    // Kupno ponad pojemnosc magazynu (dostawa z gieldy idzie ~1,5 h, w tym czasie surowce zostana zuzyte):
    // dodatkowe miejsce = % pojemnosci. Dziala w wioskach grupy kupna, a gdy grupy nie wybrano - w kazdej.
    // Zabezpieczenie: kupno ponad stan wolno tylko w "oknie" (domyslnie 2 min od pierwszego takiego zakupu),
    // a potem przez przerwe (domyslnie 15 min od konca okna) obowiazuje zwykly limit miejsca w magazynie.
    const KEY_N = 'pe_nadmiar_' + SWIAT + GRACZ;
    function nadmiarStan() {
        let s = 0; try { s = (JSON.parse(localStorage.getItem(KEY_N)) || {}).start || 0; } catch { /* brak */ }
        const t = Date.now(), ow = (ST.nadmiarOkno || 2) * 60_000, pr = (ST.nadmiarPrzerwa || 15) * 60_000;
        if (!s || t >= s + ow + pr) return { typ: 'wolne', ms: 0 };
        if (t < s + ow) return { typ: 'okno', ms: s + ow - t };
        return { typ: 'blokada', ms: s + ow + pr - t };
    }
    function oznaczNadmiar() {
        if (nadmiarStan().typ !== 'wolne') return;
        try { localStorage.setItem(KEY_N, JSON.stringify({ start: Date.now() })); } catch { /* pelny */ }
    }
    function opisNadmiaru() {
        const st = nadmiarStan(), min = st.ms / 60000;
        const t = min >= 1 ? Math.ceil(min) + ' min' : Math.ceil(st.ms / 1000) + ' s';
        return st.typ === 'okno' ? 'okno ponad stan trwa jeszcze ' + t : st.typ === 'blokada' ? 'ponad stan zablokowane jeszcze ' + t : 'ponad stan dostępne';
    }
    function pokazNadmiar() { const e = document.getElementById('pew_nad_stan'); if (e) e.textContent = ' · ' + opisNadmiaru(); }

    function nadmiar(id, max) {
        if (!ST.kupnoNadmiar || !Number.isFinite(max) || max <= 0) return 0;
        if (nadmiarStan().typ === 'blokada') return 0;
        if (wGrupie('buy', id) === false) return 0;
        return Math.floor(max * ST.kupnoNadmiar / 100);
    }

    // Grupy wiosek z gry (te z przegladu produkcji): lista {id,n} + czlonkowie wybranych grup.
    const KEY_G = 'pe_grupy_' + SWIAT + GRACZ;
    function grupy() { try { const g = JSON.parse(localStorage.getItem(KEY_G)); return { lista: (g && g.lista) || [], cz: (g && g.cz) || {} }; } catch { return { lista: [], cz: {} }; } }
    function zapiszGrupy(g) { try { localStorage.setItem(KEY_G, JSON.stringify(g)); } catch { /* pelny */ } }
    const nazwaGrupy = id => { const x = grupy().lista.find(g => String(g.id) === String(id)); return x ? x.n : String(id); };
    function czlonkowie(id) { const c = id && grupy().cz[id]; return c ? new Set(c.map(String)) : null; }
    // true/false gdy wybrana grupa i znam jej sklad, null gdy grupa nie wybrana / nieznana (wtedy dzialaja limity punktow)
    function wGrupie(typ, id) {
        const g = typ === 'buy' ? ST.grupaKupna : ST.grupaSprzedazy;
        const set = czlonkowie(g);
        return set ? set.has(String(id)) : null;
    }

    // Wioski danej grupy z przegladu produkcji (page=-1 = wszystkie naraz, z fallbackiem na kolejne strony).
    async function pobierzGrupe(gid) {
        if (!gid) return null;
        try {
            const baza = '/game.php?village=' + idWioski() + TQ + '&screen=overview_villages&mode=prod&group=' + encodeURIComponent(gid);
            const ids = new Set();
            const czytaj = doc => {
                const t = doc.querySelector('#production_table');
                if (!t) return null;
                for (const tr of t.querySelectorAll('tr')) {
                    const a = tr.querySelector('a[href*="village="]');
                    const m = a && tr.querySelector('td') && /[?&]village=(\d+)/.exec(a.getAttribute('href'));
                    if (m) ids.add(m[1]);
                }
                const nag = t.querySelector('thead');
                return nag ? Number((/\((\d+)\)/.exec(nag.textContent) || [])[1]) || 0 : 0;
            };
            const doc = new DOMParser().parseFromString(await (await fetch(baza + '&page=-1', { credentials: 'same-origin' })).text(), 'text/html');
            const razem = czytaj(doc);
            if (razem === null) return null;
            if (razem && ids.size < razem) {
                const strony = new Set([...doc.querySelectorAll('a[href*="page="]')].map(a => /[?&]page=(\d+)/.exec(a.getAttribute('href'))).filter(Boolean).map(m => Number(m[1])));
                for (const nr of [...strony].sort((x, y) => x - y).slice(0, 15)) czytaj(new DOMParser().parseFromString(await (await fetch(baza + '&page=' + nr, { credentials: 'same-origin' })).text(), 'text/html'));
            }
            const g = grupy(); g.cz[gid] = [...ids]; zapiszGrupy(g);
            return ids;
        } catch { return null; }
    }

    // Lista grup z gry: z linkow w przegladzie produkcji, a gdy ich tam nie ma - z zapytania menu grup.
    const grupyZDoc = doc => [...doc.querySelectorAll('[data-group-id]')]
        .filter(a => a.getAttribute('data-group-id') !== '0' && /^\d+$/.test(a.getAttribute('data-group-id')))
        .map(a => ({ id: a.getAttribute('data-group-id'), n: a.textContent.trim() })).filter(g => g.n)
        .filter((g, i, t) => t.findIndex(x => x.id === g.id) === i);
    async function wczytajListeGrup() {
        let lista = [];
        try {
            const url = '/game.php?village=' + idWioski() + TQ + '&screen=overview_villages&mode=prod&group=0';
            lista = grupyZDoc(new DOMParser().parseFromString(await (await fetch(url, { credentials: 'same-origin' })).text(), 'text/html'));
        } catch { /* siec */ }
        if (!lista.length) {
            try {
                const t = await (await fetch('/game.php?village=' + idWioski() + TQ + '&screen=groups&mode=overview&ajax=load_group_menu', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })).text();
                const zbierz = o => Array.isArray(o) ? o.flatMap(zbierz) : (o && typeof o === 'object')
                    ? ((o.group_id !== undefined || o.id !== undefined) && typeof o.name === 'string' ? [{ id: String(o.group_id !== undefined ? o.group_id : o.id), n: o.name.trim() }] : []).concat(Object.values(o).flatMap(zbierz)) : [];
                lista = zbierz(JSON.parse(t)).filter(g => /^\d+$/.test(g.id) && g.id !== '0' && g.n);
                if (!lista.length) lista = grupyZDoc(new DOMParser().parseFromString(t, 'text/html'));
            } catch { /* brak / inny format */ }
        }
        if (lista.length) { const g = grupy(); g.lista = lista; zapiszGrupy(g); }
        if (panel) wypelnijSelecty();
        return lista.length;
    }

    function wypelnijSelecty() {
        for (const [id, klucz] of [['pew_grupa_kupna', 'grupaKupna'], ['pew_grupa_sprzedazy', 'grupaSprzedazy']]) {
            const sel = document.getElementById(id);
            if (!sel) continue;
            sel.textContent = '';
            const o0 = el('option', '', '(wszystkie wioski)'); o0.value = ''; sel.appendChild(o0);
            for (const g of grupy().lista) { const o = el('option', '', g.n); o.value = g.id; sel.appendChild(o); }
            sel.value = ST[klucz] || '';
            if (sel.value !== (ST[klucz] || '')) { ST[klucz] = ''; sel.value = ''; }
        }
    }

    function zapiszWioske() {
        const id = idWioski();
        if (!id || !document.getElementById('premium_exchange_form')) return;
        const w = wioski();
        const v = W.game_data.village;
        const z = { n: v.name || String(id), t: Date.now(), k: wolniKupcy(), nk: naKupca(), mx: Number(v.storage_max) || 0 };
        z.pkt = punktyWioski();
        z.kont = kontynentTu() || undefined;
        z.p = przybywajace();
        for (const r of RES) z[r] = wioska(r).ma;
        w[id] = z;
        try { localStorage.setItem(KEY_W, JSON.stringify(w)); } catch { /* pelny */ }
        odswiezKont();
    }

    // Mozliwe operacje wioski wg zapisanego stanu i biezacych kursow/limitow (zysk w PP wzgledem limitu).
    // Przy kupnie 'stan' = ile surowca wioska ma (z przybywajacymi) - kupowac warto do tej, ktorej go najmniej,
    // ale tylko jesli pomiesci sensowna partie (minPartiaKupna). Wzgledne zapelnienie magazynu nie gra roli:
    // 30k z 400k to nadal duzo, a 2k z 5k to malo.
    function ocenWioske(z, m, id) {
        const opcje = [];
        for (const r of RES) {
            const a = m.s[r], kurs = kursTabeli(m, r);
            const Ls = limitSprzedazy(r), Lb = ST[r].buy;
            if (Ls !== null && kurs <= Ls && !(ST.monety && z.k < ST.monetyMin) && !(ST.mennice && !czyMennica(id)) && !(wGrupie('sell', id) === null ? (ST.sprzedazMinPkt && !(z.pkt >= ST.sprzedazMinPkt)) : !wGrupie('sell', id))) {
                const nJ = Math.floor((a.p0 - Math.sqrt(Math.max(0, a.p0 * a.p0 - 2 * a.k / (1 - m.ts)))) / a.k);
                const nLim = doPelna() ? Infinity : Math.max(Math.max(0, (a.p0 - 1 / (Ls * (1 + m.tb))) / a.k), nJ);
                const n = Math.floor(Math.min(nLim, a.cap - a.stock, z[r], z.k * z.nk));
                if (n >= nJ && n > 0) opcje.push({ typ: 'sell', r, n, po: z[r] - n, zysk: zwrotSprzedazy(m, r, n) - n / (Ls * (1 + m.tb)) });
            }
            if (Lb !== null && kurs >= Lb) {
                const nJ = Math.floor((-a.p0 + Math.sqrt(a.p0 * a.p0 + 2 * a.k / (1 + m.tb))) / a.k);
                const nLim = Math.max(Math.max(0, (1 / (Lb * (1 + m.tb)) - a.p0) / a.k), nJ);
                const n = Math.floor(Math.min(nLim, a.stock, Math.max(0, z.mx - z[r] - ((z.p && z.p[r]) || 0) + nadmiar(id, z.mx))));
                const calk = Math.floor(Math.min(nLim, a.stock));
                if (n >= nJ && n > 0 && n >= Math.min(calk, CONFIG.minPartiaKupna) && !(wGrupie('buy', id) === null ? (ST.kupnoPkt && !(z.pkt < ST.kupnoPkt)) : !wGrupie('buy', id))) opcje.push({ typ: 'buy', r, n, zysk: n / Lb - kosztKupna(m, r, n), stan: z[r] + ((z.p && z.p[r]) || 0) });
            }
        }
        return opcje;
    }

    // Wszystkie znane wioski -> lista opcji. Sprzedaz: kazda wioska osobno. Kupno: dla kazdego surowca tylko
    // wioska z NAJNIZSZYM zapelnieniem magazynu tym surowcem (kupowane surowce maja isc do najslabszej).
    // Kazdy kontynent ma wlasna gielde: wioski z innego kontynentu niz ta strona nie moga byc dawca/biorca.
    // Kontynent z nazwy wioski (K56 / wspolrzedne (609|538)); gdy nieznany - nie filtrujemy.
    function kontynentNazwy(n) {
        const k = /\bK(\d+)\b/.exec(n || '');
        if (k) return k[1];
        const c = /\((\d{1,3})\|(\d{1,3})\)/.exec(n || '');
        return c ? String(Math.floor(+c[2] / 100) * 10 + Math.floor(+c[1] / 100)) : null;
    }
    function kontynentTu() {
        const v = W.game_data && W.game_data.village;
        if (v && Number.isFinite(+v.x) && Number.isFinite(+v.y) && +v.x > 0) return String(Math.floor(+v.y / 100) * 10 + Math.floor(+v.x / 100));
        const z = wioski()[idWioski()];
        return (v && kontynentNazwy(v.name + ' ' + (v.coord || ''))) || (z && kontynentNazwy(z.n)) || null;
    }
    function kontZ(z) { return (z && (z.kont || kontynentNazwy(z.n))) || null; }
    // kontynent -> posortowana (wg nazwy) lista [id, z] znanych wiosek
    function wioskiKontynentow() {
        const out = {};
        for (const [id, z] of Object.entries(wioski())) {
            const k = kontZ(z) || '?';
            (out[k] = out[k] || []).push([id, z]);
        }
        for (const k of Object.keys(out)) out[k].sort((a, b) => String(a[1].n).localeCompare(String(b[1].n), 'pl', { numeric: true }));
        return out;
    }
    function opcjeWiosek(m) {
        const wszystkie = [], kupno = {};
        const kt = kontynentTu();
        for (const [id, z] of Object.entries(wioski())) {
            const kz = kontZ(z);
            if (kt && kz && kz !== kt) continue;
            for (const o of ocenWioske(z, m, id)) {
                const x = Object.assign({ id, z }, o);
                if (o.typ === 'sell') wszystkie.push(x);
                else if (!kupno[o.r] || o.stan < kupno[o.r].stan || (o.stan === kupno[o.r].stan && o.zysk > kupno[o.r].zysk)) kupno[o.r] = x;
            }
        }
        for (const r of Object.keys(kupno)) wszystkie.push(kupno[r]);
        return wszystkie.sort((a, b) => b.zysk - a.zysk);
    }

    // Jedno zapytanie o ten sam przeglad produkcji, ktory otwierasz w grze (screen=overview_villages&mode=prod):
    // zapasy, magazyn i kupcy wszystkich wiosek naraz. Raz na sesje karty + przycisk recznego odswiezenia.
    async function wczytajPrzeglad(reczny) {
        let diag = '', probka = '';
        const w = wioski();
        let ile = 0, zle = 0;
        const widziane = new Set();   // id wiosek, ktore naprawde sa w przegladzie

        // Parsuje jedna strone przegladu produkcji do w (wiersz = wioska). Zwraca liczbe wierszy tabeli.
        function przetworz(doc) {
            // wiersze tabeli produkcji (inne wiersze strony, np. menu, tez maja linki z village= - ich nie liczymy)
            const tabela = doc.querySelector('#production_table');
            const wiersze = [...(tabela || doc).querySelectorAll('tr')].filter(tr => tr.querySelector('a[href*="village="], [data-id]') && tr.querySelector('td'));
            if (!probka) probka = 'WIERSZ: ' + (wiersze[1] || wiersze[0] || { outerHTML: '(brak wierszy)' }).outerHTML.replace(/\s+/g, ' ').slice(0, 1800);
            for (const tr of wiersze) {
                const a = tr.querySelector('a[href*="village="]');
                const m = a && /[?&]village=(\d+)/.exec(a.getAttribute('href'));
                const dv = tr.querySelector('.quickedit-vn[data-id], [data-id]');
                const id = m ? m[1] : (dv && dv.getAttribute('data-id'));
                if (!id) { zle++; continue; }
                const z = { n: ((tr.querySelector('.quickedit-label') || a || tr).textContent || '').trim().replace(/\s+/g, ' '), t: Date.now(), kont: (w[id] && w[id].kont) || undefined, nk: (w[id] && w[id].nk) || 1000, p: (w[id] && w[id].p && Date.now() - w[id].t < 20 * 60_000) ? w[id].p : undefined };

                // surowce: elementy z klasa wood/stone/iron, a gdy brak - trzy pierwsze duze liczby w wierszu
                let ok = true;
                for (const res of RES) {
                    const e = tr.querySelector('.' + res + ', [class*="' + res + '"]');
                    const n = e ? liczba(e.textContent) : null;
                    if (n === null) { ok = false; break; }
                    z[res] = n;
                }
                const tds = [...tr.querySelectorAll('td')];
                const kom = tds.map(td => td.textContent.replace(/\s+/g, ' ').trim());
                const iw = tds.findIndex(td => td.querySelector('a[href*="village="]'));      // komorka z nazwa wioski; punkty zaraz po niej
                const pkt = iw >= 0 && /^\d[\d. ]*$/.test(kom[iw + 1] || '') ? liczba(kom[iw + 1]) : undefined;
                if (pkt !== undefined) z.pkt = pkt;
                if (!ok) {
                    const wsp = kom.map((t, i) => [i, t]).filter(([, t]) => /^\d[\d. ]*$/.test(t));
                    zle++; if (!diag) diag = 'wiersz bez klas surowców: ' + tr.outerHTML.slice(0, 400); continue;
                }
                // kupcy = pierwsza komorka "x/y" (zagroda jest po nich); magazyn = komorka tuz przed nia
                const ik = kom.findIndex(t => /^\d+\s*\/\s*\d+$/.test(t));
                if (ik < 0) { zle++; if (!diag) diag = 'brak komórki kupców x/y: ' + kom.join(' | ').slice(0, 300); continue; }
                z.k = liczba(kom[ik].split('/')[0]);
                // magazyn: najblizsza liczba przed kupcami, wieksza niz kazdy ze surowcow
                const maxRes = Math.max(z.wood, z.stone, z.iron);
                let mx = 0;
                for (let i = ik - 1; i >= 0; i--) { const n = /^\d[\d. ]*$/.test(kom[i]) ? liczba(kom[i]) : null; if (n !== null && n >= maxRes) { mx = n; break; } }
                z.mx = mx || maxRes;
                w[id] = z; ile++; widziane.add(String(id));
            }
            return wiersze.length;
        }

        try {
            const baza = '/game.php?village=' + idWioski() + TQ + '&screen=overview_villages&mode=prod&group=0';
            const r = await fetch(baza + '&page=-1', { credentials: 'same-origin' });
            const html = await r.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const wierszy = przetworz(doc);
            if (!wierszy) diag = 'status ' + r.status + ', brak wierszy tabeli, adres: ' + r.url + ', początek: ' + html.replace(/\s+/g, ' ').slice(0, 200);

            // Gra nie zwrocila wszystkich na jednej stronie (np. 20 na strone) - dociagnij kolejne strony z paginacji.
            const naglowek = doc.querySelector('#production_table thead');
            const razem = naglowek ? Number((/\((\d+)\)/.exec(naglowek.textContent) || [])[1]) : 0;   // "Wioska (64)"
            const strony = (razem && wierszy >= razem) ? new Set() : new Set([...doc.querySelectorAll('a[href*="page="]')].map(a => /[?&]page=(\d+)/.exec(a.getAttribute('href'))).filter(Boolean).map(m => Number(m[1])));
            for (const nr of [...strony].sort((x, y) => x - y).slice(0, 15)) {
                const rr = await fetch(baza + '&page=' + nr, { credentials: 'same-origin' });
                przetworz(new DOMParser().parseFromString(await rr.text(), 'text/html'));
            }

            if (ile > 0) {
                // lista grup z gry (linki a.group-menu-item) i sklad wybranych grup
                const lista = grupyZDoc(doc);
                if (lista.length) { const g = grupy(); g.lista = lista; zapiszGrupy(g); } else await wczytajListeGrup();
                for (const gid of new Set([ST.grupaKupna, ST.grupaSprzedazy].filter(Boolean))) await pobierzGrupe(gid);
                if (panel) wypelnijSelecty();
                // Wioski, ktorych nie ma juz w przegladzie (stracone, zmienione, stary zapis) - usun, zeby skrypt tam nie przechodzil.
                if (razem ? widziane.size >= razem : strony.size === 0) {
                    for (const id of Object.keys(w)) if (!widziane.has(String(id))) delete w[id];
                }
                try { localStorage.setItem(KEY_W, JSON.stringify(w)); } catch { /* pelny */ }
                odswiezKont();
                if (reczny) pokazStatus(['Wczytano stan ' + ile + ' wiosek z przeglądu produkcji' + (zle ? ' (pominięto ' + zle + ' wierszy, których nie rozpoznałem)' : '') + (strony.size ? ' z ' + (strony.size + 1) + ' stron.' : '.') + ' Grup: ' + grupy().lista.length + '.']);
                return ile;
            }
        } catch (e) { diag = 'wyjątek: ' + e.message; }
        console.warn('[GIELDA] przegląd produkcji – nie rozpoznano: ' + diag);
        if (reczny) {
            pokazStatus(['Nie rozpoznałem przeglądu produkcji. Skopiuj poniższy tekst (dotknij pole, zaznacz wszystko, kopiuj) i wklej do rozmowy z Claude.'], true);
            const ta = el('textarea', 'width:100%;box-sizing:border-box;height:90px;font-size:10px;margin-top:4px');
            ta.readOnly = true; ta.value = diag + '\n\n' + (probka || '');
            ta.onclick = () => ta.select();
            statusEl.appendChild(ta);
        }
        return 0;
    }

    // Wioski-mennice wskazujesz sam (checkbox na giełdzie w tej wiosce); skrypt tylko pamięta wybór.
    const KEY_M = 'pe_mennice_' + SWIAT;
    function mennice() { try { return JSON.parse(localStorage.getItem(KEY_M)) || {}; } catch { return {}; } }
    const czyMennica = id => !!mennice()[id];
    function ustawMennice(id, tak) {
        if (!id) return;
        const m = mennice();
        if (tak) m[id] = 1; else delete m[id];
        try { localStorage.setItem(KEY_M, JSON.stringify(m)); } catch { /* pelny */ }
    }

    let bezPrzejscia = false;   // po przejsciu do slabszej wioski nie przekierowujemy ponownie

    // Inna znana wioska, ktora ma wyraznie mniej danego surowca niz tu (<= 70% i o >= 2000 mniej) i pomiesci partie, albo null.
    function lepszaDoKupna(r) {
        const mm = model();
        if (!mm) return null;
        const w = wioska(r), teraz = w.ma + w.przyb;
        const inne = opcjeWiosek(mm).filter(o => o.typ === 'buy' && o.r === r && String(o.id) !== String(idWioski()));
        const lepsza = inne.filter(o => o.stan <= teraz * 0.7 && teraz - o.stan >= 1000).sort((a, b) => a.stan - b.stan)[0];
        return lepsza ? { o: lepsza, teraz } : null;
    }

    // Gdy obecna wioska ma za duzo surowca na kupno (wioska >= kupnoPkt punktow): najlepsza inna wioska do kupna albo null.
    function celKupnaPoza(r) {
        const mm = model();
        return mm ? (opcjeWiosek(mm).filter(o => o.typ === 'buy' && o.r === r && String(o.id) !== String(idWioski())).sort((a, b) => b.zysk - a.zysk)[0] || null) : null;
    }

    // Inna znana wioska, z ktorej sprzedaz danego surowca da wyraznie wiecej (>= 25% i >= 0.5 PP) niz tu.
    // Z listy opcji (posortowanej po zysku) bierze najlepsza; przy sprzedazy sposrod opcji o zysku w zakresie 5% od
    // najlepszej wybiera te wioske, ktora po sprzedazy zostanie z NAJWIEKSZA iloscia surowca (bogatsza, nie wyczyszczona).
    function wybierzNajlepsza(lista) {
        const top = lista[0];
        if (!top || top.typ !== 'sell') return top;
        return lista.filter(o => o.typ === 'sell' && o.zysk >= top.zysk * 0.95).sort((a, b) => b.po - a.po)[0];
    }

    function lepszaDoSprzedazy(r, zyskTu, poTu) {
        const mm = model();
        if (!mm) return null;
        const inne = opcjeWiosek(mm).filter(o => o.typ === 'sell' && o.r === r && String(o.id) !== String(idWioski()));
        const best = wybierzNajlepsza(inne.sort((a, b) => b.zysk - a.zysk));
        if (!best) return null;
        if (best.zysk >= zyskTu * 1.25 && best.zysk >= zyskTu + 0.5) return best;                       // wyraznie wiekszy zysk
        if (best.zysk >= zyskTu * 0.95 && best.po >= poTu * 2 + 5000) return best;                      // podobny zysk, ale bogatsza wioska (nie czyscimy malej)
        return null;
    }

    // Przyciski sa prawdziwymi linkami (<a href>): prawy przycisk -> "Otworz w nowej karcie", srodkowy / Ctrl+klik tez.
    // Adres liczymy tuz przed kliknieciem (najazd, dotkniecie, menu kontekstowe); zwykle klikniecie robi to, co dawniej.
    function urlWioski(v) { return location.origin + '/game.php?village=' + v + TQ + '&screen=market&mode=exchange'; }
    function przyciskLink(napis, celFn, akcja, css) {
        const a = el('a', 'display:inline-block;text-decoration:none;cursor:pointer;' + (css || ''), napis);
        a.className = 'btn'; a.href = '#';
        const ustaw = () => { let c = null; try { c = celFn(); } catch { /* brak */ } a.href = c ? urlWioski(c) : location.href; };
        for (const ev of ['pointerdown', 'mouseenter', 'touchstart', 'contextmenu', 'focus']) a.addEventListener(ev, ustaw, { passive: true });
        a.addEventListener('click', e => {
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) { ustaw(); return; }   // natywnie: nowa karta / okno
            e.preventDefault(); akcja();
        });
        ustaw();
        return a;
    }
    function celNastepna() {
        const kt = kontynentTu(), ja = String(idWioski());
        const lista = kt ? (wioskiKontynentow()[kt] || []) : [];
        if (lista.length < 2) return 'n' + idWioski();
        const i = lista.findIndex(([id]) => String(id) === ja);
        return lista[(i + 1) % lista.length][0];
    }
    function celNajlepsza() {
        const m = model(); if (!m) return null;
        zczytajZPol();
        const x = wybierzNajlepsza(opcjeWiosek(m));
        return x && String(x.id) !== String(idWioski()) ? x.id : null;
    }
    function celKontynentu(k) {
        const lista = (wioskiKontynentow()[k] || []).slice().sort((a, b) => (b[1].k || 0) - (a[1].k || 0));
        return lista.length ? lista[0][0] : null;
    }
    function nastepnaWKontynencie() {
        const kt = kontynentTu(), ja = String(idWioski());
        const lista = kt ? (wioskiKontynentow()[kt] || []) : [];
        if (lista.length < 2) return przejdz('n' + idWioski());      // za malo znanych wiosek - nastepna wg gry
        const i = lista.findIndex(([id]) => String(id) === ja);
        przejdz(lista[(i + 1) % lista.length][0]);
    }
    // Przycisk kontynentu: przechodzi do wioski z tego kontynentu (ta z najwieksza liczba wolnych kupcow);
    // tam "Najlepsza wioska" szuka juz tylko w obrebie tego kontynentu i jego gieldy.
    function idzNaKontynent(k) {
        const lista = (wioskiKontynentow()[k] || []).slice().sort((a, b) => (b[1].k || 0) - (a[1].k || 0));
        if (!lista.length) return pokazStatus(['Nie znam wiosek z kontynentu K' + k + ' – „Odśwież wioski”.'], true);
        pokazStatus(['Przechodzę na kontynent K' + k + ': ' + lista[0][1].n + '. Tam kliknij „Najlepsza wioska ★” (szuka tylko w obrębie K' + k + ').']);
        opoznij(() => przejdz(lista[0][0]), 300);
    }
    function odswiezKont() {
        if (!kontEl) return;
        kontEl.textContent = '';
        const kt = kontynentTu(), wk = wioskiKontynentow();
        const ks = Object.keys(wk).filter(k => k !== '?').sort((a, b) => a - b);
        if (ks.length < 2) return;                                   // jeden kontynent - nie ma po co
        kontEl.appendChild(el('span', '', 'Kontynenty: '));
        for (const k of ks) {
            const b = przyciskLink('K' + k + ' (' + wk[k].length + ')' + (k === kt ? ' ●' : ''), () => k === kt ? null : celKontynentu(k), () => k === kt ? pokazStatus(['Jesteś już na kontynencie K' + k + '.']) : idzNaKontynent(k), 'margin:0 4px 2px 0' + (k === kt ? ';outline:2px solid #3a7d1e' : ''));
            b.title = (k === kt ? 'jesteś na tym kontynencie' : 'przejdź do wioski z kontynentu K' + k) + '; prawy przycisk / środkowy / Ctrl+klik = nowa karta';
            kontEl.appendChild(b);
        }
    }

    // Opcja „nowa karta”: wywolanie musi byc od razu po kliknieciu (inaczej przegladarka blokuje okno), wiec bez opoznienia.
    function opoznij(fn, ms) { if (ST.nowaKarta) fn(); else setTimeout(fn, ms); }
    function przejdz(v, tuTaSamaKarta) {
        const url = location.origin + '/game.php?village=' + v + TQ + '&screen=market&mode=exchange';
        if (ST.nowaKarta && !tuTaSamaKarta) {
            let ok = false;
            try {
                const ss = {};
                for (const k of ['pe_po_przejsciu', 'pe_potok_cel', 'pe_potok']) ss[k] = sessionStorage.getItem(k);
                localStorage.setItem(KEY_H, JSON.stringify({ t: Date.now(), cel: String(v), ss }));
            } catch { /* brak */ }
            try { if (typeof GM_openInTab === 'function') { GM_openInTab(url, { active: true, insert: true, setParent: true }); ok = true; } } catch { /* brak */ }
            if (!ok) { try { ok = !!window.open(url, '_blank'); } catch { /* zablokowane */ } }
            if (!ok) {
                try { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); ok = true; } catch { /* brak */ }
            }
            if (ok) {
                try { sessionStorage.removeItem('pe_po_przejsciu'); } catch { /* brak */ }
                if (statusEl) statusEl.appendChild(el('div', '', 'Otwarto wioskę w nowej karcie.'));
                return;
            }
            pokazStatus(['Nie udało się otworzyć nowej karty – przechodzę w tej samej.'], true);
        }
        location.href = url;
    }

    // Dane o wioskach (surowce, kupcy) sa tylko migawka - po sprzedazy/kupnie szybko sie starzeja. Przed decyzja o przejsciu
    // skrypt sam dociaga przeglad produkcji, jesli ostatni jest starszy niz maxMs (jedno zapytanie, bez klikania „Odśwież wioski”).
    let przegladWToku = null;
    function swiezeDane(maxMs) {
        const klucz = 'pe_przeglad_' + SWIAT + GRACZ;
        if (!idWioski() || Date.now() - odczytT(klucz) < maxMs) return Promise.resolve();
        if (przegladWToku) return przegladWToku;
        zapiszT(klucz);
        przegladWToku = Promise.resolve().then(() => wczytajPrzeglad(false)).catch(() => 0).then(() => { zapiszWioske(); odswiezKont(); przegladWToku = null; });
        return przegladWToku;
    }
    function idzDoNajlepszej() {
        swiezeDane(45_000).then(idzDoNajlepszejCore);
    }
    function idzDoNajlepszejCore() {
        const m = model();
        if (!m) return pokazStatus(['Brak danych giełdy.'], true);
        zczytajZPol();
        const spelnia = RES.filter(r => { const k = kursTabeli(m, r); return (ST[r].buy !== null && k >= ST[r].buy) || (limitSprzedazy(r) !== null && k <= limitSprzedazy(r)); });
        if (!spelnia.length) return pokazStatus(['Żaden kurs nie spełnia teraz Twoich limitów (' + RES.map(r => NAZWY[r] + ' ' + kursTabeli(m, r)).join(', ') + ') – zmiana wioski nic nie da.']);
        const ja = idWioski();
        const lista = opcjeWiosek(m);
        if (!lista.length) {
            return pokazStatus(['Brak znanej wioski, która obsłuży obecne limity (znane wioski: ' + Object.keys(wioski()).length + '). Klikaj „Następna wioska ▶”, żeby skrypt poznał kolejne.']);
        }
        const x = wybierzNajlepsza(lista);
        const opis = (x.typ === 'buy' ? 'kupno ' : 'sprzedaż ') + NAZWY[x.r].toLowerCase() + (x.typ === 'buy' ? ' (ma ' + fmt(x.stan) + ')' : '') + ', zysk ≈ ' + x.zysk.toFixed(2) + ' PP';
        if (String(x.id) === String(ja)) return pokazStatus(['Ta wioska jest już najlepsza: ' + opis + '.']);
        const wiek = Math.round((Date.now() - x.z.t) / 60000);
        pokazStatus(['Przechodzę do: ' + x.z.n + ' – ' + opis + ' (dane sprzed ' + wiek + ' min).']);
        opoznij(() => przejdz(x.id), 300);
    }

    // Po kupnie w tej wiosce (tryb "potok"): przycisk pojawia sie po przeladowaniu strony (czyli po potwierdzeniu w grze).
    function potokStan() {
        try {
            const f = JSON.parse(sessionStorage.getItem('pe_potok'));
            return (f && Date.now() - f.t < 20 * 60_000 && String(f.id) === String(idWioski())) ? f : null;
        } catch { return null; }
    }
    function pokazPotok() {
        if (!bPotok) return;
        const f = ST.potok ? potokStan() : null;
        let potwierdzone = false;
        if (f) {
            const d = W.PremiumExchange && W.PremiumExchange.data;
            const teraz0 = d && d.stock ? d.stock[f.r] : NaN;
            // kupno potwierdzone = strona przeladowana po wypelnieniu LUB zapas giełdy tego surowca spadl
            potwierdzone = f.t < T_START || (Number.isFinite(teraz0) && Number.isFinite(f.stock) && teraz0 < f.stock - 1);
        }
        bPotok.style.display = potwierdzone ? '' : 'none';
    }
    function idzNaDawce() {
        swiezeDane(45_000).then(idzNaDawceCore);
    }
    function idzNaDawceCore() {
        const m = model();
        if (!m) return pokazStatus(['Brak danych giełdy.'], true);
        zczytajZPol();
        const f = potokStan(), ja = String(idWioski());
        const sprz = opcjeWiosek(m).filter(o => o.typ === 'sell' && String(o.id) !== ja);
        const ten = f ? sprz.filter(o => o.r === f.r) : [];
        const lista = (ten.length ? ten : sprz).sort((a, b) => b.zysk - a.zysk);
        if (!lista.length) return pokazStatus(['Żaden znany dawca nie sprzeda teraz (kurs ≤ limit sprzedaży, grupa/punkty/mennica, kupcy, surowce). „Odśwież wioski” albo zmień limity.'], true);
        const x = wybierzNajlepsza(lista);
        try { sessionStorage.setItem('pe_po_przejsciu', '1'); sessionStorage.removeItem('pe_potok'); } catch { /* brak */ }
        pokazStatus(['Przechodzę na dawcę: ' + x.z.n + ' – sprzedaż ' + NAZWY[x.r].toLowerCase() + ', zysk ≈ ' + x.zysk.toFixed(2) + ' PP. Tam sprzedaż wypełni się sama (potwierdzasz Ty).']);
        opoznij(() => przejdz(x.id), 300);
    }

    function podswietlWioski(on) {
        for (const b of [bN, bB]) if (b) b.style.outline = on ? '2px solid #c0392b' : '';
    }


    // ================= WYPELNIANIE =================
    function wypelnij() {
        const m = model();
        if (!m) { pokazStatus(['Brak danych giełdy – poczekaj chwilę lub odśwież stronę.'], true); return { ustawione: true, lacznie: 0 }; }

        zczytajZPol();
        const lim = {};
        for (const r of RES) lim[r] = { buy: ST[r].buy, sell: limitSprzedazy(r) };
        const ustawione = RES.some(r => lim[r].buy !== null || lim[r].sell !== null);

        const budzet = Math.min(punktyPremium(), ST.budzet === null ? Infinity : ST.budzet);
        const linie = [];
        const kandydaci = [];
        const jedynki = [];     // gielda wypchnieta na maksa: kandydaci "wpisz 1 szt."
        const kupnoPoza = [];   // surowce spelniajace limit kupna, ale ta wioska ma ich za duzo
        let brakSily = false; // kurs spelnia limit, ale ta wioska nie ma zasobow/kupcow
        wyczyscFormularz();

        // Gra pozwala na jedna operacje na raz (jeden surowiec), wiec zbieramy kandydatow
        // spelniajacych limity i wpisujemy tylko tego z najlepsza cena wzgledem limitu.
        for (const r of RES) {
            const nazwa = NAZWY[r];
            const L = lim[r];
            const kurs = kursTabeli(m, r);

            if (L.buy !== null) {
                if (kurs < L.buy) {
                    linie.push(nazwa + ': kurs teraz ' + kurs + ' < limit kupna ' + L.buy + ' – nie kupuję.');
                } else {
                    const pktTu = punktyWioski();
                    const gk = wGrupie('buy', idWioski());
                    const zablokowane = gk === null ? !!(ST.kupnoPkt && !(pktTu < ST.kupnoPkt)) : !gk;
                    const w = zablokowane ? { n: -1 } : ileKupic(m, r, L.buy, budzet);
                    if (w.n < 0) { kupnoPoza.push(r); linie.push(nazwa + ': kupno wyłączone – ' + (gk === null ? 'ta wioska ma ' + fmt(pktTu) + ' pkt (kupuję tylko do wiosek poniżej ' + fmt(ST.kupnoPkt) + ').' : 'ta wioska nie należy do grupy kupna „' + nazwaGrupy(ST.grupaKupna) + '”.')); }
                    else if (w.n > 0) kandydaci.push({ r, typ: 'buy', n: w.n, pp: w.pp, powod: w.powod, kurs, zysk: w.n / L.buy - kosztKupna(m, r, w.n) });
                    else { brakSily = true; linie.push(nazwa + ': kupno 0 szt. (ogranicza: ' + w.powod + ').'); }
                }
            }

            const gs = wGrupie('sell', idWioski());
            if (L.sell !== null && (gs === null ? (ST.sprzedazMinPkt && !(punktyWioski() >= ST.sprzedazMinPkt)) : !gs)) {
                if (kurs <= L.sell) { brakSily = true; linie.push(nazwa + ': sprzedaż wyłączona – ' + (gs === null ? 'ta wioska ma ' + fmt(punktyWioski()) + ' pkt (sprzedaję tylko z wiosek od ' + fmt(ST.sprzedazMinPkt) + ').' : 'ta wioska nie należy do grupy sprzedaży „' + nazwaGrupy(ST.grupaSprzedazy) + '”.')); }
            } else if (L.sell !== null && ST.mennice && !czyMennica(idWioski())) {
                if (kurs <= L.sell) { brakSily = true; linie.push(nazwa + ': ta wioska nie jest mennicą – sprzedaż wyłączona (zaznacz „ta wioska to mennica” albo odznacz „tylko z mennic”).'); }
            } else if (L.sell !== null && ST.monety && wolniKupcy() < ST.monetyMin) {
                if (kurs <= L.sell) { brakSily = true; linie.push(nazwa + ': wybijanie monet – ta wioska ma ' + wolniKupcy() + ' wolnych kupców (< ' + ST.monetyMin + '), nie sprzedaje.'); }
            } else if (L.sell !== null) {
                if (kurs > L.sell) {
                    linie.push(nazwa + ': kurs teraz ' + kurs + ' > limit sprzedaży ' + L.sell + ' – nie sprzedaję.');
                    const j = jedynkaSprzedaz(m, r);
                    if (j) jedynki.push(j);
                } else {
                    const w = ileSprzedac(m, r, L.sell);
                    if (w.n > 0) kandydaci.push({ r, typ: 'sell', n: w.n, pp: w.pp, kupcy: w.kupcy, ostatni: w.ostatni, powod: w.powod, kurs, zysk: zwrotSprzedazy(m, r, w.n) - w.n / (L.sell * (1 + m.tb)) });
                    else {
                        const j = /poni\u017cej 1 PP/.test(w.powod || '') ? jedynkaSprzedaz(m, r) : null;
                        if (j) jedynki.push(j);
                        else { brakSily = true; linie.push(nazwa + ': sprzedaż 0 szt. (ogranicza: ' + w.powod + ').'); }
                    }
                }
            }
        }

        // nic nie spelnia limitow, ale gielda jest wypchnieta na maksa: wpisz 1 szt. surowca, ktorego zostalo najmniej miejsca
        // (najmniej surowca oddajesz za to samo 1 PP); gra sama skalkuluje oferte
        if (!kandydaci.length && jedynki.length) {
            jedynki.sort((x, y) => x.miejsce - y.miejsce);
            const j = jedynki[0];
            kandydaci.push(Object.assign({}, j, { kurs: kursTabeli(m, j.r), zysk: 0, powod: 'giełda wypchnięta na maksa' }));
        }

        let lacznie = 0;
        if (!kandydaci.length && kupnoPoza.length) {
            const cele = kupnoPoza.map(celKupnaPoza).filter(Boolean).sort((a, b) => b.zysk - a.zysk);
            if (cele.length && ST.kupnoDoSlabej && !bezPrzejscia) {
                const cel = cele[0];
                try { sessionStorage.setItem('pe_po_przejsciu', '1'); } catch { /* brak */ }
                pokazStatus(['Kupno ' + NAZWY[cel.r].toLowerCase() + ': ta wioska nie jest celem kupna – przechodzę do „' + cel.z.n + '” (' + fmt(cel.z.pkt) + ' pkt, ma ' + fmt(cel.stan) + ' surowca). Tam kliknij „Kalkuluj”.']);
                opoznij(() => przejdz(cel.id), 500);
                return { ustawione, lacznie: 0, przejscie: true };
            }
            if (!cele.length) linie.push('Żadna znana wioska kupna (' + (ST.grupaKupna ? 'grupa „' + nazwaGrupy(ST.grupaKupna) + '”' : 'poniżej ' + fmt(ST.kupnoPkt) + ' pkt') + ') nie pomieści partii (albo jej nie znam – „Odśwież wioski”) – kupno pomijam.');
        }
        if (!kandydaci.length && brakSily && ST.kupnoDoSlabej && !bezPrzejscia) {
            // kurs oplacalny, ale ta wioska nie ma zasobow/kupcow/miejsca - przenies do najlepszej znanej
            const ja = String(idWioski());
            const cel = wybierzNajlepsza(opcjeWiosek(m).filter(o => String(o.id) !== ja));
            if (cel) {
                try { sessionStorage.setItem('pe_po_przejsciu', '1'); } catch { /* brak */ }
                pokazStatus(['Ta wioska nie da rady – przechodzę do „' + cel.z.n + '”: ' + (cel.typ === 'buy' ? 'kupno ' : 'sprzedaż ') + NAZWY[cel.r].toLowerCase() + ', zysk ≈ ' + cel.zysk.toFixed(2) + ' PP. Tam kliknij „Kalkuluj”.']);
                opoznij(() => przejdz(cel.id), 500);
                return { ustawione, lacznie: 0, przejscie: true };
            }
            linie.push('Żadna znana wioska nie obsłuży tej okazji (znane wioski: ' + Object.keys(wioski()).length + ') – „Odśwież wioski” albo „Następna wioska ▶”.');
        }
        if (kandydaci.length) {
            // najlepszy = najwiekszy szacowany zysk wzgledem limitu w PP (uwzglednia ilosc, wiec 1 PP
            // rzadkiego surowca przegrywa z duza transakcja surowca, ktorego jest duzo);
            // rozrzut dodaje ok. +-1% szumu, zeby przy prawie rownych zyskach nie wygrywal zawsze ten sam
            for (const c of kandydaci) c.wynik = (c.typ === 'sell' && doPelna() ? c.pp : c.zysk) * (rozrzutOn() && CONFIG.rozrzutMax > 0 ? 1 + (Math.random() - 0.5) * 0.02 : 1);
            kandydaci.sort((a, b) => b.wynik - a.wynik);
            const c = kandydaci[0];
            if (c.typ === 'sell' && ST.kupnoDoSlabej && !bezPrzejscia && !c.jedynka) {
                const l = lepszaDoSprzedazy(c.r, c.zysk, wioska(c.r).ma - c.n);
                if (l) {
                    try { sessionStorage.setItem('pe_po_przejsciu', '1'); } catch { /* brak */ }
                    pokazStatus(['Sprzedaż ' + NAZWY[c.r].toLowerCase() + ': przechodzę do lepszej wioski „' + l.z.n + '” (zysk ≈ ' + l.zysk.toFixed(2) + ' PP vs ' + c.zysk.toFixed(2) + ' PP tutaj). Tam kliknij „Kalkuluj”.']);
                    opoznij(() => przejdz(l.id), 500);
                    return { ustawione, lacznie: 0, przejscie: true };
                }
            }
            if (c.typ === 'buy' && ST.kupnoDoSlabej && !bezPrzejscia && !c.jedynka) {
                const l = lepszaDoKupna(c.r);
                if (l) {
                    try { sessionStorage.setItem('pe_po_przejsciu', '1'); } catch { /* brak */ }
                    pokazStatus(['Kupno ' + NAZWY[c.r].toLowerCase() + ': przechodzę do słabszej wioski „' + l.o.z.n + '” (ma ' + fmt(l.o.stan) + ' vs ' + fmt(l.teraz) + ' tutaj). Tam kliknij „Kalkuluj”.']);
                    opoznij(() => przejdz(l.o.id), 500);
                    return { ustawione, lacznie: 0, przejscie: true };
                }
            }
            const a = m.s[c.r];
            lacznie = c.n;
            wpisz(c.typ + '_' + c.r, c.n);
            if (c.jedynka) {
                linie.unshift(NAZWY[c.r] + ': giełda wypchnięta na maksa (miejsca zostało ' + fmt(c.miejsce) + ' szt., mniej niż warte 1 PP) – wpisano 1 szt., gra sama dobierze sprzedaż za 1 PP (kurs ' + c.kurs + '). Sprawdź ofertę w oknie potwierdzenia.');
            } else if (c.typ === 'buy') {
                const w0 = wioska(c.r);
                if (c.n > Math.max(0, w0.wolne - Math.floor((Number.isFinite(w0.max) ? w0.max : 0) * CONFIG.zapasMagazynu))) { oznaczNadmiar(); pokazNadmiar(); }
                if (ST.potok) { try { sessionStorage.setItem('pe_potok', JSON.stringify({ t: Date.now(), id: idWioski(), r: c.r, stock: a.stock })); sessionStorage.setItem('pe_potok_cel', JSON.stringify({ t: Date.now(), r: c.r, kurs: c.kurs })); } catch { /* brak */ } }
                const kursPo = Math.floor(1 / ((a.p0 + a.k * c.n) * (1 + m.tb)));
                linie.unshift('Największy zysk: ' + NAZWY[c.r] + ' – kupno ' + fmt(c.n) + ' szt. za ' + c.pp + ' PP, kurs ' + c.kurs + ' → po zakupie ≈ ' + kursPo + ', zysk ≈ ' + c.zysk.toFixed(2) + ' PP (ogranicza: ' + c.powod + ').');
            } else {
                const kursPo = Math.floor(1 / ((a.p0 - a.k * c.n) * (1 + m.tb)));
                linie.unshift('Największy zysk: ' + NAZWY[c.r] + ' – sprzedaż ' + fmt(c.n) + ' szt. za ' + c.pp + ' PP (' + c.kupcy + ' kupców, ostatni z ' + c.ostatni + ' szt.), kurs ' + c.kurs + ' → po sprzedaży ≈ ' + kursPo + ', zysk ≈ ' + c.zysk.toFixed(2) + ' PP (ogranicza: ' + c.powod + ').');
            }
            for (const x of kandydaci.slice(1)) {
                linie.push(NAZWY[x.r] + ': ' + (x.typ === 'buy' ? 'kupno' : 'sprzedaż') + ' też spełnia limit (kurs ' + x.kurs + ', zysk ≈ ' + x.zysk.toFixed(2) + ' PP), ale gra pozwala na jeden surowiec naraz – zostaje na następny raz.');
            }
        }
        if (!ustawione) linie.push('Ustaw przynajmniej jeden limit.');
        let slabsza = false;
        if (kandydaci.length) {
            const c0 = kandydaci[0];
            if (c0.typ === 'buy') {
                const l = lepszaDoKupna(c0.r);
                if (l) { slabsza = true; linie.push('Uwaga: dla surowca ' + NAZWY[c0.r].toLowerCase() + ' słabsza jest wioska „' + l.o.z.n + '” (ma ' + fmt(l.o.stan) + ' vs ' + fmt(l.teraz) + ' tutaj) – „Najlepsza wioska ★” tam przejdzie.'); }
            }
        }
        podswietlWioski((lacznie === 0 && brakSily) || slabsza);
        if (lacznie === 0 && brakSily) linie.push('Kurs jest opłacalny, ale ta wioska nie da rady – spróbuj „Najlepsza wioska ★” albo „Następna wioska ▶”.');
        if (ST.kupnoNadmiar) linie.push('Kupno ponad stan: ' + opisNadmiaru() + '.');
        linie.push(lacznie > 0 ? 'Formularz wypełniony – potwierdź ofertę w grze.' : 'Nic nie spełnia limitów – formularz pusty.');
        pokazStatus(linie);
        return { ustawione, lacznie };
    }

    // ---------- podpiecie pod "Kalkuluj najlepsza oferte" ----------
    // Klik w przycisk poprzedza zdarzenie submit, wiec formularz jest juz wypelniony,
    // zanim gra odczyta pola i policzy oferte. Faza capture - przed handlerami gry.
    document.addEventListener('click', function (e) {
        const btn = e.target && e.target.closest && e.target.closest('.btn-premium-exchange-buy');
        if (!btn || !panel) return;
        const cb = document.getElementById('pew_auto');
        if (!cb || !cb.checked) return;
        // Formularz juz ma ilosci (nasze po poprzednim kliknieciu albo reczne poprawki) - nie ruszamy,
        // zeby mozna bylo recznie zmienic ilosc i policzyc oferte ponownie.
        const niepusty = ['buy', 'sell'].some(typ => RES.some(r => {
            const i = document.querySelector('input[name="' + typ + '_' + r + '"]');
            return i && i.value.trim() !== '';
        }));
        if (niepusty) {
            pokazStatus(['Formularz ma już ilości – nie nadpisuję. „Wyczyść formularz” albo „Wypełnij (podgląd)” liczy od nowa.']);
            return;
        }
        const w = wypelnij();
        if (w.przejscie || (w.ustawione && w.lacznie === 0)) {
            // nic do zrobienia przy tych limitach - nie wysylaj pustego formularza
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }, true);


    // ================= PETLA =================
    function uruchom() {
        const dane = odczytaj();
        if (!Object.keys(dane).length) return;
        odswiezWiersze(dane);
        zapiszLog(dane);
        sprawdz(dane);
    }

    // Podpiecie pod natywna aktualizacje gry (co ok. 10 s) - zero wlasnych zapytan.
    (function podepnij() {
        if (!NA_GIELDZIE) return;
        const pe = W.PremiumExchange;
        if (!pe || typeof pe.receiveData !== 'function') return setTimeout(podepnij, 500);
        if (pe.__wypelHooked) return;
        pe.__wypelHooked = true;
        const orig = pe.receiveData.bind(pe);
        pe.receiveData = function (d) { const r = orig(d); setTimeout(uruchom, 50); return r; };
    })();

    // Zapas: gdyby hook nie zadzialal, sprawdzaj co 15 s z DOM.
    if (NA_GIELDZIE) setInterval(uruchom, 15_000);
    // Krotkie przypomnienia: co 2 s tylko ponownie oceniamy ostatnie dane z pamieci (zero zapytan do serwera).
    if (NA_GIELDZIE) setInterval(() => { const d = odczytaj(); if (Object.keys(d).length) sprawdz(d); }, 2_000);

    function start() {
        if (!NA_GIELDZIE) return;
        const form = document.getElementById('premium_exchange_form');
        if (!form) return setTimeout(start, 400);
        if (document.getElementById('pe-wypelniacz')) return;
        zbudujPanel(form);
        zapiszWioske();
        try {
            if (sessionStorage.getItem('pe_po_przejsciu')) {
                sessionStorage.removeItem('pe_po_przejsciu');
                bezPrzejscia = true;
                setTimeout(() => { swiezeDane(60_000).then(() => { bezPrzejscia = true; try { wypelnij(); } finally { bezPrzejscia = false; } }); }, 900);   // tylko wypelnia formularz - „Kalkuluj” klikasz sam
            }
        } catch { /* brak sessionStorage */ }
        uruchom();
    }

    // Po zalogowaniu (wejscie na ekran przegladu spoza gry) jednorazowo przejdz na gielde.
    // Zabezpieczenie przed petla: nie czesciej niz raz na 5 min.
    const teraz = () => Date.now();
    const odczytT = k => { try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; } };
    const zapiszT = k => { try { localStorage.setItem(k, String(teraz())); } catch { /* zablokowane */ } };

    (function otworzGielde() {
        const gd = W.game_data;
        if (!ST.otworz || !gd || gd.screen !== 'overview') return;
        if (/\/game\.php/.test(document.referrer)) return;      // przejscie wewnatrz gry - nie ruszamy
        if (teraz() - odczytT('pe_otw_' + SWIAT + GRACZ) < 5 * 60_000) return;
        zapiszT('pe_otw_' + SWIAT + GRACZ);
        console.log('[GIELDA] po zalogowaniu: otwieram giełdę');
        przejdz(gd.village.id, true);
    })();

    // Przeglad produkcji (stan wszystkich wiosek): z dowolnej strony gry, co najwyzej raz na 90 s.
    setTimeout(() => {
        swiezeDane(90_000);
    }, 1500);
    // na gieldzie co 3 min odswiez dane w tle, zeby wybor wioski nie opieral sie na starych zapasach i kupcach
    if (NA_GIELDZIE) setInterval(() => swiezeDane(150_000), 3 * 60_000);
    start();


    // ================= KOMENDY W KONSOLI (F12) =================
    // Ustaw ten sam prog kupna / sprzedazy dla wszystkich surowcow naraz.
    W.gieldaProgi = function (kup, sprzedaj) {
        for (const r of RES) {
            if (kup) ST[r].buy = kup;
            if (sprzedaj) ST[r].sell = sprzedaj;
        }
        zapiszUstawienia();
        for (const r of RES) {
            const b = document.getElementById('pew_buy_' + r), s = document.getElementById('pew_sell_' + r);
            if (b) b.value = ST[r].buy ?? '';
            if (s) s.value = ST[r].sell ?? '';
        }
        Object.keys(stan).forEach(k => delete stan[k]);
        console.log(`[GIELDA] progi: kup >=${kup ?? '(bez zmian)'}, sprzedaj <=${sprzedaj ?? '(bez zmian)'}`);
        uruchom();
    };

    // Srednia z wlasnego logu za wskazana liczbe godzin wstecz.
    // gieldaSrednia()    - dzisiaj od polnocy
    // gieldaSrednia(6)   - ostatnie 6 godzin
    W.gieldaSrednia = function (godzin) {
        const l = logArr();
        if (!l.length) {
            console.warn('[GIELDA] log pusty - skrypt musi chwile pozbierac dane');
            return;
        }

        let od, opis;
        if (godzin) {
            od = Date.now() - godzin * 3600_000;
            opis = `ostatnie ${godzin} h`;
        } else {
            const p = new Date();
            p.setHours(0, 0, 0, 0);
            od = p.getTime();
            opis = 'dzisiaj od polnocy';
        }

        const okno = l.filter(w => w.t >= od);
        if (!okno.length) {
            console.warn(`[GIELDA] brak wpisow w okresie: ${opis}`);
            return;
        }

        const t = {};
        for (const r of RES) {
            const v = okno.map(w => w[r]).filter(x => x != null).sort((a, b) => a - b);
            if (!v.length) continue;
            t[NAZWY[r]] = {
                srednia: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
                mediana: v[Math.floor(v.length / 2)],
                min: v[0],
                max: v[v.length - 1],
                wpisow: v.length,
            };
        }

        const rozpietosc = ((okno[okno.length - 1].t - okno[0].t) / 3600_000).toFixed(1);
        console.log(`[GIELDA] ${opis} - dane z ${rozpietosc} h (${okno.length} wpisow)`);
        console.table(t);
        return t;
    };

    W.gieldaStat = function () {
        const l = logArr();
        if (!l.length) return console.warn('[GIELDA] log pusty');
        const t = {};
        for (const r of RES) {
            const v = l.map(w => w[r]).filter(x => x != null).sort((a, b) => a - b);
            if (v.length) t[NAZWY[r]] = { wpisow: v.length, min: v[0],
                mediana: v[Math.floor(v.length / 2)], max: v[v.length - 1],
                srednia: Math.round(v.reduce((a, b) => a + b, 0) / v.length) };
        }
        console.table(t);
    };

    W.gieldaCSV = function () {
        const l = logArr();
        if (!l.length) return console.warn('[GIELDA] log pusty');
        const csv = '﻿' + ['data;godzina;drewno;glina;zelazo',
            ...l.map(w => { const d = new Date(w.t);
                return [d.toLocaleDateString('pl-PL'), d.toLocaleTimeString('pl-PL'),
                        w.wood ?? '', w.stone ?? '', w.iron ?? ''].join(';'); })
        ].join('\r\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = `gielda-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        console.log(`[GIELDA] pobrano ${l.length} wpisow`);
    };

    // Test powiadomienia - sprawdz konfiguracje zanim zostawisz na noc.
    W.gieldaTestPush = function () {
        if (!CONFIG.push.wlaczone) {
            console.warn('[GIELDA] push wylaczony - ustaw push.wlaczone = true');
            return;
        }
        ostatniPush.test = 0; // pomin odstep
        wyslijPush('TEST - jesli to widzisz na telefonie, dziala', 'test');
        console.log('[GIELDA] wyslano test przez kanal:', CONFIG.push.kanal);
    };

    if (window.Notification && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    console.log('%c[GIELDA] alarm + wypelniacz uruchomiony', 'color:#0a0;font-weight:bold');
    console.log('  gieldaProgi(kup, sprzedaj) - ten sam prog dla wszystkich surowcow\n' +
                '  gieldaSrednia() / gieldaSrednia(6) - srednia z logu\n' +
                '  gieldaStat() / gieldaCSV() - statystyki / pobierz historie\n' +
                '  gieldaTestPush() - test powiadomienia na telefon');
})();
