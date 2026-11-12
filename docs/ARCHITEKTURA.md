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

| Modul | Obsah | Stav |
|---|---|---|
| `sys` | firmy, číselné řady, moduly | hotovo |
| `gab` | adresář subjektů, adresy, kontakty | hotovo |
| `gl` | účtový rozvrh, střediska, deníky, doklady, zápisy | hotovo (základ) |
| `tax` | daňové kódy, sazby, řádek přiznání, oddíl KH | číselník hotov |
| `ar` | odběratelé, vydané faktury, saldo | plán |
| `ap` | dodavatelé, přijaté faktury, saldo | plán |
| `cash` | pokladna a banka, párování plateb | plán |
| `fa` | dlouhodobý majetek, odpisy | plán |
| `inv` | produkty, sklad | plán |
| `sales` | objednávky — zdroj pro e-shop a pokladnu | plán |

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

## 10. Bezpečnost

- RLS na všech tabulkách objektů; role `shanon_app` není vlastník ani superuser.
- Relace: náhodný token v `httpOnly` cookie, v DB jen jeho SHA-256; odhlášení
  relaci maže. Brzda proti hádání hesel.
- Každá server action ověřuje relaci; správa modulů jen pro roli `admin`.
- Proxy (`src/proxy.ts`) jen přesměrovává nepřihlášené, nic neautorizuje.
- Odkaz „zpět“ přijímá jen interní cesty.
- Tajné údaje jen v proměnných prostředí. `.env*` je v `.gitignore`.

## 11. Další kroky (pořadí)

1. Uživatelé a role (oprávnění na objekty: číst / zapisovat / mazat / akce)
2. `ar` + `ap`: faktury s DPH → účtování přes účtovací profily
3. `cash`: banka (GPC/ABO import), pokladna, párování
4. Uzávěrky období, výkazy (rozvaha, výsledovka, obratová předvaha)
5. DPH: přiznání, KH, SH → XML pro EPO
6. `inv` + `sales` → první kanál (pokladna nebo e-shop)
7. Úložiště tenanta (R2), export dat
8. Rozšíření od tenantů v izolovaném běhu, katalog
