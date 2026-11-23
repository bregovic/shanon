<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Shanon — pravidla vývoje

Architektura: `docs/ARCHITEKTURA.md`. Číst před každou větší změnou.

## Manifest: objektově a efektivně

- **Objektově:** novou funkci navrhnout jako vlastnost definice (`ObjectDef` / `FieldDef` / `ModuleDef`)
  s jednou obecnou implementací v jádru (`src/server`, `src/core`), kterou dostanou všechny objekty — ne kód
  pro jeden objekt, stránku nebo endpoint. Vzory: `numberSeq`, `mergeable`, `related`, `lines`, `postingPreview`,
  `rememberLast`, import / export, uložené pohledy. Specifický kód jen pro byznys pravidlo (`ObjectHandlers`).
- **Efektivně (tisíce transakcí):**
  - počet dotazů nesmí růst s počtem řádků: žádné `get` / `find` v cyklu za záznam — načíst hromadně
    (`{ in: [...] }`) a spárovat v paměti; číselníky jednou za operaci;
  - opakované čtení v jedné transakci obsluhuje paměť čtení datové služby (`get` / `find`); zápis mimo
    `save` / `remove` (`updateMany`, SQL, `ROLLBACK TO SAVEPOINT`) = zavolat `forgetReads(tx)`;
  - seznamy jen po stránkách na serveru (`listRecords`), součty agregací v DB, ne sčítáním v JS;
  - dlouhé operace po dávkách (`IMPORT_BATCH`, limit transakce 20 s), síť mimo transakci (`outside`);
  - veřejné stránky (e-shop, portál) mají pevný počet dotazů na stránku bez ohledu na velikost katalogu;
  - nová horká cesta = případ ve `scripts/perf.ts`, výsledek porovnat s měřítkem níže (Workflow → Výkon).

## Objekty a moduly

- Nová tabulka = nový objekt v `src/modules/<modul>/index.ts` (`defineObject`),
  ne ručně psaný model. Pak `npm run schema:gen` a `npm run db:new-migration -- <popis>`
  (porovná se snímkem `prisma/migrations/schema.snapshot.prisma`; snímek commitovat s migrací).
- `prisma/schema.prisma` se **nikdy neupravuje ručně** (generuje se). Systémové
  tabulky jsou v `prisma/base.prisma`.
- Pole používá existující typ z `Edts` nebo vlastní `defineEdt` — ne vlastní
  délky a validace přímo u pole.
- Žádné kruhové importy mezi soubory modulů (A importuje B a B importuje A): produkční
  bundler je sloučí a importované funkce můžou být při volání nedefinované (500 jen v produkci,
  testy to neodhalí). Obsluhu dej do souboru, který importuje, ne naopak; kontrola
  `npx madge --circular --extensions ts src/modules`. Dynamický `await import()` modulů nepoužívat.
- Zapnuté moduly jsou **po firmách** (agenda firmy): `sys_company_module`, `sys_tenant_module` = souhrn (modul zapnutý aspoň
  v jedné firmě, rychlé předfiltrum veřejných vstupů). `Ctx.modules` = moduly aktuální firmy — vždy přes `companyModules()`
  (`src/server/modules.ts`, i veřejné vstupy, API, dávky podle firmy úlohy); zapnutí / vypnutí `enableCompanyModules` /
  `disableCompanyModules`, se setupem `enableModulesWithSetup` (`src/server/company-modules.ts`); další firma organizace dostane jen minimum
  (jádro + `ModuleDef.starter`: Organizace, Adresář), první firma při založení organizace zadané moduly; `setup-all` doplní firmám bez nastavení moduly tenanta.
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
- Deníky (`src/modules/gl/journal.ts`): řádek = druh účtu (hlavní kniha, odběratel,
  dodavatel, banka, pokladna) + účet, MD/D, volitelně druh a protiúčet; název deníku určuje
  druh a číslování dokladů (po vyrovnání / jeden za deník / řádek / ručně). Ověřit =
  `runJournal(…, dryRun)` (postVoucher `dryRun`), Zaúčtovat po dokladech; odběratel /
  dodavatel → saldokontní účet skupiny + zápis do salda, úhrada s VS spáruje fakturu.
  Ruční zápis na saldokonto jen přes druh účtu (`PostingLine.viaSubledger`).
- Objednávky a zálohy (`src/modules/tax/orders.ts`, z továrny partnerů): objednávka mimo
  účetnictví (Potvrdit → Vystavit zálohu → Vytvořit fakturu, řádky přes
  `documentLineHandlers`); záloha mimo účetnictví, úhradu páruje banka (VS → `customerAdvance`
  / `vendorAdvance`) na účet záloh skupiny (324 / 314) a do salda jako položku „Záloha“;
  `postInvoice` uhrazenou zálohu odečte. Saldo partnera = saldokonto + účet záloh.
- Řádky upravované v mřížce: `lines[].inline` (`InlineLines`), sdílený sloupec polí
  `FieldDef.gridColumn`; kompaktní hlavička dokladu `ObjectDef.compactHeader`.
- Doklady s řádky a DPH (faktury) nepsat znovu: `src/modules/tax/document.ts`
  (výpočet, součty, zaúčtování, saldo, daňové transakce). Pomocná kniha partnerů
  (AR, AP) vzniká továrnou `partner-ledger.ts` — nový podobný modul = parametry
  + labely, ne nový kód.
- Typy polí: `Edts.Amount` se sčítá v řádku Celkem, `Edts.Price`, `Edts.Qty`,
  `Edts.AmountCur` ne (`noTotal`). Výchozí datum „dnes“ = `default: "$today"`.
