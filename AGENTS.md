<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Shanon — pravidla vývoje

Architektura: `docs/ARCHITEKTURA.md`. Číst před každou větší změnou.

## Objekty a moduly

- Nová tabulka = nový objekt v `src/modules/<modul>/index.ts` (`defineObject`),
  ne ručně psaný model. Pak `npm run schema:gen` a `npm run db:new-migration -- <popis>`
  (porovná se snímkem `prisma/migrations/schema.snapshot.prisma`; snímek commitovat s migrací).
- `prisma/schema.prisma` se **nikdy neupravuje ručně** (generuje se). Systémové
  tabulky jsou v `prisma/base.prisma`.
- Pole používá existující typ z `Edts` nebo vlastní `defineEdt` — ne vlastní
  délky a validace přímo u pole.
- Žádný vlastní CRUD v modulech. Čtení/zápis jen přes `src/server/data.ts`;
  byznys logika přes události (`ObjectHandlers`) a `DataApi`.
- Do hlavní knihy jen přes `postVoucher()` (`src/modules/gl/posting.ts`) — hlídá
  vyrovnanost a otevřené účetní období. Cizí měna: `convertLines` / `rateFor`
  (kurz ČNB, nejvýš 7 dní starý, chybějící se načte samo).
- Účtový rozvrh: účty jsou 6místné (3 syntetika + 3 analytika, `synthetic` se
  dopočítá; zadání „211“ se doplní na 211000). Účty se zákazem ručního zápisu
  (`noManualEntry`: saldokonto, banka, pokladna, DPH) odmítne účetní deník,
  doklady modulů na ně účtují. Výchozí nastavení modulů bere účet přes
  `postingAccount(data, "311")` (xxx000, jinak první účet syntetiky).
- Doklady s řádky a DPH (faktury) nepsat znovu: `src/modules/tax/document.ts`
  (výpočet, součty, zaúčtování, saldo, daňové transakce). Pomocná kniha partnerů
  (AR, AP) vzniká továrnou `partner-ledger.ts` — nový podobný modul = parametry
  + labely, ne nový kód.
- Typy polí: `Edts.Amount` se sčítá v řádku Celkem, `Edts.Price`, `Edts.Qty`,
  `Edts.AmountCur` ne (`noTotal`). Výchozí datum „dnes“ = `default: "$today"`.
- Odkaz do modulu, na kterém modul nezávisí (položka na řádku faktury), má
  `optionalRef: true` — bez zapnutého cílového modulu se pole skryje.
- Údaje konkrétních firem (IČO, DIČ, adresy) nepatří do repa (je veřejné) —
  nastavují se přes UI nebo `scripts/company-profile.ts` se souborem zvenku.
- Řádky, které záznamu nepatří (faktury odběratele, výpisy účtu), mají v `lines`
  `owned: false` — se záznamem se nemažou a dvojklik otevře jejich vlastní stránku.
- Akce se souborem (importy): `actions: [{ id, label, upload: ".gpc,.txt" }]`,
  obsluha dostane `file` jako třetí parametr. Soubor do 5 MB (`serverActions.bodySizeLimit`).
- Akce, které vrací soubor (XML pro úřad, PDF): `actions: [{ id, label, download: true }]`
  + `ObjectHandlers.downloads[id]` → `/api/download/<objekt>/<id>/<akce>`, stačí právo číst.
- Texty, které logika ukládá nebo dává do souborů, překládá `ctx.t(label, params)`
  (jazyk uživatele) — nikdy natvrdo česky v kódu.
- DPH: přiznání a KH se počítají z `tax.trans` podle DUZP; kam transakce patří,
  určuje daňový kód (řádek přiznání, sazba). Pasti formátu EPO jsou v
  `src/modules/tax/vat-return.ts` — před změnou XML je přečíst.
- Párování plateb se nesmí hádat: automat páruje jen jednoznačnou shodu VS,
  víc kandidátů = ručně. Import výpisu se uloží jen když součty sedí na hlavičku.
- Pokladna (`src/modules/pos`): ceny a DPH počítá vždy server z položek
  (`sale.ts`), terminál `/kasa` ukazuje jen orientační součet. Hotovost se
  zaokrouhluje podle účetní měny (`sys.currency.cashRoundingUnit`, CZK = 1 Kč,
  `roundCents`) mimo základ DPH. Do účetnictví jde až uzávěrka směny
  (jeden doklad za směnu, `tax.trans` se `simplified` → KH oddíl A.5).
  Odložené nákupy (`basket.ts`): box (`pos.box`, kód = obsah QR, jen písmena
  a číslice) nebo jméno; sdílené pokladnami firmy, souběh hlídá verze, prodej
  s `basketId` nákup uzavře. Kód boxu v hledání kasy + Enter otevře jeho nákup.
