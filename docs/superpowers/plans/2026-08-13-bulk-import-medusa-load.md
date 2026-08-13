# 대량등록 Medusa 부하·처리량 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대량등록이 Medusa 에 거는 부하를 62% 줄이고, 상품당 처리 시간을 26.6초에서 12.3초로 낮춘 뒤, 인박스 클레임 유휴를 걷어내 2,553건 소요를 17시간에서 5시간대로 내린다.

**Architecture:** 세 갈래다. (A) channel-adapter 가 상품마다 두 번 부르던 Medusa price list 호출을, 신규 상품은 한 번으로 줄이고(A1) 나아가 여러 상품을 모아 한 번으로 합친다(A2). (B) 상품마다 await 하던 storefront 캐시 무효화를 버퍼에 모아 주기적으로 한 번만 호출한다. (C) 인박스 클레임 쿼리를 측정한 뒤 인덱스 또는 lane 컬럼 승격으로 슬롯 유휴를 없앤다.

**Tech Stack:** NestJS, TypeScript, Drizzle ORM, Jest, Medusa v2 Admin API, Next.js(storefront `/api/revalidate`)

**설계서:** `docs/superpowers/specs/2026-08-13-bulk-import-medusa-load-design.md`

## 계획 단계에서의 스펙 수정

스펙의 **A(price list 배치화)를 A1·A2 로 쪼갠다.** 코드를 읽고 나니 위험도와 효과가 크게 다르다.

- **A1 — 신규 상품의 `remove` 호출 제거.** 버퍼가 필요 없고 durability 위험이 0이며, 상품당 3.3초를 즉시 회수한다. 측정 구간의 766건이 전부 신규였으므로 대량등록 시나리오에서는 이것만으로 price list 비용의 절반이 사라진다.
- **A2 — 여러 상품의 `create` 를 한 배치로 합치기.** 나머지 3.28초를 회수하지만 인메모리 버퍼를 쓰므로 **프로세스가 비정상 종료하면 그 주기분의 가격이 유실**된다. 유실을 감지하는 장치가 없다(§리스크 참조).

A1 을 먼저 넣고 A2 는 뒤로 뺀다. A2 없이 A1+B+C 만 해도 상품당 15.6초, 소요 ~6.5시간이다.

## Global Constraints

- 레이어 규칙: Controller → Service → Reader/Manager → Repository. Service 는 `HttpException`·drizzle·Express 타입을 import 하지 않는다. 도메인 예외는 `@app/shared` 의 `NotFoundError`/`BadRequestError`/`ConflictError` 를 던진다
- `any` / `as` 캐스팅 금지 (문서화된 정당화와 팀 승인 없이는)
- Nullable 정규화: `string ?? ''`, `number ?? 0`, `date ?? undefined`
- 트랜잭션은 `dbService.run(fn, tx)` 단일 러너를 쓴다. 클래스별 `inTx` 헬퍼를 새로 만들지 않는다
- **테스트 실행은 반드시 `npx jest --runTestsByPath <파일경로>` 로 한다.** 이 워크트리 경로에 `+` 가 들어 있어(`.claude/worktrees/feat+bulk-import-medusa-load`) 일반 `jest <path>` 의 정규식 매칭이 오염된다
- 커밋 메시지 끝에 다음 줄을 붙인다: `Claude-Session: https://claude.ai/code/session_01RxLvaYzJJXi76zMB1J5RCL`
- 마이그레이션이 생기는 것은 Task 6 뿐이다. 인덱스 추가는 additive expand 이므로 배포 순서는 **`migrate → deploy`** 다 (contract 의 `deploy → migrate` 와 반대 — 헷갈리지 말 것)
- 새 환경변수는 `deployments/lcnine/services/infra/services.ts` 의 `withPrefix('CHANNEL_ADAPTER', {...})` 블록(현재 `INBOX_*` 가 있는 자리, 약 242행)에 함께 추가한다

---

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `apps/channel-adapter/src/types.ts` | `PimActiveVersionChangedEvent` 에 `origin` 선언 추가 | 1 |
| `apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.ts` | 대량 여부 판정, price list 호출 축소, revalidate 위임 | 1·2·4 |
| `apps/channel-adapter/src/adapters/medusa/medusa.client.ts` | price list 배치 delete+create 단일 호출 | 4 |
| `apps/channel-adapter/src/adapters/medusa/deferred-revalidate.service.ts` (신규) | revalidate handle 버퍼 + 주기 flush | 2 |
| `apps/channel-adapter/src/adapters/medusa/deferred-price-list.service.ts` (신규) | price list 항목 버퍼 + 주기 flush | 4 |
| `apps/channel-adapter/src/adapters/medusa/storefront-revalidate.service.ts` | 다건 handle 무효화 지원 | 2 |
| `apps/channel-adapter/src/adapter.module.ts` | 신규 서비스 provider 등록 | 2·4 |
| `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts` | 클레임 쿼리 정렬 개선 | 6 |
| `apps/channel-adapter/drizzle/*` | 클레임용 인덱스 | 6 |
| `deployments/lcnine/services/infra/services.ts` | flush 주기 환경변수 | 2·4 |

---

## Task 1: 대량 출처 판정

`syncFromSnapshot` 이 "이 이벤트가 대량등록에서 왔는가"를 알아야 이후 태스크가 분기할 수 있다. 지금 `origin` 은 런타임 payload 에는 있지만 TS 타입에 선언돼 있지 않다.

**Files:**
- Modify: `apps/channel-adapter/src/types.ts:763-773`
- Modify: `apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.ts` (`handleActiveVersionChanged` 450행, `syncFromSnapshot` 299행)
- Test: `apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.spec.ts`

**Interfaces:**
- Produces: `SyncFromSnapshotOptions.isBulk?: boolean` — Task 2·4 가 이 플래그로 지연 경로를 켠다
- Produces: `isBulkOrigin(origin?: string): boolean` — 순수 함수, 같은 파일에서 export

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.spec.ts` 끝에 추가:

```typescript
import { isBulkOrigin } from './pim-medusa-sync.service';

