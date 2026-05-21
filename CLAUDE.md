# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Almondyoung Server** is a NestJS monorepo for an integrated e-commerce/logistics platform. It includes backend microservices, a Medusa-based commerce layer, and frontend apps.

### Backend Apps (`apps/`)
| App | Purpose |
|-----|---------|
| `core` | Main API server. WMS + PIM 도메인을 모두 포함하는 통합 백엔드. 배포 이름 `Core` (hostname `core.…`). |
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
npm run start:main:dev         # core server (watch, loads apps/core/.env)
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
Each service has its own schema and drizzle config. Workflow: edit `schema.ts` → generate SQL migration → migrate is applied by `db:setup` (dev) 또는 autodeploy workflow (배포).
```bash
# Generate a new migration from current schema.ts (--name is required)
npm run db:generate:core -- --name <kebab-description>
npm run db:generate:wallet -- --name <kebab-description>
npm run db:generate:user-service -- --name <kebab-description>
npm run db:generate:notification -- --name <kebab-description>
npm run db:generate:channel-adapter -- --name <kebab-description>
npm run db:generate:analytics -- --name <kebab-description>
npm run db:generate:file-service -- --name <kebab-description>
npm run db:generate:ugc-service -- --name <kebab-description>
npm run db:generate:membership -- --name <kebab-description>

# Dev 머신에서 마이그레이션 적용 (인터랙티브). 한 명령에 bootstrap → migrate → seed 가 묶여있음.
npm run db:setup -- --stage dev --deployment lcnine-services
# user-service is owned by the lcnine-auth deployment:
npm run db:setup -- --stage dev --deployment lcnine-auth
```

`db:setup` 은 **interactive dev 전용 wrapper** 다 — `--yes` / `--non-interactive` 거부, `--stage live` / `SST_STAGE=live` 거부. 비대화식·배포 경로에선 분리된 4개 명령을 *직접* 호출 (ADR-0005 §3):

```bash
npm run db:bootstrap  -- --stage <stage> --deployment <name> --yes  # 누락된 logical DB 생성
npm run db:migrate    -- --stage <stage> --deployment <name> --yes  # drizzle-kit migrate
npm run db:seed:ref   -- --stage <stage> --deployment <name> --yes  # 비-demo 그룹 reference seed
npm run db:seed:demo  -- --stage <stage> --deployment <name> --yes  # demo- prefix 그룹 (live 거부)
```

`drizzle-kit push` is intentionally not used — see `docs/adr/0005-drizzle-migration-and-autodeploy.md`.

