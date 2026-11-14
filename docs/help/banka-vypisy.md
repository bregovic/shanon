---
title: Banka měsíčně – import výpisů a zaúčtování
module: bank
objects: bank.statement, bank.statementLine, bank.importLog, bank.account
order: 10
summary: Hromadný import GPC, kontrola návaznosti, párování plateb a deník hlavní knihy z výpisů.
---
## Jednou na začátku

- V [Bankovní účty](/bank/account) založte účet s **číslem účtu** (např. `19-123456789/0100`) a účtem hlavní knihy (221…). Podle čísla účtu se výpisy samy přiřadí správné firmě.

## Každý měsíc

1. Stáhněte z internetového bankovnictví výpisy ve formátu **GPC** (ABO).
2. [Hromadný import výpisů](/bank/import) – vyberte nebo přetáhněte všechny soubory najednou a dejte **Načíst**.
3. Prohlédněte výsledek (nebo později [Importované výpisy](/bank/importLog)):
   - **Načteno** – v pořádku,
   - **Upozornění** – nenavazuje zůstatek nebo chybí některý výpis (např. „Chybí výpis č. 2“),
   - **Duplicita** – výpis už v systému je,
   - **Chyba** – soubor nesedí na součty nebo účet nemá žádná firma.
4. Otevřete výpis v [Bankovních výpisech](/bank/statement). Platby s variabilním symbolem faktury nebo zálohy se spárovaly samy (**Spárovat** je možné spustit znovu). Nespárované řádky doplňte – vyberte otevřenou položku odběratele či dodavatele, zálohu nebo protiúčet (poplatky 568…).
5. Zaúčtování – dvě cesty:
   - **Zaúčtovat** rovnou na výpisu, nebo
   - v seznamu výpisů označte jeden či více výpisů a dejte **Vytvořit deník HK**. Vznikne bankovní deník, který v [Deníky](/gl/journal) zkontrolujete (**Ověřit**) a **zaúčtujete**.

> **Zkontrolovat návaznost** (i nad více výpisy) znovu prověří zůstatky a chybějící čísla.

## Na co si dát pozor

- Výpis, který nesedí na součty v hlavičce, se neuloží vůbec – stáhněte ho z banky znovu.
- Automat páruje jen jednoznačnou shodu VS. Když stejný VS má víc dokladů, spárujte ručně.
