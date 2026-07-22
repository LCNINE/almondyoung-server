# 로컬 core 개발 환경 + `dev_core` 시드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** core 를 로컬에서 단독 기동하고, 한 명령으로 전용 DB `dev_core` 를 밀고 창고 워크플로우 개발에 필요한 결정론적 세계를 재시딩한다.

**Architecture:** `scripts/local/seed-dev-core/` 아래에 책임별 모듈(가드 · DB 재생성 · 스코프 · 마스터데이터 · 재고 · 입고 · 주문 · 대량)을 두고 얇은 CLI 엔트리가 조립한다. **정합성이 걸린 전이는 도메인 서비스를 경유**하고(재고는 `InventoryCommandService.receive`, FO/예약은 `FulfillmentsService.create`), 순수 마스터 데이터만 결정론적 상수로 직접 insert 한다. 서비스 조립은 통합테스트가 이미 유지하는 `__support__/logistics-wiring.ts` 의 `wireLogistics` 를 재사용한다.

**Tech Stack:** TypeScript, drizzle-orm + postgres.js, drizzle-kit, NestJS 서비스(수동 DI), Jest(ts-jest), Docker Compose(postgres/kafka/zookeeper).

## Global Constraints

- 설계 SoT: `docs/superpowers/specs/2026-07-23-local-core-dev-environment-design.md`. 충돌하면 스펙이 이긴다.
- 모든 명령은 **레포 루트**(`/home/pauseb/workspace/almondyoung-server`)에서 실행한다.
- 대상 DB 는 **`dev_core` 하나뿐**이다. 기존 `core` 논리 DB 는 통합테스트와 `refresh-from-live.sh` 소유라 절대 건드리지 않는다.
- 시드 스크립트 실행기는 `npx ts-node -r tsconfig-paths/register --transpile-only` 다. `@app/*` 경로 별칭을 쓰므로 `tsconfig-paths` 등록이 필수다.
- **결정론**: SKU 코드 · 바코드 · 주문번호 · 창고/로케이션/SKU UUID 는 전부 상수이거나 인덱스 파생이다. `randomUUID()` 를 쓰지 않는다. (통합테스트 픽스처는 격리를 위해 랜덤을 쓰므로 `seedSku`/`seedSalesOrder`/`seedWarehouseWithZone` 은 **쓰지 않는다** — `receiveStock` 만 쓴다.)
- 타입 안전: `any` 금지. `as` 는 사유 주석이 있을 때만.
- Kafka 는 끄지 않는다. core 부팅이 브로커를 요구하므로 `docker compose up -d` 로 kafka·zookeeper 까지 올린다 (스펙 §3.1).
- 시드 통합 스펙은 `SEED_DEV_CORE_URL` 이 있을 때만 돈다. `DATABASE_URL` 로 게이트하면 다른 통합테스트 실행 중에 딸려 돌아 `core` 를 오염시킬 수 있다.
- 각 Task 끝에서 커밋한다.

---

### Task 1: `dev_core` 논리 DB 준비

**Files:**
- Modify: `scripts/local/init-db.sql`

**Interfaces:**
- Produces: 로컬 postgres 에 `dev_core` 논리 DB. 이후 모든 Task 가 이 DB 를 대상으로 한다.

- [ ] **Step 1: compose 전체 기동**

Run:
```bash
docker compose up -d
```
Expected: `postgres`, `redis`, `kafka`, `zookeeper` 4개가 생성/기동된다. 현재 머신은 postgres 만 떠 있는 상태이므로 나머지 3개가 새로 만들어진다.

- [ ] **Step 2: 기동 확인**

Run:
```bash
docker compose ps --format '{{.Service}}\t{{.State}}'
```
Expected: 4줄 모두 `running`. kafka 가 `restarting` 이면 zookeeper 가 먼저 뜰 때까지 기다렸다가 `docker compose up -d kafka` 로 재시도한다.

- [ ] **Step 3: `init-db.sql` 에 `dev_core` 추가**

`scripts/local/init-db.sql` 의 `CREATE DATABASE core;` 바로 아래에 추가한다:

```sql
-- 로컬 core 단독 개발용 (통합테스트/refresh-from-live 가 쓰는 core 와 분리)
CREATE DATABASE dev_core;
```

- [ ] **Step 4: 현재 볼륨에 `dev_core` 수동 생성**

`init-db.sql` 은 postgres 볼륨 최초 생성 시에만 실행되므로 기존 볼륨에는 반영되지 않는다.

Run:
```bash
docker compose exec -T postgres psql -U postgres -c "CREATE DATABASE dev_core"
```
Expected: `CREATE DATABASE`

- [ ] **Step 5: 확인**

Run:
```bash
docker compose exec -T postgres psql -U postgres -lqt | cut -d'|' -f1 | grep -w dev_core
```
Expected: `dev_core` 한 줄 출력

- [ ] **Step 6: 커밋**

```bash
git add scripts/local/init-db.sql
git commit -m "[local] init-db 에 dev_core 논리 DB 추가"
```

---

### Task 2: 가드 — 파괴 대상 검증

**Files:**
- Create: `scripts/local/seed-dev-core/guard.ts`
- Test: `scripts/local/seed-dev-core/guard.spec.ts`

**Interfaces:**
- Produces: `assertLocalDevCoreUrl(rawUrl: string): { url: URL; dbName: string }` — 검증 통과 시 파싱 결과 반환, 실패 시 `Error` throw. Task 3 의 DB 재생성이 이 함수를 먼저 부른다.

- [ ] **Step 1: 실패하는 테스트 작성**

`scripts/local/seed-dev-core/guard.spec.ts`:

```typescript
import { assertLocalDevCoreUrl } from './guard';

describe('assertLocalDevCoreUrl', () => {
  it('localhost 의 dev_core 를 통과시키고 DB 이름을 돌려준다', () => {
    const result = assertLocalDevCoreUrl('postgresql://postgres:postgres@localhost:5432/dev_core');
    expect(result.dbName).toBe('dev_core');
    expect(result.url.hostname).toBe('localhost');
  });

  it('127.0.0.1 도 통과시킨다', () => {
    expect(assertLocalDevCoreUrl('postgresql://postgres:postgres@127.0.0.1:5432/dev_core').dbName).toBe('dev_core');
  });

  it('원격 호스트를 거부한다', () => {
    expect(() =>
      assertLocalDevCoreUrl('postgresql://u:p@lcnine-services-live.ap-northeast-2.rds.amazonaws.com:5432/dev_core'),
    ).toThrow(/localhost/);
  });

  it('dev_core 가 아닌 DB 를 거부한다 — 공용 core 보호', () => {
    expect(() => assertLocalDevCoreUrl('postgresql://postgres:postgres@localhost:5432/core')).toThrow(/dev_core/);
  });

  it('sst tunnel 로 localhost 에 붙은 원격 core 도 DB 이름으로 거부한다', () => {
    expect(() => assertLocalDevCoreUrl('postgresql://postgres:postgres@localhost:5432/user_service')).toThrow(
      /dev_core/,
    );
  });

  it('URL 이 아니면 거부한다', () => {
    expect(() => assertLocalDevCoreUrl('not-a-url')).toThrow();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest scripts/local/seed-dev-core/guard.spec.ts`
Expected: FAIL — `Cannot find module './guard'`

- [ ] **Step 3: 가드 구현**

`scripts/local/seed-dev-core/guard.ts`:

```typescript
/**
 * 시드 리셋은 DROP DATABASE 를 수행한다. 실수로 라이브·공용 DB 를 날리지 않도록
 * 대상 URL 을 두 조건으로 잠근다.
 *
 * 호스트 조건이 라이브 RDS 를 막고, DB 이름 조건이 공용 로컬 `core` 를 막는다.
 * `sst tunnel` 이 떠 있으면 localhost:5432 가 원격을 가리킬 수 있으므로
 * **DB 이름 조건이 실질적 방어선**이다.
 */
const ALLOWED_HOSTS = ['localhost', '127.0.0.1'];
const REQUIRED_DB_NAME = 'dev_core';

export function assertLocalDevCoreUrl(rawUrl: string): { url: URL; dbName: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`[seed-dev-core] DATABASE_URL 을 파싱할 수 없습니다: ${rawUrl}`);
  }

  if (!ALLOWED_HOSTS.includes(url.hostname)) {
    throw new Error(
      `[seed-dev-core] 로컬 전용 스크립트입니다. 호스트는 ${ALLOWED_HOSTS.join(' 또는 ')} 여야 하는데 '${url.hostname}' 입니다.`,
    );
  }

  const dbName = url.pathname.replace(/^\//, '');
  if (dbName !== REQUIRED_DB_NAME) {
    throw new Error(
      `[seed-dev-core] 대상 DB 는 '${REQUIRED_DB_NAME}' 여야 합니다. '${dbName}' 은 거부합니다 (통합테스트·라이브 복제본 보호).`,
    );
  }

  return { url, dbName };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest scripts/local/seed-dev-core/guard.spec.ts`
Expected: PASS — 6 passed

- [ ] **Step 5: 커밋**

```bash
git add scripts/local/seed-dev-core/guard.ts scripts/local/seed-dev-core/guard.spec.ts
git commit -m "[local] dev_core 시드 파괴 대상 가드"
```

---

### Task 3: DB 재생성 + 마이그레이션 + CLI 엔트리