- Odkaz do modulu, na kterém modul nezávisí (položka na řádku faktury), má
  `optionalRef: true` — bez zapnutého cílového modulu se pole skryje.
- Oddělení firem: data objektu se `scope: "company"` patří jedné firmě; firmy jsou
  nezávislé subjekty. Sdílet lze jen netransakční číselníky s `shareable: true` přes
  virtuální společnost (Správa systému → Virtuální společnosti): data leží ve skryté
  nosné firmě (`sys.company.virtual`), `Ctx.shared` (doplní `inTenant`) mapuje objekt →
  firma a `scopeWhere`/založení/číslování to řeší na jednom místě (`dataCompany`).
  Pravidla a Osamostatnit (kopie + přepojení odkazů) v `src/server/virtual.ts`.
  Doklady a transakce se nesdílí nikdy.
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
- DPH přes skupiny (`src/modules/tax/tax-groups.ts`): skupina DPH (partner / skupina partnerů → hlavička dokladu)
  × položka DPH (položka / skupina položek / účet HK) → `tax.taxGroupCode` (kód pro prodej a nákup). Ručně zadaný kód
  zůstane (`resolveLineCode` přepíše jen prázdný nebo ten z předchozí kombinace). Samovyměření (`reverseCharge`,
  `deductLine`): na dokladu bez daně, při zaúčtování MD i D 343 a dvě `tax.trans` (`taxTransParts`, transakce nese
  `reportLine`/`khSection`). Deník: kód přímo v mřížce, výpočet `lineTax` (název deníku `amountsIncludeTax`),
  obsluha `journal-tax.ts`, zaúčtování v `gl/journal.ts`, přičtené DPH v `taxExtra` (vyrovnanost dokladu).
  Výchozí sada CZ v `taxSetup` (CZ_CODES/GROUPS/ITEMS/MATRIX). Přiznání: všechny řádky 1–13, 20–26, 40–47, 50
  (`DP3_ATTRS`), KH A.1, A.2, B.1 navíc k A.4/A.5/B.2/B.3.
- Neplátce DPH (`vatPayer()` v `tax/orders.ts`: organizace, jinak firma): výchozí nastavení jen kódy BEZ / P0 (`NP_CODES`), skupiny
  a doprava na ně; tisk bez daňového dokladu (`doc.title`, účtenka v4 bez rekapitulace DPH, faktura v7). Stane-li se plátcem,
  `setup-all` doplní plnou sadu. Zbytečné kódy stávajících firem se nemažou.
- Nápověda pod polem formuláře: `FieldDef.help` (label) → `FieldMeta.help` → `Field hint`. Spisová značka organizace
  (`parseFileNumber` / `registrationText` v `org/index.ts`, z ARES `dalsiUdaje[].spisovaZnacka`) sestaví `registration`
  (tiskne se na faktuře v bloku dodavatele a na účtence); ručně změněný text se nepřepisuje.
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
- Pokladní kniha (`src/modules/cash`): pokladna = účet 211xxx, doklady PPD/VPD (řady
  CASHIN/CASHOUT), DPH zjednodušeného dokladu do `tax.trans` (`simplified`), výdej do
  mínusu nejde; report čte `gl.trans` účtu pokladny (i uzávěrky směn z kasy).
  Reporty umí parametr `kind: "ref"` (výběr záznamu objektu `refObject`).
- Síť mimo transakci (transakce max. 20 s): akce `outside: true` / úloha `JobDef.outside`
  — obsluha v `src/server/outside.ts`, oprávnění ověří `runAction` předem (`checkOnly`).
- Workflow (`src/modules/wf`): pracovní položka `wf.workItem` = obecný úkol k záznamu libovolného objektu (`refObject` + `refId`,
  druh, řešitel, termín, výsledek, běh `instanceId` + `stepNum`). Zakládat jen přes `createWorkItem(data, …)` (otevřený úkol se stejným
  `sourceKey` se nezakládá znovu, řešitel dostane osobní upozornění `notify({ userId })`), uzavírat `closeWorkItems`. Moje úkoly = panel
  v Přehledu (`src/server/work-items.ts`). Definice (`wf.definition` + kroky `wf.definitionStep`, typy účastníků `wf.participantType`,
  běhy `wf.instance`) řídí jádro `src/server/workflow.ts`: spouštěče sbírá datová služba (`queueWorkflow` při založení záznamu a po akci,
  modul `fireWorkflowEvent` — `int.document` „extracted“) a vyhodnotí je `flushWorkflow` na konci `inTenant` ve stejné transakci.
  Automatický krok = akce objektu (`Session.action(…, { workflow: true })`, v savepointu, nesplněný předpoklad / chyba → úkol Doplnit
  údaje), úkol, schválení; podmínky zápisem filtru sloupce (`parseCondition` + `Session.matches`). Zamčené akce běhu hlídá
  `workflowLock` v `Session.action`. Původce = `ObjectHandlers.originator` (int: portál → kdo nahrál → napojení; zalistovaný doklad →
  původce dokladu ke zpracování), jinak `DataApi.createdBy`. Nová vlastnost workflow = obecně v jádru, ne kód pro jeden objekt.
  Výchozí workflow firmy (`wf/setup.ts`, jen firmě bez definic): WF-DOKLADY (vytěžený připravený doklad → `list`: založit partnera +
  zalistovat; jinak úkol původci / vlastníkovi; `rejectAction` reject) a WF-PRIJATE (přijatá faktura → schválení vlastníkem → `post`).
  Proužek workflow nad každým detailem s během (`src/server/workflow-bar.ts` + `components/workflow-bar.tsx`): stav, krok, řešitel,
  Schválit / Zamítnout / Hotovo s komentářem (`actOnWorkItem` — řešitel smí i bez práv na agendu úkolů), historie, Zrušit workflow.
