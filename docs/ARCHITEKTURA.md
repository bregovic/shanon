# Shanon — architektura

Administrativa pro malé prodejce a menší firmy. Nad ní parametrizované kanály:
e-shop, pokladna, dodavatelský portál. Inspirace AX / D365, postavené na
moderním webovém stacku.

> Stav: základ jádra (větev `next`). Stará PHP verze je v `main` a v záloze
> `Del/shanon-legacy-2026-11-12`.

## 1. Principy

1. **Co jde popsat definicí, se neprogramuje.** Objekt (tabulka + formulář +
   grid + API + validace) je jedna definice v `src/modules/<modul>`.
2. **Jeden zdroj pravdy pro texty.** Labely `@MODUL:Klic` ve všech jazycích,
   tenant si je může přepsat. V kódu UI nejsou natvrdo psané texty.
3. **Core se nemění kvůli zákazníkovi.** Úpravy tenantů jsou rozšíření —
   pole navíc (sloupec `ext`), labely, události. Core na rozšířeních nezávisí.
4. **Izolaci tenantů hlídá databáze**, ne jen kód (Row Level Security).
5. **Každá transakce má obraz v hlavní knize.** Pomocné knihy účtují přes
   jednu službu `postVoucher()`.
6. **Bezpečnost od prvního dne.** Žádné debug/setup skripty na webu, každá
   akce ověřuje relaci, žádné tajné údaje v repu.

## 2. Vrstvy

```
┌──────────────────────────────────────────────────────────────┐
│ Kanály (později): e-shop · pokladna · dodavatelský portál      │  samostatné appky nad API,
│                   konfigurace tenanta, ne generovaný kód       │  motiv a doména podle tenanta
├──────────────────────────────────────────────────────────────┤
│ Admin UI (src/app, Fluent UI) — obecné obrazovky z definic     │
├──────────────────────────────────────────────────────────────┤
│ Rozšíření (src/extensions) — pole, labely, události            │  soukromá / veřejná
├──────────────────────────────────────────────────────────────┤
│ Moduly core (src/modules) — sys, gab, gl, tax, …               │  zapínají se per tenant
├──────────────────────────────────────────────────────────────┤
│ Jádro (src/core) — typy polí, objekty, moduly, labely, validace│
│ Datová služba (src/server/data.ts) — jediný CRUD pro vše       │
├──────────────────────────────────────────────────────────────┤
│ PostgreSQL + RLS (tenant_id), Prisma 7                         │
└──────────────────────────────────────────────────────────────┘
```

## 3. Jádro

| Pojem | Soubor | Obdoba v AX/D365 |
|---|---|---|
| Typ pole (`defineEdt`) | `src/core/edt.ts` | Extended Data Type |
| Výčet (`defineEnum`) | `src/core/edt.ts` | Base Enum |
| Objekt (`defineObject`) | `src/core/object.ts` | Tabulka + formulář |
| Modul (`defineModule`) | `src/core/module.ts` | Konfigurační klíč / model |
| Rozšíření (`defineExtension`) | `src/core/module.ts` | Extension / ISV vrstva |
| Label | `src/core/labels.ts` | Label file `@SYS` |
| Číselná řada | `sys.numberSeq` | Number sequence |
| Firma | `sys.company` | Legal entity (DataAreaId) |

**Rozsah objektu:** `tenant` (sdílené pro zákazníka — adresář) nebo `company`
(patří firmě — účty, doklady, DPH). Sdílený objekt nesmí odkazovat na objekt firmy.

**Systémová pole** přidává generátor: `id` (UUID v7), `tenant_id`,
`company_id`, `ext` (JSON pro pole rozšíření), `version` (souběžné úpravy),
`created_*`, `updated_*`.

**Z definice vzniká:** `npm run schema:gen` → `prisma/schema.prisma` →
`prisma migrate dev` → migrace. `scripts/rls.ts` doplní RLS politiky.

## 4. Datová služba (`src/server/data.ts`)

Každé čtení a zápis objektu jde tudy. Pořadí při uložení:

1. zapnutý modul a vybraná firma
2. převod a validace hodnot podle typů (+ pole rozšíření)
3. výchozí hodnoty, číselná řada, povinná pole
4. odkazy musí mířit na záznam téhož tenanta/firmy (cizí klíč to neohlídá)
5. `beforeSave` — core a zapnutá rozšíření
6. zápis s kontrolou `version` → jinak „záznam změnil někdo jiný“
7. audit (`sys_audit`: co se změnilo, kdo, kdy)
8. `afterSave`