**Files:**
- Create: `scripts/local/seed-dev-core/database.ts`
- Create: `scripts/local/seed-dev-core/index.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `assertLocalDevCoreUrl` (Task 2)
- Produces:
  - `recreateDatabase(rawUrl: string): Promise<void>` — 세션 종료 → DROP → CREATE
  - `runCoreMigrations(rawUrl: string): void` — drizzle-kit migrate 동기 실행
  - `resolveSeedUrl(): string` — `SEED_DEV_CORE_URL` ?? 기본 로컬 URL
  - npm script `dev:core:reset`
- Produces (Task 4~9 가 소비): `index.ts` 의 `main()` 이 단계별 함수를 순서대로 부르는 골격

- [ ] **Step 1: DB 재생성 모듈 구현**

`scripts/local/seed-dev-core/database.ts`:

```typescript
import { execFileSync } from 'child_process';
import * as postgres from 'postgres';
import { assertLocalDevCoreUrl } from './guard';

export const DEFAULT_SEED_URL = 'postgresql://postgres:postgres@localhost:5432/dev_core';

export function resolveSeedUrl(): string {
  return process.env.SEED_DEV_CORE_URL ?? DEFAULT_SEED_URL;
}

/**
 * 대상 DB 의 다른 세션을 끊고 drop/create 한다. core 를 watch 로 띄워둔 채여도
 * postgres.js 풀이 재연결하므로 core 를 내릴 필요가 없다.
 */
export async function recreateDatabase(rawUrl: string): Promise<void> {
  const { url, dbName } = assertLocalDevCoreUrl(rawUrl);

  const admin = postgres({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: 'postgres',
    max: 1,
  });

  try {
    await admin`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${dbName} AND pid <> pg_backend_pid()
    `;
    // dbName 은 가드가 'dev_core' 리터럴로 고정했으므로 식별자 보간이 안전하다.
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
  } finally {
    await admin.end();
  }
}

/**
 * drizzle-kit 은 별도 프로세스로 돌린다. apps/core/drizzle.config.ts 의
 * dotenv config() 는 **이미 설정된 env 를 덮어쓰지 않으므로** 여기서 주입한
 * DATABASE_URL 이 이긴다 (migrate-all.sh 와 동일한 성질).
 */
export function runCoreMigrations(rawUrl: string): void {
  assertLocalDevCoreUrl(rawUrl);
  execFileSync('npx', ['drizzle-kit', 'migrate', '--config', 'apps/core/drizzle.config.ts'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: rawUrl },
  });
}
```

- [ ] **Step 2: CLI 엔트리 구현**

`scripts/local/seed-dev-core/index.ts`:

```typescript
import { recreateDatabase, resolveSeedUrl, runCoreMigrations } from './database';

async function main(): Promise<void> {
  const bulk = process.argv.includes('--bulk');
  const url = resolveSeedUrl();

  console.log(`── 1/3 dev_core 재생성 (${url})`);
  await recreateDatabase(url);

  console.log('── 2/3 drizzle 마이그레이션');
  runCoreMigrations(url);

  console.log(`── 3/3 시드${bulk ? ' (--bulk)' : ''}`);
  // 시드 단계는 Task 4 이후에 채운다.

  console.log('✅ dev_core 리셋 완료');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: npm script 추가**

`package.json` 의 `"db:migrate:local"` 줄 바로 아래에 추가한다:

```json
    "dev:core:reset": "ts-node -r tsconfig-paths/register --transpile-only scripts/local/seed-dev-core/index.ts",
```

- [ ] **Step 4: 실행해서 테이블이 생기는지 확인**

Run:
```bash
npm run dev:core:reset
```
Expected: 1/3 · 2/3 · 3/3 로그 후 `✅ dev_core 리셋 완료`. drizzle-kit 이 마이그레이션을 적용하는 출력이 보인다.

Run:
```bash
docker compose exec -T postgres psql -U postgres -d dev_core -c "\dt public.*" | head -20
```
Expected: `warehouses`, `locations`, `skus`, `stock_events`, `stock_ledgers` 등이 목록에 있다.

- [ ] **Step 5: 가드가 실제로 막는지 확인**

Run:
```bash
SEED_DEV_CORE_URL=postgresql://postgres:postgres@localhost:5432/core npm run dev:core:reset
```
Expected: 즉시 실패. `대상 DB 는 'dev_core' 여야 합니다. 'core' 은 거부합니다` 메시지. **`core` DB 에 아무 변화가 없어야 한다.**

- [ ] **Step 6: 커밋**

```bash
git add scripts/local/seed-dev-core/database.ts scripts/local/seed-dev-core/index.ts package.json
git commit -m "[local] dev_core 재생성 + 마이그레이션 러너"
```

---

### Task 4: 스코프 부트스트랩

**Files:**
- Create: `scripts/local/seed-dev-core/scopes.ts`
- Modify: `scripts/local/seed-dev-core/index.ts`
- Test: `scripts/local/seed-dev-core/seed.integration.spec.ts`

**Interfaces:**
- Consumes: `resolveSeedUrl` (Task 3)
- Produces: `bootstrapScopes(db: PostgresJsDatabase<typeof wmsSchema>): Promise<void>` — `auth.scopes` + `auth.role_scope_mapping` 채움
- Produces (Task 5~9 가 소비): 시드 검증 스펙 `seed.integration.spec.ts` 의 골격 — `beforeAll` 에서 리셋+시드를 1회 돌리고 각 Task 가 assertion 을 추가한다

**배경:** `ScopeBootstrapService` 는 core 부팅 시 1회만 돈다. 리셋이 이 테이블을 비우면 watch 로 띄워둔 core 가 계속 403 을 뱉으므로, 시드가 직접 채워 core 를 안 내리고 리셋할 수 있게 한다 (스펙 §4.2).

- [ ] **Step 1: 실패하는 통합 스펙 작성**

`scripts/local/seed-dev-core/seed.integration.spec.ts`:

```typescript
import { execFileSync } from 'child_process';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { wmsSchema } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';

const SEED_URL = process.env.SEED_DEV_CORE_URL;
const describeIfSeedDb = SEED_URL ? describe : describe.skip;

describeIfSeedDb('dev_core 시드', () => {
  jest.setTimeout(300_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    execFileSync(
      'npx',
      ['ts-node', '-r', 'tsconfig-paths/register', '--transpile-only', 'scripts/local/seed-dev-core/index.ts'],
      { stdio: 'inherit', env: { ...process.env, SEED_DEV_CORE_URL: SEED_URL } },
    );
    client = postgres(SEED_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });

  afterAll(async () => {
    await client?.end();
  });

  it('scope 와 role→scope 매핑이 채워진다', async () => {
    const scopeRows = await db.execute(sql`SELECT count(*)::int AS n FROM auth.scopes`);
    expect(Number((scopeRows as unknown as Array<{ n: number }>)[0].n)).toBeGreaterThan(0);

    const mappingRows = await db.execute(
      sql`SELECT role_name FROM auth.role_scope_mapping GROUP BY role_name ORDER BY role_name`,
    );
    const roles = (mappingRows as unknown as Array<{ role_name: string }>).map((row) => row.role_name);
    expect(roles).toEqual(['logistics_manager', 'logistics_worker']);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `SEED_DEV_CORE_URL=postgresql://postgres:postgres@localhost:5432/dev_core npx jest --runInBand scripts/local/seed-dev-core/seed.integration.spec.ts`
Expected: FAIL — `expect(received).toEqual(expected)` 에서 `roles` 가 `[]`

- [ ] **Step 3: 스코프 부트스트랩 구현**

`scripts/local/seed-dev-core/scopes.ts`:

```typescript
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { DbService } from '@app/db';
// 배럴(@app/authorization)은 passport/jwks-rsa 까지 끌어와 스크립트 기동이 느려진다. 필요한 것만 깊은 경로로.
import { AuthorizationService } from '@app/authorization/services/authorization.service';
import { ALL_SCOPES } from '../../../apps/core/src/platform/auth/merged-scopes';
import { FULFILLMENT_ROLE_MAPPINGS } from '../../../apps/core/src/platform/auth/fulfillment-scopes';
import { wmsSchema } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { makeDbService } from '../../../apps/core/src/modules/fulfillment/services/__support__';

/**
 * core 의 ScopeBootstrapService 가 부팅 시 하는 일과 동일하다.
 * 시드가 직접 하는 이유는 스펙 §4.2 — core 를 띄운 채 리셋해도 403 이 안 나게 하기 위함.
 */
export async function bootstrapScopes(db: PostgresJsDatabase<typeof wmsSchema>): Promise<void> {
  const dbService = makeDbService(db);
  // AuthorizationService 는 스키마 제네릭 없는 DbService 를 받는다. auth 스키마 테이블을
  // 직접 참조해 조회하므로 제네릭은 런타임에 무의미하고, 구조적으로만 호환시키면 된다.
  const service = new AuthorizationService(dbService as unknown as DbService, {
    microserviceName: 'almondyoung',
    scopes: ALL_SCOPES,
    roleMappings: FULFILLMENT_ROLE_MAPPINGS,
  });

  await service.ensureScopesExist('almondyoung', ALL_SCOPES);
  await service.ensureRoleScopeMappings(FULFILLMENT_ROLE_MAPPINGS);
}
```

- [ ] **Step 4: 엔트리에 배선**

`scripts/local/seed-dev-core/index.ts` 를 다음으로 교체한다:

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
import { wmsSchema } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { recreateDatabase, resolveSeedUrl, runCoreMigrations } from './database';
import { bootstrapScopes } from './scopes';

async function main(): Promise<void> {
  const bulk = process.argv.includes('--bulk');
  const url = resolveSeedUrl();

  console.log(`── 1/4 dev_core 재생성 (${url})`);
  await recreateDatabase(url);

  console.log('── 2/4 drizzle 마이그레이션');
  runCoreMigrations(url);

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema: wmsSchema });

  try {
    console.log('── 3/4 스코프 부트스트랩');
    await bootstrapScopes(db);

    console.log(`── 4/4 시드${bulk ? ' (--bulk)' : ''}`);
    // 세계 생성은 Task 5 이후에 채운다.
  } finally {
    await client.end();
  }

  console.log('✅ dev_core 리셋 완료');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `SEED_DEV_CORE_URL=postgresql://postgres:postgres@localhost:5432/dev_core npx jest --runInBand scripts/local/seed-dev-core/seed.integration.spec.ts`