- Pole typu uživatel: `Edts.User` (`Edt.user`, VARCHAR 36) — formulář výběr z `Ctx.users` (uživatelé firmy, načtení v `auth.ts`),
  filtr seznamu jménem / e-mailem / `me` (`Session.userWhere`), uložení od člověka ověří uživatele tenanta. Aplikační role čte
  ze `sys_user` jen id, jméno, e-mail, aktivní, roli (grant po sloupcích + RLS v `scripts/rls.ts`), nikdy heslo.
- Indexy pro časté dotazy: `ObjectDef.indexes` (`[["assignedTo", "status"]]`, v rámci tenanta / firmy).
- Vytěžování dokladů (`src/modules/int/ocr.ts`, `documents.ts`, `src/server/doc-import.ts`):
  napojení druhu „ocr“ (OpenAI Responses API, strukturovaný výstup; `openaiTest` = klíč
  `SHANON_TEST_OCR_KEY` z prostředí, nikdy v DB), mezitabulka `int.document` (+ řádky),
  Vytěžit → kontrola (partner podle IČO/DIČ, součty, duplicita) → Zalistovat (`listDocumentFull`: chybějící partner z registru,
  koncept dokladu v agendě, `DataApi.copyAttachments` souboru) — vše v transakci. ISDOC v PDF (`isdocFromPdf`): klíčové slovo `stream`
  ne jako konec `endstream`. Denní limit napojení, dávka `int.processDocuments` (nové + vytěžené bez běhu workflow).
- Dodavatelský portál (`int.portal`, veřejně `/portal/<tenantId>/<klíč>` + `/api/portal/...`, mimo přihlášení v
  `src/proxy.ts`): `src/server/supplier-portal.ts` najde portál podle klíče (zapnutý), kontroluje druh souboru podle obsahu
  (`sniffPortalFile`), velikost, počet, limit za hodinu z adresy (otisk IP) a za den, zakládá `int.document` se zdrojem
  `portal` a údaji odesílatele + přílohu, protokol `int.portalUpload`, upozornění. Zalistování z portálu nikdy automaticky.
  Jednoduchá adresa `/<zkratka organizace>/<portál>`: `org.entity.publicSlug` + `int.portal.slug`, jedinečné napříč tenanty přes
  `DataApi.claimGlobalKey` (tabulka `sys_global_key` bez RLS, grant v `scripts/rls.ts`); `src/proxy.ts` přepíše dvoudílnou adresu,
  jejíž první část není v `RESERVED_PATHS` (`src/lib/reserved-paths.ts` — nový modul / stránku přidat, test to hlídá).
  Pole s `share` (odkaz) má ve formuláři Kopírovat / E-mailem / Otevřít.
- Aplikace Portál (CR-108, `/p/<kód tenanta>`, manifest `public/portal-app.webmanifest`, Shanon `public/manifest.webmanifest`,
  tlačítko `InstallAppButton`): účty mimo uživatele v `sys_portal_account` / `sys_portal_session` (base.prisma, aplikační role
  k nim práva nemá, čte jen `src/server/portal-auth.ts`, cookie `shanon_portal`). Zaměstnanec = `hr.employee` (osobní číslo napříč
  firmami = jedna identita, heslo z pozvánky), dodavatel = `int.portalContact` (e-mail, přihlášení odkazem; neznámý e-mail nic,
  odpověď stejná). Firmy a agendy se odvozují při každém požadavku (`identityCompanies` + `int.portal.appEmployees/appVendors`).
  Podání `src/server/portal-app.ts` → `int.document` se zdrojem `app` (WF-DOKLADY ho smí zalistovat sám), účtenka nese
  `employeeId` → `employeeVendor` (dodavatel zaměstnance s profilem ZAM). Úprava fotky v prohlížeči `components/photo-editor.tsx`.
- Veřejné datové služby (ARES, ČNB, ECB) volat přes `withService(data, "ares"|"cnb"|"ecb", …)`
  (`src/modules/int/services.ts`): napojení druhu „service“ (zakládá výchozí nastavení)
  je jde vypnout, otestovat a volání jdou do `int.log`; bez Integrace běží služba bez logu.
- Testovací prostředí (`src/modules/int/test-env.ts`, Integrace → Funkce): napojení TEST-…
  (EET simulátor `eetSimulator`, simulátor terminálu, tisk z prohlížeče), ostrá stejného
  druhu `pausedByTest`; ostrá napojení se zakládají ručně.
- REST API (`/api/v1/<objekt>[/<id>[/<akce>]]`, `src/app/api/v1`): klíč z napojení
  druhu API (Integrace), v DB jen SHA-256 otisk (`src/server/api-token.ts`), rozsah
  = moduly/objekty s právem Upravovat, `sys`/`int` nikdy, mazání přes API není.
  Vše přes datovou službu; autor zápisů „API · název napojení“.
- Dávkové úlohy: `ModuleDef.jobs` (`JobDef`, id `<modul>.<název>`, `run(ctx)` vrací
  zprávu), `default` = výchozí nastavení úlohu ve firmě založí. Plánovač
  `src/server/batch.ts` (z `src/instrumentation.ts`, každou minutu, `BATCH_SCHEDULER=off`
  vypne), plán v pražském čase, zmeškané běhy se nedohánějí, historie `sys.batchRun`.
