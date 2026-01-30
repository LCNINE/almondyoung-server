# Medusa DB Migration (Direct)

Direct DB migration scripts for Medusa. This is intentionally separate from the channel adapter to reduce accidental coupling and to keep read-first workflows safe.

## Goals

- Read-first exploration using Drizzle schema pull
- Explicit write guards (`ALLOW_DB_WRITES=true` required)
- Small, focused migrations (start with product categories)

## Setup

```bash
cd scripts/medusa-db-migration
pnpm add drizzle-orm@beta
pnpm add -D drizzle-kit@beta
pnpm add postgres dotenv chalk ts-node typescript @types/node
```

Copy and edit env:

```bash
cp .env.example .env
```

## Schema pull (Medusa DB)

```bash
pnpm run db:pull:medusa
```

This will generate or update `src/medusa.schema.ts` and `drizzle/medusa` artifacts.

## Schema pull (PIM DB)

```bash
pnpm run db:pull:pim
```

This will generate or update `src/pim.schema.ts` and `drizzle/pim` artifacts.

## Run (dry by default)

```bash
pnpm run categories:dry
```

To enable writes, set `ALLOW_DB_WRITES=true` in `.env` and run:

```bash
pnpm run categories
```

## Structure

```
scripts/medusa-db-migration/
├── .env.example
├── .gitignore
├── README.md
├── drizzle.config.ts
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── medusa.schema.ts
    ├── lib/
    │   ├── env.ts
    │   └── medusa-db.ts
    └── migrations/
        └── categories.ts
```

## Notes

- `medusa.schema.ts` is a placeholder until you pull the schema.
- The category migration is a stub; wire it to the pulled schema and your PIM source once ready.
