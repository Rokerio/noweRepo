# Plemiona – skrypty użytkownika

Skrypty do Tampermonkey / Violentmonkey. Kliknij link **Instaluj** – przeglądarka otworzy okno instalacji. Skrypty aktualizują się same po podbiciu `@version`.

| Skrypt | Wersja | Instalacja |
|---|---|---|
| Plemiona – Cofanie wojsk wg wiosek (gracz → wioska → wycofaj) | 1.1 | [Instaluj](https://raw.githubusercontent.com/Rokerio/noweRepo/main/cofanie-wg-wiosek.user.js) |
| Dostawy MK - drzewo do celu (bicie monet) | 2.2.2 | [Instaluj](https://raw.githubusercontent.com/Rokerio/noweRepo/main/dostawy-mk-drzewo.user.js) |
| Duże strzałki przełączania wiosek | 1.2 | [Instaluj](https://raw.githubusercontent.com/Rokerio/noweRepo/main/duze-strzalki-wiosek.user.js) |
| Dysponent Grup – wysyłka | 1.2.2 | [Instaluj](https://raw.githubusercontent.com/Rokerio/noweRepo/main/dysponent-grup-wysylka.user.js) |
| Plemiona - Giełda Premium: alarm + wypełniacz | 5.56 | [Instaluj](https://raw.githubusercontent.com/Rokerio/noweRepo/main/gielda-premium.user.js) |
| Plemiona – Grupy flag (Zagroda / Surowce / Atak / Rekrutacja) | 1.0.1 | [Instaluj](https://raw.githubusercontent.com/Rokerio/noweRepo/main/grupy-flag.user.js) |
| Plemiona – Klin PRO (normalny + z cofki, auto) | 3.17 | [Instaluj](https://raw.githubusercontent.com/Rokerio/noweRepo/main/klin-pro.user.js) |
| Plemiona – Obstawy + Stałki (masowe wsparcie) | 2.6 | [Instaluj](https://raw.githubusercontent.com/Rokerio/noweRepo/main/obstawy-stalki.user.js) |
| Plemiona – statystyki gracza w dymku mapy | 2.10 | [Instaluj](https://raw.githubusercontent.com/Rokerio/noweRepo/main/plemiona-mapa-statystyki.user.js) |
| Plemiona - nazwy Taxi / Bolt | 5.5 | [Instaluj](https://raw.githubusercontent.com/Rokerio/noweRepo/main/plemiona-nazwy.user.js) |
| Plemiona – Plemienny Poker podpowiedź | 1.5 | [Instaluj](https://raw.githubusercontent.com/Rokerio/noweRepo/main/plemiona-poker-podpowiedz.user.js) |
| Plemiona – Skaner defa offem (Dzienne + raporty) | 2.1 | [Instaluj](https://raw.githubusercontent.com/Rokerio/noweRepo/main/skaner-defa-offem.user.js) |
| Plemiona – Strażnik planu ataku | 1.28 | [Instaluj](https://raw.githubusercontent.com/Rokerio/noweRepo/main/straznik-planu-ataku.user.js) |
| Plemiona – Zrzut źródła strony (do wklejenia Claude) | 1.1 | [Instaluj](https://raw.githubusercontent.com/Rokerio/noweRepo/main/plemiona-zrzut-zrodla.user.js) |
| Masowy Zbierak API (Plemiona) | 7.6 | [Instaluj](https://raw.githubusercontent.com/Rokerio/noweRepo/main/zbierak-api.user.js) |
| Plemiona – Sprawdzacz skryptów (README vs to urządzenie) | 1.0.0 | [Instaluj](https://raw.githubusercontent.com/Rokerio/noweRepo/main/sprawdzacz-skryptow.user.js) |

## Sprawdzanie na urządzeniu

Zainstaluj **Sprawdzacz skryptów** – przycisk 🔎 w rogu gry porównuje tę listę z tym, co jest zainstalowane na danym urządzeniu (✅ aktualny, 🔄 do aktualizacji, ❌ nie widziany). Każdy skrypt zapisuje swoją wersję w `localStorage` (`gdp_registry`) przy uruchomieniu, więc „nie widziany” = niezainstalowany albo jeszcze nie uruchomiony na swojej stronie. Nowy skrypt do README musi mieć tę samą linijkę rejestru pod `==/UserScript==`.

## Aktualizacja

Po zmianie skryptu podbij `@version` w nagłówku i wrzuć na `main`. Tampermonkey sprawdza aktualizacje wg własnego harmonogramu (Ustawienia → Sprawdzaj aktualizacje), a ręcznie: Narzędzia → Sprawdź aktualizacje.
