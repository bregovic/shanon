# Shanon vs. D365 F&O / AX 2012 — co ve standardu chybí

Stav Shanonu k 12. 11. 2026. Srovnání se týká **platformy a financí**
(ne celých logistických modulů). Priorita: **P1** = potřebné pro první
ostré nasazení malé firmy, **P2** = brzy, **P3** = později / podle poptávky.

## Co už Shanon má (obdoba v AX/D365)

| Shanon | AX 2012 / D365 F&O |
|---|---|
| Typy polí (EDT), výčty, objekty z definice | EDT, Base Enums, tabulky + formuláře z metadat |
| Labely `@MODUL:Klic`, přepisy tenanta | Label files, label overrides |
| Moduly se závislostmi, zapínání per tenant | Configuration keys, License keys |
| Rozšíření mimo core (pole do `ext`, události) | Extensions, event handlers (CoC v D365) |
| Firmy, data per firma / sdílená data | Legal entities, DataAreaId, sdílené tabulky (GAB) |
| Adresář subjektů | Global address book |
| Role → oprávnění na modul/objekt, superuživatel, správce firmy, role per firma | Security roles, duties, privileges; přiřazení rolí k organizacím |
| Izolace tenantů v DB (RLS) | — (D365 je single-tenant) |
| Číselné řady s Použitím, výchozí nastavení | Number sequences, references, wizard |
| Hlavní kniha: účty, střediska, názvy deníků, deník → doklad → zápisy | Main accounts, financial dimensions, journal names, GJ → voucher → GeneralJournalAccountEntry |
| Daňové kódy, daňové transakce | Sales tax codes, TaxTrans |
| Fiskální roky a období (otevřené / pozastavené / uzavřené) | Fiscal calendars, ledger periods |
| Měny a kurzy, načítání kurzů ČNB, deník a faktury v cizí měně | Currencies, exchange rates, rate providers |
| Skupiny odběratelů/dodavatelů jako účtovací profil | Customer/vendor groups, posting profiles |
| Odběratelé, vydané faktury, saldo | Customers, free text invoices, customer transactions |
| Bankovní účty, import výpisů GPC, párování, úhrady do salda | Bank accounts, bank statements, reconciliation, settlement |
| Dodavatelé, přijaté faktury, saldo | Vendors, vendor invoices, vendor transactions |
| Přílohy | Document management (DocuRef) |
| Historie změn | Database log |
| Oblíbené, plochy modulů | Favorites, workspaces / area pages |
| Grid s filtry a řazením, export do Excelu | Grid filtering, Export to Excel |

## Co chybí — platforma