Vše v jedné transakci s `SET LOCAL ROLE shanon_app` a `app.tenant_id` → RLS.

## 4b. Filtry gridu

Syntaxe ze Shanonu 1 (`src/core/filter.ts`), vyhodnocená na serveru
(`src/server/filter-where.ts`) — do prohlížeče jde jen stránka výsledků:
`text`, `*text*`, `text*`, `A, B`, `!text`, `""`, `> 100`, `10..20`,
`15.12`, `15.12..`, `..31.12`, `ano/ne`. Odkaz se filtruje podle titulku
cíle (číslo účtu), výčet podle popisku (`osoba`), řazení podle odkazu taky.

## 5. Moduly a jejich zapínání

Tenant si v *Nastavení → Moduly* zapne jen to, co potřebuje. Závislosti se
zapnou s ním; modul, na kterém závisí jiný zapnutý, nejde vypnout. Vypnutí
data nemaže, jen skryje menu a zablokuje API.

| Modul | Obsah | Stav (15. 11. 2026) |
|---|---|---|
| `sys` | firmy, virtuální společnosti, číselné řady (i souvislé), měny a kurzy, role, dávkové úlohy, transformace (formáty), upozornění | hotovo |
| `org` | organizace firmy, provozovny, logo | hotovo |
| `gab` | adresář subjektů, adresy, kontakty, bankovní účty subjektů, ARES / VIES, registr plátců DPH | hotovo |
| `gl` | účtový rozvrh, období, finanční dimenze, systémové účty, deníky (obecné, banka, pokladna, platby), doklady, předvaha, rozvaha, výsledovka | hotovo |
| `tax` | daňové kódy, DPH na dokladech, přiznání DP3 a KH (XML pro EPO), objednávky a zálohy s daňovým dokladem k platbě (továrna AR/AP) | hotovo; chybí SH, přenesená povinnost |
| `ar` / `ap` | odběratelé a dodavatelé, objednávky, zálohy, faktury, saldo; AP platební příkazy | hotovo; chybí dobropisy jako druh, upomínky |
| `bank` | účty, import GPC (hromadně, kontrola návaznosti), párování, deníky z výpisů, platební metody, příkazy ABO / SEPA | hotovo; chybí camt.053 |
| `cash` | pokladní kniha (PPD/VPD), uzávěrka | hotovo |
| `inv` | položky (měna ceny), skupiny, jednotky, slevy | hotovo |
| `whs` | sklady, lokace (6 úrovní), deníky, rezervace, příjemka, ocenění průměrnou cenou (způsob A) | hotovo |
| `pos` | dotyková pokladna, směny, EET 2.0, terminál, odložené nákupy, PIN | hotovo |
| `prt` | tiskové sestavy (návrhář), PDF, QR platba, ISDOC | hotovo |
| `int` | napojení (EET, tiskárny, terminál, REST API, datové služby, vytěžování dokladů, pošta SMTP), doklady ke zpracování, testovací prostředí | hotovo |
| `qa` | evidence testování (funkce, UAT, požadavky) | hotovo |
| `fa` | dlouhodobý majetek, odpisy | plán |

## 6. Hlavní kniha a pomocné knihy

```
 ar (faktura) ─┐
 ap (faktura) ─┤                  ┌─ gl.voucher (UD26-000001)
 cash (platba)─┼─► postVoucher() ─┤
 fa (odpis)   ─┤                  └─ gl.trans (účet, středisko, ±částka)
 gl.journal   ─┘
```

- Částka v `gl.trans` je se znaménkem: + MD, − D. Doklad musí být vyrovnaný.
- Peníze se počítají v haléřích (`src/core/money.ts`), nikdy float.
- Účtovací profily (plán): mapování „druh dokladu + skupina → účty“, ať pomocné
  knihy nemají účty natvrdo.
- Finanční dimenze: zatím středisko; další dimenze (zakázka, projekt) stejným vzorem.
- Uzávěrka období (plán): zamčené období odmítne `postVoucher()`.

## 7. DPH

Daňový kód nese sazbu, směr, účet DPH, řádek přiznání a oddíl kontrolního
hlášení. S moduly `ar`/`ap` přibude: výpočet daně na řádcích dokladů, daňové
transakce (`tax.trans`) a z nich přiznání, KH a souhrnné hlášení v XML pro EPO
(zkušenost z DMS).

## 8. Rozšíření (úpravy tenantů)

