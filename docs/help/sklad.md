---
title: Sklad – příjem, výdej, inventura, ocenění
module: whs
objects: whs.journal, whs.journalLine, whs.onhand, whs.trans, whs.parameters, whs.location, whs.warehouse
order: 10
summary: Sklady a lokace, příjemka z objednávky, vyřazení, přesun, inventura a ocenění průměrnou cenou.
---
## Nastavení

- [Sklady](/whs/warehouse) – hlavní sklad vznikne sám; další přidejte (např. prodejna). Jeden je **výchozí**.
- [Úrovně lokací](/whs/locationLevel) – pojmenujte si až 6 úrovní (Budova, Místnost, Regál, Police…).
- [Lokace](/whs/location) – strom: lokace s nadřazenou lokací. Kód se skládá do cesty, např. `A.01.R1.3`.
- [Parametry skladu](/whs/parameters) – **Oceňovat zásoby** zapne průměrnou cenu a účtování (132, 131, 504, 549, 648).
- U pokladny lze nastavit **sklad pokladny**, odkud se vydává prodej.

## Příjem

- Z **nákupní objednávky**: **Přijmout na sklad** → vznikne příjemka se zbývajícím množstvím a cenou z objednávky → doplňte lokace → **Zaúčtovat**.
- **Přijatá faktura bez objednávky** naskladní zboží sama při zaúčtování.

## Výdej

- **Vydaná faktura** vydá zboží při zaúčtování (z objednávky uvolní rezervaci). **Účtenka z pokladny** vydá ze skladu pokladny.
- Prodej smí jít do mínusu (prodej se nezastaví); skladové deníky ne.

## Skladové deníky

[Skladové deníky](/whs/journal) → **Nový**, zvolte druh:

| Druh | Použití |
|---|---|
| Příjemka | ruční příjem (s cenou za jednotku) |
| Vyřazení | ztráta, poškození, prošlé zboží – vyplňte důvod |
| Přesun | mezi sklady nebo lokacemi |
| Inventura | **Načíst stav** předvyplní stav z evidence, přepište jen napočítané rozdíly |

Řádky doplňte přímo v mřížce a dejte **Zaúčtovat**.

## Kontrola

- [Zásoby](/whs/onhand) po lokacích, [Skladové pohyby](/whs/trans), [Rezervace](/whs/reservation).
- Report [Dostupnost zásob](/report/whs/availability) – zásoba, rezervováno, dostupné.
- Report [Ocenění zásob](/report/whs/valuation) – hodnota zásob a porovnání s účtem 132 (rozdíl má být 0).
