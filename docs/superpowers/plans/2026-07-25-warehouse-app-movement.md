# 재고 이동(로케이션↔로케이션) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 물류 현장 앱의 `/movement` 스텁을 로케이션 우선 재고 이동 워크플로우로 교체하고, 이를 뒷받침할 로케이션 내용물 조회 엔드포인트를 백엔드에 추가한다.

**Architecture:** 이동 자체는 기존 `POST /movement/move`(동일 창고 배치, 라인 1개)를 재사용한다. 유일한 백엔드 공백인 "로케이션 내용물 조회"는 `GET /inventory/stocks/location/:locationId` additive read 로 채운다. 프론트는 출발지 스캔 → 내용물(ON_HAND) → 품목별 단건 이동 + 직전 도착지 재사용의 화면 내 상태기계이며, Phase 1 의 훅/컴포넌트/테스트 패턴을 그대로 복제한다.

**Tech Stack:** NestJS + Drizzle ORM(postgres.js) (apps/core) · React 19 + TanStack Query/Router + Tailwind + Vitest/Testing Library (native/warehouse-app, Tauri 웹뷰).

## Global Constraints

- 상위 스펙: `docs/superpowers/specs/2026-07-25-warehouse-app-movement-design.md` — 결정/문구/범위의 단일 출처.
- 백엔드는 **전부 additive** — 스키마 변경 0 · 마이그레이션 0 · 기존 응답 필드 제거 0.
- 백엔드 inventory 규칙(CLAUDE.md): `trx.select().from().innerJoin().where().orderBy()`(Drizzle 연산자), `db.query.*`·`with` 관계·`any`/`as` 금지, `@InjectTypedDb<typeof wmsSchema>()`, `dbService.run(fn, tx)` 단일 러너. 서비스는 `@app/shared` 도메인 예외(`NotFoundError`)를 던지고 컨트롤러는 try/catch 하지 않는다. 중첩 DTO 는 별도 클래스, `@ApiProperty({ type: 'object' })` 금지.
- 프론트 데이터훅 규약(Phase 1): react-query key = 파라미터 튜플, `api.request<T>({ path })`, URL 상태 없이 로컬 `useState`, mutation 성공 시 관련 key 무효화.
- 이동 = `ON_HAND → ON_HAND` 고정. 화면은 ON_HAND 행만 이동 대상으로 노출.
- 검증 게이트: `nest build core` exit 0 · `npm test`(warehouse-app vitest) 전량 green · oxlint 신규 error 0(변경 파일 스코프). 백엔드 통합 스펙은 `DATABASE_URL` 있을 때만 실행(없으면 auto-skip, Phase 1 과 동일 취급).
- 작업 디렉터리: 백엔드 명령은 리포 루트, 프론트 명령은 `native/warehouse-app`.

---

### Task 1: 백엔드 — 로케이션 내용물 조회 엔드포인트

**Files:**
- Create: `apps/core/src/modules/inventory/stock-projection/dto/location-contents.dto.ts`
- Modify: `apps/core/src/modules/inventory/stock-projection/services/stock-projection.reader.ts` (import + `getLocationContents` 메서드 추가, reader.ts:205 `getBySkuAndWarehouse` 뒤)
- Modify: `apps/core/src/modules/inventory/stock-projection/services/stock-projection.service.ts` (delegation 추가)
- Modify: `apps/core/src/modules/inventory/stock-projection/controllers/stock-projection.controller.ts` (route + import 추가)
- Test: `apps/core/src/modules/inventory/stock-projection/services/stock-projection-by-location.integration.spec.ts` (기존 파일에 describe 추가)

**Interfaces:**
- Produces:
  - `class LocationContentItemDto { skuId: string; skuCode: string; skuName: string; stockState: string; quantity: number }`
  - `class LocationContentsDto { locationId: string; locationCode: string; warehouseId: string; items: LocationContentItemDto[] }`
  - `StockProjectionReader.getLocationContents(locationId: string, tx?: DbTx): Promise<LocationContentsDto>`
  - `StockProjectionService.getLocationContents(locationId: string, tx?: DbTx)`
  - HTTP `GET /inventory/stocks/location/:locationId` → `LocationContentsDto`
- Consumes: `wmsTables.locations`(`id`·`code`·`warehouseId` 모두 notNull), `wmsTables.stockLedgers`(`skuId`·`locationId`·`stockState`·`qty`), `wmsTables.skus`(`code`·`name` notNull), `NotFoundError`(`@app/shared`), `DbTx`/`wmsTables`(inventory.schema), `dbService.run`.

- [ ] **Step 1: DTO 파일 작성**

Create `apps/core/src/modules/inventory/stock-projection/dto/location-contents.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

export class LocationContentItemDto {
  @ApiProperty()
  skuId: string;

  @ApiProperty()
  skuCode: string;

  @ApiProperty()
  skuName: string;

  @ApiProperty({ description: 'ON_HAND | DEFECTIVE | IN_TRANSFER' })
  stockState: string;

  @ApiProperty()
  quantity: number;
}

export class LocationContentsDto {
  @ApiProperty()
  locationId: string;

  @ApiProperty()
  locationCode: string;

  @ApiProperty()
  warehouseId: string;

  @ApiProperty({ type: [LocationContentItemDto] })
  items: LocationContentItemDto[];
}
```

- [ ] **Step 2: 통합 스펙 작성 (실패 대신 auto-skip; DATABASE_URL 있으면 실행)**

기존 `stock-projection-by-location.integration.spec.ts` 상단 import 에 `NotFoundError` 를 추가한다:

```ts
import { NotFoundError } from '@app/shared';
```