Expected: PASS — 1 passed

- [ ] **Step 6: 커밋**

```bash
git add scripts/local/seed-dev-core/scopes.ts scripts/local/seed-dev-core/index.ts scripts/local/seed-dev-core/seed.integration.spec.ts
git commit -m "[local] dev_core 시드 스코프 부트스트랩"
```

---

### Task 5: 결정론 상수 + 마스터 데이터

**Files:**
- Create: `scripts/local/seed-dev-core/constants.ts`
- Create: `scripts/local/seed-dev-core/master-data.ts`
- Modify: `scripts/local/seed-dev-core/index.ts`
- Modify: `scripts/local/seed-dev-core/seed.integration.spec.ts`

**Interfaces:**
- Produces (Task 6~9 가 소비):
  - `SEED_IDS` — `warehouseBucheon`, `warehouseChina`, `locBucheonReceiving`, `locBucheonShipping`, `locBucheonRackA1`…, `holderPrimary`, `holderSecondary`, `deliveryProfile` UUID 상수
  - `SEED_SKUS: ReadonlyArray<{ id: string; code: string; name: string; barcode: string; holderId: string; safetyStock: number }>` — 20건
  - `seedMasterData(tx: DbTx): Promise<void>`

- [ ] **Step 1: 상수 모듈 작성**

`scripts/local/seed-dev-core/constants.ts`:

```typescript
/**
 * 결정론 규약(스펙 §7.7): 모든 식별자는 상수이거나 인덱스 파생이다.
 * 스캔 워크플로우를 개발하므로 바코드가 리셋마다 바뀌면 종이에 적어두고 쓸 수 없다.
 *
 * 창고 UUID 2개는 scripts/seeding/constants/uuids.ts 의 FIXED_UUIDS 와 동일한 값이라
 * 라이브/기존 시드와 창고 식별자가 어긋나지 않는다.
 */
export const SEED_IDS = {
  warehouseBucheon: '019d0001-0001-7000-a000-000000000001',
  warehouseChina: '019d0001-0002-7000-a000-000000000002',

  locBucheonReceiving: '019d0002-0001-7000-a000-000000000001',
  locBucheonShipping: '019d0002-0002-7000-a000-000000000002',
  locBucheonDamage: '019d0002-0003-7000-a000-000000000003',
  locBucheonReturn: '019d0002-0004-7000-a000-000000000004',
  locChinaReceiving: '019d0002-0005-7000-a000-000000000005',
  locChinaShipping: '019d0002-0006-7000-a000-000000000006',
  locChinaDamage: '019d0002-0007-7000-a000-000000000007',
  locChinaReturn: '019d0002-0008-7000-a000-000000000008',

  holderPrimary: '019d0003-0001-7000-a000-000000000001',
  holderSecondary: '019d0003-0002-7000-a000-000000000002',

  deliveryProfile: '019d0004-0001-7000-a000-000000000001',
} as const;

/** 부천 일반 랙/빈 6개 — 이동·실사 대상. code 가 곧 라벨이다. */
export const SEED_RACK_LOCATIONS = Array.from({ length: 6 }, (_, index) => ({
  id: `019d0005-000${index + 1}-7000-a000-00000000000${index + 1}`,
  code: `A-01-${String(index + 1).padStart(2, '0')}`,
  displayName: `A열 1단 ${index + 1}번`,
}));

/**
 * SKU 20건. 재고 배치는 stock.ts 가 index 로 결정한다:
 *   index 0~1  → 재고 0 (품절 경로)
 *   index 2~13 → 단일 로케이션
 *   index 14~19 → 다중 로케이션 분산
 * safetyStock 은 일부만 > 0 이라 재고조회의 '부족' 3-상태를 볼 수 있다.
 */
export const SEED_SKUS = Array.from({ length: 20 }, (_, index) => {
  const seq = String(index + 1).padStart(4, '0');
  return {
    id: `019d0006-${seq}-7000-a000-0000000${seq}`,
    code: `DEV-SKU-${seq}`,
    name: `개발용 상품 ${seq}`,
    barcode: `8800000${seq}`,
    holderId: index % 2 === 0 ? SEED_IDS.holderPrimary : SEED_IDS.holderSecondary,
    safetyStock: index % 5 === 0 ? 10 : 0,
  };
});
```

- [ ] **Step 2: 마스터 데이터 시드 구현**

`scripts/local/seed-dev-core/master-data.ts`:

```typescript
import { DbTx, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { SEED_IDS, SEED_RACK_LOCATIONS, SEED_SKUS } from './constants';

/** 순수 마스터 데이터라 도메인 서비스를 경유하지 않는다 — 정합성이 걸린 전이가 없다. */
export async function seedMasterData(tx: DbTx): Promise<void> {
  await tx.insert(wmsTables.warehouses).values([
    { id: SEED_IDS.warehouseBucheon, name: '부천 물류창고', type: 'domestic' },
    { id: SEED_IDS.warehouseChina, name: '중국 물류창고', type: 'overseas' },
  ]);

  await tx.insert(wmsTables.locations).values([
    { id: SEED_IDS.locBucheonReceiving, warehouseId: SEED_IDS.warehouseBucheon, code: 'RECEIVING_DEFAULT', locationType: 'zone', displayName: '입고기본존', isSystem: true, systemRole: 'inbound_default' },
    { id: SEED_IDS.locBucheonShipping, warehouseId: SEED_IDS.warehouseBucheon, code: 'SHIPPING_DEFAULT', locationType: 'zone', displayName: '출고기본존' },
    { id: SEED_IDS.locBucheonDamage, warehouseId: SEED_IDS.warehouseBucheon, code: 'DAMAGE_DEFAULT', locationType: 'zone', displayName: '불량기본존' },
    { id: SEED_IDS.locBucheonReturn, warehouseId: SEED_IDS.warehouseBucheon, code: 'RETURN_DEFAULT', locationType: 'zone', displayName: '반품기본존', isSystem: true, systemRole: 'return_default' },
    { id: SEED_IDS.locChinaReceiving, warehouseId: SEED_IDS.warehouseChina, code: 'RECEIVING_DEFAULT', locationType: 'zone', displayName: '입고기본존', isSystem: true, systemRole: 'inbound_default' },
    { id: SEED_IDS.locChinaShipping, warehouseId: SEED_IDS.warehouseChina, code: 'SHIPPING_DEFAULT', locationType: 'zone', displayName: '출고기본존' },
    { id: SEED_IDS.locChinaDamage, warehouseId: SEED_IDS.warehouseChina, code: 'DAMAGE_DEFAULT', locationType: 'zone', displayName: '불량기본존' },
    { id: SEED_IDS.locChinaReturn, warehouseId: SEED_IDS.warehouseChina, code: 'RETURN_DEFAULT', locationType: 'zone', displayName: '반품기본존', isSystem: true, systemRole: 'return_default' },
    ...SEED_RACK_LOCATIONS.map((rack) => ({
      id: rack.id,
      warehouseId: SEED_IDS.warehouseBucheon,
      code: rack.code,
      locationType: 'zone' as const,
      displayName: rack.displayName,
    })),
  ]);

  await tx.insert(wmsTables.settings).values([
    { warehouseId: SEED_IDS.warehouseBucheon, key: 'use_sub_barcode', value: 'true' },
    { warehouseId: SEED_IDS.warehouseBucheon, key: 'use_expiry_separation', value: 'false' },
    { warehouseId: SEED_IDS.warehouseChina, key: 'use_sub_barcode', value: 'true' },
    { warehouseId: SEED_IDS.warehouseChina, key: 'use_expiry_separation', value: 'false' },
  ]);

  await tx.insert(wmsTables.holders).values([
    { id: SEED_IDS.holderPrimary, name: '개발용 화주 A' },
    { id: SEED_IDS.holderSecondary, name: '개발용 화주 B' },
  ]);

  // shipment.plan 이 shippingProfileId 를 요구한다 (Task 9).
  await tx.insert(wmsTables.deliveryProfiles).values({
    id: SEED_IDS.deliveryProfile,
    name: '개발용 배송 프로필',
    sourceType: 'in_house',
    senderSnapshot: { name: '개발용 발송인', phone: '02-0000-0000' },
    originAddressSnapshot: { address: '부천 물류창고' },
    returnAddressSnapshot: { address: '부천 물류창고' },
    carrierAccountRef: 'dev-local',
    supportedFulfillmentModes: ['in_house'],
  });

  await tx.insert(wmsTables.skus).values(
    SEED_SKUS.map((sku) => ({
      id: sku.id,
      holderId: sku.holderId,
      name: sku.name,
      code: sku.code,
      safetyStock: sku.safetyStock,
      deliveryProfileId: SEED_IDS.deliveryProfile,
    })),
  );

  await tx.insert(wmsTables.skuBarcodes).values(
    SEED_SKUS.map((sku) => ({ skuId: sku.id, barcode: sku.barcode, isPrimary: true })),
  );
}
```

- [ ] **Step 3: 엔트리에 배선**

`scripts/local/seed-dev-core/index.ts` 의 `// 세계 생성은 Task 5 이후에 채운다.` 를 다음으로 교체한다:

```typescript
    await db.transaction(async (trx) => {
      await seedMasterData(trx as unknown as DbTx);
    });
```

파일 상단에 import 를 추가한다:

```typescript
import { DbTx } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { seedMasterData } from './master-data';
```

- [ ] **Step 4: 검증 assertion 추가**

`seed.integration.spec.ts` 의 마지막 `it` 뒤에 추가한다:

```typescript
  it('마스터 데이터가 결정론적으로 들어간다', async () => {
    const warehouses = await db.select().from(wmsTables.warehouses).orderBy(wmsTables.warehouses.name);
    expect(warehouses.map((w) => w.name)).toEqual(['부천 물류창고', '중국 물류창고']);

    const locations = await db.select().from(wmsTables.locations);
    expect(locations).toHaveLength(14); // 시스템 존 8 + 부천 랙 6

    const skus = await db.select().from(wmsTables.skus).orderBy(wmsTables.skus.code);
    expect(skus).toHaveLength(20);
    expect(skus[0].code).toBe('DEV-SKU-0001');

    const barcodes = await db.select().from(wmsTables.skuBarcodes).orderBy(wmsTables.skuBarcodes.barcode);
    expect(barcodes[0].barcode).toBe('88000000001');
  });
```

스펙 상단 import 에 `wmsTables` 를 추가한다:

```typescript
import { wmsSchema, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `SEED_DEV_CORE_URL=postgresql://postgres:postgres@localhost:5432/dev_core npx jest --runInBand scripts/local/seed-dev-core/seed.integration.spec.ts`
Expected: PASS — 2 passed. 바코드 assertion 이 틀리면 `SEED_SKUS` 의 `barcode` 조합 규칙(`8800000` + 4자리)을 실제 출력에 맞춰 상수와 테스트를 함께 맞춘다.

- [ ] **Step 6: 커밋**

```bash
git add scripts/local/seed-dev-core/constants.ts scripts/local/seed-dev-core/master-data.ts scripts/local/seed-dev-core/index.ts scripts/local/seed-dev-core/seed.integration.spec.ts
git commit -m "[local] dev_core 마스터 데이터 시드 (창고/로케이션/화주/SKU/바코드)"
```

---

### Task 6: 재고 시드

**Files:**
- Create: `scripts/local/seed-dev-core/stock.ts`
- Modify: `scripts/local/seed-dev-core/index.ts`
- Modify: `scripts/local/seed-dev-core/seed.integration.spec.ts`

**Interfaces:**
- Consumes: `SEED_IDS`, `SEED_SKUS`, `SEED_RACK_LOCATIONS` (Task 5)
- Produces: `seedStock(command: InventoryCommandService, tx: DbTx): Promise<void>`

**배경:** 재고는 `stock_events`(append-only) + `stock_ledgers`(투영)가 함께 움직여야 하므로 **반드시 `InventoryCommandService.receive` 를 경유**한다. 직접 insert 하면 앱이 거부하는 세계가 나온다.

- [ ] **Step 1: 실패하는 assertion 추가**

`seed.integration.spec.ts` 에 추가한다:

```typescript
  it('재고가 원장과 이벤트 양쪽에 정합하게 들어간다', async () => {
    const ledgers = await db
      .select({
        skuId: wmsTables.stockLedgers.skuId,
        qty: wmsTables.stockLedgers.qty,
        locationId: wmsTables.stockLedgers.locationId,
      })
      .from(wmsTables.stockLedgers)
      .where(eq(wmsTables.stockLedgers.stockState, 'ON_HAND'));

    // 재고 0 SKU 2건은 원장 행이 아예 없다.
    const skuIdsWithStock = new Set(ledgers.map((row) => row.skuId));
    expect(skuIdsWithStock.has(SEED_SKUS[0].id)).toBe(false);
    expect(skuIdsWithStock.has(SEED_SKUS[1].id)).toBe(false);
    expect(skuIdsWithStock.size).toBe(18);

    // 다중 로케이션 분산 SKU 는 원장 행이 2개 이상이다.
    const rowsForSpread = ledgers.filter((row) => row.skuId === SEED_SKUS[19].id);
    expect(rowsForSpread.length).toBeGreaterThan(1);

    // RECEIVE 이벤트 수 == 원장 행 수 (직접 insert 로 만들지 않았다는 증거)
    const receiveEvents = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(wmsTables.stockEvents)
      .where(eq(wmsTables.stockEvents.transitionType, 'RECEIVE'));
    expect(Number(receiveEvents[0].n)).toBe(ledgers.length);
  });
```

스펙 상단 import 에 `eq` 를 추가한다:

```typescript
import { eq, sql } from 'drizzle-orm';
import { SEED_SKUS } from './constants';
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `SEED_DEV_CORE_URL=postgresql://postgres:postgres@localhost:5432/dev_core npx jest --runInBand scripts/local/seed-dev-core/seed.integration.spec.ts`
Expected: FAIL — `expect(skuIdsWithStock.size).toBe(18)` 에서 `0`

- [ ] **Step 3: 재고 시드 구현**

`scripts/local/seed-dev-core/stock.ts`:

```typescript
import { InventoryCommandService } from '../../../apps/core/src/modules/inventory/core/services/inventory-command.service';
import { DbTx } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { SEED_IDS, SEED_RACK_LOCATIONS, SEED_SKUS } from './constants';

/**
 * 재고는 반드시 InventoryCommandService.receive 를 경유한다.
 * stock_events(원장) + stock_ledgers(투영) + 판매가능수량이 한 트랜잭션에서 함께 움직여야
 * 앱이 읽는 세계가 정합하다.
 *
 * 배치 규칙 (constants.ts 주석과 짝):
 *   index 0~1   → 재고 없음
 *   index 2~13  → 랙 1곳에 50개
 *   index 14~19 → 랙 2곳에 30 + 20개
 */
export async function seedStock(command: InventoryCommandService, tx: DbTx): Promise<void> {
  for (const [index, sku] of SEED_SKUS.entries()) {
    if (index < 2) continue;

    const placements =
      index < 14
        ? [{ location: SEED_RACK_LOCATIONS[index % SEED_RACK_LOCATIONS.length], quantity: 50 }]
        : [
            { location: SEED_RACK_LOCATIONS[index % SEED_RACK_LOCATIONS.length], quantity: 30 },
            { location: SEED_RACK_LOCATIONS[(index + 1) % SEED_RACK_LOCATIONS.length], quantity: 20 },
          ];

    for (const [placementIndex, placement] of placements.entries()) {
      await command.receive(
        {
          skuId: sku.id,
          toWarehouseId: SEED_IDS.warehouseBucheon,
          toLocationId: placement.location.id,
          quantity: placement.quantity,
          reason: 'DEV-SEED',
          // 결정론 규약 — 같은 리셋을 반복해도 같은 키가 나온다.
          idempotencyKey: `dev-seed-receive-${sku.code}-${placementIndex}`,
        },
        tx,
      );
    }
  }
}
```

- [ ] **Step 4: 엔트리에 배선**

`scripts/local/seed-dev-core/index.ts` 의 트랜잭션 블록을 다음으로 교체한다:

```typescript
    const wired = wireLogistics(makeDbService(db), 'v2');

    await db.transaction(async (trx) => {
      const tx = trx as unknown as DbTx;
      await seedMasterData(tx);
      await seedStock(wired.command, tx);
    });
```

import 를 추가한다:

```typescript
import { makeDbService, wireLogistics } from '../../../apps/core/src/modules/fulfillment/services/__support__';
import { seedStock } from './stock';
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `SEED_DEV_CORE_URL=postgresql://postgres:postgres@localhost:5432/dev_core npx jest --runInBand scripts/local/seed-dev-core/seed.integration.spec.ts`
Expected: PASS — 3 passed

- [ ] **Step 6: 커밋**

```bash
git add scripts/local/seed-dev-core/stock.ts scripts/local/seed-dev-core/index.ts scripts/local/seed-dev-core/seed.integration.spec.ts
git commit -m "[local] dev_core 재고 시드 (InventoryCommandService 경유)"
```

---

### Task 7: 입고 시드 (PO + inbound_plans)

**Files:**
- Create: `scripts/local/seed-dev-core/inbound.ts`
- Modify: `scripts/local/seed-dev-core/index.ts`
- Modify: `scripts/local/seed-dev-core/seed.integration.spec.ts`

**Interfaces:**
- Consumes: `SEED_IDS`, `SEED_SKUS` (Task 5)
- Produces: `seedInbound(tx: DbTx): Promise<void>`

**배경:** `inbound_plans.linked_purchase_order_id` 가 NOT NULL FK 라 발주(PO)가 선행돼야 한다. 컬럼 값의 정답 레퍼런스는 `apps/core/scripts/import-inbound-plans.ts:135-187` 과 `purchase-order.service.ts` 의 `createInboundPlanFromPO` 다.

- [ ] **Step 1: 실패하는 assertion 추가**

`seed.integration.spec.ts` 에 추가한다:

```typescript
  it('입고 계획이 상태별로 들어간다', async () => {
    const plans = await db
      .select({ status: wmsTables.inboundPlans.status, planType: wmsTables.inboundPlans.planType })
      .from(wmsTables.inboundPlans)
      .orderBy(wmsTables.inboundPlans.status);
    expect(plans).toHaveLength(3);
    expect(plans.map((p) => p.status).sort()).toEqual(['confirmed', 'pending', 'receiving']);

    const orders = await db.select().from(wmsTables.purchaseOrders);
    expect(orders).toHaveLength(2);

    const items = await db.select().from(wmsTables.inboundPlanItems);
    expect(items.length).toBeGreaterThanOrEqual(3);
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `SEED_DEV_CORE_URL=postgresql://postgres:postgres@localhost:5432/dev_core npx jest --runInBand scripts/local/seed-dev-core/seed.integration.spec.ts`
Expected: FAIL — `expect(plans).toHaveLength(3)` 에서 `0`

