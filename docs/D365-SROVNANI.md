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
| Přiznání k DPH a kontrolní hlášení (XML pro EPO), daňové parametry | Sales tax settlement, VAT return / control statement (ER) |
| Položky, skupiny položek, měrné jednotky, ceny s DPH / bez | Released products, item groups, units, sales price |
| Import číselníků z CSV / XML / Excelu | Data management (import projects) |
| Účtový rozvrh: syntetika/analytika, druh účtu (saldokonto, banka, pokladna, DPH…), zákaz ručního zápisu | Main accounts: posting type, do not allow manual entry |
| Pokladna: terminál, směny, účtenky, uzávěrka se zaúčtováním | Store commerce (POS), shifts, statement posting |
| Integrace: EET 2.0, tiskárny ESC/POS, platební terminál (SumUp, simulátor), protokol | Hardware station, payment connectors, fiscal integration |
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
| 8 | ~~Dávkové úlohy~~ — hotovo 13. 11. 2026 (plán, opakování, historie, upozornění při chybě) | | ✓ |
| 9 | ~~Upozornění~~ — zvoneček hotov 14. 11. 2026 (chyby dávek, doklady ke kontrole, registr DPH, EET); zbývá upozornění na změnu pole a e-mailem | Hlídání splatností, změn | P2 |
| 10 | ~~Tiskové sestavy~~ — návrhář, PDF, QR platba, ISDOC, odeslání e-mailem (14. 11. 2026); zbývá print management per odběratel | | ✓ |
| 11 | **Electronic reporting** — částečně: Transformace (ABO, SEPA, GPC, SPAYD, EAN), DP3/KH v kódu | Výkazy pro FÚ bez programování formátu | P2 |
| 12 | ~~Finanční dimenze~~ — hotovo (6 dimenzí, pravidla povinnosti, výchozí z partnera a účtu) | | ✓ |
| 13 | **Zabezpečení na úrovni polí a záznamů** (field-level security, XDS — např. jen vlastní odběratelé obchodníka) | Citlivé údaje (mzdy, marže) | P2 |
| 14 | **Segregace povinností** (SoD pravidla, konflikty rolí) | Audit u větších firem | P3 |
| 15 | ~~Kontextová nápověda~~ — návody k agendám, „?“ u formulářů, Ctrl+K (14. 11. 2026); zbývá Task recorder / videa | Zaučení uživatelů | ✓ |
| 16 | ~~Navigační hledání~~ — Ctrl+K (menu i návody); zbývá hledání v datech | Rychlá orientace | P3 |
| 17 | **Office integrace** (úprava dat v Excelu a zpět — Excel add-in) | Hromadné úpravy číselníků | P3 |
| 18 | **Datová platnost** (date-effective tabulky: ceny, adresy platné od–do) | Ceníky, historie adres | P2 |
| 19 | ~~Sdílení dat mezi firmami~~ — virtuální společnosti hotovo 13. 11. 2026; zbývá mezipodnikové účtování | | ✓ |
| 20 | **Organizační hierarchie** (provozovny, divize, rozpočtová hierarchie) | Reporting po provozovnách | P3 |
| 21 | **Správa funkcí** (feature management — postupné zapínání novinek) | Bezpečné nasazování změn tenantům | P3 |
| 22 | **Kopie firmy / šablona firmy** | Rychlé založení nové firmy z existující | P2 |
| 23 | **KPI dlaždice na plochách** (počty, součty, grafy na workspace) | Přehled bez otevírání seznamů | P2 |

## Co chybí — finance a doklady

| # | Funkce | Priorita |
|---|---|---|
| 24 | Odběratelé (AR): ~~faktury, saldo, úhrady a párování, objednávky, zálohy, daňový doklad k platbě, e-mail~~ hotovo; zbývá dobropis jako druh, upomínky, úroky z prodlení | P1 |
| 25 | Dodavatelé (AP): ~~faktury, saldo, úhrady, příkazy k úhradě (ABO/SEPA), vytěžování a ISDOC~~ hotovo; zbývá schválení faktur | P1 |
| 26 | Banka: ~~účty, hromadný import GPC, návaznost, párování, deníky z výpisů, příkazy~~ hotovo; zbývá **camt.053**, kurzové rozdíly | P1 |
| 27 | ~~DPH na řádcích, daňové transakce, přiznání DP3, KH (XML EPO)~~ hotovo; zbývá **souhrnné hlášení**, přenesená povinnost, pořízení z EU, zaúčtování vyrovnání DPH, podání datovkou | P1 |
| 28 | Uzávěrka: přecenění měn, zavření období, převod výsledku | P2 |
| 29 | ~~Výkazy: obratová předvaha, rozvaha, výsledovka~~ hotovo; zbývá kniha analytických účtů, saldokonto k datu | P2 |
| 30 | Dlouhodobý majetek: karty, odpisové plány (účetní/daňové), vyřazení | P2 |
| 31 | Rozpočty a porovnání skutečnosti | P3 |
| 32 | Periodické deníky / šablony deníků, opravné (storno) doklady — deník má rychlé pořizování (15. 11. 2026), šablony chybí | P2 |
| 33 | Konsolidace skupiny | P3 |

## Doporučené pořadí (aktualizováno 15. 11. 2026)

1. ~~Období, měny, účtovací profily, faktury AR/AP, banka, DPH, tisk, výkazy, dávky, upozornění, nápověda~~ (hotovo).
2. **Ostré nasazení první firmy** — chybí jen provozní kroky (profil, počáteční stavy, produkční prostředí).
3. **Workflow schvalování** (#4) — úkoly do zvonečku.
4. Uzávěrky (#28), storno a periodické deníky (#32), souhrnné hlášení a přenesená povinnost (#27).
5. **Uložená zobrazení a šablony záznamů** (#5, #6).
6. Zbytek podle poptávky zákazníků.

Výhoda Shanonu oproti D365 pro malé firmy: multi-tenant SaaS (jedna
instalace, izolace v databázi), zapínání modulů bez licencí, úpravy zákazníků
jako sdílitelná rozšíření, nulová instalace, česká legislativa jako standard.
