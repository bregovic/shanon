---
title: Banka měsíčně – import výpisů a zaúčtování
module: bank
objects: bank.statement, bank.statementLine, bank.importLog, bank.account, bank.postingRule
order: 10
video: 02-banka-vypis
summary: Hromadný import GPC, kontrola návaznosti, párování plateb a deník hlavní knihy z výpisů.
---
## Jednou na začátku

- V [Bankovní účty](/bank/account) založte účet s **číslem účtu** (např. `19-123456789/0100`) a účtem hlavní knihy (221…). Podle čísla účtu se výpisy samy přiřadí správné firmě.

## Výpisy v CSV (specifikace)

CSV výpis každá banka skládá jinak, proto ho popisuje **specifikace** ([Specifikace výpisů](/bank/statementFormat)) – nic není napevno v programu:

- **Začátek souboru** – podle něj se soubor pozná (KB: `KB+, vypis v csv`),
- **Maska názvu souboru** – číslo účtu z názvu (KB: `^Vypis_(\d+)_`),
- **Transakce začínají řádkem** – text buňky, kterým začíná tabulka (KB: `Datum zauctovani`),
- kódování, oddělovač, desetinná čárka a formát data,
- **Údaje výpisu**: u hlavičky *údaj ← začátek řádku* (Počáteční zůstatek ← `Pocatecni zustatek`), u transakcí *údaj ← název sloupce* (Částka ← `Castka`, VS ← `VS`).

Specifikace KB je připravená. Pro jinou banku založte novou podle jejího vzoru. U [bankovního účtu](/bank/account) vyberte **Specifikaci výpisu**. Hromadný import pak pozná soubor i účet sám (IBAN nebo číslo účtu v hlavičce, případně číslo v názvu souboru). Výpis za období bez čísla dostane číslo z období (`20260101-20261114`) a návaznost se kontroluje podle data.

## Každý měsíc

1. Stáhněte z internetového bankovnictví výpisy ve formátu **GPC** (ABO), nebo v **CSV** – např. Komerční banka „KB+, výpis v CSV“.
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

## Párování a předkontace

Po načtení zkuste u výpisu **Automaticky spárovat**. Ve sloupci **Párování** je u každé transakce vidět, co se našlo:

- **Faktura / záloha odběratele či dodavatele** – podle VS (jen jednoznačná shoda),
- **Účtenka (QR platba)** – příjem s VS a přesnou částkou účtenky z pokladny, která čeká na QR platbu; po zaúčtování výpisu je účtenka **Zaplaceno** (účtuje se proti účtu QR plateb pokladny, výchozí 261),
- **Předkontace** – transakce bez dokladu podle pravidla v [Předkontace transakcí](/bank/postingRule): text zprávy obsahuje (např. „poplatek“), protiúčet obsahuje, směr příjem / výdaj → účet hlavní knihy. Připravené jsou bankovní poplatky (568) a úroky (662),
- **Účet** – protiúčet zadaný ručně v detailu transakce,
- **Nespárováno** – doplníte v deníku.

Částka je jedním sloupcem **Částka +/−** (příjem kladně, výdaj záporně). Vazby na faktury a zálohy jsou v detailu transakce.

## Deník z vybraných transakcí

V detailu výpisu jsou rovnou transakce (hlavička je v **Další ▾ → Hlavička**). Transakce můžete vyfiltrovat (třeba Párování = spárované), označit a dát **Vytvořit deník HK** – přejdou jen vybrané. Další výběr se přidá do stejného rozpracovaného deníku výpisu; transakce, která už v deníku je, se podruhé nepřevede (sloupec **Deník**).

Po hromadném importu bez chyb se aplikace sama přepne do přehledu bankovních výpisů.

## Na co si dát pozor

- Výpis, který nesedí na součty v hlavičce, se neuloží vůbec – stáhněte ho z banky znovu.
- Automat páruje jen jednoznačnou shodu VS. Když stejný VS má víc dokladů, spárujte ručně.
