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
Each service has its own schema and drizzle config. Workflow: edit `schema.ts` → generate SQL migration → migrate is applied by `db:setup` (dev) 또는 사람이 `sst deploy` 와 짝지어 부르는 `db:migrate` (배포). **autodeploy 는 없다** — ADR-0005 §4 가 도입을 보류했다. drizzle 서비스는 container 자체 migration 도 없으므로, `db:migrate` 호출이 deploy 절차에서 누락되지 않게 하는 건 운영자 책임이다 (Medusa 만 예외로 container CMD 가 자체 migrate 를 부른다).
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

**Medusa schema 적용**: Medusa container 가 부팅 시 자체 `medusa db:migrate --execute-safe-links` 를 부른다 (Dockerfile CMD). 즉 `sst deploy` 가 새 Medusa task 를 띄우면 schema migration + module link sync 가 자동 적용. drizzle 서비스들은 자체 migration 없이 사람이 `db:migrate` 를 명시 호출.

**After pulling someone else's schema change:** rerun the `db:setup` line — Phase 2 applies new migrations only and skips already-applied ones.

**Rename caveat:** `drizzle-kit generate` cannot detect column/table renames automatically — it emits `DROP` + `ADD` (data loss). When you intend a rename, drizzle-kit prompts interactively on generate; this means **generate must run on a dev machine, never in CI**. Migrate (applying SQL) is non-interactive and safe to automate.

**Destructive changes — expand-contract 컨벤션 (ADR-0005 §5):** column drop / rename / type narrow / NOT NULL 추가 등 *destructive* schema 변경은 코드 변경과 같은 PR 에 묶지 않는다. 대신 phase 별 PR 분할:

- **새 추가 (column/table/index/NULLABLE FK)** → 1 PR (코드 변경과 같이 가능)
- **Column drop** → 2 PR: (1) 코드에서 사용 중단 (2) `DROP COLUMN`
- **Rename / type narrow / NOT NULL 추가** → 3 PR: (1) 새 컬럼 + dual write (2) backfill + read 전환 (3) 옛 컬럼 drop

**PR 사이에 deploy 가 끝나야 한다** — PR #1 머지 직후 PR #2 머지를 연속으로 해버리면 한 deploy 안에 두 phase 가 묶여 컨벤션 무력화. 적어도 한 번의 deploy 완료가 PR 사이에 필요.

**Contract phase 는 `sst deploy → migrate` 순서가 막는다** — 옛 task 가 destructive migration 을 만나는 사고 방지. autodeploy 가 없으므로 이 순서는 자동이 아니라 *운영자가 지키는 규율*이다 (ADR-0005 §5).

**Expand phase 는 순서가 반대다: `migrate → deploy`.** "additive 만 expand" 컨벤션은 *새 schema 가 옛 코드를 안 깨는 것*만 보장하지, 그 반대 (새 코드가 옛 schema 를 만나는 것) 는 보장하지 않는다. 새 컬럼을 읽고 쓰는 코드가 컬럼보다 먼저 뜨면 깨진다. migrate 를 먼저 돌리면 rolling 중 옛 task 는 nullable 추가 컬럼을 무시하므로 안전하다. 두 phase 의 순서를 반대로 적용하지 말 것 — 어느 phase 인지 먼저 확인한다.

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

### 검증 게이트

```bash
npm run type-check   # tsc --noEmit, spec 포함. 에러 0 이 기준선이다
npx jest             # 전체 유닛 테스트. 실패 0 이 기준선이다
```

두 명령 모두 **0 이 정상**이다. PR 에서 `.github/workflows/verification-gates.yml`
이 자동으로 돌며 차단한다. "develop 도 원래 깨져 있으니 괜찮다"는 식으로 기준선을
비교하는 절차는 더 이상 필요 없다 — 빨간 건 이 PR 이 만든 것이다.