- Nový doklad s číselnou řadou a vlastními řádky se uloží sám, jakmile jsou vyplněná povinná
  pole (výběr odběratele) — dostane číslo a hned jdou zadávat řádky (`autoCreate`).
  Souvislá řada (`sys.numberSeq.continuous`, v definici `numberSeqs[].continuous`): číslo
  smazaného konceptu jde do `sys.numberSeqFree` a `nextNumber` ho přidělí přednostně.
- Související doklady jako tlačítka v liště: `ObjectDef.related` (počet, bez záznamů neaktivní).
- Lookup standard: odkaz = „kód · název“ (`nameFieldOf`, u partnerů `titleRef`), hledá se
  podle obou; import přijme i „kód · název“. Filtr sloupce odkazu v seznamu taky podle kódu i názvu (`filter-where.ts`,
  u partnera název subjektu; `!text` = ani jedno). V seznamu má odkaz na partnera jen název (`FieldMeta.refNameOnly`),
  sloupec obrázku je bez nadpisu.
- Sloučit záznamy (`ObjectDef.mergeable`, `src/server/merge.ts`, tlačítko Sloučit v seznamu u ≥ 2 vybraných): ponechá se
  záznam s nejnižším kódem, odkazy ze všech objektů a přílohy se přepojí, ostatní se smažou (jedna transakce, střet
  jedinečného klíče odmítne); úpravy ponechaného `ObjectHandlers.merge` (položka: stejná MJ a zadání ceny, vyšší cena,
  dodavatel jen shodný, název bez „(dodavatel)“).
- PDF sestav na serveru: `src/server/print-pdf.ts` (pdfkit, DejaVu Sans), `/api/pdf/<doklad>/<id>`;
  prvky pod tabulkou řádků drží navrženou pozici a posunou se jen při přetečení.
- Sklad (`src/modules/whs`): pohyb jen přes `move()` (whs.trans + whs.onhand v jednom),
  lokace stromem (úroveň = nadřazená + 1, max. podle `whs.locationLevel`, cesta A.01.R1.3),
  deníky příjemka/inventura/vyřazení/přesun; napojení obsluhami na cizí objekty (ar.order
  rezervace, ar.invoice výdej, ap.invoice bez objednávky příjem, ap.order Přijmout na sklad,
  pos.receiptLine výdej) s kontrolou `ctx.modules`. Prodej smí do mínusu, deníky ne.
  Ocenění (Sklad → Parametry, `valuation`): průměrná cena za firmu (`whs.itemCost`, `valueMove`
  v `move()`), hodnota na `whs.trans`; `postStockValue` účtuje způsobem A (příjem 132/131,
  výdej 504/132, vyřazení 549/132, inventura 549|648), nákup skladových položek na 131.
- Transformace (`src/core/transform.ts`, Správa systému → Transformace): registr formátů
  (ABO, SEPA, GPC, SPAYD, EAN13); platební metoda (`bank.paymentMethod`) určuje formát příkazu.
  Platební příkaz (`bank.paymentOrder`, menu Dodavatelé): Navrhnout úhrady, výhrady z registru DPH
  (nespolehlivý plátce, nezveřejněný účet → jen s Odsouhlaseno), soubor `payment-formats.ts`.
- Výpisy v CSV: nic napevno pro banku — specifikace `bank.statementFormat` (+ `bank.statementFormatField`:
  údaj ← prefix řádku hlavičky / název sloupce, rozpoznání podle začátku souboru a masky názvu s číslem účtu),
  parser `src/modules/bank/csv-statement.ts` (výsledek ve tvaru GPC), specifikace na `bank.account`.
  Výchozí specifikace (KB) v `FORMATS` v `bank/index.ts`. Výpis za období: číslo `RRRRMMDD-RRRRMMDD`,
  návaznost podle data. Skutečné výpisy zákazníků nikdy do repa ani testů — test má vymyšlený výpis.
- Řádky výpisu: v mřížce jen příznak `matchKind` (faktura / záloha / účet / předkontace), vazby v detailu. Předkontace
  `bank.postingRule` (text / protiúčet / směr → účet) použije `autoMatch`, když VS nic nenajde. Deník z výpisu i z vybraných
  řádků (`bank.statementLine` akce `createJournal`, bulk) — řádek si pamatuje `journalId`, další výběr se přidá do
  rozpracovaného deníku výpisu. Hromadné akce řádků v detailu dokladu = `actions[].bulk` objektu řádků (tlačítka nad
  mřížkou). `ObjectDef.collapseHeader` = sbalená hlavička i u řádků mimo mřížku (výpis).
- Hromadný import výpisů `src/server/bank-import.ts` (firma podle čísla účtu, protokol
  `bank.importLog`, kontrola návaznosti `checkStatementChain`); z výpisu deník HK
  (`journalFromStatement`). Hromadné akce v seznamu: `actions[].bulk`.
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
- Založení z registru (`src/modules/gab/registry-lookup.ts`): IČO / DIČ CZ → ARES,
  zahraniční DIČ → VIES (datová služba `vies`). Akce s `module: "ap"` se ukáže jen se
  zapnutým modulem (Vytvořit dodavatele / odběratele na subjektu).
- ARES (`src/modules/gab/ares.ts`): veřejná služba bez klíče; akce „Doplnit z ARES“
  na subjektu i partnerovi (podle IČO, jinak jednoznačně podle názvu) doplní jméno,
  DIČ, právní formu a sídlo.