| # | Funkce v AX/D365 | Proč je užitečná | Priorita |
|---|---|---|---|
| 1 | ~~Fiskální kalendář a účetní období~~ — hotovo 13. 11. 2026 | | ✓ |
| 2 | ~~Měny a kurzy ČNB~~ — hotovo; zbývá vykazovací měna a přecenění | Přecenění otevřených položek | P2 |
| 3 | ~~Účtovací profily~~ — hotovo přes skupiny partnerů; zbývá profil per partner / položka | | P3 |
| 4 | **Workflow / schvalování** (deník, faktura, objednávka; delegace, eskalace) | Malé firmy chtějí aspoň „schválí jednatel“; navazuje na Schvaleem | P1 |
| 5 | **Šablony záznamů** (record templates — výchozí hodnoty při založení per firma/uživatel) | Rychlé zakládání podobných záznamů; doplní „výchozí hodnoty kdekoli“ | P2 |
| 6 | **Uložená zobrazení** (saved views: sloupce, filtry, řazení, sdílení s rolí) | Personalizace gridů bez programování | P2 |
| 7 | **Data management** (datové entity, import/export balíčků, šablony, opakovaný import) | Migrace z jiných systémů, hromadné importy | P2 |
| 8 | **Dávkové úlohy** (batch jobs, plánování, opakování, historie běhů) | Přecenění, uzávěrky, importy z banky, upomínky | P2 |
| 9 | **Upozornění** (alerts: při změně pole / termínu, e-mail, centrum oznámení) | Hlídání splatností, změn | P2 |
| 10 | **Tiskové sestavy a správa tisku** (print management: kam a jak tisknout doklady per odběratel) | Faktury, upomínky, objednávky v PDF/e-mailem | P1 |
| 11 | **Electronic reporting** (konfigurovatelné formáty souborů: DPH přiznání, KH, SH, bankovní formáty) | Výkazy pro FÚ bez programování formátu | P1 (DPH) |
| 12 | **Finanční dimenze a účetní struktury** (víc dimenzí, pravidla povinnosti per účet) | Zakázky, projekty, střediska povinně u nákladů | P2 |
| 13 | **Zabezpečení na úrovni polí a záznamů** (field-level security, XDS — např. jen vlastní odběratelé obchodníka) | Citlivé údaje (mzdy, marže) | P2 |
| 14 | **Segregace povinností** (SoD pravidla, konflikty rolí) | Audit u větších firem | P3 |
| 15 | **Kontextová nápověda a průvodci** (F1, task guides / Task recorder) | Zaučení uživatelů | P2 |
| 16 | **Globální vyhledávání a navigační hledání** („Hledat stránku“ i data) | Rychlá orientace | P2 |
| 17 | **Office integrace** (úprava dat v Excelu a zpět — Excel add-in) | Hromadné úpravy číselníků | P3 |
| 18 | **Datová platnost** (date-effective tabulky: ceny, adresy platné od–do) | Ceníky, historie adres | P2 |
| 19 | **Sdílení dat mezi firmami** (shared tables / virtual companies, mezipodnikové účtování) | Skupina firem: společné produkty, mezifiremní faktury | P3 |
| 20 | **Organizační hierarchie** (provozovny, divize, rozpočtová hierarchie) | Reporting po provozovnách | P3 |
| 21 | **Správa funkcí** (feature management — postupné zapínání novinek) | Bezpečné nasazování změn tenantům | P3 |
| 22 | **Kopie firmy / šablona firmy** | Rychlé založení nové firmy z existující | P2 |
| 23 | **KPI dlaždice na plochách** (počty, součty, grafy na workspace) | Přehled bez otevírání seznamů | P2 |

## Co chybí — finance a doklady

| # | Funkce | Priorita |
|---|---|---|
| 24 | Odběratelé (AR): ~~odběratelé, skupiny, vydané faktury, saldo~~ hotovo; zbývá **úhrady a párování**, dobropisy, upomínky, úroky z prodlení | P1 |
| 25 | Dodavatelé (AP): ~~dodavatelé, přijaté faktury, saldo~~ hotovo; zbývá **úhrady, příkazy k úhradě**, schválení faktur | P1 |
| 26 | Banka: ~~účty, import GPC, párování, úhrady~~ hotovo; zbývá **camt.053**, **příkazy k úhradě** (ABO/SEPA), kurzové rozdíly, pokladna | P1 |
| 27 | ~~Výpočet DPH na řádcích, daňové transakce~~ hotovo; zbývá **přiznání, KH, SH (XML EPO)**, přenesená daňová povinnost | P1 |
| 28 | Uzávěrka: přecenění měn, zavření období, převod výsledku | P2 |
| 29 | Výkazy: obratová předvaha, rozvaha, výsledovka, hlavní kniha, saldokonto (Financial reporting) | P1 |
| 30 | Dlouhodobý majetek: karty, odpisové plány (účetní/daňové), vyřazení | P2 |
| 31 | Rozpočty a porovnání skutečnosti | P3 |
| 32 | Periodické deníky / šablony deníků, opravné (storno) doklady | P2 |
| 33 | Konsolidace skupiny | P3 |

## Doporučené pořadí

1. ~~Období + měny + účtovací profily~~, ~~faktury AR/AP se saldem a DPH~~ (hotovo).
2. ~~Banka a úhrady~~ (hotovo). Zbývá **přiznání a KH** (#27), **tisk faktur** (#10)
   a **výkazy** (#29) → první ostré nasazení; k bance pak příkazy k úhradě a camt.053.
3. **Šablony záznamů a uložená zobrazení** (#5, #6) — „výchozí hodnoty kdekoli“ a personalizace.
4. **Workflow schvalování** (#4) — propojit se Schvaleem.
5. **Import dat, dávky, upozornění** (#7–9).
6. Zbytek podle poptávky zákazníků.

Výhoda Shanonu oproti D365 pro malé firmy: multi-tenant SaaS (jedna
instalace, izolace v databázi), zapínání modulů bez licencí, úpravy zákazníků
jako sdílitelná rozšíření, nulová instalace, česká legislativa jako standard.