그리고 파일 맨 끝(마지막 `});` 다음 줄, describeIfDb 블록 안이 아니라 새 describeIfDb 블록으로) 아래 describe 를 추가한다. `describeIfDb`·`inRollbackTx`·`seedEntities`·`reader`·`randomUUID`·`wmsTables` 는 파일 상단에 이미 있으므로 재사용한다:

```ts
describeIfDb('getLocationContents (DB integration, rollback-only)', () => {
  it('로케이션 내용물을 skuCode 오름차순으로, 조인된 코드·이름과 함께 반환한다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, locA } = await seedEntities(tx);
      const [holderX] = await tx
        .insert(wmsTables.holders)
        .values({ name: `it-hx-${randomUUID().slice(0, 8)}` })
        .returning();
      // 4번째 문자 'A' < 'Z' 라 접미 uuid 와 무관하게 skuLo.code < skuHi.code 가 확정된다.
      const [skuLo] = await tx
        .insert(wmsTables.skus)
        .values({ name: 'lo', code: `IT-A-${randomUUID()}`, holderId: holderX.id })
        .returning();
      const [skuHi] = await tx
        .insert(wmsTables.skus)
        .values({ name: 'hi', code: `IT-Z-${randomUUID()}`, holderId: holderX.id })
        .returning();
      // 기대 출력과 반대 순서로 삽입해 정렬이 실제로 적용되는지 본다.
      await tx.insert(wmsTables.stockLedgers).values([
        { skuId: skuHi.id, warehouseId: warehouse.id, locationId: locA.id, stockState: 'ON_HAND', qty: 4 },
        { skuId: skuLo.id, warehouseId: warehouse.id, locationId: locA.id, stockState: 'ON_HAND', qty: 9 },
      ]);

      const result = await reader.getLocationContents(locA.id, tx);

      expect(result.locationId).toBe(locA.id);
      expect(result.locationCode).toBe(locA.code);
      expect(result.warehouseId).toBe(warehouse.id);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].skuId).toBe(skuLo.id);
      expect(result.items[0].skuCode).toBe(skuLo.code);
      expect(result.items[0].skuName).toBe('lo');
      expect(result.items[0].quantity).toBe(9);
      expect(result.items[1].skuId).toBe(skuHi.id);
    });
  });

  it('없는 로케이션은 NotFoundError 를 던진다', async () => {
    await inRollbackTx(async (tx) => {
      await expect(reader.getLocationContents(randomUUID(), tx)).rejects.toThrow(NotFoundError);
    });
  });

  it('재고가 없는 로케이션은 빈 items 를 준다', async () => {
    await inRollbackTx(async (tx) => {
      const { locB } = await seedEntities(tx);
      const result = await reader.getLocationContents(locB.id, tx);
      expect(result.items).toEqual([]);
    });
  });

  it('ON_HAND 가 아닌 상태(DEFECTIVE)도 필터 없이 함께 반환한다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku, locA } = await seedEntities(tx);
      await tx.insert(wmsTables.stockLedgers).values([
        { skuId: sku.id, warehouseId: warehouse.id, locationId: locA.id, stockState: 'ON_HAND', qty: 5 },
        { skuId: sku.id, warehouseId: warehouse.id, locationId: locA.id, stockState: 'DEFECTIVE', qty: 1 },
      ]);
      const result = await reader.getLocationContents(locA.id, tx);
      expect(result.items).toHaveLength(2);
      expect(result.items.map((i) => i.stockState).sort()).toEqual(['DEFECTIVE', 'ON_HAND']);
    });
  });
});
```

- [ ] **Step 3: reader 에 `getLocationContents` 구현**

`stock-projection.reader.ts` 상단 import 에 DTO 를 추가한다:

```ts
import { LocationContentsDto } from '../dto/location-contents.dto';
```

`getBySkuAndWarehouse` 메서드(reader.ts:205 `}` 로 끝남) 바로 뒤에 추가한다:

```ts
  async getLocationContents(locationId: string, tx?: DbTx): Promise<LocationContentsDto> {
    return this.dbService.run(async (trx) => {
      const [location] = await trx
        .select({
          id: wmsTables.locations.id,
          code: wmsTables.locations.code,
          warehouseId: wmsTables.locations.warehouseId,
        })
        .from(wmsTables.locations)
        .where(eq(wmsTables.locations.id, locationId))
        .limit(1);

      if (!location) {
        throw new NotFoundError(`Location not found: ${locationId}`);
      }

      const items = await trx
        .select({
          skuId: wmsTables.stockLedgers.skuId,
          skuCode: wmsTables.skus.code,
          skuName: wmsTables.skus.name,
          stockState: wmsTables.stockLedgers.stockState,
          quantity: wmsTables.stockLedgers.qty,
        })
        .from(wmsTables.stockLedgers)
        .innerJoin(wmsTables.skus, eq(wmsTables.stockLedgers.skuId, wmsTables.skus.id))
        .where(eq(wmsTables.stockLedgers.locationId, locationId))
        .orderBy(wmsTables.skus.code, wmsTables.stockLedgers.stockState);

      return {
        locationId: location.id,
        locationCode: location.code,
        warehouseId: location.warehouseId,
        items,
      };
    }, tx);
  }
```

(`eq`·`NotFoundError` 는 reader.ts 상단에 이미 import 되어 있다 — reader.ts:2,3. 확인만.)

- [ ] **Step 4: service delegation 추가**

`stock-projection.service.ts` 의 `getBySkuAndWarehouse` delegation(service.ts:27-29) 바로 뒤에 추가한다:

```ts
  getLocationContents(locationId: string, tx?: DbTx) {
    return this.reader.getLocationContents(locationId, tx);
  }
```

- [ ] **Step 5: controller route 추가**

`stock-projection.controller.ts` 상단 import 에 DTO 를 추가한다:

```ts
import { LocationContentsDto } from '../dto/location-contents.dto';
```