- [ ] **Step 3: 입고 시드 구현**

`scripts/local/seed-dev-core/inbound.ts`:

```typescript
import { DbTx, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { SEED_IDS, SEED_SKUS } from './constants';

/** 리셋마다 같은 날짜가 나오도록 고정한다 (결정론 규약). */
const EXPECTED_DATE = new Date('2026-08-01T00:00:00.000Z');

/**
 * 국내 PO 1건(부천 단일 plan) + 해외 PO 1건(중국 source → 부천 destination 2-plan).
 * 상태는 pending / receiving / confirmed 를 하나씩 만들어 Phase 2 화면이 세 갈래를 다 본다.
 */
export async function seedInbound(tx: DbTx): Promise<void> {
  const [domesticPo] = await tx
    .insert(wmsTables.purchaseOrders)
    .values({
      type: 'domestic',
      supplierId: null,
      sourceWarehouseId: SEED_IDS.warehouseBucheon,
      destinationWarehouseId: SEED_IDS.warehouseBucheon,
      requiresTransfer: false,
      expectedArrival: EXPECTED_DATE,
      status: 'confirmed',
      auditStatus: 'approved',
    })
    .returning();

  await tx.insert(wmsTables.purchaseOrderLines).values([
    { poId: domesticPo.id, skuId: SEED_SKUS[0].id, quantity: 40, unitPrice: null },
    { poId: domesticPo.id, skuId: SEED_SKUS[1].id, quantity: 25, unitPrice: null },
  ]);

  const [domesticPlan] = await tx
    .insert(wmsTables.inboundPlans)
    .values({
      warehouseId: SEED_IDS.warehouseBucheon,
      planType: 'destination',
      linkedPurchaseOrderId: domesticPo.id,
      destinationWarehouseId: SEED_IDS.warehouseBucheon,
      requiresTransfer: false,
      expectedDate: EXPECTED_DATE,
      status: 'pending',
    })
    .returning();

  await tx.insert(wmsTables.inboundPlanItems).values([
    { planId: domesticPlan.id, skuId: SEED_SKUS[0].id, expectedQty: 40, receivedQty: 0, status: 'pending' },
    { planId: domesticPlan.id, skuId: SEED_SKUS[1].id, expectedQty: 25, receivedQty: 0, status: 'pending' },
  ]);

  const [foreignPo] = await tx
    .insert(wmsTables.purchaseOrders)
    .values({
      type: 'foreign',
      supplierId: null,
      sourceWarehouseId: SEED_IDS.warehouseChina,
      destinationWarehouseId: SEED_IDS.warehouseBucheon,
      requiresTransfer: true,
      expectedArrival: EXPECTED_DATE,
      status: 'confirmed',
      auditStatus: 'approved',
    })
    .returning();

  await tx
    .insert(wmsTables.purchaseOrderLines)
    .values([{ poId: foreignPo.id, skuId: SEED_SKUS[2].id, quantity: 60, unitPrice: null }]);

  // source plan: 부분입고 중 (receiving)
  const [sourcePlan] = await tx
    .insert(wmsTables.inboundPlans)
    .values({
      warehouseId: SEED_IDS.warehouseChina,
      planType: 'source',
      linkedPurchaseOrderId: foreignPo.id,
      destinationWarehouseId: SEED_IDS.warehouseBucheon,
      requiresTransfer: true,
      expectedDate: EXPECTED_DATE,
      status: 'receiving',
    })
    .returning();

  await tx
    .insert(wmsTables.inboundPlanItems)
    .values([{ planId: sourcePlan.id, skuId: SEED_SKUS[2].id, expectedQty: 60, receivedQty: 20, status: 'receiving' }]);

  // destination plan: 입고 완료 (confirmed)
  const [destinationPlan] = await tx
    .insert(wmsTables.inboundPlans)
    .values({
      warehouseId: SEED_IDS.warehouseBucheon,
      planType: 'destination',
      parentPlanId: sourcePlan.id,
      linkedPurchaseOrderId: foreignPo.id,
      destinationWarehouseId: SEED_IDS.warehouseBucheon,
      requiresTransfer: false,
      expectedDate: null,
      status: 'confirmed',
    })
    .returning();

  await tx
    .insert(wmsTables.inboundPlanItems)
    .values([
      { planId: destinationPlan.id, skuId: SEED_SKUS[2].id, expectedQty: 60, receivedQty: 60, status: 'confirmed' },
    ]);
}
```

- [ ] **Step 4: 엔트리에 배선**

`index.ts` 의 트랜잭션 블록에 한 줄 추가한다 (`seedStock` 다음):

```typescript
      await seedInbound(tx);
```

import 추가:

```typescript
import { seedInbound } from './inbound';
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `SEED_DEV_CORE_URL=postgresql://postgres:postgres@localhost:5432/dev_core npx jest --runInBand scripts/local/seed-dev-core/seed.integration.spec.ts`
Expected: PASS — 4 passed.

`inbound_plan_items.status` 나 `purchase_orders.auditStatus` 에서 enum 값 오류가 나면 `apps/core/src/modules/inventory/schema/inventory.schema.ts` 의 해당 `pgEnum` 정의를 열어 실제 값으로 고친다.

- [ ] **Step 6: 커밋**

```bash
git add scripts/local/seed-dev-core/inbound.ts scripts/local/seed-dev-core/index.ts scripts/local/seed-dev-core/seed.integration.spec.ts
git commit -m "[local] dev_core 입고 시드 (PO 2건 + inbound plan 3건)"
```

---

### Task 8: 판매주문 + 상품매칭 + FO

**Files:**
- Create: `scripts/local/seed-dev-core/orders.ts`
- Modify: `scripts/local/seed-dev-core/index.ts`
- Modify: `scripts/local/seed-dev-core/seed.integration.spec.ts`

**Interfaces:**
- Consumes: `SEED_IDS`, `SEED_SKUS` (Task 5), `Wired` (Task 6 에서 이미 생성)
- Produces: `seedOrders(wired: Wired, tx: DbTx): Promise<string[]>` — 생성된 shipment id 목록을 Task 9 에 넘긴다

**배경:** SO/라인/매칭은 결정론이 필요하므로 직접 insert 하고, **FO 와 예약과 draft shipment 는 `FulfillmentsService.create` 로 만든다**. 이 경로가 FOI 수량 계산(`SO라인.qty × link.quantity`)과 예약을 함께 세운다.

- [ ] **Step 1: 실패하는 assertion 추가**

`seed.integration.spec.ts` 에 추가한다:

```typescript
  it('판매주문 10건이 FO 와 draft shipment 로 변환된다', async () => {
    const orders = await db.select().from(wmsTables.salesOrders).orderBy(wmsTables.salesOrders.channelOrderId);
    expect(orders).toHaveLength(10);
    expect(orders[0].channelOrderId).toBe('DEV-ORDER-0001');

    const fulfillmentOrders = await db.select().from(wmsTables.fulfillmentOrders);
    expect(fulfillmentOrders).toHaveLength(10);

    const items = await db.select().from(wmsTables.fulfillmentOrderItems);
    expect(items).toHaveLength(10);
    // 예약이 함께 섰는지 — 직접 insert 로는 만들 수 없는 상태다.
    expect(items.every((item) => item.reservedQty > 0)).toBe(true);

    const shipments = await db.select().from(wmsTables.shipments);
    expect(shipments).toHaveLength(10);
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `SEED_DEV_CORE_URL=postgresql://postgres:postgres@localhost:5432/dev_core npx jest --runInBand scripts/local/seed-dev-core/seed.integration.spec.ts`
Expected: FAIL — `expect(orders).toHaveLength(10)` 에서 `0`

- [ ] **Step 3: 주문 시드 구현**

`scripts/local/seed-dev-core/orders.ts`:

```typescript
import { eq } from 'drizzle-orm';
import type { Wired } from '../../../apps/core/src/modules/fulfillment/services/__support__';
import { DbTx, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { SEED_IDS, SEED_SKUS } from './constants';

const ORDER_COUNT = 10;

/** variant id 도 결정론 — 매칭 재현과 URL 안정성을 위해. */
function variantIdFor(index: number): string {
  const seq = String(index + 1).padStart(4, '0');
  return `019d0007-${seq}-7000-a000-0000000${seq}`;
}

/**
 * SO/라인/매칭은 결정론이 필요해 직접 insert 하고,
 * FO·예약·draft shipment 는 FulfillmentsService.create 가 만든다.
 * 재고가 있는 SKU(index 2 이상)만 쓴다 — 예약이 서야 하기 때문.
 */
export async function seedOrders(wired: Wired, tx: DbTx): Promise<string[]> {
  const shipmentIds: string[] = [];

  for (let index = 0; index < ORDER_COUNT; index += 1) {
    const sku = SEED_SKUS[index + 2];
    const variantId = variantIdFor(index);
    const quantity = (index % 3) + 1;
    const seq = String(index + 1).padStart(4, '0');

    const [salesOrder] = await tx
      .insert(wmsTables.salesOrders)
      .values({
        channelOrderId: `DEV-ORDER-${seq}`,
        salesChannel: 'medusa',
        status: 'confirmed',
        shippingAddress: {
          recipientName: `개발 수취인 ${seq}`,
          phone: '010-0000-0000',
          postalCode: '14547',
          roadAddress: '경기도 부천시 길주로 1',
          detailAddress: `${seq}호`,
        },
        orderDate: new Date('2026-07-20T00:00:00.000Z'),
      })
      .returning();

    await tx.insert(wmsTables.salesOrderLines).values({
      salesOrderId: salesOrder.id,
      variantId,
      productName: sku.name,
      quantity,
      unitPrice: 10_000,
      channelOrderItemId: `DEV-ITEM-${seq}`,
      channelProductId: `DEV-PRODUCT-${seq}`,
    });

    const [matching] = await tx
      .insert(wmsTables.productMatchings)
      .values({ variantId, status: 'matched', strategy: 'variant', isResolved: true, preStockSellable: true })
      .returning();
    await tx
      .insert(wmsTables.productVariantSkuLinks)
      .values({ productMatchingId: matching.id, skuId: sku.id, quantity: 1 });

    await wired.fulfillments.create({ salesOrderId: salesOrder.id, warehouseId: SEED_IDS.warehouseBucheon }, tx);

    // 방금 만든 SO 의 shipment 를 그래프로 되짚는다. shipments 테이블에는 salesOrderId 가 없고
    // shipment_lines → fulfillment_order_items → fulfillment_orders 로만 이어진다.
    // "마지막 행" 같은 순서 의존은 쓰지 않는다 — ORDER BY 없는 select 의 행 순서는 보장되지 않는다.
    const [shipment] = await tx
      .selectDistinct({ id: wmsTables.shipments.id })
      .from(wmsTables.shipments)
      .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrder.id));

    if (!shipment) {
      throw new Error(`[seed-dev-core] ${salesOrder.channelOrderId} 의 shipment 를 찾지 못했습니다`);
    }
    shipmentIds.push(shipment.id);
  }

  return shipmentIds;
}
```

- [ ] **Step 4: 엔트리에 배선**

`index.ts` 의 트랜잭션 블록을 다음으로 교체한다:

```typescript
    await db.transaction(async (trx) => {
      const tx = trx as unknown as DbTx;
      await seedMasterData(tx);
      await seedStock(wired.command, tx);
      await seedInbound(tx);
      await seedOrders(wired, tx);
    });
```

import 추가:

```typescript
import { seedOrders } from './orders';
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `SEED_DEV_CORE_URL=postgresql://postgres:postgres@localhost:5432/dev_core npx jest --runInBand scripts/local/seed-dev-core/seed.integration.spec.ts`
Expected: PASS — 5 passed.

`fulfillments.create` 가 `PRODUCT_SKU_MATCHING_REQUIRED` 로 실패하면 `productMatchings`/`productVariantSkuLinks` 삽입이 create 보다 **먼저** 일어났는지 확인한다. `FULFILLMENT_V2_CUTOVER_AT` 관련 실패는 `wireLogistics` 가 epoch 을 박아두므로 발생하지 않아야 한다.

- [ ] **Step 6: 커밋**

```bash
git add scripts/local/seed-dev-core/orders.ts scripts/local/seed-dev-core/index.ts scripts/local/seed-dev-core/seed.integration.spec.ts
git commit -m "[local] dev_core 판매주문·매칭·FO 시드"
```

---

### Task 9: shipment 를 `planned` 로 전이

**Files:**
- Create: `scripts/local/seed-dev-core/shipments.ts`
- Modify: `scripts/local/seed-dev-core/index.ts`
- Modify: `scripts/local/seed-dev-core/seed.integration.spec.ts`

**Interfaces:**
- Consumes: Task 8 의 shipment id 목록, `SEED_IDS.deliveryProfile`
- Produces: `planShipments(planning: ShipmentPlanningService, shipmentIds: string[], tx: DbTx): Promise<void>`

**배경:** 스펙 §7.5 — 시드는 `draft` 와 `planned`(피킹 대기)까지만 만든다. 피킹 중·출고완료·short-pick 은 batch custody + 운송장 + dispatch 와이어링이 필요한 Phase 4 표면이고, 그 전이를 만드는 것이 앱 개발의 목적이라 시드가 선점하지 않는다.

`ShipmentPlanningService` 는 `wireLogistics` 의 `Wired` 에 없으므로 이 Task 가 직접 조립한다.

- [ ] **Step 1: 실패하는 assertion 추가**

`seed.integration.spec.ts` 에 추가한다:

```typescript
  it('shipment 절반은 draft, 절반은 planned 로 남는다', async () => {
    const shipments = await db.select({ status: wmsTables.shipments.status }).from(wmsTables.shipments);
    const byStatus = shipments.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});
    expect(byStatus).toEqual({ draft: 5, planned: 5 });
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `SEED_DEV_CORE_URL=postgresql://postgres:postgres@localhost:5432/dev_core npx jest --runInBand scripts/local/seed-dev-core/seed.integration.spec.ts`
Expected: FAIL — `{ draft: 10 }` 이 나온다

- [ ] **Step 3: 참조 구현 확인**

Read: `apps/core/src/modules/fulfillment/services/outbound-v2-scenarios.integration.spec.ts:461-476` (`planShipment` 헬퍼)

`planning.plan(shipmentId, { shippingProfileId, expectedManifestVersion, expectedReservationVersion }, idempotencyKey, actor, tx)` 호출 형태를 그대로 따른다.

- [ ] **Step 4: shipment 전이 구현**

`scripts/local/seed-dev-core/shipments.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { ShipmentPlanningService } from '../../../apps/core/src/modules/fulfillment/services/shipment-planning.service';
import { DbTx, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { SEED_IDS } from './constants';

/**
 * 시드 작업자 신원. core 는 operator_id 에 FK 를 걸지 않으므로 (스펙 §4.4)
 * 고정 UUID 를 써도 무방하고, 결정론 규약상 그래야 한다.
 */
export const SEED_ACTOR = { id: '019d0008-0001-7000-a000-000000000001', roles: ['master'] };

/** 앞쪽 절반만 planned 로 올려 draft/planned 두 상태를 모두 남긴다. */
export async function planShipments(
  planning: ShipmentPlanningService,
  shipmentIds: string[],
  tx: DbTx,
): Promise<void> {
  const target = shipmentIds.slice(0, Math.floor(shipmentIds.length / 2));

  for (const [index, shipmentId] of target.entries()) {
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
    await planning.plan(
      shipmentId,
      {
        shippingProfileId: SEED_IDS.deliveryProfile,
        expectedManifestVersion: shipment.manifestVersion,
        expectedReservationVersion: shipment.reservationVersion,
      },
      `dev-seed-plan-${String(index + 1).padStart(4, '0')}`,
      SEED_ACTOR,
      tx,
    );
  }
}
```

- [ ] **Step 5: 확장 와이어링을 엔트리에 추가**

`ShipmentPlanningService` 는 `wireLogistics` 밖이라 직접 조립한다. 생성자는
`(dbService, commands, shipmentReservations, invariant, audit, scopes, workflow)` 7 인자다
(`outbound-v2-scenarios.integration.spec.ts:95-103` 과 동일).

`index.ts` 의 `const wired = …` 아래에 추가한다:

```typescript
    const dbService = makeDbService(db);
    const planning = new ShipmentPlanningService(
      dbService,
      new FulfillmentCommandService(dbService),
      wired.shipmentReservations,
      new FulfillmentInvariantService(),
      new AuditService(dbService),
      // plan() 경로는 scope 를 보지 않지만 생성자가 요구한다. 시드 액터는 master 이므로
      // 전 scope 를 가진 stub 으로 채운다 (통합 스펙과 동일한 관용구).
      { getScopesByRoles: () => Promise.resolve(new Set(FULFILLMENT_SCOPES.map((scope) => scope.key))) } as never,
      new FulfillmentWorkflowGate(
        new ConfigService({
          FULFILLMENT_WORKFLOW_MODE: 'v2',
          FULFILLMENT_V2_CUTOVER_AT: '1970-01-01T00:00:00.000Z',
        }),
      ),
    );
```

`const wired = wireLogistics(makeDbService(db), 'v2')` 는 `wireLogistics(dbService, 'v2')` 로 바꿔 `dbService` 를 한 번만 만든다.

import 를 추가한다:

```typescript
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../../apps/core/src/modules/inventory/shared/services/audit.service';
import { FulfillmentCommandService } from '../../../apps/core/src/modules/fulfillment/services/fulfillment-command.service';
import { FulfillmentInvariantService } from '../../../apps/core/src/modules/fulfillment/services/fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from '../../../apps/core/src/modules/fulfillment/services/fulfillment-workflow-gate.service';
import { ShipmentPlanningService } from '../../../apps/core/src/modules/fulfillment/services/shipment-planning.service';
import { FULFILLMENT_SCOPES } from '../../../apps/core/src/platform/auth/fulfillment-scopes';
```

트랜잭션 블록 마지막에 추가:

```typescript
      const shipmentIds = await seedOrders(wired, tx);
      await planShipments(planning, shipmentIds, tx);
```

import 추가:

```typescript
import { planShipments } from './shipments';
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `SEED_DEV_CORE_URL=postgresql://postgres:postgres@localhost:5432/dev_core npx jest --runInBand scripts/local/seed-dev-core/seed.integration.spec.ts`
Expected: PASS — 6 passed

- [ ] **Step 7: 커밋**

```bash
git add scripts/local/seed-dev-core/shipments.ts scripts/local/seed-dev-core/index.ts scripts/local/seed-dev-core/seed.integration.spec.ts
git commit -m "[local] dev_core shipment planned 전이"
```

---

### Task 10: `--bulk` 대량 데이터

**Files:**
- Create: `scripts/local/seed-dev-core/bulk.ts`
- Modify: `scripts/local/seed-dev-core/index.ts`
- Modify: `scripts/local/seed-dev-core/seed.integration.spec.ts`

