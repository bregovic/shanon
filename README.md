# Shanon

Administrativa pro malé prodejce a firmy — adresář, hlavní kniha, DPH; moduly
se zapínají podle potřeby, úpravy zákazníků žijí v rozšířeních mimo core.

Architektura: [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md) · Pravidla vývoje: [AGENTS.md](AGENTS.md)

## Stack

Next.js 16 · React 19 · TypeScript · Prisma 7 · PostgreSQL (RLS) · Tailwind 4 · Vitest

## Lokální vývoj

```bash
npm install
cp .env.example .env
npm run db:local                 # Postgres v PGlite (nechat běžet v jiném okně)
npx prisma migrate deploy
npx tsx scripts/rls.ts
SEED_PASSWORD=… npm run db:seed  # demo tenant, admin@shanon.local
npm run dev
```

## Kontroly

```bash
npm run lint && npm run typecheck && npm test && npm run schema:check
```

## Nasazení (Railway)

`railway.json`: build `npm run build`, při startu `npm run db:deploy`
(migrace + RLS). Proměnné: `DATABASE_URL`.