**Daily cycle for a schema change:**
1. Edit `schema.ts` (or the file referenced by that service's `drizzle.config.ts`).
2. `npm run db:generate:<svc> -- --name <kebab-description>` — name describes intent (`add-foo-column`, `drop-deprecated-bar`), not auto-generated nonsense.
3. Review the generated SQL in `apps/<svc>/drizzle/<timestamp>_*.sql`. If it looks wrong, `git rm` it and fix `schema.ts` before regenerating — never hand-edit a generated migration that's already been applied.
4. `npm run db:setup -- --stage dev --deployment lcnine-services` to apply locally (인터랙티브 — 시드 그룹 선택 등 prompt 응답).
5. Commit `schema.ts` + the new `drizzle/<timestamp>_*.sql` + `drizzle/meta/` updates **in a single commit**. Splitting them desynchronizes other people's checkouts.

**⚠ Medusa schema 변경 시 (P3 autodeploy 활성화 전까지의 임시 절차):** Medusa container 가 더이상 부팅 시 자체 `medusa db:migrate` 를 돌리지 않으므로 (ADR-0005 §5), Medusa 모듈 / link / data-model 변경분을 live 또는 dev 환경에 반영하려면 배포 후 한 번 수동 호출이 필요하다:

```bash
sst shell --stage <stage> -- bash -lc "cd apps/medusa && yarn predeploy"
```

P3 PR 머지 후엔 autodeploy workflow 가 자동 호출하므로 이 단계는 사라진다.

**After pulling someone else's schema change:** rerun the `db:setup` line — Phase 2 applies new migrations only and skips already-applied ones.

**Rename caveat:** `drizzle-kit generate` cannot detect column/table renames automatically — it emits `DROP` + `ADD` (data loss). When you intend a rename, drizzle-kit prompts interactively on generate; this means **generate must run on a dev machine, never in CI**. Migrate (applying SQL) is non-interactive and safe to automate.

**Destructive changes** (column drop / rename / type narrow) on data with operational value: split into two PRs — additive first, contract later. See ADR-0005 §5.

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
- **Controller**: HTTP/WebSocket handling, DTO validation, auth guards. Never calls Repository directly. **No try/catch for error-to-status mapping** — the global filter handles it.
- **Service (Port)**: 2-3 lines, expresses business flow only. No validation logic. Throws domain exceptions from `@app/shared` on failure. Never imports `HttpException`, drizzle-orm, or Express types.
- **Reader/Manager/Creator (Implementation)**: All validation, business logic, and DB access lives here.
  - `xxx.reader.ts` — data queries (sits between Service and Repository)
  - `xxx.manager.ts` — validation + business logic + DB writes
  - `xxx.creator.ts` — entity creation
- **Repository**: One per domain (not per table). DB access, external API calls, Kafka. Injects `DbService<typeof schema>`.

**Error handling:**

Services throw domain exceptions from `@app/shared` — these are NOT `HttpException` and do not couple to Nest HTTP types:
```typescript
import { NotFoundError, BadRequestError, ConflictError } from '@app/shared';

// Not found
throw new NotFoundError(`Category not found: ${id}`);   // → 404
// Bad input
throw new BadRequestError('Category name is required'); // → 400
// Conflict
throw new ConflictError('Cannot delete: channels exist'); // → 409
// Truly unexpected internal error — becomes 500
throw new Error('DB returned empty result after insert');
```

`GlobalExceptionFilter` (`libs/shared/src/filters/http-exception.filter.ts`) maps `ApplicationException` subclasses to the correct HTTP status automatically.

Controllers only throw Nest exceptions for **input validation at the controller boundary** (e.g., missing query params), and do not wrap service calls in try/catch:
```typescript
// Controller input guard — OK
if (!warehouseId) throw new BadRequestException('warehouseId is required');

// Simple delegation — no try/catch needed
return this.service.doSomething(dto);
```

### Database Layer

- **ORM**: Drizzle ORM with `postgres.js`
- **Pattern**: Each service exports its schema object and `DbService<typeof schema>` is injected via `@InjectTypedDb<typeof schema>()`
- **Schema files**: `apps/<service>/src/schema.ts` or `apps/<service>/database/schemas/<name>-schema.ts`
- **Drizzle types**: Use `InferSelectModel`/`InferInsertModel` for types; define in a `types.ts` alongside schema
- **All table definitions** go in one `schema.ts` per service; snake_case table/column names, camelCase TypeScript exports

### Inventory (구 WMS) Rules

Inventory 모듈은 **event sourcing** 으로 재고를 관리한다 (apps/core/src/modules/inventory):
- `stock_events` — immutable event log (source of truth)
- `stock_summary` — projection with optimistic locking (`version` field)
- Event types: `IN`, `OUT`, `ADJUST`, `MOVE`, `RESERVE`, `CONFIRM`, `RELEASE`, `CANCEL`

**Inventory Transaction Propagation** (strict rule):
```typescript
// Import DbTx only from inventory.schema.ts — never re-declare locally
import { DbTx, inventoryTables, inventorySchema } from 'apps/core/src/modules/inventory/schema/inventory.schema';

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

**Inventory Query Rules:**
- Prohibited: `db.query.*`, `with` relations, `any`/`as` casting
- Required: `trx.select().from().innerJoin().where().orderBy()` with Drizzle operators
- DB injection: `@InjectTypedDb<typeof inventorySchema>()`, never `@Inject('DB')`
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
- Most services have `.env` files loaded via `dotenv-cli`

## Agent skills

### Issue tracker

Issues live on GitHub at `LCNINE/almondyoung-server`; use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical defaults (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` + `docs/adr/` at repo root; created lazily by `/grill-with-docs`). See `docs/agents/domain.md`.