```ts
defineExtension({
  id: "subject-rating", visibility: "public", owner: "core",
  dependsOn: ["gab"], labelPrefix: "XRATING",
  fields: { "gab.subject": { rating: { edt: Rating } } },        // → ext.rating
  handlers: { "gab.subject": { beforeSave(ctx, data) { … } } },
});
```

- **Pole** se ukládají do `ext` — core ani databáze se nemění.
- **Labely** mají vlastní prefix `X…`, core labely přepsat nemohou (to dělá tenant
  přes `sys_label_override`).
- **Logika** jen přes události (`beforeSave`, `afterSave`, `beforeDelete`, akce)
  a `DataApi` — rozšíření nesahá přímo do databáze a vidí jen data tenanta.
- **Viditelnost:** `private` = jen vlastník; `public` = ostatní tenanti si ho
  mohou zapnout (katalog rozšíření).
- **Fáze 2 — kód tenanta:** rozšíření od tenantů poběží odděleně (izolovaný
  worker / webhook) se stejným `DataApi` přes HTTP a s limity. Do té doby jsou
  rozšíření v repu a prochází revizí (první strana).

## 9. Úložiště tenanta

- **Soubory:** tenant si může připojit vlastní bucket (Cloudflare R2 / S3) —
  přílohy a dokumenty leží u něj (`sys_tenant.storage`, šifrovaně).
- **Export dat:** pravidelný export tabulek tenanta do jeho bucketu (Parquet/CSV)
  — záloha a vlastní BI.
- **Vlastní databáze:** pozdější prémiová úroveň — oddělená databáze spravovaná
  námi, směrování podle tenanta. Tabulky přímo v cizím úložišti nepodporujeme.

## 9b. Standardní funkce každého objektu

Oprávnění, přílohy (DocuRef), historie změn, oblíbené a export do Excelu
dostane každý objekt automaticky — viz tabulka v `AGENTS.md`.

**Oprávnění** (obdoba security rolí v AX): role (`sys.role`) má řádky
`sys.rolePermission` = cíl (modul nebo objekt) + úroveň (Číst / Upravovat /
Upravovat a mazat). Uživatel (`sys_user.role_ids`) má sjednocení svých rolí;
oprávnění na objekt má přednost před modulem. Správce tenanta má vše.
Kontroluje se v datové službě; systémové kroky (zaúčtování dokladu) se
kontrolují na úrovni akce, která je spustila.

**Firmy (účetní jednotky):** uživatel vidí jen firmy, ke kterým je přiřazen
(`sys_user_company`); v každé má vlastní role, případně je správcem firmy.
Superuživatel tenanta vidí všechny firmy a jako jediný zakládá firmy,
definuje role a zapíná moduly. Srovnání s D365/AX: `docs/D365-SROVNANI.md`.

## 10. Bezpečnost

- RLS na všech tabulkách objektů; role `shanon_app` není vlastník ani superuser.
- Relace: náhodný token v `httpOnly` cookie, v DB jen jeho SHA-256; odhlášení
  relaci maže. Brzda proti hádání hesel.
- Každá server action ověřuje relaci; správa modulů jen pro roli `admin`.
- Proxy (`src/proxy.ts`) jen přesměrovává nepřihlášené, nic neautorizuje.
- Odkaz „zpět“ přijímá jen interní cesty.
- Tajné údaje jen v proměnných prostředí. `.env*` je v `.gitignore`.

## 11. Další kroky (pořadí)

Hotovo do 15. 11. 2026: uživatelé a oprávnění, AR/AP/banka/pokladna/DPH, sklad, pokladna,
tisk a PDF, výkazy HK, dávky, upozornění, nápověda, pošta, ISDOC, vytěžování dokladů.

1. **Ostré nasazení první firmy** (Uzeniny Hynek Cibulka, #26): profil firmy, ceník, počáteční stavy,
   produkční prostředí (CR-037), rotace tajných klíčů.
2. **Workflow schvalování** (faktury dodavatelů, deníky) — úkoly do zvonečku; propojit se Schvaleem.
3. Uzávěrky: zavření období, převod výsledku, přecenění měn, storno a periodické deníky.
4. DPH: souhrnné hlášení, přenesená povinnost, pořízení z EU, zaúčtování vyrovnání DPH.
5. Banka camt.053, dobropisy jako druh dokladu, upomínky (e-mailem), hromadné odeslání faktur.
6. Uložená zobrazení gridu, šablony záznamů, oprávnění na pole.
7. Dlouhodobý majetek, rozpočty.
8. Úložiště souborů tenanta (R2/S3 — ovladač do `src/server/storage.ts`), export dat, e-shop.
9. Rozšíření od tenantů v izolovaném běhu, katalog.
