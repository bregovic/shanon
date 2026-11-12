<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Shanon — pravidla vývoje

Architektura: `docs/ARCHITEKTURA.md`. Číst před každou větší změnou.

## Objekty a moduly

- Nová tabulka = nový objekt v `src/modules/<modul>/index.ts` (`defineObject`),
  ne ručně psaný model. Pak `npm run schema:gen` a `npx prisma migrate dev --name <popis>`.
- `prisma/schema.prisma` se **nikdy neupravuje ručně** (generuje se). Systémové
  tabulky jsou v `prisma/base.prisma`.
- Pole používá existující typ z `Edts` nebo vlastní `defineEdt` — ne vlastní
  délky a validace přímo u pole.
- Žádný vlastní CRUD v modulech. Čtení/zápis jen přes `src/server/data.ts`;
  byznys logika přes události (`ObjectHandlers`) a `DataApi`.
- Do hlavní knihy jen přes `postVoucher()` (`src/modules/gl/posting.ts`).
- Peníze přes `src/core/money.ts` (haléře, BigInt), nikdy sčítání `Number`.

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
- Žádné debug/setup/fix skripty dostupné z webu. Údržba = `scripts/` (CLI).
- Žádná hesla, tokeny ani connection stringy v repu.
- Nové tabulky objektů dostanou RLS automaticky (`scripts/rls.ts` po migraci).

## Workflow

- GitHub Issues se štítky Analysis → Development → Testing → Done.
- Commity: `feat(gl): … [#123]`, `fix(gab): …`, `docs: …`.
- Před pushem: `npm run lint && npm run typecheck && npm test && npm run schema:check`.
- Lokální DB bez Dockeru: `npm run db:local` (PGlite), pak
  `npx prisma migrate deploy && npx tsx scripts/rls.ts && npm run db:seed`.