**왜 빌드만으로는 부족한가:** `nest build` 는 `tsconfig.build.json` 이
`**/*spec.ts` 를 제외하므로 spec 타입 에러를 못 잡는다. `jest` 도
`tsconfig.jest.json` 의 `isolatedModules: true` 때문에 ts-jest 가 transpile-only 로
동작해 타입을 아예 검사하지 않는다. **spec 의 타입을 지키는 건 `type-check` 뿐이다.**

**jest 설정의 무시 패턴은 정규식이다.** `modulePathIgnorePatterns` /
`testPathIgnorePatterns` 에 `<rootDir>` 를 쓰면 치환 결과에 정규식 메타문자가 섞일 수
있다 — 이 저장소의 워크트리는 `.claude/worktrees/feat+foo` 꼴이라 `+` 가 수량자로
해석돼 패턴이 **조용히 안 걸렸다** (워크트리에서 jest 를 돌리면 `apps/medusa` spec 이
딸려 들어와 실패가 17건 늘었다). `<rootDir>` 없는 부분일치 패턴으로 쓸 것.

**jest 는 UTC 로 뜬다.** `scripts/jest/global-setup.js` 가 워커 fork 전에
`process.env.TZ` 를 `UTC` 로 박는다. 라이브(ECS/Lambda)와 CI 러너가 UTC 인데 개발 머신만
`Asia/Seoul` 이라, `toZonedTime` 처럼 **런타임 TZ 에 상대적인** 코드의 버그가 로컬에서만
사라지는 일이 있었다 (#724 발견 ⑪ — 당일 입고 취소가 라이브에서만 400). 스펙 파일 안에서
`process.env.TZ` 를 바꾸는 것은 이미 늦으니 그러지 말 것. TZ 견고성을 일부러 확인할 때만
셸에서 `TZ=America/New_York npx jest …` 처럼 넘기면 되고(명시한 값이 우선한다), 그때는
`scripts/jest/tz-is-utc.spec.ts` 하나가 빨간 게 정상이다.

프론트·통합·외부환경 테스트는 별도 명령이다:

```bash
npm run test:admin-web            # admin-web 전용
npm run test:user-service         # user-service 전용 config
npm run test:membership           # itdoc (전용 config)
npm run test:coupang:integration  # 실 DB + adapter-mock 필요
npm run test:core:integration:local
```

DB 를 요구하는 통합 스펙은 `describeIfDb` / `REQUIRE_*_DB=1` 가드로 기본 실행에서
자동 skip 된다. 새 통합 스펙도 이 컨벤션을 따를 것 — 가드 없이 두면 기본 게이트가
빨개진다.

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

Inventory 모듈은 **append-only 원장**으로 재고를 관리한다 (apps/core/src/modules/inventory):
- `stock_events` — immutable transition log (source of truth). `transition_type`: `RECEIVE`, `SHIP`, `MOVE`, `SCRAP`, `ADJUST_UP`, `ADJUST_DOWN` (+`MARK_DEFECT`/`REWORK_GOOD` 는 DEAD, producer 0)
- `stock_ledgers` — grain 별 현재 잔량, optimistic locking (`version` field)
- `stock_summary_view` — `stock_ledgers` 실시간 집계 **Postgres VIEW** (테이블 아님)
- **예약은 원장 이벤트가 아니다.** `stock_reservations` 행 상태 전이(`confirmed` → `released`)로 다루며, 예약 대상은 상자 라인(`targetType='SHIPMENT_LINE'`)이다. 가용재고 = ON_HAND 원장 합 − confirmed 예약 합.

**Transaction Propagation** (strict rule — see `docs/adr/0025-single-transaction-runner.md`):
```typescript
// Per-BC tx type, derived once via TxFor and named per BC. Import from the BC's
// canonical home — DbTx from inventory.schema, DbTransaction from catalog.types, etc.
// Never re-declare a local `type Tx = Parameters<...>` and never add a per-class inTx helper.
import { DbTx, inventoryTables, inventorySchema } from 'apps/core/src/modules/inventory/schema/inventory.schema';

// Use the single runner on the injected DbService — NOT a per-class inTx helper.
async createFoo(dto: CreateFooDto, tx?: DbTx) {
  return this.dbService.run(async (trx) => {   // trx: DbTx inferred from DbService<S>
    // Use trx inside, never this.db
    await this.otherService.doThing(trx);      // propagate!
  }, tx);
}

// Public methods: tx?: DbTx as last param. Private helpers: tx: DbTx required.
private async loadFoo(tx: DbTx, id: string) { ... }
```

Cross-BC **seam** services (those that legitimately span schemas, e.g. `ProductSellableQuantityService`) declare the wider `DbService<MergedSchema>` and accept `tx?: AnyTx`, narrowing once with `tx as TxFor<MergedSchema>` where they call `run`. `DbService<MergedSchema>` is the marker of a cross-BC service and must stay a short, reviewable list. Do **not** re-introduce per-class `inTx` helpers or `asTx(tx as unknown)` casts. `TxFor`, `AnyTx`, and `DbService.run` live in `@app/db`.

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

### Medusa (`apps/medusa`) — 확장은 소스가 아니라 문서에서 시작한다

`apps/medusa` 에서 「이걸 할 수 있나 / 얼마나 드나」를 판단하기 전에
**`https://docs.medusajs.com/llms.txt` 를 읽는다.** 카테고리별 URL 목록이라 필요한 페이지를 거기서 고른다.

설치된 `node_modules` 만 읽으면 *무엇이 있는지*는 알아도 **무엇이 «지원되는 확장점»인지는 모른다** —
훅은 코드로 보면 `createHook("name", …)` 한 줄이라 「여기로 들어오라」는 초대인지 내부 구현 디테일인지
구별되지 않는다. **역순도 성립하지 않는다**: 문서는 확장점은 알려줘도 *우리 호출 경로가 그걸 전부
지나가는지*는 안 알려준다. **문서로 확장점 목록 → 소스로 커버리지, 둘 다 필요하다.**

- **확장 권장 순서(문서):** 추가데이터(`additional_data`) → 워크플로 훅 → 커스텀 미들웨어 →
  이벤트 구독 → 라우트 **«복제»**(override 아님).
- **모듈 서비스 교체는 문서에 존재하지 않는다.** 그 결론이 나오면 **그 자체를 오답 신호로 볼 것.**
- **코어 라우트 override 는 지양한다** — 코어 미들웨어(zod 검증)에 암묵 의존하게 되고, 업그레이드가
  그 매칭을 바꾸면 조용히 무검증이 된다. 다른 경로에 복제하면 원본이 그대로 남는다.
- **워크플로 훅은 워크플로당 핸들러 하나뿐이다.** 중복 등록하면 부팅이 죽는다 —
  `apps/medusa/src/workflows/hooks/__tests__/no-duplicate-validate-hooks.unit.spec.ts` 가 이걸 지킨다.
  새 검증이 필요하면 **새 훅을 등록하지 말고 기존 핸들러 안에 함수를 더한다.**

2026-08-31 에 이 규칙이 없어서 비용을 **자릿수 단위로** 틀렸다(「모듈을 통째로 갈아끼워야 한다」 →
실제로는 비어 있는 공식 훅). 같은 이유로 워크플로 밖 쓰기가 만든 결함 하나를 오래 못 봤다.
경위는 이슈 #488 의 `A4` · `N7` · `N8`.

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

### 검색 0건 미취급 키워드 리포트

고객이 검색했는데 0건이었고 시중엔 파는 상품을 뽑아 소싱 후보 엑셀로 만든다.
`.claude/skills/search-zero-hit/` (실행 절차는 `scripts/ops/search-zero-hit/README.md`).