`getStockBySkuAndWarehouse` 핸들러(controller.ts:63-69) 바로 뒤에 추가한다:

```ts
  @Get('/stocks/location/:locationId')
  @ApiOperation({ summary: '로케이션 내용물 조회 (SKU·상태·수량)' })
  @ApiParam({ name: 'locationId', description: '로케이션 ID' })
  @ApiResponse({ status: 200, type: LocationContentsDto })
  async getLocationContents(@Param('locationId') locationId: string): Promise<LocationContentsDto> {
    return this.stockProjection.getLocationContents(locationId);
  }
```

(`@Get`·`@Param`·`@ApiOperation`·`@ApiParam`·`@ApiResponse` 는 controller.ts 상단에 이미 import 되어 있다.)

- [ ] **Step 6: 빌드로 검증**

Run(리포 루트): `npx nest build core`
Expected: exit 0, 타입 에러 없음.

- [ ] **Step 7: 통합 스펙 실행(있으면) + 심볼 확인**

Run: `DATABASE_URL 이 설정돼 있으면` → `npx jest --testPathPattern=stock-projection-by-location`
Expected: getLocationContents describe 4개 PASS. `DATABASE_URL` 미설정이면 `describe.skip` 으로 auto-skip — 이는 정상(Phase 1 과 동일). 이 경우 검증은 Step 6 빌드가 담당.

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/inventory/stock-projection/
git commit -m "feat(inventory): GET /inventory/stocks/location/:locationId 로케이션 내용물 조회"
```

---

### Task 2: 프론트 — movement 타입 + `useLocationContents` 훅

**Files:**
- Create: `native/warehouse-app/src/domains/movement/types.ts`
- Create: `native/warehouse-app/src/domains/movement/useLocationContents.ts`
- Test: `native/warehouse-app/src/domains/movement/useLocationContents.test.tsx`

**Interfaces:**
- Produces:
  - `interface LocationContentItem { skuId: string; skuCode: string; skuName: string; stockState: string; quantity: number }`
  - `interface LocationContents { locationId: string; locationCode: string; warehouseId: string; items: LocationContentItem[] }`
  - `interface MoveInput { warehouseId: string; skuId: string; fromLocationId: string; toLocationId: string; quantity: number; reason?: string; idempotencyKey: string }`
  - `useLocationContents(locationId: string | undefined)` → react-query result of `LocationContents`, query key `['location-contents', locationId]`, `enabled` when locationId truthy.
- Consumes: `useApiClient()`(`api.request<T>({ path })`), `useQuery`.

- [ ] **Step 1: 실패 테스트 작성**

Create `native/warehouse-app/src/domains/movement/useLocationContents.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useLocationContents } from './useLocationContents';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function wrapperWith(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

describe('useLocationContents', () => {
  it('locationId 로 GET 경로를 만들고 응답을 준다', async () => {
    const request = vi.fn(async (_o: { path: string }) => ({
      locationId: 'l-1',
      locationCode: 'A-01-02',
      warehouseId: 'w-1',
      items: [{ skuId: 's1', skuCode: 'C1', skuName: '상품1', stockState: 'ON_HAND', quantity: 12 }],
    }));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };
    const { result } = renderHook(() => useLocationContents('l-1'), { wrapper: wrapperWith(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/inventory/stocks/location/l-1');
    expect(result.current.data?.items[0].skuCode).toBe('C1');
  });

  it('locationId 가 없으면 요청하지 않는다', () => {
    const request = vi.fn(async () => ({}));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };
    renderHook(() => useLocationContents(undefined), { wrapper: wrapperWith(client) });
    expect(request).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run(native/warehouse-app): `npm test -- useLocationContents`
Expected: FAIL — `Cannot find module './useLocationContents'` (또는 types).

- [ ] **Step 3: 타입 파일 작성**

Create `native/warehouse-app/src/domains/movement/types.ts`:

```ts
/** GET /inventory/stocks/location/:locationId 의 items[] 한 행. */
export interface LocationContentItem {
  skuId: string;
  skuCode: string;
  skuName: string;
  /** ON_HAND | DEFECTIVE | IN_TRANSFER. 이동 대상은 ON_HAND 뿐이다. */
  stockState: string;
  quantity: number;
}

/** GET /inventory/stocks/location/:locationId 응답. */
export interface LocationContents {
  locationId: string;
  locationCode: string;
  warehouseId: string;
  items: LocationContentItem[];
}

/** MovementScreen → useMoveStock 입력. 라인 1개 MoveBatchDto 로 조립된다. */
export interface MoveInput {
  warehouseId: string;
  skuId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  /** 선택 사유. MoveLineDto.memo 로 전달된다. */
  reason?: string;
  /** (c) 시트 진입 시 1회 생성, 재시도에 재사용. */
  idempotencyKey: string;
}
```

- [ ] **Step 4: 훅 작성**

Create `native/warehouse-app/src/domains/movement/useLocationContents.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { LocationContents } from './types';

/** GET /inventory/stocks/location/:locationId — 로케이션 내용물(SKU·상태·수량). */
export function useLocationContents(locationId: string | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['location-contents', locationId],
    enabled: Boolean(locationId),
    queryFn: () => api.request<LocationContents>({ path: `/inventory/stocks/location/${locationId}` }),
  });
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run(native/warehouse-app): `npm test -- useLocationContents`
Expected: PASS (2 tests).

- [ ] **Step 6: 커밋**

```bash
git add native/warehouse-app/src/domains/movement/types.ts \
        native/warehouse-app/src/domains/movement/useLocationContents.ts \
        native/warehouse-app/src/domains/movement/useLocationContents.test.tsx
git commit -m "feat(warehouse-app): useLocationContents 훅 + movement 타입"
```

---

### Task 3: 프론트 — `useMoveStock` 훅

**Files:**
- Create: `native/warehouse-app/src/domains/movement/useMoveStock.ts`
- Test: `native/warehouse-app/src/domains/movement/useMoveStock.test.tsx`

**Interfaces:**
- Produces:
  - `MOVE_REASONS: readonly ['재배치', '통합', '분산', '기타']`
  - `useMoveStock()` → mutation of `MoveInput`. POST `/movement/move`, body = `{ warehouseId, idempotencyKey, lines: [{ skuId, fromLocationId, toLocationId, quantity, memo: reason }] }`, `idempotencyKey` 헤더 동반. 성공 시 `location-contents`·`sku-warehouse-stock`·`sku-stock-summary` 무효화.
- Consumes: `MoveInput`(Task 2), `useApiClient`, `useMutation`/`useQueryClient`.

- [ ] **Step 1: 실패 테스트 작성**

Create `native/warehouse-app/src/domains/movement/useMoveStock.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useMoveStock } from './useMoveStock';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function harness() {
  const request = vi.fn(
    async (_o: { path: string; method?: string; body?: unknown; idempotencyKey?: string }) => ({})
  );
  const client: ApiClient = { request: request as unknown as ApiClient['request'] };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return { request, invalidate, wrapper };
}

describe('useMoveStock', () => {
  it('라인 1개 배치와 멱등 헤더를 보내고 캐시를 무효화한다', async () => {
    const { request, invalidate, wrapper } = harness();
    const { result } = renderHook(() => useMoveStock(), { wrapper });

    await result.current.mutateAsync({
      warehouseId: 'w-1',
      skuId: 's1',
      fromLocationId: 'l-1',
      toLocationId: 'l-2',
      quantity: 5,
      reason: '재배치',
      idempotencyKey: 'k1',
    });

    const call = request.mock.calls[0][0];
    expect(call.path).toBe('/movement/move');
    expect(call.method).toBe('POST');
    expect(call.idempotencyKey).toBe('k1');
    expect(call.body).toEqual({
      warehouseId: 'w-1',
      idempotencyKey: 'k1',
      lines: [
        { skuId: 's1', fromLocationId: 'l-1', toLocationId: 'l-2', quantity: 5, memo: '재배치' },
      ],
    });

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(keys.some((k) => k.includes('location-contents'))).toBe(true);
    expect(keys.some((k) => k.includes('sku-warehouse-stock'))).toBe(true);
    expect(keys.some((k) => k.includes('sku-stock-summary'))).toBe(true);
  });

  it('사유가 없으면 memo 를 보내지 않는다', async () => {
    const { request, wrapper } = harness();
    const { result } = renderHook(() => useMoveStock(), { wrapper });

    await result.current.mutateAsync({
      warehouseId: 'w-1',
      skuId: 's1',
      fromLocationId: 'l-1',
      toLocationId: 'l-2',
      quantity: 3,
      idempotencyKey: 'k2',
    });

    const call = request.mock.calls[0][0] as { body: { lines: Array<{ memo?: string }> } };
    expect(call.body.lines[0].memo).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run(native/warehouse-app): `npm test -- useMoveStock`
Expected: FAIL — `Cannot find module './useMoveStock'`.

- [ ] **Step 3: 훅 작성**

Create `native/warehouse-app/src/domains/movement/useMoveStock.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { MoveInput } from './types';

export const MOVE_REASONS = ['재배치', '통합', '분산', '기타'] as const;

/**
 * POST /movement/move — 동일 창고 라인 1개 배치 이동.
 * 서버가 출발지 ON_HAND 부족(400)·동일 로케이션 금지·창고 소속을 검증한다.
 */
export function useMoveStock() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MoveInput) =>
      api.request<unknown>({
        method: 'POST',
        path: '/movement/move',
        body: {
          warehouseId: input.warehouseId,
          idempotencyKey: input.idempotencyKey,
          lines: [
            {
              skuId: input.skuId,
              fromLocationId: input.fromLocationId,
              toLocationId: input.toLocationId,
              quantity: input.quantity,
              memo: input.reason,
            },
          ],
        },
        idempotencyKey: input.idempotencyKey,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['location-contents'] });
      void qc.invalidateQueries({ queryKey: ['sku-warehouse-stock'] });
      void qc.invalidateQueries({ queryKey: ['sku-stock-summary'] });
    },
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run(native/warehouse-app): `npm test -- useMoveStock`
Expected: PASS (2 tests).

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src/domains/movement/useMoveStock.ts \
        native/warehouse-app/src/domains/movement/useMoveStock.test.tsx
git commit -m "feat(warehouse-app): useMoveStock 훅 (라인 1개 배치 이동)"
```

---

### Task 4: 프론트 — `errorMessage` 에 movement 문맥 추가

**Files:**
- Modify: `native/warehouse-app/src/core/data/errorMessage.ts` (`ErrorContext` union + `CONTEXTUAL`)
- Test: `native/warehouse-app/src/core/data/errorMessage.test.ts` (케이스 추가)

**Interfaces:**
- Produces: `ErrorContext` 에 `'movement'` 추가. `errorMessage(e, 'movement')` 는 400 → `'출발지 재고가 부족해요. 다시 확인해 주세요.'`.
- Consumes: 없음.

- [ ] **Step 1: 실패 테스트 작성**

`errorMessage.test.ts` 의 `describe('errorMessage with context', …)` 블록 안, `'실사 문맥의 400 …'` it 블록(test.ts:40-44) 바로 뒤에 추가한다:

```ts
  it('이동 문맥의 400 은 출발지 부족을 짚어준다', () => {
    expect(errorMessage(new Error('POST /movement/move → 400'), 'movement')).toBe(
      '출발지 재고가 부족해요. 다시 확인해 주세요.'
    );
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run(native/warehouse-app): `npm test -- errorMessage`
Expected: FAIL — `'movement'` 인자가 타입에 없어 tsc/실행 에러, 또는 기대 문자열 불일치.

- [ ] **Step 3: 구현 — union + 매핑 추가**

`errorMessage.ts` 의 `ErrorContext` 타입(errorMessage.ts:4)을 교체한다:

```ts
export type ErrorContext = 'barcode' | 'location' | 'stocktaking' | 'movement';
```

그리고 `CONTEXTUAL` 상수(errorMessage.ts:6-10)에 `movement` 항목을 추가한다:

```ts
const CONTEXTUAL: Record<ErrorContext, Partial<Record<number, string>>> = {
  barcode: { 404: '등록되지 않은 바코드예요.' },
  location: { 404: '로케이션을 찾을 수 없어요.' },
  stocktaking: { 400: '실사가 진행 중이 아니에요. 세션 상태를 확인해 주세요.' },
  movement: { 400: '출발지 재고가 부족해요. 다시 확인해 주세요.' },
};
```

- [ ] **Step 4: 테스트 통과 확인**

Run(native/warehouse-app): `npm test -- errorMessage`
Expected: PASS (기존 + 신규 케이스).

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src/core/data/errorMessage.ts \
        native/warehouse-app/src/core/data/errorMessage.test.ts
git commit -m "feat(warehouse-app): errorMessage movement 문맥(400 출발지 부족)"
```

---

### Task 5: 프론트 — MovementScreen + 라우트 배선

**Files:**
- Create: `native/warehouse-app/src/domains/movement/MovementScreen.tsx`
- Create: `native/warehouse-app/src/app/routes/MovementRoute.tsx`
- Modify: `native/warehouse-app/src/app/routeTree.tsx` (`/movement` 플레이스홀더 → `MovementRoute`)
- Test: `native/warehouse-app/src/domains/movement/MovementScreen.test.tsx`

**Interfaces:**
- Produces: `MovementScreen()` React 컴포넌트(props 없음), `MovementRoute()` 래퍼.
- Consumes: `useLocationContents`(Task 2), `useMoveStock`·`MOVE_REASONS`(Task 3), `errorMessage(_, 'movement'|'location')`(Task 4), `LocationContentItem`(Task 2), `useWarehouse`, `useLocationSearch`, `useScanner`, `NumberPad`, `ConfirmDialog`, `ScreenHeader`, `Button`, `WarehousePicker`, `cn`.

- [ ] **Step 1: 실패 테스트 작성**

Create `native/warehouse-app/src/domains/movement/MovementScreen.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { MovementScreen } from './MovementScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const CONTENTS = {
  locationId: 'l-src',
  locationCode: 'A-01-02',
  warehouseId: 'w-1',
  items: [
    { skuId: 's1', skuCode: 'CT-001', skuName: '코튼셔츠', stockState: 'ON_HAND', quantity: 12 },
    { skuId: 's2', skuCode: 'DF-002', skuName: '불량품', stockState: 'DEFECTIVE', quantity: 2 },
  ],
};

function makeClient(calls: Array<{ path: string; method?: string; body?: unknown }>): ApiClient {
  return {
    request: (async (opts: { path: string; method?: string; body?: unknown }) => {
      calls.push({ path: opts.path, method: opts.method, body: opts.body });
      if (opts.path.startsWith('/locations/warehouses/')) {
        if (opts.path.includes('A-01')) {
          return { items: [{ id: 'l-src', code: 'A-01-02', displayName: 'A-01-02' }], total: 1 };
        }
        if (opts.path.includes('B-05')) {
          return { items: [{ id: 'l-dst', code: 'B-05-03', displayName: 'B-05-03' }], total: 1 };
        }
        return { items: [], total: 0 };
      }
      if (opts.path === '/inventory/stocks/location/l-src') return CONTENTS;
      if (opts.path === '/movement/move') return {};
      throw new Error(`GET ${opts.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
}

function renderScreen(client: ApiClient, withWarehouse = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const prefs = createMemoryPrefs(
    withWarehouse ? { 'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '본창고' }) } : {}
  );
  const rootRoute = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <MovementScreen />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrap = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <ScanProvider>
            <WarehouseProvider prefs={prefs}>{children}</WarehouseProvider>
          </ScanProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return render(<RouterProvider router={router as never} />, { wrapper: wrap });
}

// 출발지 A-01-02 를 골라 내용물 모드로 진입시키는 공통 절차.
async function pickSource() {
  await userEvent.type(await screen.findByLabelText('출발 로케이션 검색'), 'A-01');
  await userEvent.click(await screen.findByRole('button', { name: /A-01-02/ }));
}

describe('MovementScreen', () => {
  it('창고 미설정이면 창고 선택을 안내한다', async () => {
    renderScreen(makeClient([]), false);
    expect(await screen.findByText('창고를 먼저 선택해 주세요.')).toBeInTheDocument();
  });

  it('출발지를 고르면 ON_HAND 품목만 보여준다(불량품 제외)', async () => {
    renderScreen(makeClient([]));
    await pickSource();
    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
    expect(screen.queryByText('불량품')).not.toBeInTheDocument();
  });

  it('품목·대상지·수량을 갖추면 확인 후 이동을 보낸다', async () => {
    const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
    renderScreen(makeClient(calls));
    await pickSource();

    await userEvent.click(await screen.findByRole('button', { name: '이동' }));
    // 대상지 선택
    await userEvent.type(await screen.findByLabelText('대상 로케이션 검색'), 'B-05');
    await userEvent.click(await screen.findByRole('button', { name: /B-05-03/ }));
    // 이동 실행
    await userEvent.click(screen.getByRole('button', { name: '이동하기' }));
    const dialog = await screen.findByRole('dialog', { name: '재고 이동' });
    await userEvent.click(within(dialog).getByRole('button', { name: '이동' }));

    const move = calls.find((c) => c.path === '/movement/move');
    expect(move?.method).toBe('POST');
    expect(move?.body).toMatchObject({
      warehouseId: 'w-1',
      lines: [{ skuId: 's1', fromLocationId: 'l-src', toLocationId: 'l-dst', quantity: 12 }],
    });
  });

  it('이동 성공 후 시트를 닫고 재오픈 시 직전 대상지 칩을 보여준다', async () => {
    renderScreen(makeClient([]));
    await pickSource();

    await userEvent.click(await screen.findByRole('button', { name: '이동' }));
    await userEvent.type(await screen.findByLabelText('대상 로케이션 검색'), 'B-05');
    await userEvent.click(await screen.findByRole('button', { name: /B-05-03/ }));
    await userEvent.click(screen.getByRole('button', { name: '이동하기' }));
    const dialog = await screen.findByRole('dialog', { name: '재고 이동' });
    await userEvent.click(within(dialog).getByRole('button', { name: '이동' }));

    // 시트가 닫힌다(품목 이동 다이얼로그 사라짐).
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '품목 이동' })).not.toBeInTheDocument()
    );
    // 재오픈 → 직전 대상지 칩.
    await userEvent.click(await screen.findByRole('button', { name: '이동' }));
    expect(await screen.findByRole('button', { name: '직전 대상지 B-05-03 사용' })).toBeInTheDocument();
  });

  it('대상 로케이션 목록에서 출발지는 제외된다', async () => {
    renderScreen(makeClient([]));
    await pickSource();
    await userEvent.click(await screen.findByRole('button', { name: '이동' }));

    // 대상지 검색에 출발지 코드를 넣어도(같은 l-src) 목록에서 걸러진다.
    await userEvent.type(await screen.findByLabelText('대상 로케이션 검색'), 'A-01');
    await waitFor(() => {
      const sheet = screen.getByRole('dialog', { name: '품목 이동' });
      expect(within(sheet).queryByRole('button', { name: /A-01-02/ })).not.toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run(native/warehouse-app): `npm test -- MovementScreen`
Expected: FAIL — `Cannot find module './MovementScreen'`.

- [ ] **Step 3: MovementScreen 작성**

Create `native/warehouse-app/src/domains/movement/MovementScreen.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { NumberPad } from '../../core/design/NumberPad';
import { ConfirmDialog } from '../../core/design/ConfirmDialog';
import { cn } from '../../core/design/cn';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useLocationSearch } from '../warehouse/useLocationSearch';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { useLocationContents } from './useLocationContents';
import { useMoveStock, MOVE_REASONS } from './useMoveStock';
import type { LocationContentItem } from './types';

const OTHER = '기타';

interface LocationRef {
  id: string;
  code: string;
}

export function MovementScreen() {
  const { warehouseId, isSet } = useWarehouse();

  // (a) 출발지
  const [source, setSource] = useState<LocationRef | null>(null);
  const [sourceTerm, setSourceTerm] = useState('');
  // (c) 품목 이동 시트
  const [activeItem, setActiveItem] = useState<LocationContentItem | null>(null);
  const [dest, setDest] = useState<LocationRef | null>(null);
  const [destTerm, setDestTerm] = useState('');
  const [qty, setQty] = useState(0);
  const [reason, setReason] = useState<string | null>(null);
  const [otherReason, setOtherReason] = useState('');
  const [lastDest, setLastDest] = useState<LocationRef | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const contents = useLocationContents(source?.id);
  const sourceSearch = useLocationSearch(warehouseId, source ? '' : sourceTerm);
  const destSearch = useLocationSearch(warehouseId, !activeItem || dest ? '' : destTerm);
  const move = useMoveStock();

  // 스캔은 모드에 따라 라우팅된다: 시트가 열려 있고 대상지 미정이면 대상지로,
  // 아니면 출발지 대기 중일 때 출발지로. 내용물 모드(출발지 선택됨·시트 닫힘)의
  // 스캔은 무시한다 — 품목은 탭으로 고른다.
  useScanner((e) => {
    if (activeItem) {
      if (!dest) setDestTerm(e.code);
      return;
    }
    if (!source) setSourceTerm(e.code);
  });

  // 출발지: 스캔/입력이 코드와 정확히 일치하는 단건이면 자동 선택.
  useEffect(() => {
    if (source) return;
    const term = sourceTerm.trim();
    if (!term) return;
    const exact = (sourceSearch.data?.items ?? []).filter((i) => i.code === term);
    if (exact.length === 1) {
      setSource({ id: exact[0].id, code: exact[0].code });
      setSourceTerm('');
    }
  }, [sourceSearch.data, sourceTerm, source]);

  // 대상지: 출발지를 제외한 뒤 코드 완전일치 단건이면 자동 선택.
  useEffect(() => {
    if (!activeItem || dest) return;
    const term = destTerm.trim();
    if (!term) return;
    const exact = (destSearch.data?.items ?? [])
      .filter((i) => i.id !== source?.id)
      .filter((i) => i.code === term);
    if (exact.length === 1) {
      setDest({ id: exact[0].id, code: exact[0].code });
      setDestTerm('');
    }
  }, [destSearch.data, destTerm, activeItem, dest, source]);

  // 멱등키 회전: payload(품목·출발·대상·수량)가 바뀌면 새 키를 발급한다.
  // "요청은 커밋됐는데 응답만 유실" 뒤 값을 고쳐 재제출하면 옛 payload 를
  // 같은 키로 replay 하는 사고를 막는다. 값이 안 바뀐 재시도는 같은 키를 유지.
  const keyPayloadRef = useRef({ skuId: '', from: '', to: '', qty: 0 });
  useEffect(() => {
    if (!activeItem || !source) return;
    const next = { skuId: activeItem.skuId, from: source.id, to: dest?.id ?? '', qty };
    const prev = keyPayloadRef.current;
    if (prev.skuId === next.skuId && prev.from === next.from && prev.to === next.to && prev.qty === next.qty) {
      return;
    }
    keyPayloadRef.current = next;
    setIdempotencyKey(crypto.randomUUID());
  }, [activeItem, source, dest, qty]);

  function openSheet(item: LocationContentItem) {
    if (!source) return;
    setActiveItem(item);
    setDest(null);
    setDestTerm('');
    setQty(item.quantity);
    setReason(null);
    setOtherReason('');
    keyPayloadRef.current = { skuId: item.skuId, from: source.id, to: '', qty: item.quantity };
    setIdempotencyKey(crypto.randomUUID());
  }

  function closeSheet() {
    setActiveItem(null);
    setDest(null);
    setDestTerm('');
    setQty(0);
    setReason(null);
    setOtherReason('');
  }

  const movable = (contents.data?.items ?? []).filter(
    (i) => i.stockState === 'ON_HAND' && i.quantity > 0
  );
  const effectiveReason = reason === OTHER ? otherReason.trim() : reason ?? '';
  const canSubmit =
    Boolean(activeItem) &&
    Boolean(source) &&
    Boolean(dest) &&
    dest?.id !== source?.id &&
    qty >= 1 &&
    qty <= (activeItem?.quantity ?? 0);

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="재고 이동" backTo="/" />
        <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
          <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ScreenHeader title="재고 이동" backTo="/" />

      {!source ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">출발 로케이션</h2>
          <label htmlFor="src-search" className="sr-only">
            출발 로케이션 검색
          </label>
          <input
            id="src-search"
            aria-label="출발 로케이션 검색"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="출발 로케이션 바코드를 스캔하거나 코드를 입력하세요"
            value={sourceTerm}
            onChange={(e) => setSourceTerm(e.target.value)}
          />
          {sourceSearch.isError ? (
            <p role="alert" className="text-sm text-red-600">
              {errorMessage(sourceSearch.error, 'location')}
            </p>
          ) : null}
          <ul className="space-y-1">
            {(sourceSearch.data?.items ?? []).map((loc) => (
              <li key={loc.id}>
                <button
                  type="button"
                  className="w-full rounded-md border border-gray-200 bg-white p-3 text-left active:bg-gray-50"
                  onClick={() => {
                    setSource({ id: loc.id, code: loc.code });
                    setSourceTerm('');
                  }}
                >
                  {loc.code}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-lg border border-blue-500 bg-blue-50 p-3">
            <span className="text-xs text-gray-500">출발</span>
            <span className="flex-1 font-medium text-gray-800">{source.code}</span>
            <button
              type="button"
              className="text-xs text-blue-700 underline"
              onClick={() => {
                setSource(null);
                closeSheet();
              }}
            >
              변경
            </button>
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">이동할 품목</h2>
            {contents.isError ? (
              <p role="alert" className="text-sm text-red-600">
                {errorMessage(contents.error, 'location')}
              </p>
            ) : contents.isLoading ? (
              <p className="text-sm text-gray-500">불러오는 중…</p>
            ) : movable.length === 0 ? (
              <p className="text-sm text-gray-500">이 로케이션에는 이동할 재고가 없어요.</p>
            ) : (
              <ul className="space-y-2">
                {movable.map((item) => (
                  <li
                    key={`${item.skuId}-${item.stockState}`}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
                  >
                    <span className="flex-1">
                      <span className="block font-medium text-gray-800">{item.skuName}</span>
                      <span className="block font-mono text-xs text-gray-500">{item.skuCode}</span>
                    </span>
                    <span className="text-lg font-semibold text-gray-900">{item.quantity}</span>
                    <Button className="px-3 py-1.5 text-xs" onClick={() => openSheet(item)}>
                      이동
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {activeItem && source ? (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="품목 이동"
        >
          <div className="max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-xl bg-white p-5 shadow-lg">
            <div>
              <div className="font-semibold text-gray-800">{activeItem.skuName}</div>
              <div className="font-mono text-xs text-gray-500">{activeItem.skuCode}</div>
              <div className="mt-1 text-xs text-gray-500">
                출발 {source.code} · 현재 ON_HAND {activeItem.quantity}
              </div>
            </div>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-700">이동 수량</h3>
              <div
                className={cn(
                  'rounded-lg border p-2 text-center text-2xl font-semibold',
                  qty >= 1 && qty <= activeItem.quantity
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-400'
                )}
              >
                {qty}
              </div>
              <NumberPad value={qty} onChange={setQty} />
              {qty > activeItem.quantity ? (
                <p className="text-xs text-red-600">현재 수량({activeItem.quantity})을 초과할 수 없어요.</p>
              ) : null}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-700">대상 로케이션</h3>
              {dest ? (
                <div className="flex items-center gap-3 rounded-lg border border-blue-500 bg-blue-50 p-3">
                  <span className="flex-1 font-medium text-gray-800">{dest.code}</span>
                  <button
                    type="button"
                    className="text-xs text-blue-700 underline"
                    onClick={() => setDest(null)}
                  >
                    변경
                  </button>
                </div>
              ) : (
                <>
                  {lastDest && lastDest.id !== source.id ? (
                    <button
                      type="button"
                      className="w-full rounded-md border border-blue-300 bg-blue-50 p-2 text-sm text-blue-700"
                      onClick={() => setDest(lastDest)}
                    >
                      직전 대상지 {lastDest.code} 사용
                    </button>
                  ) : null}
                  <label htmlFor="dest-search" className="sr-only">
                    대상 로케이션 검색
                  </label>
                  <input
                    id="dest-search"
                    aria-label="대상 로케이션 검색"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="대상 로케이션 바코드를 스캔하거나 코드를 입력하세요"
                    value={destTerm}
                    onChange={(e) => setDestTerm(e.target.value)}
                  />
                  {destSearch.isError ? (
                    <p role="alert" className="text-sm text-red-600">
                      {errorMessage(destSearch.error, 'location')}
                    </p>
                  ) : null}
                  <ul className="space-y-1">
                    {(destSearch.data?.items ?? [])
                      .filter((i) => i.id !== source.id)
                      .map((loc) => (
                        <li key={loc.id}>
                          <button
                            type="button"
                            className="w-full rounded-md border border-gray-200 bg-white p-3 text-left active:bg-gray-50"
                            onClick={() => setDest({ id: loc.id, code: loc.code })}
                          >
                            {loc.code}
                          </button>
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-700">
                사유 <span className="text-xs font-normal text-gray-400">(선택)</span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {MOVE_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(reason === r ? null : r)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-sm',
                      reason === r
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 bg-white text-gray-700'
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
              {reason === OTHER ? (
                <input
                  aria-label="사유 직접 입력"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  placeholder="사유를 입력하세요"
                  value={otherReason}
                  onChange={(e) => setOtherReason(e.target.value)}
                />
              ) : null}
            </section>

            {move.isError ? (
              <p role="alert" className="text-sm text-red-600">
                {errorMessage(move.error, 'movement')}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button
                type="button"
                className="flex-1 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
                onClick={closeSheet}
              >
                취소
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={!canSubmit || move.isPending}
                onClick={() => setConfirming(true)}
              >
                이동하기
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title="재고 이동"
        message={`${source?.code ?? ''} → ${dest?.code ?? ''}, ${activeItem?.skuName ?? '상품'} ${qty}개 이동합니다.`}
        confirmLabel="이동"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          if (!activeItem || !source || !dest || !warehouseId) return;
          move.mutate(
            {
              warehouseId,
              skuId: activeItem.skuId,
              fromLocationId: source.id,
              toLocationId: dest.id,
              quantity: qty,
              reason: effectiveReason || undefined,
              idempotencyKey,
            },
            {
              onSuccess: () => {
                setLastDest(dest);
                setIdempotencyKey(crypto.randomUUID());
                closeSheet();
              },
            }
          );
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: MovementRoute 래퍼 작성**

Create `native/warehouse-app/src/app/routes/MovementRoute.tsx`:

```tsx
import { MovementScreen } from '../../domains/movement/MovementScreen';

export function MovementRoute() {
  return <MovementScreen />;
}
```

- [ ] **Step 5: routeTree 배선 교체**

`native/warehouse-app/src/app/routeTree.tsx` 의 import 블록(routeTree.tsx:19 뒤)에 추가:

```ts
import { MovementRoute } from './routes/MovementRoute';
```

그리고 `movementRoute` 정의(routeTree.tsx:96-100)의 `component` 를 교체한다:

```ts
const movementRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/movement',
  component: MovementRoute,
});
```

(`PlaceholderScreen` import 는 `shipments`·`inbound`·`picking`·`packing` 라우트가 계속 쓰므로 그대로 둔다. `movementRoute` 는 이미 `routeTree.addChildren` 에 등록돼 있어 등록부는 변경 없음.)

- [ ] **Step 6: 화면 테스트 통과 확인**

Run(native/warehouse-app): `npm test -- MovementScreen`
Expected: PASS (5 tests).

- [ ] **Step 7: 라우터 회귀 확인 + 전량 테스트 + 빌드/린트**

Run(native/warehouse-app):
```bash
npm test
```
Expected: 전량 green(198 기존 + 신규). `router.test.tsx`·`router.handheld.test.tsx` 가 `/movement` 해석을 계속 통과하는지 포함.

Run(native/warehouse-app):
```bash
npx tsc -p tsconfig.app.json --noEmit
npx oxlint src/domains/movement src/app/routes/MovementRoute.tsx src/app/routeTree.tsx src/core/data/errorMessage.ts
```
Expected: tsc 에러 0, oxlint 변경 파일 신규 error 0.

- [ ] **Step 8: 커밋**

```bash
git add native/warehouse-app/src/domains/movement/MovementScreen.tsx \
        native/warehouse-app/src/domains/movement/MovementScreen.test.tsx \
        native/warehouse-app/src/app/routes/MovementRoute.tsx \
        native/warehouse-app/src/app/routeTree.tsx
git commit -m "feat(warehouse-app): 재고 이동 화면(MovementScreen) + /movement 배선"
```

---

## 검증 체크리스트 (전 태스크 완료 후)

- [ ] `npx nest build core` exit 0 (Task 1)
- [ ] `npm test`(warehouse-app) 전량 green
- [ ] `npx tsc -p tsconfig.app.json --noEmit`(warehouse-app) 에러 0
- [ ] oxlint 변경 파일 신규 error 0
- [ ] `GET /inventory/stocks/location/:locationId` 통합 스펙: DATABASE_URL 있으면 실행해 green, 없으면 ⏸(auto-skip)
- [ ] 기기 수동 스모크(선택, 라이브): HID 리더로 출발지→품목→대상지 스캔 1회전 후 admin-web 에서 원장 반영(출발 −N/대상 +N, 총량 불변) 확인

## 후속(이 플랜 밖, 스펙 §2 비목표)

- 장바구니 일괄 이동(라인별 도착지 카트), 상품 우선 진입(SkuDetail `[이동]`), 이동 이력 탭, DEFECTIVE 이동, 다중 작업자 충돌 UI.