- Integrace (`src/modules/int`): napojení = druh + ovladač (`drivers.ts`), každá
  komunikace do `int.log`. Síť nikdy uvnitř transakce prodeje — EET se posílá po
  uložení účtenky, nevyjde-li do 2 s, účtenka „čeká“ a odešle se dodatečně (48 h).
  EET 2.0: `eet.ts` (SOAP, podpis exc-c14n/RSA-SHA256, tělo skládané rovnou
  kanonicky); ověření proti Playgroundu `npx tsx scripts/eet-playground.ts <p12> <heslo>`.
  Platba kartou: účtenka se vystaví až po schválení terminálem, server ověří
  částku a jediné použití transakce (`assertPaid`).
- REST API (`/api/v1/<objekt>[/<id>[/<akce>]]`, `src/app/api/v1`): klíč z napojení
  druhu API (Integrace), v DB jen SHA-256 otisk (`src/server/api-token.ts`), rozsah
  = moduly/objekty s právem Upravovat, `sys`/`int` nikdy, mazání přes API není.
  Vše přes datovou službu; autor zápisů „API · název napojení“.
- Dávkové úlohy: `ModuleDef.jobs` (`JobDef`, id `<modul>.<název>`, `run(ctx)` vrací
  zprávu), `default` = výchozí nastavení úlohu ve firmě založí. Plánovač
  `src/server/batch.ts` (z `src/instrumentation.ts`, každou minutu, `BATCH_SCHEDULER=off`
  vypne), plán v pražském čase, zmeškané běhy se nedohánějí, historie `sys.batchRun`.
- Číselné řady modulu se v jeho Nastavení ukážou samy (z `numberSeqs`, odkaz
  `?filter.usedFor=<modul>.*`). Seznam objektu umí filtr z odkazu `?filter.<pole>=<výraz>`.
- Odkaz na číselník (cíl bez řádků/akcí) vede do seznamu `?focus=<id>` s vybraným
  řádkem (`refLink`), doklad na svou stránku.
- Duplikovat (`src/server/duplicate.ts`, obecně): bez polí unikátního klíče (kromě
  odkazů), čísla z řady, readOnly, obrázků a tajných údajů. Doklad s číselnou řadou
  se zkopíruje rovnou i s vlastními řádky (`lines[].copy: false` = nekopírovat,
  např. diskuze), jinak nový formulář s předvyplněnými hodnotami.
- Účty automatických transakcí (zaokrouhlení, haléřové a kurzové rozdíly, technický
  účet, rozvažné účty) jen přes `systemAccount(data, druh)` (`gl.systemAccount`,
  Hlavní kniha → Systémové účty) — nikdy vlastní pole „účet zaokrouhlení“ v modulu.
  Zaokrouhlení částek podle měny: `currencyRounding()` + `roundCents()`.
- Tajné údaje = `FieldDef.secret`: šifrovaně (AES-256-GCM, `SHANON_SECRET_KEY`
  v prostředí — bez něj produkce tajné údaje neuloží; ztráta klíče = údaje znovu
  zadat), ven jen maska. Čte je jen logika modulu přes `revealSecret()`.
- Obrázek = pole s `image: true` (hodnota = id přílohy): formulář ukáže náhled,
  nahrání tlačítkem i přetažením (`setImage`, bez zvýšení verze záznamu), grid
  miniaturu, import ho nastaví ze sloupce s cestou + složky obrázků
  (`imagesFromUploads`, párování podle konce cesty / názvu souboru).
- Finanční dimenze (`src/modules/gl/dimensions.ts`): max. 6, pole `dim1…dim6`
  (`dimFields()`, `FieldDef.dimSlot`) na zápisech, deníku a řádcích dokladů;
  popisek = název dimenze, nepoužité se skryjí. Pravidla firmy podle začátku čísla
  účtu → `dimNReq` na účtu; kontroluje `postVoucher` (ruční zápis přísně, doklady
  modulů nepovolené vynechají). Partner se doplní z `PostingRequest.partner`.
  Výchozí dimenze: řádek → partner (`PostingRequest.partnerDims`, pole dim1…6 na
  dodavateli/odběrateli) → účet (dim1…6 na účtu). Zdroj „subject“: nový subjekt
  adresáře založí hodnotu (předpona + číslo) a partneři subjektu ji dostanou.
- Reporty: `ModuleDef.reports` (`defineReport`, `src/core/report.ts`) — parametry,
  výpočet přes DataApi, `requires` = objekty ke čtení; obecná stránka
  `/report/<modul>/<id>` s exportem do Excelu, v menu sekce `kind: "reports"`.