- Slevy (`inv.discount`): procento nebo akční cena, na položku / skupinu / vše,
  od–do; pokladna bere nejvýhodnější (`bestDiscount`), na řádku účtenky zůstane
  běžná cena a sleva.
- Import řádků dokladu: `importRecords(…, { fixed: { journalId } })` — rodič pevně,
  v UI tlačítko Import u řádků na stránce dokladu; export řádků `/api/export/<obj>?filter={…}`.
- Simulace provozu (jen test): `npx tsx --conditions=react-server scripts/simulate-shop.ts
  <tenant> <firma> [--receipts=60]` — směna, prodeje, boxy, pokladní kniha, faktura,
  kontrola předvahy, vyrovnanosti dokladů a DPH směny.
- Tiskové sestavy (`src/modules/prt`, `src/core/print.ts`, `src/lib/print-render.tsx`):
  tisknutelný doklad = `ModuleDef.printables` (dataset + katalog polí + výchozí rozvržení);
  šablona `prt.template` (JSON rozvržení v mm), návrhář `/print/designer`, tisk
  `/print/<objekt>/<id>`; jeden vykreslovač pro náhled, tisk i kasu. Moduly, které
  tisknou, mají `prt` v `dependsOn`. QR platba: `spayd()`, IBAN z čísla účtu `czIban()`.
- Import velkých souborů: nejdřív kontrola celého souboru nanečisto (jedna transakce, vrátí se; obrázky se jen ověří),
  pak zápis po dávkách `IMPORT_BATCH` (200 řádků = transakce, limit 20 s); chyba v dávce = předchozí dávky zůstanou,
  opakovaný import je aktualizuje podle klíče. Dodavatel / odběratel jde importovat jen s IČO (`regNo` na partnerovi,
  jedinečný klíč): subjekt z adresáře, jinak z registru (`createFromRegistry`, ARES); prázdná skupina = první skupina.
  Položka má `brand` (značka ≠ dodavatel).
- Smazání firmy s daty (`src/server/company-delete.ts`, akce `sys.company:deleteWithData` mimo transakci, superuživatel,
  potvrzení opsáním kódu = `actions[].confirm`): všechny tabulky objektů firmy (nepovinné odkazy vynulovat, mazat v kolech
  se savepointy), přílohy a soubory, sys vazby (po `RESET ROLE`), záznam do `sys_audit`. Nová tabulka firmy s odkazem
  na sys tabulku mimo objekty = doplnit sem.
- Zrušit zaúčtování faktury (`unpostInvoice` v `tax/document.ts`, akce `unpost` s `actions[].adminOnly` = jen superuživatel):
  smaže gl.trans + gl.voucher, tax.trans a položku salda, vrátí zálohu; odmítne úhradu, podané přiznání za DUZP, uzavřené
  období a pohyb skladu. Hlavička faktury: DUZP a splatnost následují datum vystavení, změna skupiny DPH / měny přepočte
  řádky (afterSave, mapy `groupChanged` / `currencyChanged`). Import vydaných faktur z ISDOC: `src/server/isdoc-import.ts`
  (větev v `importAction` pro `ar.invoice`), číslo faktury z ISDOC.
- Varování (nezávazné): `data.warn(label, params)` → `Ctx.warnings` → akce `saveRecordAction` / `runRecordAction` je vrátí
  (`_warnings` / `warnings`) a UI je ukáže jako `toast(…, "warning")`. Kontrola duplicit `checkDuplicate` (gl/posting.ts) podle
  výčtu `DupCheck` (přijmout / varovat / odmítnout / odmítnout ve stejném roce): číslo faktury (`ar.parameters` / `ap.parameters`,
  přijatá u téhož dodavatele), ručně zadané číslo dokladu v HK (`gl.parameters.voucherDupCheck`; `gl.voucher.voucherNum`
  není jedinečné kvůli opravným deníkům). Typ přijatého dokladu `ap.invoice.docType` (faktura / účtenka / dar): účtenka = zjednodušený doklad, `tax.trans.simplified`;
  dar = bez DPH, řádek 543100, profil darů z `ap.parameters.donationProfileId` (DAR → 379).
- Účtovací profily (`<ar|ap>.postingProfile` + řádky partner / skupina / všechny → účet salda): faktura nese `postingProfileId`
  (dar → profil darů, jinak profil partnera, jinak parametry; výchozí sada STANDARD/ZAM/FU/DAR/OST v `profiles` spec, FU dostane dodavatel FÚ z `tax.parameters`, platba DPH podle něj), `summaryAccountOf` v `tax/document.ts`; bez profilu účet skupiny. Položka salda si účet
  pamatuje (`trans.accountId`) a úhrada (banka `summaryAccount`, deník s VS v `planJournal`) jde proti němu.
- Platba DPH (`src/modules/tax/vat-payment.ts`, druh `vatPayment` přiznání, akce `postPayment`, obsluha `vatPaymentHandlers` zvlášť
  kvůli importům): zúčtování účtů DPH z `tax.trans` období proti dodavateli FÚ (`tax.parameters.taxOfficeVendorId`), položka
  `ap.trans` (VS = DIČ, splatnost 25. den) → uhrazení párováním výpisu. Tisk `vatPaymentPrintable` (QR). Druh `incomeTax` zatím
  bez výpočtu. Faktura v cizí měně: kurz k DUZP, DPH v Kč ze základu v Kč (§ 37), tisk přepočtu (`doc.fx*`); zaokrouhlení
  vydaných faktur `sys.currency.invoiceRoundingUnit` (CZK = 1) → `roundingAmount`, systémové účty roundingGain/Loss.
