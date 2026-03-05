# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Almondyoung Server** is a NestJS monorepo for an integrated e-commerce/logistics platform. It includes backend microservices, a Medusa-based commerce layer, and frontend apps.

### Backend Apps (`apps/`)
| App | Purpose |
|-----|---------|
| `almondyoung-server` | Main API gateway/server |
| `wms` | Warehouse Management System (inventory, inbound, outbound, movement) |
| `pim` | Product Information Management (products, variants, categories) |
| `user-service` | Auth, user accounts |
| `wallet` | Payments, BNPL, refunds |
| `membership` | Subscription/membership management |
| `notification` | Push/email/SMS notifications |
| `channel-adapter` | Marketplace integrations (Naver, Coupang) |
| `file-service` | File upload/storage (S3) |
| `search` | Elasticsearch/OpenSearch product search |
| `analytics` | Analytics data collection |
| `ugc-service` | User-generated content (reviews) |
| `orchestrator` | Saga orchestration for cross-service workflows |
| `outbox-demo` | Transactional outbox pattern demo |

### Frontend Apps
- `apps/admin-web` — Next.js admin dashboard
- `apps/wallet-web` — Wallet/payment frontend
- `apps/medusa` — Medusa commerce backend

### Shared Libraries (`libs/`)
- `@app/db` — Drizzle ORM base, `DbService<Schema>`, `@InjectTypedDb` decorator
- `@app/events` — Kafka event bus with transactional outbox, DLQ, graceful shutdown
- `@app/authorization` — RBAC authorization module
- `@app/auth-core` — JWT auth core
- `@app/roles` — Role definitions
- `@app/shared` — Common utilities

## Development Commands

### Starting Services
```bash
npm run start:main:dev         # Main server (watch)
npm run start:wms:dev          # WMS (loads .env + .env.local)
npm run start:pim:dev          # PIM
npm run start:user-service:dev # User service
npm run start:wallet:dev       # Wallet
npm run start:membership:dev   # Membership
npm run start:channel-adapter:dev  # Channel adapter
npm run start:search:dev       # Search
npm run start:ugc-service:dev  # UGC service
npm run start:admin-web:dev    # Admin Next.js dev server
```

Note: Some services use `./scripts/with-ipv4.sh dotenv -e apps/<name>/.env` for env loading.

### Building
```bash
npm run build               # Build all NestJS apps
nest build <app-name>       # Build specific app
npm run build:admin-web     # Build admin Next.js app
```

### Testing
```bash
npm run test                         # All unit tests (Jest)
npm run test:watch                   # Watch mode
npm run test:cov                     # Coverage
jest --testPathPattern=<pattern>     # Run specific test files

# Per-service test commands
npm run test:user-service
npm run test:membership              # Membership e2e/itdoc
npm run test:payment                 # Payment-related tests
npm run test:bnpl:itdoc
```

### Database (Drizzle)
Each service has its own schema and drizzle config:
```bash
# WMS
npm run db:generate:wms       # Generate migrations
npm run db:push:wms           # Push schema

# PIM
npm run db:generate:pim
npm run db:push:pim

# Other services
npm run db:push:wallet
npm run db:push:user-service
npm run db:push:notification
npm run db:push:channel-adapter
npm run db:push:analytics
npm run db:push:file-service
npm run db:push:ugc-service
```

### Adding New Microservices/Libraries
```bash
nest g app <name>    # New microservice
nest g lib <name>    # New shared library
```
Never create new apps/libs by hand — always use the CLI.

### Code Quality
```bash
npm run lint      # ESLint with auto-fix
npm run format    # Prettier
```

## Architecture

### Layer Architecture (All Services)

```
Controller → Service → Reader/Manager → Repository
```

**Rules (always apply):**
- **Controller**: HTTP/WebSocket handling, DTO validation, auth guards, **Error → HTTP response conversion**. Never calls Repository directly.
- **Service (Port)**: 2-3 lines, expresses business flow only. No validation logic. Throws `throw new Error("message")` on failure. Never imports `HttpException`, drizzle-orm, or Express types.
- **Reader/Manager/Creator (Implementation)**: All validation, business logic, and DB access lives here.
  - `xxx.reader.ts` — data queries (sits between Service and Repository)
  - `xxx.manager.ts` — validation + business logic + DB writes
  - `xxx.creator.ts` — entity creation
- **Repository**: One per domain (not per table). DB access, external API calls, Kafka. Injects `DbService<typeof schema>`.

**Error handling in controllers:**
```typescript
try {
  return await this.service.doSomething();
} catch (e: any) {
  const msg = (e?.message ?? '').toLowerCase();
  if (msg.includes('not found')) throw new NotFoundException(e.message);
  if (msg.match(/already|invalid|failed|required|exceed/)) throw new BadRequestException(e.message);
  throw new InternalServerErrorException(e.message);
}
```

### Database Layer

- **ORM**: Drizzle ORM with `postgres.js`
- **Pattern**: Each service exports its schema object and `DbService<typeof schema>` is injected via `@InjectTypedDb<typeof schema>()`
- **Schema files**: `apps/<service>/src/schema.ts` or `apps/<service>/database/schemas/<name>-schema.ts`
- **Drizzle types**: Use `InferSelectModel`/`InferInsertModel` for types; define in a `types.ts` alongside schema
- **All table definitions** go in one `schema.ts` per service; snake_case table/column names, camelCase TypeScript exports

### WMS-Specific Rules

WMS uses **event sourcing** for stock management:
- `stock_events` — immutable event log (source of truth)
- `stock_summary` — projection with optimistic locking (`version` field)
- Event types: `IN`, `OUT`, `ADJUST`, `MOVE`, `RESERVE`, `CONFIRM`, `RELEASE`, `CANCEL`

**WMS Transaction Propagation** (strict rule):
```typescript
// Import DbTx only from wms-schema.ts — never re-declare locally
import { DbTx, wmsTables, wmsSchema } from '../../../database/schemas/wms-schema';

// Standard helper in every service class
private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
  return tx ? fn(tx) : this.db.transaction(fn);
}

// Public methods: tx?: DbTx as last param
async createFoo(dto: CreateFooDto, tx?: DbTx) {
  return this.inTx(async (trx) => {
    // Use trx inside, never this.db
    await this.otherService.doThing(trx);  // propagate!
  }, tx);
}

// Private helpers: tx: DbTx required
private async loadFoo(tx: DbTx, id: string) { ... }
```

**WMS Query Rules:**
- Prohibited: `db.query.*`, `with` relations, `any`/`as` casting
- Required: `trx.select().from().innerJoin().where().orderBy()` with Drizzle operators
- DB injection: `@InjectTypedDb<typeof wmsSchema>()`, never `@Inject('DB')`
- No `@ApiProperty({ type: 'object' })` — always define nested DTOs as separate classes

### Type Safety
- No `any` or `as` casting without documented justification and team approval
- Nullable normalization: `string ?? ''`, `number ?? 0`, `date ?? undefined`
- Use only enum values defined in schema

### Events / Kafka (`@app/events`)
- Transactional outbox pattern for reliable event publishing
- Auto-DLQ support for failed consumers
- Graceful shutdown support; see `libs/events/docs/` for patterns

## Environment Variables
- `DATABASE_URL` — PostgreSQL connection string
- `PORT` — Service port
- Most services have `.env` files loaded via `dotenv-cli`; WMS also has `.env.local`