- Barevný štítek výčtu v gridu: `color` u hodnoty `defineEnum` (stav, priorita).
- Grid: titleField je odkaz na detail; šířky sloupců podle obsahu (min/max),
  nejširší textový sloupec bere zbytek.
- Pole/skupina formuláře podle hodnoty jiného pole: `visibleWhen: { field, in: [...] }`.
- ARES (`src/modules/gab/ares.ts`): veřejná služba bez klíče; akce „Doplnit z ARES“
  na subjektu i partnerovi (podle IČO, jinak jednoznačně podle názvu) doplní jméno,
  DIČ, právní formu a sídlo.
- Slevy (`inv.discount`): procento nebo akční cena, na položku / skupinu / vše,
  od–do; pokladna bere nejvýhodnější (`bestDiscount`), na řádku účtenky zůstane
  běžná cena a sleva.
- Hromadný import mimo UI: `npx tsx --conditions=react-server scripts/import-file.ts
  <tenant> <firma> <objekt> <soubor>`; data zákazníků (ceníky, IČO) nikdy do repa.
- Peníze přes `src/core/money.ts` (haléře, BigInt), nikdy sčítání `Number`.

## Obecné metody — žádný kód pro běžné operace

Seznam, založení, úprava, mazání a akce nad záznamem jsou **jedna sada pro
všechny objekty**. Nový objekt nepotřebuje žádnou novou stránku ani endpoint:

| Operace | Server | UI |
|---|---|---|
| seznam, filtr, řazení, stránky | `listRecords` / `listAction` | `SmartGrid` |
| detail | `getRecord` / `getRecordAction` | `RecordDrawer` nebo `ObjectDetailView` |
| založení / úprava | `saveRecord` / `saveRecordAction` | `RecordForm` |
| mazání (i hromadně, v jedné transakci) | `deleteRecord` / `deleteRecordsAction` | potvrzovací dialog |
| akce (Zaúčtovat…) | `runAction` / `runRecordAction` | tlačítko z `ObjectDef.actions` |

**Automaticky u každého objektu** (nic se nepíše, jen se definuje objekt):

| Funkce | Kde | Poznámka |
|---|---|---|
| Oprávnění | `src/core/security.ts`, kontrola v `data.ts` | uživatel → firmy (`sys_user_company`) → role v dané firmě → modul/objekt → Číst / Upravovat / Mazat; superuživatel vše; správce firmy vše ve svých firmách kromě `adminOnly` (firmy, role) |
| Číselné řady | `ObjectDef.numberSeq`, `ModuleDef.numberSeqs` | řada podle Použití (objekt), jinak podle kódu; tenant mění formát, další číslo i přiřazení |
| Výchozí nastavení | `ModuleDef.setup`, `src/server/setup.ts` | zakládá jen chybějící (řady, účty, deník GEN, DPH); samo při založení firmy, zapnutí modulu a nasazení |
| Součty | `ListParams.totals` | řádek Celkem pod gridem — součty číselných sloupců za celý výběr |
| Proklik | odkazy ve formuláři (tlačítko Otevřít) i v gridu | na číselníky, nastavení, subjekty… |
| Přílohy (DocuRef) | `src/server/docuref.ts`, tlačítko Přílohy | poznámky a soubory do 10 MB, právo = právo na záznam, mažou se se záznamem |
| Historie změn | `sys_audit`, `src/server/history.ts`, ikona historie | kdo, kdy, co (popisky polí, titulky odkazů) |
| Oblíbené | `sys_favorite`, hvězdička v liště a na ploše modulu | menu oblíbených v hlavičce |
| Export do Excelu | `/api/export/<objekt>` | stejné filtry, řazení a oprávnění jako grid, max. 50 000 řádků |
| Import (CSV, XML, Excel) | `src/server/import.ts`, tlačítko Import, `/api/import-template/<objekt>` | sloupce podle názvu pole, popisku nebo `FieldDef.aliases`; odkazy podle kódu/názvu; aktualizace podle prvního `unique` klíče; vše nebo nic (savepoint na řádek), Zkontrolovat = suchý běh |

Vlastní stránka jen tam, kde obecná nestačí (nástěnky, průvodci, výkazy) — a i
ta používá stejné komponenty a akce.

## UI standard (převzato ze Shanonu 1, Fluent UI v9)

- **Hlavička** (`AppShell`): logo → plocha aktuálního modulu, výběr modulu
  s ikonami, přepínač firmy, nastavení, uživatel, odhlášení.
- **Plocha modulu** (`/[modul]`): sloupce *Formuláře*, *Funkce*, *Reporty*,
  *Nastavení* podle `MenuGroup.kind`, sbalovací sekce podle `ModuleDef.menu`.