- E-shop (`src/modules/shop`, veřejně `src/server/eshop.ts` + `src/app/eshop/[org]/[[...path]]` + `/api/eshop/...`): jeden obchod na
  firmu, adresa `/<org.entity.publicSlug>` (proxy přepíše `/<zkratka>` a `/<zkratka>/(p|k|kosik|objednavka|info)/…` na `/eshop/…`;
  `SHOP_PATHS` nesmí být adresou portálu). Katalog = `inv.item.eshop` (pole s `FieldDef.module` = jen se zapnutým modulem), platby =
  `bank.paymentMethod.eshop`. Ceny/košík/objednávka jen v `catalog.ts` (server): objednávka → `shop.order` + `ar.order` s `pricesInclTax`
  (daň z ceny s DPH, faktura převezme, tisk ukáže cenu/MJ bez DPH) potvrzená = rezervace, převod → `ar.advance` (VS, QR); úhrada zálohy
  (handler `ar.advance`) → stav K vyřízení. Vzhled obchodu = vlastní CSS (`components/eshop`, šablony `data-layout`), ne Fluent.
- Vážené zboží a vychystávání (`src/modules/shop/picking.ts`, stránka `/shop/vychystani`): rezerva `inv.item.weighBufferPct` → jinak
  `shop.shop.weighBufferPct`; objednávka s váženým zbožím = `shop.order.estimated` + `amountMax`, kartou předem ne (CR-094 předautorizace),
  převodem bez zálohy (stav toPick, faktura po zvážení). Den / hodina vyzvednutí `pickupDate` / `pickupHour` (`pickupWindow`). Řádky
  `shop.pick` (systemOnly) vznikají s objednávkou; `setPick` (skutečné / Chybí, varování nad rezervou), `completePick` = řádky
  ar.order podle skutečnosti (chybějící smazat, odkaz pick vynulovat) → faktura + `postInvoice` → stav ready → e-mail (akce mimo transakci).
- Platební brána Comgate (`src/modules/int/comgate.ts`, ovladač `comgate` druhu payment): REST v2, `Authorization: Basic merchant:secret`,
  `testMode` = testovací platby. Stav se nikdy nebere z oznámení — `/api/pay/comgate/<tenant>/<napojení>` (`src/server/payment-push.ts`)
  i návrat kupujícího ověří stav dotazem u brány (`settleGatewayLog` v `src/server/eshop.ts`) a zapíší ho do `int.log` (payment.start,
  `detail` = `amount=… redirect=…`). E-shop: platba kind `card` jen s aktivní bránou (`gatewayConnection`, TEST- má přednost),
  `shop.order.paymentLogId`; pokladna: brána jen s `posQr`, `PaymentState.qr` = QR s platební stránkou. Testovací prostředí kopíruje
  ostré napojení do TEST-COMGATE. Comgate vyžaduje povolenou IP serveru.
  Bez Comgate založí testovací prostředí TEST-GATEWAY (ovladač `gatewaySim`): testovací stránka `/pay-sim/<tenant>/<protokol>`
  (`src/server/gateway-sim.ts`) zapíše `sim=PAID|CANCELLED` do protokolu a vyhodnotí ho stejně (`settleGatewayLog`).
- Pokladna a odběratel: `pos.receipt.customerId` (účtenka = faktura – daňový doklad, `ReceiptPrint.customer`, šablona účtenky v3
  s `doc.title`/`customer.*`), uzávěrka dá účtenku s CZ DIČ od 10 000 Kč do KH jednotlivě (A.4, `sourceObject` pos.receipt);
  `sellOnInvoice` = vydaná faktura `pricesInclTax` zaúčtovaná přes `ar.cfg` + `postInvoice`. E-mail z pokladny `sendDocumentNow`
  (`src/server/mail.ts`, koncept s PDF + odeslání). Kód firmy z ARES = `companyCodeFromName` (4 znaky, jedinečný).
- Tisková stanice (`src/server/station.ts`, objekty `int.device` / `int.printRoute` / `int.printJob` v `src/modules/int/devices.ts`,
  program pro Windows `src/station/stanice.ps1`): prohlížeč tiskárnu vybrat nesmí → Shanon Pokladna na PC u tiskárny. Zařízení → Stáhnout
  instalaci = osobní `.cmd` (`station-installer.ts`, program + ikona + jednorázový párovací kód `shp.…`, v DB jen otisk) → `/api/station/pair`
  dá klíč `shs.…` (DPAPI na PC). Stanice čeká dlouhým dotazem `/api/station/jobs` (probuzení `station-wake.ts`), PDF `jobs/<id>/pdf`
  s `X-Print-Settings` pro SumatraPDF (`printSettings`), výsledek POST. Tisk z UI = `printViaStation` / `printHref` (`src/lib/station-print.ts`,
  server action `stationPrintAction`): tiskárna `resolveStationPrinter` (účtenka → tiskárna pokladny, jinak pravidla dokladů: uživatel →
  počítač ze zástupce `/stanice?d=` v localStorage → kód), bez ní tisk z prohlížeče. Účtenka v PDF má výšku přesně podle obsahu (měřicí průchod).
- Pokladní váha (`src/lib/scale.ts`, napojení druhu `scale`: `scaleSerial` / `scaleSim`): Web Serial v kase, protokoly toledo8217 /
  casEcr / continuous (`parseScale`, testy bez hardwaru), bere se jen ustálená kladná hmotnost; port váhy zapamatovaný v localStorage
  (`pos.port.scale`), tiskárna ho přeskočí (`grantedPort`). Automatické zvážení po otevření dialogu `ScaleAutoStart`.