**Interfaces:**
- Consumes: `SEED_IDS` (Task 5)
- Produces: `seedBulk(tx: DbTx): Promise<void>` — SKU +300, 로케이션 +50

**배경:** 재고조회가 서버 페이지네이션 표라 규모가 있어야 페이지네이션·검색·정렬의 실제 감각이 나온다. 평소 리셋은 소형으로 빠르게 돌린다.

- [ ] **Step 1: 실패하는 테스트 작성**

`seed.integration.spec.ts` 맨 아래에 별도 describe 를 추가한다:

```typescript
describeIfSeedDb('dev_core 시드 --bulk', () => {
  jest.setTimeout(600_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    execFileSync(
      'npx',
      [
        'ts-node',
        '-r',
        'tsconfig-paths/register',
        '--transpile-only',
        'scripts/local/seed-dev-core/index.ts',
        '--bulk',
      ],
      { stdio: 'inherit', env: { ...process.env, SEED_DEV_CORE_URL: SEED_URL } },
    );
    client = postgres(SEED_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });

  afterAll(async () => {
    await client?.end();
  });

  it('SKU 320건 · 로케이션 64건이 된다', async () => {
    const skus = await db.select({ n: sql<number>`count(*)::int` }).from(wmsTables.skus);
    expect(Number(skus[0].n)).toBe(320);

    const locations = await db.select({ n: sql<number>`count(*)::int` }).from(wmsTables.locations);
    expect(Number(locations[0].n)).toBe(64);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `SEED_DEV_CORE_URL=postgresql://postgres:postgres@localhost:5432/dev_core npx jest --runInBand scripts/local/seed-dev-core/seed.integration.spec.ts -t "--bulk"`
Expected: FAIL — `expect(320)` 에서 `20`

- [ ] **Step 3: 대량 시드 구현**

`scripts/local/seed-dev-core/bulk.ts`:

```typescript
import { DbTx, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { SEED_IDS } from './constants';

const BULK_SKU_COUNT = 300;
const BULK_LOCATION_COUNT = 50;

/**
 * 페이지네이션·검색 체감용. 결정론 규약을 따르되 기본 시드와 코드 공간을 분리한다
 * (`BULK-SKU-` 접두). 재고는 붙이지 않는다 — 목록 규모만 필요하고,
 * 300건에 receive 를 태우면 리셋이 눈에 띄게 느려진다.
 */
export async function seedBulk(tx: DbTx): Promise<void> {
  const locations = Array.from({ length: BULK_LOCATION_COUNT }, (_, index) => {
    const seq = String(index + 1).padStart(3, '0');
    return {
      warehouseId: SEED_IDS.warehouseBucheon,
      code: `B-${seq}`,
      locationType: 'zone' as const,
      displayName: `벌크 로케이션 ${seq}`,
    };
  });
  await tx.insert(wmsTables.locations).values(locations);

  const skus = Array.from({ length: BULK_SKU_COUNT }, (_, index) => {
    const seq = String(index + 1).padStart(4, '0');
    return {
      holderId: index % 2 === 0 ? SEED_IDS.holderPrimary : SEED_IDS.holderSecondary,
      name: `벌크 상품 ${seq}`,
      code: `BULK-SKU-${seq}`,
      safetyStock: 0,
      deliveryProfileId: SEED_IDS.deliveryProfile,
    };
  });
  const inserted = await tx.insert(wmsTables.skus).values(skus).returning({ id: wmsTables.skus.id, code: wmsTables.skus.code });

  await tx.insert(wmsTables.skuBarcodes).values(
    inserted.map((sku) => ({
      skuId: sku.id,
      barcode: `881${sku.code.replace('BULK-SKU-', '').padStart(8, '0')}`,
      isPrimary: true,
    })),
  );
}
```

- [ ] **Step 4: 엔트리에 배선**

`index.ts` 의 트랜잭션 블록 마지막에 추가한다:

```typescript
      if (bulk) {
        await seedBulk(tx);
      }
```

import 추가:

```typescript
import { seedBulk } from './bulk';
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `SEED_DEV_CORE_URL=postgresql://postgres:postgres@localhost:5432/dev_core npx jest --runInBand scripts/local/seed-dev-core/seed.integration.spec.ts`
Expected: PASS — 7 passed (기본 6 + bulk 1)

- [ ] **Step 6: 기본 리셋으로 되돌려 놓기**

Run: `npm run dev:core:reset`
Expected: 소형 세계로 복귀. 이후 수동 개발은 이 상태에서 한다.

- [ ] **Step 7: 커밋**

```bash
git add scripts/local/seed-dev-core/bulk.ts scripts/local/seed-dev-core/index.ts scripts/local/seed-dev-core/seed.integration.spec.ts
git commit -m "[local] dev_core --bulk 대량 시드"
```

---

### Task 11: `apps/core/.env` + 템플릿 — core 로컬 기동

**Files:**
- Create: `env-templates/.env.core.local.example`
- Create: `apps/core/.env` (gitignore 대상 — 커밋하지 않는다)

**Interfaces:**
- Produces: core 가 `:3100` 에서 `dev_core` 를 보고 기동하는 상태

- [ ] **Step 1: 템플릿 작성**

`env-templates/.env.core.local.example`:

```dotenv
# 로컬 core 단독 개발용 템플릿. apps/core/.env 로 복사해 <> 부분을 채운다.
# 설계: docs/superpowers/specs/2026-07-23-local-core-dev-environment-design.md

PORT=3100
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dev_core

# 로컬 compose 브로커. API 키를 넣지 않아 라이브 Confluent 접속 자체가 불가능하다.
# 브로커가 없으면 core 는 부팅하지 않는다 — 끄는 게 아니라 격리하는 것이다.
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID_PREFIX=core-local
KAFKA_GROUP_ID=core-local-<사용자>

FULFILLMENT_WORKFLOW_MODE=v2
FULFILLMENT_V2_CUTOVER_AT=1970-01-01T00:00:00.000Z

OIDC_ISSUER_URL=https://user.almondyoung.com
AUTH_SECRET=<로컬 전용 임의값 — generate:token 으로 HS256 디버그 토큰 발급용>

# 아래는 의도적으로 비운다 (라이브 부작용 차단):
# WALLET_BASE_URL / WALLET_API_KEY / FILE_SERVICE_URL / HANJIN_* / ELASTICSEARCH_*
```

- [ ] **Step 2: 실제 `.env` 작성**

Run:
```bash
cp env-templates/.env.core.local.example apps/core/.env
```

그 다음 `apps/core/.env` 를 열어 `KAFKA_GROUP_ID` 의 `<사용자>` 를 실제 값(예: `pauseb`)으로, `AUTH_SECRET` 을 임의 문자열로 바꾼다.

- [ ] **Step 3: 커밋 대상이 아닌지 확인**

Run: `git status --short apps/core/.env`
Expected: 출력 없음 (`.gitignore` 의 `/**/*.env` 가 잡는다). 출력이 있으면 커밋하지 말고 `.gitignore` 를 먼저 고친다.

- [ ] **Step 4: core 기동**

Run:
```bash
npm run start:main:dev
```
Expected: 부팅 로그에 `Scope initialization complete` 와 `Almondyoung server running on 0.0.0.0:3100`. Kafka 연결 오류가 없어야 한다.

- [ ] **Step 5: 인증 없이도 뜨는지 확인**

다른 터미널에서 Run:
```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3100/health
```
Expected: `200`

- [ ] **Step 6: 시드 데이터가 API 로 보이는지 확인**

Run:
```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3100/inventory/skus/search/advanced
```
Expected: `401` (인증 가드가 살아있다는 뜻). 앱 로그인 후 실제 데이터 확인은 Task 12 에서 한다.

- [ ] **Step 7: 템플릿만 커밋**

```bash
git add env-templates/.env.core.local.example
git commit -m "[local] core 로컬 개발 env 템플릿"
```

---

### Task 12: warehouse-app 을 로컬 core 로 전환

**Files:**
- Modify: `native/warehouse-app/.env.local` (gitignore 대상)
- Modify: `native/warehouse-app/.env.local.example`
- Modify: `native/warehouse-app/package.json`

**Interfaces:**
- Produces: `npm run tauri:dev` (로컬 core) / `npm run tauri:dev:live` (라이브 core)

**배경:** Vite 는 `.env` 파일을 파싱한 뒤 셸의 `VITE_*` 로 덮어쓴다(`vite/dist/node/chunks/node.js:5697`). 파일 하나만 두고 셸 env 로 전환한다.

- [ ] **Step 1: `.env.local.example` 갱신**

`native/warehouse-app/.env.local.example` 을 다음으로 교체한다:

```dotenv
# OIDC 는 로컬/라이브 어느 core 를 보든 항상 라이브 user-service 를 쓴다.
VITE_OIDC_ISSUER=https://<user-service-issuer>
VITE_OIDC_AUTHORIZE=https://<auth-web>/oauth/authorize
VITE_OIDC_CLIENT_ID=warehouse-app

# 기본은 로컬 core (docs/local-dev.md 의 포트맵 기준 3100).
# 라이브로 붙으려면 셸에서 덮어쓴다 — Vite 가 process.env 의 VITE_* 를 파일보다 우선한다:
#   VITE_API_BASE_URL=https://core.almondyoung.com npm run tauri:dev
# 안드로이드/타 기기에서는 localhost 가 아니라 LAN/Tailscale IP 를 쓴다:
#   VITE_API_BASE_URL=http://<tailscale-ip>:3100 npm run tauri:dev
VITE_API_BASE_URL=http://localhost:3100
```