- **Hledání v menu**: přehled aplikace a hlavička (Ctrl+K, „/“); zdroj
  `src/server/menu.ts` (jen položky, které uživatel smí vidět).
- **Seznam**: `ActionBar` [drobečky] … [Nový] [Upravit] [Smazat] | [Obnovit],
  pod ní `SmartGrid` (filtr a řazení v menu sloupce, výběr řádků).
- **Formulář**: klik = výběr, dvojklik / Enter = otevřít. Běžný objekt se
  otevře v šuplíku zprava (`Drawer position="end"`), doklad s řádky nebo akcemi
  na celé stránce (`ObjectDetailView`), řádky dokladu zase v šuplíku.
- Tlačítka v šuplíku: [Zpět] … [Uložit]. Primární akce = modré plné tlačítko.
- Chyby: `MessageBar intent="error"` nahoře + hláška u pole. Uložit je během
  ukládání zakázané. Mazání vždy s potvrzením.
- Zarovnání v gridu: text vlevo, čísla vpravo, data a zaškrtnutí na střed.
  Záporné částky červeně.
- Zkratky (`useShortcuts`): Shift+N nový, Shift+R obnovit, Shift+D smazat,
  Shift+S nebo Ctrl+S uložit, Esc zpět/zavřít, Enter otevřít.
- Mobil (375 px): hlavička i lišta se posouvají do strany, grid má minimální
  šířky sloupců a posouvá se, formulář je v jednom sloupci.
- Barvy jen z motivu (`src/components/providers.tsx`, odstíny loga) a tokenů
  Fluentu — žádné natvrdo psané barvy v komponentách.

## Úpravy pro zákazníky

- Nikdy neměnit core kvůli jednomu tenantovi. Úprava = rozšíření v `src/extensions/`
  (pole do `ext`, labely s prefixem `X…`, události).

## Texty

- Každý text v UI je label `@MODUL:Klic` v souboru modulu, cs i en. Test
  `tests/core.test.ts` hlídá, že žádný label nechybí.
- Popisky stručné a věcné, tónem obchodní aplikace. Bez vysvětlování vnitřností,
  bez ujišťování, bez slova „AI“. Chybová hláška říká, co udělat.

## Bezpečnost

- Každá server action začíná `requireSession()`; správa jen pro `admin`.
- Oprávnění vynucuje datová služba — UI jen skrývá tlačítka. Nový kód nikdy
  nečte/nezapisuje data objektů mimo `data.ts` (obešel by oprávnění i RLS).
- Byznys logika modulu (`ObjectHandlers`, `DataApi`) běží jako systémová
  operace — oprávnění se kontroluje u akce uživatele, která ji spustila.
- Objekty, které rozdávají práva nebo zakládají firmy, mají `adminOnly: true`
  (jen superuživatel). Správce firmy spravuje uživatele jen ve svých firmách.
- Nové výchozí nastavení modulu patří do `ModuleDef.setup` / `numberSeqs`,
  nikdy do seedu — musí fungovat pro každou novou firmu i existující tenanty.
- Soubory se stahují jen přes `/api/files/<id>` (kontrola práva na záznam,
  `nosniff`, nebezpečné typy jen ke stažení).
- Žádné debug/setup/fix skripty dostupné z webu. Údržba = `scripts/` (CLI).
- Žádná hesla, tokeny ani connection stringy v repu.
- Nové tabulky objektů dostanou RLS automaticky (`scripts/rls.ts` po migraci).

## Workflow

- Evidence vývoje je i v aplikaci: modul **Testování a vývoj** (`qa`) — klíčové
  funkce se stavem, UAT scénáře, požadavky (CR, chyby, úkoly). Výchozí obsah
  v `docs/qa/*.csv` (import tlačítkem Import); nová funkce = řádek ve funkcích
  + UAT scénář, nový požadavek = řádek v požadavcích s dalším číslem CR-nnn.

- GitHub Issues se štítky Analysis → Development → Testing → Done.
- Commity: `feat(gl): … [#123]`, `fix(gab): …`, `docs: …`.
- Před pushem: `npm run lint && npm run typecheck && npm test && npm run schema:check`.
- Před dokončením úkolu (dřívější SOP): build projde, nové texty jsou labely
  v cs i en, nový objekt má test v `tests/`, změna je ověřená v prohlížeči
  (desktop i mobil), žádné tajné údaje ani ladicí výpisy.
- Lokální DB bez Dockeru: `npm run db:local` (PGlite, v `.env` `DB_POOL_MAX=1` —
  PGlite neunese souběžná spojení), pak
  `npx prisma migrate deploy && npx tsx scripts/rls.ts && npm run db:seed`.