- Ověřená váha Dialog 06 (napojení `scaleProtocol = dialog06`): **cenu váženého zboží počítá jen váha** (WELMEC 2.2) — v kódu
  pokladny nesmí být hmotnost × cena pro takový řádek. Kodek `src/lib/dialog06.ts` (rámce PŘEDBĚŽNÉ, po specifikaci TEM měnit
  jen tam), `ScaleDriver` (`src/lib/scale-driver.ts`: výměny 1 s × 3, dotaz 250 ms, kontrola ceny za kg, návrat na nulu,
  připojení po 5 s; přenos `WebSerialTransport` / `SimScaleTransport` v `scale-sim.ts` — jen simulátor počítá cenu, hraje váhu),
  panel `src/components/pos-scale-panel.tsx`. Server (`scaleSaleLine` v `pos/sale.ts`): řádek s `scale` = qty a cena z váhy,
  cena za kg = ceník, bez slevy; pokladna s ověřenou vahou (`verifiedScale` doplní akce z napojení) neprodá vážené kg zboží bez
  údajů z váhy; audit na `pos.receiptLine.scale*`, box drží vážení v `pos.basketLine.scale` (JSON).
- Hromadný import mimo UI: `npx tsx --conditions=react-server scripts/import-file.ts
  <tenant> <firma> <objekt> <soubor>`; data zákazníků (ceníky, IČO) nikdy do repa.
- Pošta (`src/modules/int/mail.ts` ovladač SMTP přes nodemailer / `mailTest` jen do protokolu,
  `src/server/mail.ts`): Odeslat e-mailem (akce `outside`) založí koncept `int.mail` s PDF dokladu
  v přílohách a otevře ho (akce smí vrátit `ActionOutcome.open`); Odeslat pošle napojením druhu
  „mail“, zapíše `int.log` a u faktury `emailedAt`. Příjemce = `docEmail` partnera, jinak e-mail subjektu.
- SysLastValue: `FieldDef.rememberLast` — uložení uživatelem zapamatuje hodnotu (`sys.lastValue`, uživatel +
  firma + objekt + pole), nový záznam ji nabídne (u odkazu jen pokud sedí `lookupFilter`). Nový záznam: kurzor
  do prvního prázdného povinného pole; kompaktní hlavička nového dokladu ukazuje jen první skupinu polí.
- Mřížka řádků: Enter = další pole, Shift+Enter = předchozí (na posledním uloží řádek), ↓ na posledním řádku = uložit a nový řádek
  (prázdný řádek se sám nepřidává), podrobnosti vybraného řádku pod mřížkou (`lines[].details`), dimenze účtu
  a protiúčtu v dialogu Ctrl+Shift+D i v záložce Dimenze (jeden `DimsEditor`; `lines[].dims`; protiúčet `offsetDim1…6`,
  prázdné = jako účet). Po otevření dokladu kurzor do posledního řádku na první pole, které se neplní samo.
  Pod mřížkou jen nápověda kláves (nevyrovnaný doklad = zvýrazněné řádky, kontrola Ověřit). Výchozí dimenze řádku
  `applyDefaultDims` (posting.ts): účet = účet HK / partner / účet HK banky či pokladny (`defaultDimsOf`) → hlavička
  deníku; protiúčet = jeho výchozí → dimenze účtu; změna účtu nahradí jen hodnoty, které dal předchozí účet.
  Výchozí protiúčet a dimenze: název deníku → hlavička deníku (lze změnit) → nový řádek; protiúčet banka/pokladna
  ne u řádku stejného druhu, jediný účet firmy se doplní. Proskok na odkazovaný záznam: Ctrl+Enter / Ctrl+klik
  v `RefCombobox` (mřížka napřed uloží řádek), Esc = `goBack`. Potvrzení Uloženo = `toast()` (`ToastHost` v AppShell). Přehled zkratek pro uživatele = `docs/help/ovladani.md` (při nové zkratce doplnit).
- Filtry seznamu: `sessionStorage grid:<objekt>` s `base` (cesta seznamu) — `dropStaleGridViews` v AppShell je zahodí při
  odchodu z agendy (detail `/<base>/<id>` je zachová). Uložený pohled = oblíbená položka (`sys_favorite`, `folder` = složka v menu)
  s adresou `?v=<název>&filter.<pole>=…&sort=…&dir=…`; lišta „Filtrováno“ + Zrušit filtry + Uložit pohled v `ObjectListView`.
- Lišta formuláře (standard): Uložit + akce zpracování jako tlačítka; ostatní ve skupinách
  `Tisk ▾` (tisk, PDF, soubory, e-mail), `Zobrazit ▾` (související doklady, Náhled dokladu), `Další ▾`
  (Duplikovat). Skupina = `actions[].group` (výchozí: download → print, jinak process). Náhled dokladu =
  `ObjectDef.postingPreview` (akce nanečisto v transakci, která se vrátí; `src/server/posting-preview.ts`).
  Doklad s mřížkou řádků má po uložení sbalenou hlavičku; nový doklad se uloží klikem na předběžné číslo.