- [ ] **Step 2: `.env.local` 갱신**

`native/warehouse-app/.env.local` 의 `VITE_API_BASE_URL` 한 줄만 바꾼다:

```dotenv
VITE_API_BASE_URL=http://localhost:3100
```

`VITE_OIDC_*` 3줄과 `VITE_HTTP_DEBUG` 는 건드리지 않는다.

- [ ] **Step 3: npm script 추가**

`native/warehouse-app/package.json` 의 `"scripts"` 에 추가한다:

```json
    "tauri:dev": "tauri dev",
    "tauri:dev:live": "cross-env VITE_API_BASE_URL=https://core.almondyoung.com tauri dev",
```

`cross-env` 가 devDependencies 에 없으면 설치한다:

Run: `cd native/warehouse-app && npm install -D cross-env`

- [ ] **Step 4: 로컬 core 를 보는지 확인**

core 가 떠 있는 상태에서 Run:
```bash
cd native/warehouse-app && npm run tauri:dev
```
Expected: 앱이 뜨고 로그인(라이브 OIDC) 후 `/inventory` 표에 **`DEV-SKU-0001` 등 시드 SKU 20건**이 보인다. `VITE_HTTP_DEBUG=true` 라 콘솔에 `http://localhost:3100/...` 요청이 찍힌다.

- [ ] **Step 5: 라이브 전환이 되는지 확인**

Run:
```bash
cd native/warehouse-app && npm run tauri:dev:live
```
Expected: 콘솔 요청 URL 이 `https://core.almondyoung.com/...` 로 바뀌고 라이브 SKU 가 보인다.

- [ ] **Step 6: 토큰 role 확인**

앱에서 로그인한 뒤 개발자 콘솔에서 access token 의 payload 를 디코드해 `roles` claim 을 확인한다.

Expected: `logistics_worker` 또는 `logistics_manager` 또는 `master` 중 하나가 있어야 Phase 3(피킹) 이 403 없이 진행된다. 없으면 **라이브 user-service 에서 역할 부여가 선행돼야 한다** — 이 구성에서 유일한 라이브 데이터 쓰기다 (스펙 §4.3). 지금 단계(Phase 1·2, inventory 모듈)는 role 없이도 동작하므로 여기서 막히지 않는다.

- [ ] **Step 7: 커밋**

```bash
git add native/warehouse-app/.env.local.example native/warehouse-app/package.json native/warehouse-app/package-lock.json
git commit -m "[warehouse-app] 기본 API 대상을 로컬 core 로 전환 + 라이브 전환 스크립트"
```

---

### Task 13: 문서화 + 종단 스모크

**Files:**
- Modify: `docs/local-dev.md`

**Interfaces:**
- Consumes: Task 1~12 전부
- Produces: 다음 사람이 이 환경을 재현할 수 있는 문서

- [ ] **Step 1: `docs/local-dev.md` 에 섹션 추가**

"## 물류 통합 테스트 (jest, 로컬 DB)" 섹션 **앞에** 다음을 넣는다:

````markdown
## core 단독 개발 + `dev_core` 시드

warehouse-app 등 클라이언트 개발용으로 core 만 로컬에 띄우고, 전용 논리 DB `dev_core` 를
한 명령으로 밀고 다시 시딩한다. 통합테스트·`refresh-from-live.sh` 가 쓰는 `core` 와 분리돼 있어
서로를 오염시키지 않는다. 설계 근거: `docs/superpowers/specs/2026-07-23-local-core-dev-environment-design.md`

```bash
docker compose up -d                 # postgres + kafka + zookeeper (kafka 없으면 core 가 안 뜬다)
cp env-templates/.env.core.local.example apps/core/.env   # <사용자>/<임의값> 채우기
npm run dev:core:reset               # drop → create → migrate → 스코프 → 시드
npm run dev:core:reset -- --bulk     # SKU +300 · 로케이션 +50 (페이지네이션 체감용)
npm run start:main:dev               # core :3100
```

- **Kafka 는 끌 수 없다.** `main.ts` 가 조건 없이 `startAllMicroservices()` 를 부르므로 브로커에
  못 붙으면 부팅이 실패한다. compose 브로커로 **격리**하는 것이지 비활성화하는 게 아니다.
  `KAFKA_API_KEY/SECRET` 를 넣지 않아 라이브 Confluent 접속은 애초에 불가능하다.
- **user-service 는 라이브를 쓴다.** core 가 `OIDC_ISSUER_URL` 로 JWKS 검증만 하므로 그대로 통과한다.
  단 피킹·출고(fulfillment) 엔드포인트는 `logistics_worker`/`logistics_manager`/`master` 역할이 필요하다.
  재고조회·실사·이동·입고(inventory 모듈)는 scope 게이트가 없어 로그인만 되면 동작한다.
- 시드는 결정론적이다. SKU 코드 `DEV-SKU-0001…`, 바코드 `88000000001…`, 주문번호 `DEV-ORDER-0001…`
  이 리셋해도 그대로라 종이에 적어두고 스캔 테스트에 쓸 수 있다.
- warehouse-app 은 기본이 로컬 core 다. 라이브로 붙으려면
  `cd native/warehouse-app && npm run tauri:dev:live`.
````

- [ ] **Step 2: "아직 로컬화 안 된 것" 의 시드 항목 갱신**

같은 문서의 아래 항목을

```markdown
- **reference/demo 시드** (`db:seed:ref`, `db:seed:demo`): `sst shell` 의 `Resource.Db` 에 의존해서 로컬 postgres 에 못 쓴다.
  당장 필요하면 기존 DB 에서 `pg_dump --data-only` 로 가져올 것. 자주 필요해지면 `scripts/seeding/lib/db-connection.ts` 에 `DATABASE_URL` fallback 추가.
```

다음으로 교체한다:

```markdown
- **reference/demo 시드** (`db:seed:ref`, `db:seed:demo`): `sst shell` 의 `Resource.Db` 에 의존해서 로컬 postgres 에 못 쓴다.
  core 개발용 시드는 위 "core 단독 개발 + `dev_core` 시드" 로 대체됐다. 다른 서비스(wallet/membership 등)의
  로컬 시드가 필요해지면 `scripts/seeding/lib/db-connection.ts` 에 `DATABASE_URL` fallback 을 추가한다.
```

- [ ] **Step 3: 종단 스모크 — 처음부터 끝까지**

Run:
```bash
docker compose ps --format '{{.Service}}\t{{.State}}'
```
Expected: postgres · kafka · zookeeper · redis 모두 `running`

Run:
```bash
npm run dev:core:reset
```
Expected: 4단계 로그 후 `✅ dev_core 리셋 완료`

core 를 띄운 채 한 번 더 Run:
```bash
npm run dev:core:reset
```
Expected: 성공. 이후 앱에서 재고조회가 **403 없이** 동작한다 (스코프 부트스트랩 검증).

- [ ] **Step 4: outbox 드레인 확인**

앱에서 쓰기 워크플로우를 한 번 태운 뒤 Run:
```bash
docker compose exec -T postgres psql -U postgres -d dev_core -c "SELECT status, count(*) FROM event.outbox_events GROUP BY status"
```
Expected: `pending` 이 쌓여 있지 않다. 쌓인다면 브로커 연결이 실패한 것이므로 core 로그의 Kafka 오류를 본다.

테이블/스키마 이름이 다르면 Run: `docker compose exec -T postgres psql -U postgres -d dev_core -c "\dt event.*"` 로 실제 이름을 확인해 명령을 고친다.

- [ ] **Step 5: 전체 유닛 테스트 회귀 확인**

Run: `npx jest scripts/local`
Expected: guard 6 passed. 통합 스펙은 `SEED_DEV_CORE_URL` 이 없어 skip 된다 — **skip 되는 게 정상**이다.

- [ ] **Step 6: 커밋**

```bash
git add docs/local-dev.md
git commit -m "[docs] local-dev 에 core 단독 개발 + dev_core 시드 절차 추가"
```

---

## 완료 기준

- `npm run dev:core:reset` 이 10초 내외로 끝나고, 같은 결과가 반복 재현된다.
- core 를 watch 로 띄운 채 리셋해도 403 이 나지 않는다.
- warehouse-app 이 기본으로 로컬 core 를 보고, `tauri:dev:live` 로 라이브 전환된다.
- `npx jest scripts/local` 이 통과하고, DB 없는 환경에서는 통합 스펙이 skip 된다.
- `docs/local-dev.md` 만 읽고 새 머신에서 이 환경을 재현할 수 있다.

## 알려진 위험

- **Task 9 의 `ShipmentPlanningService` 조립**이 이 계획에서 가장 깨지기 쉽다. 생성자 인자는 `outbound-v2-scenarios.integration.spec.ts:95-103` 기준으로 적어뒀지만, 그 사이 인자가 바뀌었다면 추정하지 말고 그 파일을 다시 읽는다. 조립이 과하게 번지면 shipment 를 `draft` 로만 두고 Task 9 를 후속으로 미루는 것도 허용된다 — 그 경우 스펙 §7.5 와 `seed.integration.spec.ts` 의 상태 기대값을 함께 고친다.
- **Task 7 의 enum 값**(`purchase_orders.auditStatus`, `inbound_plan_items.status`)은 스키마에서 재확인이 필요할 수 있다. 실패 시 추측하지 말고 `inventory.schema.ts` 의 `pgEnum` 정의를 연다.
- `wireLogistics` 는 통합테스트가 유지하는 수동 DI 다. 서비스 생성자가 바뀌면 시드도 같이 깨지지만, 통합테스트가 먼저 알려준다.