describe('isBulkOrigin', () => {
  it('bulk_import 를 대량으로 판정한다', () => {
    expect(isBulkOrigin('bulk_import')).toBe(true);
  });

  it('출처가 없으면 단건으로 판정한다', () => {
    expect(isBulkOrigin(undefined)).toBe(false);
    expect(isBulkOrigin('')).toBe(false);
  });

  it('모르는 출처는 단건으로 판정한다 — 안전한 쪽이 즉시 반영이다', () => {
    expect(isBulkOrigin('admin_ui')).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --runTestsByPath apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.spec.ts`
Expected: FAIL — `isBulkOrigin is not a function` 또는 import 해석 실패

- [ ] **Step 3: 타입에 origin 을 선언한다**

`apps/channel-adapter/src/types.ts:763` 의 인터페이스에 두 줄 추가:

```typescript
export interface PimActiveVersionChangedEvent {
  masterId: string;
  versionId: string | null;
  name: string | null;
  previousActiveVersionId: string | null;
  categoryIds?: string[];
  primaryCategoryId?: string | null;
  changeReason: 'published' | 'rollback' | 'unpublished';
  changedAt: string;
  snapshot?: PimProductSnapshot | null;
  // core 가 발행 시 실어 보내는 출처. 단건 게시에는 키 자체가 없다
  // (apps/core/.../product-versions.service.ts:1043).
  origin?: string;
  importSessionId?: string;
}
```

- [ ] **Step 4: 판정 함수를 구현한다**

`pim-medusa-sync.service.ts` 상단 import 아래에 추가:

```typescript
/**
 * 대량 출처 목록. inbox-worker 의 BULK_ORIGINS 와 같은 값이지만, 그쪽은 metadata 를 읽는
 * SQL 레인 판정이고 이쪽은 payload 를 읽는 핸들러 분기라 의도적으로 따로 둔다.
 * 모르는 값은 단건으로 본다 — 즉시 반영이 안전한 기본값이다.
 */
const BULK_SYNC_ORIGINS: readonly string[] = ['bulk_import'];

export function isBulkOrigin(origin?: string): boolean {
  return !!origin && BULK_SYNC_ORIGINS.includes(origin);
}
```

- [ ] **Step 5: 테스트 통과를 확인한다**

Run: `npx jest --runTestsByPath apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.spec.ts`
Expected: PASS

- [ ] **Step 6: 플래그를 syncFromSnapshot 까지 배선한다**

`syncFromSnapshot` 시그니처(299행)를 바꾼다:

```typescript
  async syncFromSnapshot(
    snapshot: PimProductSnapshot,
    options?: { skipCategorySync?: boolean; isBulk?: boolean },
  ): Promise<SyncResult> {
```

`handleActiveVersionChanged`(450행)에서 넘긴다. 현재 `syncFromSnapshot` 을 부르는 자리에 `isBulk` 를 더한다:

```typescript
    const isBulk = isBulkOrigin(event.origin);
```

그리고 그 함수 안의 `syncFromSnapshot(...)` 호출마다 `isBulk` 를 옵션에 실어 보낸다. 이 단계에서는 플래그를 아직 아무도 읽지 않는다 — 배선만 한다.

- [ ] **Step 7: 타입체크와 기존 테스트를 돌린다**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 기준선 대비 신규 에러 0 (기준선은 162건, 메모리 `lint-scope-caveat` 참조)

Run: `npx jest --runTestsByPath apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.spec.ts`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add apps/channel-adapter/src/types.ts apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.ts apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(channel-adapter): 동기화에 대량 출처 판정을 들인다

core 가 payload 에 싣는 origin 이 TS 타입엔 없어 핸들러가 대량 여부를 몰랐다.
타입에 선언하고 isBulkOrigin 으로 판정해 syncFromSnapshot 까지 배선한다.
모르는 출처는 단건으로 본다 — 즉시 반영이 안전한 기본값이다.

Claude-Session: https://claude.ai/code/session_01RxLvaYzJJXi76zMB1J5RCL
EOF
)"
```

---

## Task 2: 신규 상품의 price list `remove` 제거 (A1)

`syncPriceLists` 는 가격을 넣기 전에 항상 먼저 지운다. 신규 생성 상품에는 지울 것이 없는데도 그렇다. 측정값으로 이 호출은 상품당 3.30초, 대량등록 Medusa 비용의 31%다.

`upsertProduct` 가 이미 `action: 'created' | 'updated'` 를 돌려주는데(`medusa.client.ts:1674`) 호출부(`:378`)가 받아놓고 `syncPriceLists`(`:389`)에는 넘기지 않는다.

**Files:**
- Modify: `apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.ts:378-389`, `:567-636`
- Test: `apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.spec.ts`

**Interfaces:**
- Consumes: `upsertProduct` 의 `action: 'created' | 'updated'` (기존)
- Produces: `syncPriceLists(snapshot, productId, variants, opts: { skipRemove: boolean })` — Task 4 가 같은 진입점을 버퍼로 바꾼다

- [ ] **Step 1: 사전 확인 — `action='created'` 를 믿어도 되는지 읽는다**

`medusa.client.ts:1674-1714` 를 읽고 `action: 'created'` 가 반환되는 경로가 **정말로 상품이 새로 만들어진 경우뿐인지** 확인한다. `:1683` 과 `:1706` 은 `'updated'`, `:1714` 가 `'created'` 다.

확인할 것: 매핑 기록이 실패한 뒤 재시도돼서, 상품은 이미 Medusa 에 있는데 `medusaProductId` 인자가 `undefined` 로 들어오는 경로가 있는가. 있다면 그 경로에서 handle 로 기존 상품을 찾아 `'updated'` 로 빠지는지.

**`'created'` 인데 상품이 이미 존재할 수 있다면 이 태스크를 중단하고 사람에게 보고한다.** 그 경우 remove 를 건너뛰면 가격이 중복 누적된다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

기존 `describe('PimMedusaSyncService.syncPriceLists (replace semantics)')` 블록(`:151-223`)이 이미 `createService()` 헬퍼를 갖고 있고, `syncPriceLists` 를 `(service as any).syncPriceLists(snapshot, 'prod_1', medusaVariants)` 로 직접 부른다. **그 블록 안에 그 스타일로 추가한다.** 새 헬퍼를 만들지 않는다.

```typescript
  it('신규 생성 상품이면 remove 를 건너뛰고 add 만 한다', async () => {
    const { service, medusaClient, calls } = createService();
    const snapshot = {
      variants: [{ id: 'pim-var-1', membershipPrice: 34000, tieredPrices: [] }],
    };
    const medusaVariants = [{ id: 'variant_m1', metadata: { pimVariantId: 'pim-var-1' } }];

    await (service as any).syncPriceLists(snapshot, 'prod_1', medusaVariants, { skipRemove: true });

    expect(medusaClient.removeProductFromPriceList).not.toHaveBeenCalled();
    expect(medusaClient.addPricesToPriceList).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['add']);
  });

  it('기존 상품이면 지금까지대로 remove 후 add 한다', async () => {
    const { service, medusaClient, calls } = createService();
    const snapshot = {
      variants: [{ id: 'pim-var-1', membershipPrice: 34000, tieredPrices: [] }],
    };
    const medusaVariants = [{ id: 'variant_m1', metadata: { pimVariantId: 'pim-var-1' } }];

    await (service as any).syncPriceLists(snapshot, 'prod_1', medusaVariants, { skipRemove: false });

    expect(medusaClient.removeProductFromPriceList).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['remove', 'add']);
  });
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx jest --runTestsByPath apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.spec.ts`
Expected: FAIL — "신규 생성 상품이면" 케이스에서 `removeProductFromPriceList` 가 1회 호출됨. 기존 2건은 계속 PASS 여야 한다

- [ ] **Step 4: 구현한다**

`:389` 의 호출을 바꾼다:

```typescript
      await this.syncPriceLists(snapshot, product.id, product.variants, {
        // 신규 생성 상품은 price list 에 항목이 있을 수 없다. remove 는 상품당 3.30초로
        // 상품 생성(2.86초)보다 비싼 호출이라 건너뛰는 값어치가 크다.
        skipRemove: action === 'created',
      });
```

`syncPriceLists` 시그니처와 두 remove 호출을 바꾼다 (`:567`, `:620`, `:633`). **`opts` 는 기본값이 있는 선택 인자여야 한다** — 기존 테스트 2건이 3개 인자로 호출하고 있고, 그 둘은 "remove 후 add" 를 계속 검증해야 하는 유효한 스펙이다:

```typescript
  private async syncPriceLists(
    snapshot: PimProductSnapshot,
    medusaProductId: string,
    medusaVariants: MedusaProduct['variants'] | undefined,
    opts: { skipRemove?: boolean } = {},
  ): Promise<void> {
```

`:620`·`:633` 에서는 `if (!opts.skipRemove)` 로 감싼다 — 기본값 `{}` 면 `undefined` 라 지금까지대로 remove 를 탄다.

`:620` 과 `:633` 의 remove 를 각각 감싼다:

```typescript
      if (!opts.skipRemove) {
        await this.medusaClient.removeProductFromPriceList(listId, medusaProductId);
      }
      await this.medusaClient.addPricesToPriceList(listId, membershipPrices);
```

기존 주석(`:616-619`)은 그대로 둔다 — `updated` 경로에서는 여전히 유효한 설명이다. 그 아래에 한 줄만 덧붙인다:

```typescript
      // 신규 생성 상품은 지울 항목이 없으므로 skipRemove 로 건너뛴다.
```

- [ ] **Step 5: 테스트 통과를 확인한다**

Run: `npx jest --runTestsByPath apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.spec.ts`
Expected: PASS (신규 2건 포함 전부)

- [ ] **Step 6: 커밋**

```bash
git add apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.ts apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.spec.ts
git commit -m "$(cat <<'EOF'
fix(channel-adapter): 신규 상품의 price list remove 호출을 걷어낸다

remove 는 상품당 3.30초로 상품 생성(2.86초)보다 비싸다. 신규 생성 상품은
price list 에 지울 항목이 없는데도 매번 불렀다. upsertProduct 가 이미
돌려주던 action 을 syncPriceLists 로 넘겨 분기한다.

대량등록 Medusa 비용의 31% 에 해당한다.

Claude-Session: https://claude.ai/code/session_01RxLvaYzJJXi76zMB1J5RCL
EOF
)"
```

---

## Task 3: storefront revalidate 배치화 (B)

상품마다 `revalidateProduct` 를 await 하는데, 측정 구간 771건 중 762건이 5초 타임아웃이었다. storefront 쪽은 770/770 완료하므로 **기다림 자체가 무의미**하다. 더 큰 문제는 라우트가 호출 한 번마다 `PRODUCT_LIST_TAG` 전역과 모든 카테고리 페이지를 무효화한다는 것 — 17시간 동안 2,553번이면 캐시가 데워질 틈이 없다.

**Files:**
- Create: `apps/channel-adapter/src/adapters/medusa/deferred-revalidate.service.ts`
- Create: `apps/channel-adapter/src/adapters/medusa/deferred-revalidate.service.spec.ts`
- Modify: `apps/channel-adapter/src/adapters/medusa/storefront-revalidate.service.ts`
- Modify: `apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.ts:400`
- Modify: `apps/channel-adapter/src/adapter.module.ts:273` 부근 providers
- Modify: `deployments/lcnine/services/infra/services.ts:242` 부근

**Interfaces:**
- Consumes: `SyncFromSnapshotOptions.isBulk` (Task 1)
- Produces: `StorefrontRevalidateService.revalidateProducts(handles: string[]): Promise<void>`
- Produces: `DeferredRevalidateService.enqueue(handle: string): void` / `flush(): Promise<void>`

- [ ] **Step 1: 다건 무효화의 실패하는 테스트를 쓴다**

`storefront-revalidate.service.spec.ts` 에 추가:

```typescript
  it('여러 handle 을 한 번의 요청으로 보낸다', async () => {
    await new StorefrontRevalidateService().revalidateProducts(['m1', 'm2', 'm3']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      tags: ['product-m1', 'pim-detail-m1', 'product-m2', 'pim-detail-m2', 'product-m3', 'pim-detail-m3'],
      paths: [],
    });
  });

  it('handle 이 없으면 호출하지 않는다', async () => {
    await new StorefrontRevalidateService().revalidateProducts([]);

    expect(fetchMock).not.toHaveBeenCalled();
  });
```

**설계 근거:** 다건 경로는 `handle` 필드를 쓰지 않고 `tags` 만 쓴다. 라우트(`route.ts:73-86`)는 `handle` 이 있을 때만 `PRODUCT_LIST_TAG` 전역 무효화와 국가별 `revalidatePath` 를 도는데, 그건 호출 1회당 1번이면 충분하고 handle 마다 반복할 필요가 없다. 대신 `product-{handle}` 태그를 직접 실어 개별 상품 캐시를 정확히 지운다. 전역 목록 태그는 아래 Step 4 에서 flush 당 1회만 친다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --runTestsByPath apps/channel-adapter/src/adapters/medusa/storefront-revalidate.service.spec.ts`
Expected: FAIL — `revalidateProducts is not a function`

- [ ] **Step 3: 다건 메서드를 구현한다**

`storefront-revalidate.service.ts` 에 추가:

```typescript
  /**
   * 여러 상품을 한 번에 무효화한다. 대량등록처럼 상품이 연달아 바뀔 때 쓴다.
   *
   * 단건 `revalidateProduct` 와 달리 `handle` 필드를 쓰지 않는다 — 라우트는 handle 이
   * 있으면 전역 목록 태그와 국가별 경로를 도는데, 그건 배치당 1회면 족하다.
   * 개별 상품 캐시는 `product-{handle}` 태그로 정확히 지운다.
   */
  async revalidateProducts(handles: string[]): Promise<void> {
    if (handles.length === 0) return;

    const tags = handles.flatMap((h) => [`product-${h}`, `pim-detail-${h}`]);
    await this.post({ tags, paths: [] }, `batch=${handles.length}`);
  }
```

- [ ] **Step 4: 테스트 통과를 확인한다**

Run: `npx jest --runTestsByPath apps/channel-adapter/src/adapters/medusa/storefront-revalidate.service.spec.ts`
Expected: PASS

- [ ] **Step 5: 버퍼 서비스의 실패하는 테스트를 쓴다**

`deferred-revalidate.service.spec.ts` 생성:

```typescript
import { DeferredRevalidateService } from './deferred-revalidate.service';
import { StorefrontRevalidateService } from './storefront-revalidate.service';

describe('DeferredRevalidateService', () => {
  let revalidate: jest.Mocked<Pick<StorefrontRevalidateService, 'revalidateProducts'>>;
  let service: DeferredRevalidateService;

  beforeEach(() => {
    revalidate = { revalidateProducts: jest.fn().mockResolvedValue(undefined) };
    service = new DeferredRevalidateService(
      revalidate as unknown as StorefrontRevalidateService,
      { get: () => undefined } as never,
    );
  });

  it('누적한 handle 을 flush 에서 한 번에 보낸다', async () => {
    service.enqueue('m1');
    service.enqueue('m2');

    await service.flush();

    expect(revalidate.revalidateProducts).toHaveBeenCalledTimes(1);
    expect(revalidate.revalidateProducts).toHaveBeenCalledWith(['m1', 'm2']);
  });

  it('같은 handle 이 여러 번 들어와도 한 번만 보낸다', async () => {
    service.enqueue('m1');
    service.enqueue('m1');

    await service.flush();

    expect(revalidate.revalidateProducts).toHaveBeenCalledWith(['m1']);
  });

  it('버퍼가 비면 호출하지 않는다', async () => {
    await service.flush();

    expect(revalidate.revalidateProducts).not.toHaveBeenCalled();
  });

  it('flush 가 실패해도 예외를 밖으로 내지 않는다 — 캐시 지연은 동기화를 막을 이유가 아니다', async () => {
    revalidate.revalidateProducts.mockRejectedValue(new Error('boom'));
    service.enqueue('m1');

    await expect(service.flush()).resolves.toBeUndefined();
  });

  it('flush 실패분은 버려진다 — 다음 flush 를 무한히 오염시키지 않는다', async () => {
    revalidate.revalidateProducts.mockRejectedValueOnce(new Error('boom'));
    service.enqueue('m1');
    await service.flush();

    revalidate.revalidateProducts.mockClear();
    await service.flush();

    expect(revalidate.revalidateProducts).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npx jest --runTestsByPath apps/channel-adapter/src/adapters/medusa/deferred-revalidate.service.spec.ts`
Expected: FAIL — 모듈을 찾을 수 없음

- [ ] **Step 7: 버퍼 서비스를 구현한다**

`deferred-revalidate.service.ts` 생성:

```typescript
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorefrontRevalidateService } from './storefront-revalidate.service';

const DEFAULT_FLUSH_INTERVAL_MS = 60_000;

/**
 * 대량등록 중의 storefront 캐시 무효화를 모아서 한 번에 친다.
 *
 * 단건 경로는 상품마다 즉시 무효화하는데, 그 라우트는 호출마다 전역 목록 태그와
 * 모든 카테고리 페이지를 지운다. 대량등록이 그걸 상품 수만큼 부르면 캐시가 데워질
 * 틈이 없다 (실측: 5시간에 770회). 여기 모았다가 주기마다 1회만 친다.
 *
 * 버퍼는 인메모리다. 프로세스가 죽으면 그 주기분은 유실되고, 해당 상품은 캐시 TTL
 * (1시간) 까지 낡은 채로 남는다. 가격·재고가 아니라 캐시라 이 정도는 허용한다.
 */
@Injectable()
export class DeferredRevalidateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeferredRevalidateService.name);
  private readonly pending = new Set<string>();
  private readonly flushIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly storefrontRevalidate: StorefrontRevalidateService,
    private readonly configService: ConfigService,
  ) {
    const raw = this.configService.get<string | number | undefined>('DEFERRED_REVALIDATE_FLUSH_MS');
    const parsed = Number(raw);
    this.flushIntervalMs =
      raw === undefined || raw === null || raw === '' || !Number.isInteger(parsed) || parsed < 1000
        ? DEFAULT_FLUSH_INTERVAL_MS
        : parsed;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.logger.log(`Deferred revalidate started (flushIntervalMs=${this.flushIntervalMs}ms)`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // 정상 종료(배포 등)에서는 남은 버퍼를 흘려보낸다.
    await this.flush();
  }

  enqueue(handle: string): void {
    this.pending.add(handle);
  }

  async flush(): Promise<void> {
    if (this.pending.size === 0) return;

    // 먼저 비운다 — 실패해도 다음 주기를 오염시키지 않는다. 최악은 캐시가 TTL 까지 낡는 것.
    const handles = [...this.pending];
    this.pending.clear();

    try {
      await this.storefrontRevalidate.revalidateProducts(handles);
      this.logger.log(`Deferred revalidate flushed: ${handles.length} handles`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Deferred revalidate flush failed (${handles.length} handles): ${message}`);
    }
  }
}
```

- [ ] **Step 8: 테스트 통과를 확인한다**

Run: `npx jest --runTestsByPath apps/channel-adapter/src/adapters/medusa/deferred-revalidate.service.spec.ts`
Expected: PASS (5건)

- [ ] **Step 9: 동기화 경로를 분기한다**

`pim-medusa-sync.service.ts` 생성자에 `DeferredRevalidateService` 를 주입하고, `:400` 을 바꾼다:

```typescript
      // 대량등록은 상품마다 무효화하면 전역 목록 태그를 상품 수만큼 지우게 된다.
      // 버퍼에 모았다가 주기마다 한 번만 친다. 단건은 지금까지대로 즉시 반영.
      if (options?.isBulk) {
        this.deferredRevalidate.enqueue(medusaPayload.handle);
      } else {
        await this.storefrontRevalidate.revalidateProduct(medusaPayload.handle);
      }
```

**생성자 인자가 늘어나면 기존 스펙이 깨진다.** `pim-medusa-sync.service.spec.ts` 에서 서비스를 직접 `new PimMedusaSyncService(medusaClient as any, mappingRepo as any, storefrontRevalidate as any)` 로 만드는 자리가 최소 `:177` 에 있고, 다른 describe 블록도 `Test.createTestingModule` 스타일로 만든다(`:226` 부근). **두 스타일 전부 새 의존을 추가해야 한다.** `grep -n "new PimMedusaSyncService\|PimMedusaSyncService," apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.spec.ts` 로 전수한 뒤 고친다.

- [ ] **Step 9b: 핸들러 종료 로그를 남긴다**

이 태스크가 대량 경로의 revalidate 로그를 없애는데, 그게 지금까지 핸들러 종료 표지로 쓰이던 로그다(§재측정 참조). 대체 표지를 만든다. `syncFromSnapshot` 의 반환 직전(`:400` 블록 다음)에 추가:

```typescript
      // 핸들러 종료 표지. 'Sync completed'(:387) 는 price list 와 revalidate 앞이라
      // 종료 시점이 아니다 — 전후 성능 비교가 이 로그에 걸린다.
      this.logger.log(`Sync finished: ${masterId} (${Date.now() - startedAt}ms)`);
```

함수 진입부(`:300` `const { masterId, versionId } = snapshot;` 아래)에 `const startedAt = Date.now();` 를 더한다.

- [ ] **Step 10: provider 를 등록한다**

`apps/channel-adapter/src/adapter.module.ts` 의 import 목록과 `providers` 배열(273행 부근 `InboxWorkerService` 옆)에 `DeferredRevalidateService` 를 추가한다.

- [ ] **Step 11: 환경변수를 추가한다**

`deployments/lcnine/services/infra/services.ts` 의 channel-adapter env 블록(242행 부근, `INBOX_SHUTDOWN_DRAIN_MS` 아래)에 추가:

```typescript
    DEFERRED_REVALIDATE_FLUSH_MS: '60000',
```

- [ ] **Step 12: 전체 테스트와 타입체크**

Run: `npx jest --runTestsByPath apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.spec.ts apps/channel-adapter/src/adapters/medusa/deferred-revalidate.service.spec.ts apps/channel-adapter/src/adapters/medusa/storefront-revalidate.service.spec.ts`
Expected: PASS

Run: `npx nest build channel-adapter`
Expected: 성공

- [ ] **Step 13: 커밋**

```bash
git add apps/channel-adapter/src/adapters/medusa/ apps/channel-adapter/src/adapter.module.ts deployments/lcnine/services/infra/services.ts
git commit -m "$(cat <<'EOF'
perf(channel-adapter): 대량등록의 storefront 무효화를 모아서 한 번에 친다

revalidate 라우트는 호출마다 전역 목록 태그와 모든 카테고리 페이지를 지운다.
대량등록이 상품마다 부르면 캐시가 데워질 틈이 없다 (실측 5시간 770회).
버퍼에 모았다가 60초마다 1회만 친다. 단건 경로는 즉시 반영 그대로 둔다.

호출자가 5초 타임아웃으로 기다리던 것도 사라진다 — storefront 쪽은 770/770
완료하고 있었으므로 그 기다림은 처음부터 무의미했다 (상품당 5.0초).

Claude-Session: https://claude.ai/code/session_01RxLvaYzJJXi76zMB1J5RCL
EOF
)"
```

---

## Task 4: price list 교차 상품 배치화 (A2)

> **이 태스크는 durability 를 거래한다.** 인메모리 버퍼에 가격을 모으므로 프로세스가 비정상 종료하면 그 주기분의 멤버십·티어 가격이 Medusa 에 반영되지 않은 채 사라진다. 유실을 감지하는 장치가 없다. Task 1~3 만으로도 상품당 15.6초·소요 6.5시간에 도달하므로, **여기서 멈추고 재측정한 뒤 진행 여부를 판단해도 된다.**

**Files:**
- Create: `apps/channel-adapter/src/adapters/medusa/deferred-price-list.service.ts`
- Create: `apps/channel-adapter/src/adapters/medusa/deferred-price-list.service.spec.ts`
- Modify: `apps/channel-adapter/src/adapters/medusa/medusa.client.ts` (배치 메서드 추가)
- Modify: `apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.ts:567-636`
- Modify: `apps/channel-adapter/src/adapter.module.ts`, `deployments/lcnine/services/infra/services.ts`

**Interfaces:**
- Consumes: `SyncFromSnapshotOptions.isBulk` (Task 1), `skipRemove` 판정 (Task 2)
- Produces: `MedusaClient.batchPriceListPrices(listId, { create, deleteProductIds }): Promise<void>`
- Produces: `DeferredPriceListService.enqueue(listId, prices, opts): void` / `flush(): Promise<void>`

- [ ] **Step 1: 배치 클라이언트 메서드의 실패하는 테스트를 쓴다**

`medusa.client.spec.ts` 에 추가:

```typescript
describe('batchPriceListPrices', () => {
  it('삭제 대상 상품이 없으면 create 만 한 번 보낸다', async () => {
    const client = makeClient();                 // 기존 스펙 헬퍼
    await client.batchPriceListPrices('plist_1', {
      create: [{ amount: 1000, currency_code: 'krw', variant_id: 'var_1' }],
      deleteProductIds: [],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/admin/price-lists/plist_1/prices/batch');
    expect(fetchMock.mock.calls[0][1].body).toEqual({
      create: [{ amount: 1000, currency_code: 'krw', variant_id: 'var_1' }],
    });
  });

  it('삭제 대상이 있으면 remove 를 먼저 한 번 보낸다', async () => {
    const client = makeClient();
    await client.batchPriceListPrices('plist_1', {
      create: [{ amount: 1000, currency_code: 'krw', variant_id: 'var_1' }],
      deleteProductIds: ['prod_1', 'prod_2'],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/admin/price-lists/plist_1/products');
    expect(fetchMock.mock.calls[0][1].body).toEqual({ remove: ['prod_1', 'prod_2'] });
    expect(fetchMock.mock.calls[1][0]).toBe('/admin/price-lists/plist_1/prices/batch');
  });

  it('create 도 삭제 대상도 없으면 아무것도 보내지 않는다', async () => {
    const client = makeClient();
    await client.batchPriceListPrices('plist_1', { create: [], deleteProductIds: [] });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --runTestsByPath apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts -t batchPriceListPrices`
Expected: FAIL — `batchPriceListPrices is not a function`

- [ ] **Step 3: 배치 클라이언트 메서드를 구현한다**

`medusa.client.ts` 의 `addPricesToPriceList`(2168행) 아래에 추가:

```typescript
  /**
   * 여러 상품의 price list 가격을 한 번에 정리한다.
   *
   * 단건 경로(`removeProductFromPriceList` + `addPricesToPriceList`)는 상품당 3.30초 +
   * 3.28초다. 비용의 대부분은 가격 데이터가 아니라 호출당 고정비다 — Medusa 의
   * `batchPriceListPricesWorkflow` 가 create/update/remove 세 중첩 워크플로를 항상
   * 전부 돌리고, 빈 하위 워크플로도 조기 반환 가드를 통과해 쿼리를 낸다.
   * 그래서 상품 수만큼 부르는 대신 한 번에 몰아 넣는다.
   *
   * `remove` 는 Medusa 가 productId 로 price id 를 서버측에서 찾아주므로 별도 조회가 없다.
   */
  async batchPriceListPrices(
    priceListId: string,
    input: {
      create: Array<{
        amount: number;
        currency_code: string;
        variant_id: string;
        min_quantity?: number;
        max_quantity?: number;
      }>;
      deleteProductIds: string[];
    },
  ): Promise<void> {
    if (input.deleteProductIds.length === 0 && input.create.length === 0) return;

    try {
      if (input.deleteProductIds.length > 0) {
        await this.sdk.client.fetch(`/admin/price-lists/${priceListId}/products`, {
          method: 'post',
          body: { remove: input.deleteProductIds },
        });
      }

      if (input.create.length > 0) {
        await this.sdk.client.fetch(`/admin/price-lists/${priceListId}/prices/batch`, {
          method: 'post',
          body: { create: input.create },
        });
      }

      this.logger.log(
        `Batched price list ${priceListId}: removed ${input.deleteProductIds.length} products, ` +
          `created ${input.create.length} prices`,
      );
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.error(`Failed to batch price list ${priceListId}: ${fetchError.message}`);
      throw new Error(`Medusa batchPriceListPrices failed: ${fetchError.message}`);
    }
  }
```

- [ ] **Step 4: 테스트 통과를 확인한다**

Run: `npx jest --runTestsByPath apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts -t batchPriceListPrices`
Expected: PASS (3건)

- [ ] **Step 5: 버퍼 서비스의 실패하는 테스트를 쓴다**

`deferred-price-list.service.spec.ts` 생성:

```typescript
import { DeferredPriceListService } from './deferred-price-list.service';
import { MedusaClient } from './medusa.client';

describe('DeferredPriceListService', () => {
  let client: jest.Mocked<Pick<MedusaClient, 'batchPriceListPrices'>>;
  let service: DeferredPriceListService;

  const price = (variantId: string) => ({ amount: 1000, currency_code: 'krw', variant_id: variantId });

  beforeEach(() => {
    client = { batchPriceListPrices: jest.fn().mockResolvedValue(undefined) };
    service = new DeferredPriceListService(client as unknown as MedusaClient, { get: () => undefined } as never);
  });

  it('같은 price list 의 가격을 한 번의 배치로 합친다', async () => {
    service.enqueue('plist_1', [price('var_1')], { productId: 'prod_1', skipRemove: true });
    service.enqueue('plist_1', [price('var_2')], { productId: 'prod_2', skipRemove: true });

    await service.flush();

    expect(client.batchPriceListPrices).toHaveBeenCalledTimes(1);
    expect(client.batchPriceListPrices).toHaveBeenCalledWith('plist_1', {
      create: [price('var_1'), price('var_2')],
      deleteProductIds: [],
    });
  });

  it('price list 가 다르면 각각 보낸다', async () => {
    service.enqueue('plist_1', [price('var_1')], { productId: 'prod_1', skipRemove: true });
    service.enqueue('plist_2', [price('var_2')], { productId: 'prod_2', skipRemove: true });

    await service.flush();

    expect(client.batchPriceListPrices).toHaveBeenCalledTimes(2);
  });

  it('기존 상품만 삭제 대상에 넣는다', async () => {
    service.enqueue('plist_1', [price('var_1')], { productId: 'prod_new', skipRemove: true });
    service.enqueue('plist_1', [price('var_2')], { productId: 'prod_old', skipRemove: false });

    await service.flush();

    expect(client.batchPriceListPrices).toHaveBeenCalledWith('plist_1', {
      create: [price('var_1'), price('var_2')],
      deleteProductIds: ['prod_old'],
    });
  });

  it('한 price list 가 실패해도 나머지는 보낸다', async () => {
    client.batchPriceListPrices.mockRejectedValueOnce(new Error('boom'));
    service.enqueue('plist_1', [price('var_1')], { productId: 'prod_1', skipRemove: true });
    service.enqueue('plist_2', [price('var_2')], { productId: 'prod_2', skipRemove: true });

    await service.flush();

    expect(client.batchPriceListPrices).toHaveBeenCalledTimes(2);
  });

  it('실패한 배치의 상품 id 를 error 로 남긴다 — 유실을 사람이 찾을 수 있어야 한다', async () => {
    const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation();
    client.batchPriceListPrices.mockRejectedValueOnce(new Error('boom'));
    service.enqueue('plist_1', [price('var_1')], { productId: 'prod_1', skipRemove: true });

    await service.flush();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('prod_1'));
  });

  it('버퍼가 비면 호출하지 않는다', async () => {
    await service.flush();

    expect(client.batchPriceListPrices).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npx jest --runTestsByPath apps/channel-adapter/src/adapters/medusa/deferred-price-list.service.spec.ts`
Expected: FAIL — 모듈을 찾을 수 없음

- [ ] **Step 7: 버퍼 서비스를 구현한다**

`deferred-price-list.service.ts` 생성:

```typescript
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MedusaClient } from './medusa.client';

const DEFAULT_FLUSH_INTERVAL_MS = 30_000;

type PriceInput = {
  amount: number;
  currency_code: string;
  variant_id: string;
  min_quantity?: number;
  max_quantity?: number;
};

type PendingList = {
  create: PriceInput[];
  deleteProductIds: string[];
  productIds: string[];
};

/**
 * 대량등록의 price list 쓰기를 모아서 한 번에 보낸다.
 *
 * 단건 경로는 상품당 remove 3.30초 + add 3.28초인데, 비용의 대부분이 호출당 고정비라
 * 여러 상품을 한 배치로 합치면 거의 사라진다 (실측 근거는 설계서 §5-A).
 *
 * 버퍼는 인메모리다. **프로세스가 비정상 종료하면 그 주기분의 가격이 유실되고, 해당
 * 상품은 기본가로 노출된다** (멤버십·티어 할인이 빠진 더 비싼 가격이라 미수금은 안 생긴다).
 * 유실 시 상품 id 를 error 로 남기므로 재게시로 복구할 수 있다. flush 주기를 30초로
 * 짧게 잡은 이유가 이 노출 창을 줄이는 것이다.
 */
@Injectable()
export class DeferredPriceListService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeferredPriceListService.name);
  private readonly pending = new Map<string, PendingList>();
  private readonly flushIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly medusaClient: MedusaClient,
    private readonly configService: ConfigService,
  ) {
    const raw = this.configService.get<string | number | undefined>('DEFERRED_PRICE_LIST_FLUSH_MS');
    const parsed = Number(raw);
    this.flushIntervalMs =
      raw === undefined || raw === null || raw === '' || !Number.isInteger(parsed) || parsed < 1000
        ? DEFAULT_FLUSH_INTERVAL_MS
        : parsed;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.logger.log(`Deferred price list started (flushIntervalMs=${this.flushIntervalMs}ms)`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  enqueue(
    priceListId: string,
    prices: PriceInput[],
    opts: { productId: string; skipRemove: boolean },
  ): void {
    const entry = this.pending.get(priceListId) ?? { create: [], deleteProductIds: [], productIds: [] };
    entry.create.push(...prices);
    entry.productIds.push(opts.productId);
    if (!opts.skipRemove) {
      entry.deleteProductIds.push(opts.productId);
    }
    this.pending.set(priceListId, entry);
  }

  async flush(): Promise<void> {
    if (this.pending.size === 0) return;

    const batches = [...this.pending.entries()];
    this.pending.clear();

    for (const [priceListId, entry] of batches) {
      try {
        await this.medusaClient.batchPriceListPrices(priceListId, {
          create: entry.create,
          deleteProductIds: entry.deleteProductIds,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // 유실이다. 재게시로만 복구되므로 상품 id 를 남겨 사람이 찾을 수 있게 한다.
        this.logger.error(
          `Deferred price list flush failed for ${priceListId} (${message}). ` +
            `Lost prices for products: ${entry.productIds.join(', ')}`,
        );
      }
    }
  }
}
```

- [ ] **Step 8: 테스트 통과를 확인한다**

Run: `npx jest --runTestsByPath apps/channel-adapter/src/adapters/medusa/deferred-price-list.service.spec.ts`
Expected: PASS (6건)

- [ ] **Step 9: syncPriceLists 를 버퍼로 분기한다**

`pim-medusa-sync.service.ts` 생성자에 `DeferredPriceListService` 를 주입하고, `syncPriceLists` 시그니처에 `isBulk` 를 더한다. `:620` 과 `:633` 의 두 블록을 각각 바꾼다 (멤버십 블록 예시, 티어 블록도 동일하게):

```typescript
      if (opts.isBulk) {
        this.deferredPriceList.enqueue(listId, membershipPrices, {
          productId: medusaProductId,
          skipRemove: opts.skipRemove,
        });
      } else {
        if (!opts.skipRemove) {
          await this.medusaClient.removeProductFromPriceList(listId, medusaProductId);
        }
        await this.medusaClient.addPricesToPriceList(listId, membershipPrices);
      }
```

호출부(`:389`)에 `isBulk` 를 더한다:

```typescript
      await this.syncPriceLists(snapshot, product.id, product.variants, {
        skipRemove: action === 'created',
        isBulk: options?.isBulk ?? false,
      });
```

- [ ] **Step 10: 배치 경로의 통합 테스트를 쓴다**

`pim-medusa-sync.service.spec.ts` 에 추가:

```typescript
  it('대량 경로에서는 price list 를 즉시 호출하지 않고 버퍼에 넣는다', async () => {
    const { service, medusaClient } = createService();
    const deferred = { enqueue: jest.fn() };
    (service as any).deferredPriceList = deferred;
    const snapshot = { variants: [{ id: 'pim-var-1', membershipPrice: 34000, tieredPrices: [] }] };
    const medusaVariants = [{ id: 'variant_m1', metadata: { pimVariantId: 'pim-var-1' } }];

    await (service as any).syncPriceLists(snapshot, 'prod_1', medusaVariants, {
      isBulk: true,
      skipRemove: true,
    });

    expect(medusaClient.addPricesToPriceList).not.toHaveBeenCalled();
    expect(medusaClient.removeProductFromPriceList).not.toHaveBeenCalled();
    expect(deferred.enqueue).toHaveBeenCalledWith(
      'plist_membership',
      [{ amount: 34000, currency_code: 'krw', variant_id: 'variant_m1' }],
      { productId: 'prod_1', skipRemove: true },
    );
  });

  it('단건 경로는 지금까지대로 즉시 호출한다', async () => {
    const { service, medusaClient, calls } = createService();
    const snapshot = { variants: [{ id: 'pim-var-1', membershipPrice: 34000, tieredPrices: [] }] };
    const medusaVariants = [{ id: 'variant_m1', metadata: { pimVariantId: 'pim-var-1' } }];

    await (service as any).syncPriceLists(snapshot, 'prod_1', medusaVariants, { isBulk: false });

    expect(medusaClient.removeProductFromPriceList).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['remove', 'add']);
  });

  it('멤버십과 티어가 함께 있으면 price list 별로 각각 버퍼에 넣는다', async () => {
    const { service } = createService();
    const deferred = { enqueue: jest.fn() };
    (service as any).deferredPriceList = deferred;
    const snapshot = {
      variants: [
        {
          id: 'pim-var-1',
          membershipPrice: 34000,
          tieredPrices: [{ minQuantity: 5, price: 9000 }],
        },
      ],
    };
    const medusaVariants = [{ id: 'variant_m1', metadata: { pimVariantId: 'pim-var-1' } }];

    await (service as any).syncPriceLists(snapshot, 'prod_1', medusaVariants, {
      isBulk: true,
      skipRemove: true,
    });

    expect(deferred.enqueue).toHaveBeenCalledTimes(2);
    const listIds = deferred.enqueue.mock.calls.map((c: unknown[]) => c[0]);
    expect(listIds).toEqual(['plist_membership', 'plist_Tiered_Prices_-_Min_5']);
  });
```

세 번째 테스트가 설계서 §9 의 "멤버십+티어 혼재" 케이스다. 두 price list 가 서로 섞이지 않는지를 본다.

- [ ] **Step 11: 등록·환경변수·검증**

`adapter.module.ts` providers 에 `DeferredPriceListService` 추가.
`services.ts` channel-adapter env 에 `DEFERRED_PRICE_LIST_FLUSH_MS: '30000'` 추가.

Run: `npx jest --runTestsByPath apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.spec.ts apps/channel-adapter/src/adapters/medusa/deferred-price-list.service.spec.ts apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts`
Expected: PASS

Run: `npx nest build channel-adapter`
Expected: 성공

- [ ] **Step 12: 커밋**

```bash
git add apps/channel-adapter/src/adapters/medusa/ apps/channel-adapter/src/adapter.module.ts deployments/lcnine/services/infra/services.ts
git commit -m "$(cat <<'EOF'
perf(channel-adapter): 대량등록의 price list 쓰기를 배치로 합친다

상품당 remove 3.30초 + add 3.28초인데 비용의 대부분이 호출당 고정비였다.
Medusa 의 batchPriceListPricesWorkflow 가 create/update/remove 세 중첩
워크플로를 항상 전부 돌리고, 빈 하위 워크플로도 조기 반환 가드를 통과해
쿼리를 낸다. 상품 수만큼 부르는 대신 30초마다 한 배치로 몰아 넣는다.

버퍼는 인메모리라 비정상 종료 시 그 주기분이 유실된다. 유실 상품 id 를
error 로 남겨 재게시로 복구할 수 있게 했다. 단건 경로는 즉시 호출 그대로.

Claude-Session: https://claude.ai/code/session_01RxLvaYzJJXi76zMB1J5RCL
EOF
)"
```

---

## Task 5: 인박스 클레임 측정 게이트 (C 선행)

> **이 태스크는 사람이 실행한다.** 프로덕션 DB 접근이 필요하고, 결과가 Task 6 의 두 갈래 중 하나를 고른다. 측정 없이 Task 6 을 시작하지 않는다.

슬롯이 비어도 다음 핸들러가 평균 16.9초 뒤에야 뜬다(3.5초 이내는 21%뿐, 최솟값은 정확히 틱 간격인 3.0초). 가설은 `claimNextInboxEvent`(`inbox-worker.service.ts:214`)의 `ORDER BY (bulk lane), created_at` 이 매 틱 후보 행 전부를 정렬한다는 것이다. 코드 주석 자체가 그렇게 적혀 있다.

- [ ] **Step 1: 터널을 연다**

```bash
cd deployments/lcnine/services && npx sst tunnel --stage live
```

- [ ] **Step 2: 적체 규모를 잰다**

```sql
SELECT status, count(*) FROM inbox_events GROUP BY status;
```

기록할 것: `pending` 행 수.

- [ ] **Step 3: 클레임 쿼리를 EXPLAIN 한다**

`inbox-worker.service.ts:214` 의 `claimNextInboxEvent` 가 만드는 SQL 을 그대로 옮겨 실행한다. 서비스 로그의 drizzle 쿼리 출력이나 코드에서 재구성한다.

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ... FROM inbox_events
WHERE status = 'pending' AND event_type IN (...)
ORDER BY (event_type IN (...) OR COALESCE(metadata->>'origin','') = 'bulk_import'), created_at
LIMIT 1;
```

기록할 것: 총 실행시간, `Seq Scan` 여부, `Sort` 노드의 행 수와 메모리.

- [ ] **Step 4: 기존 인덱스를 확인한다**

```sql
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'inbox_events';
```

- [ ] **Step 5: 갈래를 고른다**

| 관측 | 다음 태스크 |
|---|---|
| `Sort` 가 대부분의 시간을 먹고 정렬 대상 행이 pending 전체 | **Task 6-A (lane 컬럼 승격)** — 표현식 정렬은 인덱스로 못 받는다 |
| `Seq Scan` 이 지배적이고 정렬 대상은 적음 | **Task 6-B (부분 인덱스)** |
| 쿼리가 100ms 미만 | 가설 기각. 유휴의 원인이 다른 데 있다 — 재조사 필요, Task 6 중단 |

측정 결과를 설계서 §6 표에 적어 넣고 커밋한다.

---

## Task 6-A: 레인을 컬럼으로 승격 (Task 5 가 이 갈래를 가리킨 경우)

표현식 `ORDER BY` 는 인덱스로 받을 수 없다. 레인을 생성 컬럼으로 만들어 정렬을 인덱스에 태운다.

**Files:**
- Modify: `apps/channel-adapter/src/schema.ts` (`inbox_events` 테이블 정의가 여기 있다)
- Create: `apps/channel-adapter/drizzle/<timestamp>_add-inbox-lane-column.sql` (생성됨)
- Modify: `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts:214-260`
- Test: `apps/channel-adapter/src/adapters/medusa/inbox-claim-order.integration.spec.ts` (기존 파일)

- [ ] **Step 1: 기존 순서 스펙이 초록인지 먼저 확인한다**

Run: `npm run test:inbox-claim-order:integration`
Expected: PASS. 여기서 실패하면 그건 이 태스크와 무관한 선행 문제다 — 먼저 보고한다.

- [ ] **Step 2: 스키마에 생성 컬럼을 더한다**

`inbox_events` 테이블 정의에 추가:

```typescript
  // 강등 레인. ORDER BY 표현식을 인덱스로 받으려고 컬럼으로 승격했다.
  // 0 = 일반(멤버십·배송 등 고객이 즉시 체감), 1 = 대량(재고 재계산·대량등록).
  lane: smallint('lane')
    .notNull()
    .default(0),
```

- [ ] **Step 3: 마이그레이션을 생성한다**

```bash
npm run db:generate:channel-adapter -- --name add-inbox-lane-column
```

생성된 SQL 을 읽는다. 컬럼 추가 + 기본값이어야 한다. 여기에 인덱스와 백필을 손으로 덧붙인다:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS inbox_events_pending_lane_idx
  ON inbox_events (lane, created_at)
  WHERE status = 'pending';

UPDATE inbox_events
SET lane = 1
WHERE status = 'pending'
  AND (event_type IN ('ProductSellableQuantityChanged')
       OR COALESCE(metadata->>'origin', '') = 'bulk_import');
```

`CONCURRENTLY` 는 트랜잭션 밖에서만 돈다. drizzle 마이그레이션이 트랜잭션으로 감싸면 `--> statement-breakpoint` 로 분리하거나 인덱스를 별도 수동 단계로 뺀다. 생성된 파일을 읽고 판단한다.

- [ ] **Step 4: 쓰기 경로가 lane 을 채우게 한다**

`pim-product-event.consumer.ts:129` 부근의 inbox 행 생성에 `lane` 을 더한다. 판정은 지금 SQL 이 하던 것과 같은 규칙이다:

```typescript
        lane: params.origin && BULK_ORIGINS.includes(params.origin) ? 1 : 0,
```

다른 enqueue 경로(`InboxService.enqueue`)도 같은 규칙으로 채운다 — `grep -rn "inbox_events\|insert(.*inboxEvents" apps/channel-adapter/src --include=*.ts` 로 전수한다.

- [ ] **Step 5: 클레임 쿼리를 바꾼다**

`claimNextInboxEvent` 의 `ORDER BY` 를 표현식에서 컬럼으로 바꾼다:

```typescript
      .orderBy(inboxEvents.lane, inboxEvents.createdAt)
```

`bulkEventTypesSql` / `bulkOriginsSql` 구성 코드를 지운다. 주석은 왜 레인이 있는지 설명하는 부분만 남기고 "표현식이 전 행에 계산된다"는 대목은 컬럼으로 바뀌었으니 갱신한다.

- [ ] **Step 6: 순서 스펙이 여전히 초록인지 확인한다**

Run: `npm run test:inbox-claim-order:integration`
Expected: PASS — 강등 순서가 컬럼으로 바뀌어도 동일해야 한다

- [ ] **Step 7: EXPLAIN 을 다시 떠서 근거를 남긴다**

Task 5 Step 3 과 같은 쿼리를 새 계획으로 실행하고, 전후를 설계서 §6 에 적는다. `Index Scan` 으로 바뀌고 실행시간이 떨어져야 한다.

- [ ] **Step 8: 커밋**

```bash
git add apps/channel-adapter/database apps/channel-adapter/drizzle apps/channel-adapter/src docs/superpowers/specs
git commit -m "$(cat <<'EOF'
perf(channel-adapter): 인박스 강등 레인을 컬럼으로 승격한다

ORDER BY 표현식이 LIMIT 1 이어도 후보 행 전부에 계산돼, 적체가 크면 매 틱
전수 정렬이 됐다. 슬롯이 비어도 다음 핸들러가 평균 16.9초 뒤에 떴다
(3.5초 이내 21%). 레인을 컬럼으로 만들어 정렬을 부분 인덱스에 태운다.

강등 규칙 자체는 그대로다 — 대량 이벤트가 멤버십·배송을 밀어내지 않는다.

Claude-Session: https://claude.ai/code/session_01RxLvaYzJJXi76zMB1J5RCL
EOF
)"
```

---

## Task 6-B: 부분 인덱스만 추가 (Task 5 가 이 갈래를 가리킨 경우)

`Seq Scan` 이 지배적이고 정렬 대상 행은 적다면 컬럼 승격 없이 인덱스로 끝난다.

**Files:**
- Create: `apps/channel-adapter/drizzle/<timestamp>_add-inbox-pending-idx.sql`
- Modify: inbox_events 스키마 정의 (인덱스 선언)

- [ ] **Step 1: 스키마에 인덱스를 선언한다**

`inbox_events` 테이블 정의의 인덱스 블록에 추가:

```typescript
  pendingClaimIdx: index('inbox_events_pending_claim_idx')
    .on(table.eventType, table.createdAt)
    .where(sql`status = 'pending'`),
```

- [ ] **Step 2: 마이그레이션을 생성하고 읽는다**

```bash
npm run db:generate:channel-adapter -- --name add-inbox-pending-idx
```

생성된 SQL 을 읽고 `CREATE INDEX` 에 `CONCURRENTLY` 를 더한다 (운영 테이블에 락을 오래 잡지 않기 위해).

- [ ] **Step 3: 순서 스펙을 돌린다**

Run: `npm run test:inbox-claim-order:integration`
Expected: PASS

- [ ] **Step 4: EXPLAIN 전후를 설계서 §6 에 적는다**

- [ ] **Step 5: 커밋**

```bash
git add apps/channel-adapter/database apps/channel-adapter/drizzle docs/superpowers/specs
git commit -m "$(cat <<'EOF'
perf(channel-adapter): 인박스 클레임에 부분 인덱스를 붙인다

pending 행 스캔이 클레임 지연의 원인이었다. 슬롯이 비어도 다음 핸들러가
평균 16.9초 뒤에 떴다. status='pending' 부분 인덱스로 후보 집합을 좁힌다.

Claude-Session: https://claude.ai/code/session_01RxLvaYzJJXi76zMB1J5RCL
EOF
)"
```

---

## 배포 순서

1. **Task 1~3 을 먼저 배포한다** (마이그레이션 0건). channel-adapter 단독 배포.
2. 대량등록을 한 번 돌리고 재측정한다 — 상품당 소요, Medusa CPU, CloudFront 적중률.
3. Task 4 는 재측정 결과를 보고 진행 여부를 판단한다 (durability 거래가 값어치 있는지).
4. Task 5 측정 → Task 6-A 또는 6-B. **마이그레이션이 생기므로 `migrate → deploy` 순서다** (additive expand).
5. 설계서 §5-D(admin/store 분리)는 여기까지 끝난 뒤 재측정해서 결정한다. 이 계획의 범위 밖이다.

## 설계서 §6 미확정 항목의 처리

| 미확정 | 이 계획에서의 처리 |
|---|---|
| `action='created'` 신뢰성 | **Task 2 Step 1 이 게이트.** 확신 없으면 중단 |
| 클레임 쿼리 비용 | **Task 5 가 측정.** 결과가 Task 6 갈래를 고른다 |
| price list 지연의 O(n) 성장 원인 (빈 IN 리스트 vs `workflow_execution` 누적) | **조사하지 않는다.** Task 4 가 호출 수를 상품 수에서 배치 수로 줄이면 이 질문이 실용적으로 무의미해진다. Task 4 를 보류하기로 하면 그때 조사 대상으로 되살린다 |
| revalidate 가 5초를 넘기는 원인 | **조사하지 않는다.** Task 3 이 await 를 없애 무관해진다. 다만 라우트가 여전히 느리다는 사실은 남으므로, 단건 편집 UX 가 문제되면 별도 과제 |
| `GET /admin/orders` 분당 10회 | 범위 밖. 시간 귀속 상위가 아니다 |

## 재측정 방법

배포 후 다음을 다시 잰다. 명령은 이 세션에서 쓴 것과 같다.

- **상품당 소요**: channel-adapter 로그에서 `Syncing from event snapshot: {masterId}` → `revalidate ... for handle={masterId}` 쌍의 시간차. Task 3 이후에는 대량 경로에서 revalidate 로그가 사라지므로 **종료 표지를 `Sync completed` 뒤에 새로 하나 남기거나**, `pim_medusa_mappings.updatedAt` 으로 대신 잰다
- **Medusa 시간 귀속**: Medusa 로그의 `[SLOW]` 라인을 엔드포인트별 `sum(ms)` 로 집계 (300ms 초과만 남는 하한선임에 주의)
- **슬롯 가동률**: 핸들러 소요 합 ÷ (창 × 동시성)

> Task 3 이 대량 경로의 revalidate 로그를 없애면 이 세션이 쓴 측정 방법이 깨진다. **Task 3 Step 9b 가 `Sync finished: {masterId} ({durationMs}ms)` 를 핸들러 끝에 남기는 이유가 이것이다** — 배포 후에는 이 로그의 `durationMs` 를 직접 집계하면 되므로 시작/종료 쌍 맞추기도 필요 없어진다.

## 리스크

| 리스크 | 완화 |
|---|---|
| Task 2 의 `action='created'` 가 신뢰할 수 없으면 가격이 중복 누적 | Step 1 의 사전 확인이 게이트. 확신 없으면 중단하고 보고 |
| Task 4 의 버퍼 유실로 상품이 기본가로 노출 | 기본가는 할인 전 가격이라 미수금은 없다. 유실 상품 id 를 error 로 남긴다. flush 30초로 창을 좁힌다 |
| Task 4 배포 중 정상 종료가 아니면 유실 | `onModuleDestroy` 에서 flush 한다. ECS 의 graceful shutdown 안에 들어와야 하므로 `INBOX_SHUTDOWN_DRAIN_MS`(25초)보다 짧게 끝나야 한다 |
| Task 6-A 의 백필 `UPDATE` 가 큰 테이블에서 오래 걸림 | pending 행만 대상이라 규모가 작다. Task 5 Step 2 에서 미리 센다 |
| 대량등록 중 다른 도메인 이벤트 지연 | 강등 레인은 6-A 에서도 유지된다. 규칙 자체는 안 바꾼다 |
| storefront 캐시가 최대 60초 늦게 반영 | 단건 경로는 즉시 반영을 유지한다. 대량등록에만 적용 |