- Náhled před uložením (`previewRecord`, `usePreview`): formulář, šuplík i mřížka se po výběru
  (odkaz, výčet, číslo, datum) zeptají serveru, co uložení doplní — `save(…, { preview: true })` projde
  výchozí hodnoty, číselnou řadu a `beforeSave` obsluh, transakce se vrátí. Doplňování tedy patří do
  `beforeSave` (jeden zdroj pravdy). Čísla z řady jsou v náhledu jen předběžná (`_provisional`) a
  formulář je při uložení neposílá. Výběr omezený jiným polem: `FieldDef.lookupFilter`; u partnerů
  (`titleRef`) nabídka ukazuje jen jméno, `*` v hledání = podle čísla.
- Pořizování v mřížce (`InlineLines`, `ObjectDef.lines[]`): `inherit` (pole řádku ← hlavička), `carry`
  (z předchozího řádku), `balance` (vyrovnanost skupin, dorovnání nového řádku). Klávesy: Enter = uložit
  a další řádek, ↑/↓ = řádek, Tab přeskočí samočinná pole. Datum všude přes `DateInput` (zkratky AX
  `d`, `d+1`, `15`, `1511` — `src/lib/date-input.ts`). Deník: číslo dokladu přiděluje `allocateVoucher`
  už při založení řádku; druh deníku na hlavičce, menu modulů filtrem `?filter.journalType=…`
  (`MenuItem` s `object` + `href`), „Nový“ ze seznamu s filtrem předvyplní `?set.<pole>=`.
- Upozornění (zvoneček): `notify(data, { kind, title: label, params, message, href, key })`
  (`src/modules/sys/notify.ts`) — patří firmě, text se překládá až při zobrazení, `key` brání
  opakování (výchozí 24 h). Přečtení po uživatelích (`sys.notificationRead`), čtení `src/server/notices.ts`.
  Hlásí se jen to, co čeká na člověka (chyba dávky, doklady ke kontrole, nespolehlivý plátce, EET).
- Nápověda: návody `docs/help/*.md` (hlavička title, module, objects, order, summary),
  `src/server/help.ts` (vlastní převod Markdownu, odkazy jen `/…` a `http…`). Návod se ukáže
  v `/help`, v hledání Ctrl+K a jako „?“ u modulu a objektů z `objects`. Nová agenda = návod;
  odkazy ověřit (test `tests/help.test.ts` hlídá moduly a objekty).
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

- Souhrnný požadavek (např. „Deníky – opravy a úpravy“): dílčí požadavky mají `qa.issue.parentId`, opravy jsou
  kontrolní seznam `qa.issueItem` (Čeká / Opraveno – k ověření / Funguje / Stále nefunguje; datum opravy a ověření
  se doplní samo). „Stále nefunguje“ vrátí požadavek z testu do vývoje. Novou opravu k oblasti = nová položka
  souhrnného požadavku (stav Opraveno – k ověření), ne nový samostatný požadavek.
- **TEST / PROD:** Railway projekt `shanon` má prostředí `test` (https://shanon-test.up.railway.app, vlastní databáze, nasazuje
  z větve `next`) a `production` (https://shanon.up.railway.app, nasazuje z větve `release`). Vývoj = push do `next` → TEST.
  Na PROD až po schválení releasu uživatelem: `git push origin next:release`. Větev `main` je stará PHP verze.
- **Deník vývoje:** každý release na PROD = řádek(y) v `docs/qa/4-denik-vyvoje.csv` (datum nasazení, druh feature/change/fix,
  oblast, stručně, CR, commit, popis o co jde a jak se to používá) → `qa.changelog`, přehled Aktuality `/qa/aktuality`.
  Zápis se do aplikace dostane sám při nasazení (`scripts/changelog-sync.ts` v `db:deploy`, tenanti s modulem qa, klíč datum + nadpis).
  Víc úprav jedné oblasti v jednom releasu = jeden zápis s odrážkami (ne zápis za commit).
- GitHub Issues se štítky Analysis → Development → Testing → Done.
- Commity: `feat(gl): … [#123]`, `fix(gab): …`, `docs: …`.
- Před pushem: `npm run lint && npm run typecheck && npm test && npm run schema:check`
  a `npx madge --circular --extensions ts src/modules` (musí být bez kruhů).
- Výkon: `npx tsx --conditions=react-server scripts/perf.ts` (lokální DB) — porovnat s minulým
  během; transakce má limit 20 s, dlouhé operace (zaúčtování stovek dokladů) čtou číselníky
  jednou za běh (`cachedReads`) a nedělají zbytečné zápisy. Měřítko 15. 11. 2026 (PGlite):
  řádek deníku 16 ms, faktura se 3 řádky 52 ms, zaúčtování faktury 63 ms, 500 dokladů deníku 6 s.
  18. 11. 2026 před pamětí čtení: faktura se 3 řádky 88 ms (28 dotazů na řádek), zaúčtování 78 ms (85 dotazů).
  Po paměti čtení transakce: řádek deníku 16 ms, faktura se 3 řádky 60 ms, zaúčtování 49 ms, e-shop kategorie
  250 položek 22 ms, přehled 18 ms, košík 10 položek 31 ms.
  Výpis zboží e-shopu nesmí dotazovat za položku: číselníky přes `catalogReads`, zásoba hromadně `stockOf` (`shop/catalog.ts`).
- Před dokončením úkolu (dřívější SOP): build projde, nové texty jsou labely
  v cs i en, nový objekt má test v `tests/`, změna je ověřená v prohlížeči
  (desktop i mobil), žádné tajné údaje ani ladicí výpisy.
- Lokální DB bez Dockeru: `npm run db:local` (PGlite, v `.env` `DB_POOL_MAX=1` —
  PGlite neunese souběžná spojení), pak
  `npx prisma migrate deploy && npx tsx scripts/rls.ts && npm run db:seed`.
