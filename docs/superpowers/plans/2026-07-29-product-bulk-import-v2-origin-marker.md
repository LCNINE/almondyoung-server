# 대량등록 v2 4단계 — 이벤트 origin 마커 + 레인 강등 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 임포트 워커가 발행한 `ProductMasterActiveVersionChanged` 에 `origin: 'bulk_import'` 마커를 심고, channel-adapter 의 inbox 클레임이 그 행을 `ProductSellableQuantityChanged` 와 같은 후순위 레인으로 보내, 상품 1,000개 게시가 멤버십·배송·주문취소 앞에 줄 서지 않게 한다.

**Architecture:** `publishVersion` 에 선택적 3번째 인자를 더해 출처를 payload 로 흘린다. channel-adapter 컨슈머는 inbox 행을 쓸 때 `payload.origin` 을 `metadata.origin` 으로 함께 적고, 클레임 쿼리의 `ORDER BY` 가 그 metadata 를 읽는다. payload 가 아니라 metadata 인 이유는 `ORDER BY` 표현식이 `LIMIT 1` 이어도 후보 행 전부에 계산되는데 payload 는 full snapshot 이라 TOAST 압축해제가 매 틱 붙기 때문이다.

**Tech Stack:** NestJS · Drizzle ORM (`sql` 템플릿) · zod (event-contracts) · Jest · Postgres

**근거 스펙:** `docs/superpowers/specs/2026-07-28-product-bulk-import-v2-design.md` §2.5, §4.4.1~4.4.5, §8

## Global Constraints

- **마이그레이션 0건.** 새 컬럼·인덱스·타입을 만들지 않는다. `inbox_events.metadata` 는 이미 존재하는 nullable jsonb 다.
- **신규 환경변수 0건.** 노브를 두지 않으므로 `apps/core/src/config/env.validation.ts` · `apps/channel-adapter/src/config/env.validation.ts` 둘 다 건드릴 일이 없다. 만약 계획을 벗어나 env 를 추가하게 되면 **반드시** 해당 zod 스키마에 선언한다 — 선언 안 하면 조용히 버려져 노브가 죽는다.
- **배포 순서 제약 없음.** core 와 channel-adapter 는 같은 `sst deploy` 로 나가고 `origin` 은 선택 필드다. 스펙 §7 표의 옛 "core 선배포 → channel-adapter" 문구는 §4.4.4 가 정정했다.
- **2단계 리뷰 지적 #7(`as Promise<T>` 캐스팅, `inbox-worker.service.ts:336`)·#11(성공 경로 CAS 가드 주석) 은 건드리지 않는다.** 5단계가 그 함수를 재작성하며 흡수한다.
- **권위 게이트는 `nest build core` · `nest build channel-adapter`.** 이 레포는 전역 jest(develop 에서 72건 실패)와 전역 tsc(2,058줄)가 상시 red 라 "전체 그린"으로 판정할 수 없다. 판정은 **변경 파일 기준 차분**으로 한다.
- **spec 파일은 `nest build` 가 제외한다.** `npm run type-check:scoped` 가 본다 (Task 7 이 이 스테이지가 건드리는 파일까지 범위를 넓힌다).
- 마킹 범위는 **임포트 게시뿐**이다. `categories.service.publishProductProjectionRefresh` 와 `product-bulk.service.bulkActivate` 는 마킹하지 않는다 (§4.4.5).

## File Structure

| 파일 | 책임 | Task |
|---|---|---|
| `packages/event-contracts/streams/product.stream.ts` | `ProductPublishOrigin` 타입 정의 + payload/zod 에 선택 필드 2개 | 1 |
| `packages/event-contracts/streams/__tests__/product-stream-origin.spec.ts` (신규) | 계약 스키마가 origin 을 받아들이는지 | 1 |
| `apps/core/.../products/services/product-versions.service.ts` | `PublishVersionOptions` 정의, `publishVersion` → `_emitActiveVersionChangedEvent` 로 한 홉 전달, payload 병합 | 2 |
| `apps/core/.../products/services/product-versions.service.spec.ts` | 옵션 있음/없음 두 경우의 payload | 2, 7 |
| `apps/core/.../import/services/product-import-job.manager.ts` | 게시 슬라이스가 `{origin, importSessionId}` 를 넘긴다 | 3 |
| `apps/core/.../import/services/product-import-job.manager.spec.ts` | 3번째 인자 단정 | 3 |
| `apps/channel-adapter/src/consumers/pim-product-event.consumer.ts` | inbox 행의 `metadata.origin` 기입 | 4 |
| `apps/channel-adapter/src/consumers/pim-product-event.consumer.spec.ts` | origin 있음/없음 두 경우의 metadata | 4 |
| `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts` | `BULK_ORIGINS` + 클레임 `ORDER BY` 한 항 | 5 |
| `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts` | 렌더된 SQL 에 `COALESCE` 가 있는지 | 5 |
| `apps/channel-adapter/src/adapters/medusa/inbox-claim-order.integration.spec.ts` (신규) | **실 Postgres 로 클레임 순서를 증명** — NULL 함정 회귀 방어 | 6 |
| `package.json` | 통합 테스트 실행 스크립트 | 6 |
| `tsconfig.spec-scope.json` | 이 스테이지가 건드리는 spec 파일까지 타입 게이트 확장 | 7 |

---

### Task 1: 이벤트 계약에 `origin` · `importSessionId` 추가

**Files:**
- Modify: `packages/event-contracts/streams/product.stream.ts:63-73` (payload 인터페이스), `:359-369` (zod 스키마)
- Test: `packages/event-contracts/streams/__tests__/product-stream-origin.spec.ts` (신규)

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `export type ProductPublishOrigin = 'bulk_import'` — Task 2 와 Task 5 가 import 한다. `ProductMasterActiveVersionChangedPayload.origin?: ProductPublishOrigin`, `.importSessionId?: string`.

**배경:** 이 zod 스키마는 런타임 게이트가 아니다. `SchemaValidationInterceptor` 는 레포 어디에도 부착돼 있지 않고 outbox 발행 경로에도 검증이 없다. 실제 사용처는 `__tests__/` 뿐이다. 그래서 좁은 `z.literal` 로 둬도 소비자를 깨뜨릴 위험이 없다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/event-contracts/streams/__tests__/product-stream-origin.spec.ts` 생성:

```ts
import { PRODUCT_STREAM } from '../product.stream';

const basePayload = {
  masterId: 'master-1',
  versionId: 'version-1',
  name: '립 틴트',
  previousActiveVersionId: null,
  changeReason: 'published',
  changedAt: '2026-07-29T00:00:00.000Z',
};

describe('PRODUCT_STREAM ProductMasterActiveVersionChanged origin 마커', () => {
  const schema = PRODUCT_STREAM.events.ProductMasterActiveVersionChanged.schema!;

  it('대량 임포트 게시의 origin 과 세션 id 를 실어 나른다', () => {
    const parsed = schema.parse({
      ...basePayload,
      origin: 'bulk_import',
      importSessionId: '0198f0a0-0000-7000-8000-000000000001',
    });

    expect(parsed.origin).toBe('bulk_import');
    expect(parsed.importSessionId).toBe('0198f0a0-0000-7000-8000-000000000001');
  });

  it('단건 게시처럼 출처가 없는 이벤트도 그대로 통과시킨다', () => {
    const parsed = schema.parse(basePayload);

    expect(parsed.origin).toBeUndefined();
    expect(parsed.importSessionId).toBeUndefined();
  });

  it('정의되지 않은 origin 값은 거부한다', () => {
    expect(() => schema.parse({ ...basePayload, origin: 'category_refresh' })).toThrow();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest packages/event-contracts/streams/__tests__/product-stream-origin.spec.ts`
Expected: FAIL 2건 / PASS 1건. `z.object` 는 미선언 키를 조용히 strip 하므로 — 첫 번째는 `parsed.origin` 이 `undefined` 라 실패하고, 세 번째는 잘못된 값도 strip 돼 throw 하지 않아 실패한다. 두 번째(출처 없음)는 이미 통과한다.

- [ ] **Step 3: 타입과 스키마를 추가한다**

`product.stream.ts:63` 의 인터페이스 **바로 앞**에 타입을 정의한다:

```ts
/**
 * 이 이벤트를 낸 작업의 성격. 한 번에 수백~수천 건을 만들어내는 경로만 표시한다.
 * channel-adapter 의 inbox 클레임이 이 값으로 레인을 가른다 —
 * 값을 늘리려면 InboxWorkerService.BULK_ORIGINS 도 같이 본다.
 */
export type ProductPublishOrigin = 'bulk_import';

export interface ProductMasterActiveVersionChangedPayload {
  masterId: string;
  versionId: string | null;
  name: string | null;
  previousActiveVersionId: string | null;
  categoryIds?: string[];
  primaryCategoryId?: string | null;
  changeReason: 'published' | 'unpublished' | 'rollback';
  changedAt: string;
  snapshot?: ProductSnapshot | null;
  /** 대량 작업이 낸 이벤트임을 표시한다. 단건 게시에는 키 자체가 없다. */
  origin?: ProductPublishOrigin;
  /** origin='bulk_import' 일 때의 임포트 세션 id (관측용 — 강등 판정은 쓰지 않는다). */
  importSessionId?: string;
}
```

`:359` 의 zod 스키마에 두 줄을 더한다:

```ts
const ProductMasterActiveVersionChangedSchema = z.object({
  masterId: z.string().min(1),
  versionId: z.string().nullable(),
  name: z.string().nullable(),
  previousActiveVersionId: z.string().nullable(),
  categoryIds: z.array(z.string().min(1)).optional(),
  primaryCategoryId: z.string().nullable().optional(),
  changeReason: z.enum(['published', 'unpublished', 'rollback']),
  changedAt: z.string().datetime(),
  snapshot: ProductSnapshotSchema.nullable().optional(),
  origin: z.literal('bulk_import').optional(),
  importSessionId: z.string().min(1).optional(),
});
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest packages/event-contracts/streams/__tests__/`
Expected: PASS — 신규 3건 + 기존 `product-stream-purchase-constraint.spec.ts` 5건.

- [ ] **Step 5: 커밋**

```bash
git add packages/event-contracts/streams/product.stream.ts \
        packages/event-contracts/streams/__tests__/product-stream-origin.spec.ts
git commit -m "feat(event-contracts): ProductMasterActiveVersionChanged 에 origin·importSessionId 선택 필드"
```

---

### Task 2: core — `publishVersion` 이 출처를 payload 로 흘린다

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/services/product-versions.service.ts:258` (시그니처), `:309` (호출), `:911-949` (`_emitActiveVersionChangedEvent`)
- Test: `apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts:73-137` 근처에 케이스 2건 추가

**Interfaces:**
- Consumes: `ProductPublishOrigin` (Task 1)
- Produces: `export interface PublishVersionOptions { origin?: ProductPublishOrigin; importSessionId?: string }` 와 `publishVersion(versionId: string, tx?: DbTransaction, options?: PublishVersionOptions): Promise<void>` — Task 3 이 3번째 인자로 호출한다.

**주의:** `publishVersion` 의 프로덕션 호출부는 3곳이다 — `product-master-versions.controller.ts:200`, `product-bulk.service.ts:209`, `product-import-job.manager.ts:283`. 이 태스크는 **셋 다 건드리지 않는다.** 인자를 안 넘기면 payload 는 지금과 바이트 단위로 동일해야 한다(키 자체가 없어야 한다 — `origin: undefined` 도 안 된다).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`product-versions.service.spec.ts` 의 `describe('ProductVersionsService Medusa projection outbox events')` 블록 안, 기존 `it('enqueues ProductMasterActiveVersionChanged through the transactional outbox using the provided tx')` **뒤**에 두 건을 추가한다:

```ts
  it('임포트 게시면 payload 에 origin 과 importSessionId 를 싣는다', async () => {
    const { service, outboxPublisher, projectionSnapshotAssembler } = makeService();
    projectionSnapshotAssembler.assembleActiveVersionSnapshot.mockResolvedValue({
      snapshot: null,
      categoryIds: [],
      primaryCategoryId: null,
    });

    await (service as any)._emitActiveVersionChangedEvent(
      { id: 'version-2', masterId: 'master-1', name: 'Lip Tint' },
      null,
      'published',
      {} as any,
      { origin: 'bulk_import', importSessionId: 'session-1' },
    );

    expect(outboxPublisher.saveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          origin: 'bulk_import',
          importSessionId: 'session-1',
        }),
      }),
      expect.anything(),
    );
  });

  it('단건 게시면 origin 키 자체가 payload 에 없다', async () => {
    const { service, outboxPublisher, projectionSnapshotAssembler } = makeService();
    projectionSnapshotAssembler.assembleActiveVersionSnapshot.mockResolvedValue({
      snapshot: null,
      categoryIds: [],
      primaryCategoryId: null,
    });

    await (service as any)._emitActiveVersionChangedEvent(
      { id: 'version-2', masterId: 'master-1', name: 'Lip Tint' },
      null,
      'published',
      {} as any,
    );

    // `origin: undefined` 로도 통과하지 않도록 키 존재 자체를 본다 —
    // 단건 경로의 payload 는 이 스테이지 전후로 바이트 단위로 같아야 한다.
    const [{ payload }] = outboxPublisher.saveEvent.mock.calls[0];
    expect(Object.prototype.hasOwnProperty.call(payload, 'origin')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, 'importSessionId')).toBe(false);
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts -t 'origin'`
Expected: FAIL — 첫 번째가 `payload` 에 `origin` 이 없어 실패한다. 두 번째는 이미 통과한다(회귀 방어용이므로 정상).

- [ ] **Step 3: 구현한다**

`product-versions.service.ts` — 파일 상단 import 에 계약 타입을 더한다:

```ts
import type { ProductPublishOrigin } from '@packages/event-contracts/streams/product.stream';
```

`publishVersion` 정의 **바로 앞**에 옵션 타입을 둔다:

```ts
/**
 * publish 를 유발한 작업의 성격. 임포트 워커와 단건 UI 가 같은 `publishVersion` 을
 * 부르므로 출처는 호출부가 넘겨야 한다 — 넘기지 않으면 payload 에 키가 생기지 않는다.
 */
export interface PublishVersionOptions {
  origin?: ProductPublishOrigin;
  importSessionId?: string;
}
```

`:258` 시그니처와 `:309` 호출을 고친다:

```ts
  async publishVersion(versionId: string, tx?: DbTransaction, options?: PublishVersionOptions): Promise<void> {
```

```ts
      await this._emitActiveVersionChangedEvent(version, previousActiveVersion, changeReason, tx, options);
```

`_emitActiveVersionChangedEvent` 의 시그니처와 payload 를 고친다:

```ts
  private async _emitActiveVersionChangedEvent(
    newVersion: ProductMasterVersion,
    previousActiveVersion: ProductMasterVersion | null,
    changeReason: 'published' | 'unpublished' | 'rollback',
    tx: DbTransaction,
    options?: PublishVersionOptions,
  ): Promise<void> {
```

payload 객체 끝(`snapshot,` 다음)에 조건부 스프레드를 넣는다:

```ts
        payload: {
          masterId: newVersion.masterId,
          versionId: changeReason === 'unpublished' ? null : newVersion.id,
          name: changeReason === 'unpublished' ? null : (snapshot?.name ?? newVersion.name),
          previousActiveVersionId: previousActiveVersion?.id || null,
          categoryIds,
          primaryCategoryId,
          changeReason,
          changedAt: new Date().toISOString(),
          snapshot,
          // 출처가 없으면 키를 만들지 않는다 — 단건 게시의 payload 를 그대로 두기 위해서다.
          ...(options?.origin ? { origin: options.origin } : {}),
          ...(options?.importSessionId ? { importSessionId: options.importSessionId } : {}),
        },
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts`
Expected: PASS (전체 파일 — 기존 케이스 회귀 없음)

- [ ] **Step 5: 빌드 게이트**

Run: `npx nest build core`
Expected: `webpack ... compiled successfully`, exit 0

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/core/products/services/product-versions.service.ts \
        apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts
git commit -m "feat(core): publishVersion 이 게시 출처를 선택적 인자로 받아 payload 에 싣는다"
```

---

### Task 3: core — 임포트 게시 슬라이스가 출처를 넘긴다

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.ts:283`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.spec.ts:386`

**Interfaces:**
- Consumes: `publishVersion(versionId, tx?, options?)` (Task 2)
- Produces: 없음 (배선의 끝)

- [ ] **Step 1: 기존 단정을 실패하도록 조인다**

`product-import-job.manager.spec.ts:386` 의 느슨한 단정을 3번째 인자까지 보도록 바꾼다:

```ts
    expect(versionsService.publishVersion).toHaveBeenCalledWith('draft-1', expect.anything(), {
      origin: 'bulk_import',
      importSessionId: 'sess-1',
    });
```

> `'sess-1'` 은 같은 파일 `:109` 의 `CLAIM = (sessionId = 'sess-1')` 기본값이다. 이 테스트는 `CLAIM()` 을 인자 없이 부르므로 그 기본값이 그대로 `runPublishSlice` 에 들어간다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.spec.ts -t 'draft 버전을 게시하고'`
Expected: FAIL — 3번째 인자가 없다고 나온다.

- [ ] **Step 3: 구현한다**

`product-import-job.manager.ts:283` 을 고친다:

```ts
        const draftVersionId = await this.reader.getDraftVersionId(masterId);
        if (draftVersionId) {
          // 임포트 게시임을 이벤트에 남긴다 — channel-adapter 의 inbox 클레임이 이 표시로
          // 후순위 레인을 가른다(설계 스펙 §4.4). 단건 UI 게시에는 이 인자가 없다.
          await this.db.run((trx) =>
            this.versionsService.publishVersion(draftVersionId, trx, {
              origin: 'bulk_import',
              importSessionId: sessionId,
            }),
          );
        }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.spec.ts`
Expected: PASS (전체 파일)

- [ ] **Step 5: 빌드 + 스코프 타입 게이트**

Run: `npx nest build core && npm run type-check:scoped`
Expected: 둘 다 exit 0

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.spec.ts
git commit -m "feat(core): 임포트 게시 슬라이스가 origin=bulk_import 를 이벤트에 심는다"
```

---

### Task 4: channel-adapter — 컨슈머가 `metadata.origin` 을 기입한다

**Files:**
- Modify: `apps/channel-adapter/src/consumers/pim-product-event.consumer.ts:59-66` (`saveToInboxOnce` 파라미터), `:119-135` (inbox insert), `:194-202` (핸들러 호출)
- Test: `apps/channel-adapter/src/consumers/pim-product-event.consumer.spec.ts`

**Interfaces:**
- Consumes: `ProductPublishOrigin` (Task 1), `payload.origin` (Task 2·3 이 채운다)
- Produces: inbox 행의 `metadata.origin` — Task 5 의 `ORDER BY` 가 읽는다. 키 이름은 정확히 `origin`.

**왜 metadata 인가:** `ORDER BY` 표현식은 `LIMIT 1` 이어도 후보 행 전부에 대해 계산된다. `payload` 는 full snapshot 이라 TOAST 대상이고 적체가 클수록 매 틱 압축해제가 붙는다. `metadata` 는 correlationId·messageId 정도만 든 수백 바이트라 페이지 안에 있다. `importSessionId` 는 복사하지 않는다 — 정렬 핫패스가 안 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`pim-product-event.consumer.spec.ts` 의 최상위 `describe` 안에 두 건을 추가한다 (기존 케이스들과 같은 `makeDb`/`DbState` 헬퍼를 쓴다):

```ts
  it('임포트 게시 이벤트의 origin 을 inbox metadata 로 옮긴다', async () => {
    const state: DbState = { processed: [], inbox: [] };
    const db = makeDb(state);
    const consumer = new PimProductEventConsumer({ db } as any);

    await consumer.onProductMasterActiveVersionChanged(
      { messageId: 'msg-1', correlationId: 'corr-1', chainId: 'chain-1' } as any,
      {
        masterId: 'master-1',
        versionId: 'version-1',
        name: 'Lip Tint',
        previousActiveVersionId: null,
        changeReason: 'published',
        changedAt: '2026-07-29T00:00:00.000Z',
        origin: 'bulk_import',
        importSessionId: 'session-1',
        snapshot: { masterId: 'master-1', versionId: 'version-1', version: 1, name: 'Lip Tint', variants: [] },
      } as any,
    );

    expect(state.inbox[0].metadata.origin).toBe('bulk_import');
    // 정렬 핫패스가 안 쓰는 값은 metadata 에 넣지 않는다 — payload 에는 그대로 있다.
    expect(state.inbox[0].metadata.importSessionId).toBeUndefined();
    expect(state.inbox[0].payload.importSessionId).toBe('session-1');
  });

  it('단건 게시면 metadata 에 origin 키를 만들지 않는다', async () => {
    const state: DbState = { processed: [], inbox: [] };
    const db = makeDb(state);
    const consumer = new PimProductEventConsumer({ db } as any);

    await consumer.onProductMasterActiveVersionChanged(
      { messageId: 'msg-2', correlationId: 'corr-2', chainId: 'chain-2' } as any,
      {
        masterId: 'master-2',
        versionId: 'version-2',
        name: 'Lip Balm',
        previousActiveVersionId: null,
        changeReason: 'published',
        changedAt: '2026-07-29T00:00:00.000Z',
        snapshot: { masterId: 'master-2', versionId: 'version-2', version: 1, name: 'Lip Balm', variants: [] },
      } as any,
    );

    expect(Object.prototype.hasOwnProperty.call(state.inbox[0].metadata, 'origin')).toBe(false);
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/channel-adapter/src/consumers/pim-product-event.consumer.spec.ts -t 'origin'`
Expected: FAIL — 첫 번째가 `metadata.origin` 이 `undefined` 라 실패한다.

- [ ] **Step 3: 구현한다**

파일 상단 import 에 계약 타입을 더한다:

```ts
import {
  ProductMasterActiveVersionChangedPayload,
  ProductMasterDeletedPayload,
  ProductPublishOrigin,
} from '@packages/event-contracts/streams/product.stream';
```

`saveToInboxOnce` 의 파라미터 객체에 `origin` 을 더한다 (`payload` 가 두 이벤트의 유니온이라 여기서 직접 못 읽는다 — 호출부가 넘긴다):

```ts
  private async saveToInboxOnce(params: {
    eventType: typeof ACTIVE_VERSION_CHANGED | typeof MASTER_DELETED;
    masterId: string;
    payload: ProductMasterActiveVersionChangedPayload | ProductMasterDeletedPayload;
    envelope: DomainEvent<ProductMasterActiveVersionChangedPayload> | DomainEvent<ProductMasterDeletedPayload>;
    idempotencyKey: string;
    eventVersion: string;
    eventOccurredAt: Date;
    /** 대량 작업이 낸 이벤트면 여기 담긴다. InboxWorker 의 레인 강등이 이 값을 읽는다. */
    origin?: ProductPublishOrigin;
  }): Promise<boolean> {
```

inbox insert 의 `metadata` 를 고친다:

```ts
        metadata: {
          correlationId: params.envelope.correlationId,
          messageId: params.envelope.messageId,
          chainId: params.envelope.chainId,
          timestamp: params.envelope.timestamp,
          occurredAt: params.envelope.occurredAt,
          eventOccurredAt: params.eventOccurredAt.toISOString(),
          // 강등 판정이 매 틱 읽는 값이라 payload(full snapshot, TOAST 대상) 가 아니라
          // 여기 둔다. 없으면 키를 만들지 않는다 — 판정 쪽 COALESCE 가 NULL 을 흡수한다.
          ...(params.origin ? { origin: params.origin } : {}),
        },
```

`onProductMasterActiveVersionChanged` 의 호출에 한 줄 더한다:

```ts
      const saved = await this.saveToInboxOnce({
        eventType: ACTIVE_VERSION_CHANGED,
        masterId,
        payload,
        envelope,
        idempotencyKey,
        eventVersion,
        eventOccurredAt,
        origin: payload.origin,
      });
```

`onProductMasterDeleted` 의 호출은 **그대로 둔다** — `ProductMasterDeletedPayload` 에는 `origin` 이 없다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/channel-adapter/src/consumers/pim-product-event.consumer.spec.ts`
Expected: PASS (전체 파일)

- [ ] **Step 5: 커밋**

```bash
git add apps/channel-adapter/src/consumers/pim-product-event.consumer.ts \
        apps/channel-adapter/src/consumers/pim-product-event.consumer.spec.ts
git commit -m "feat(channel-adapter): PIM 컨슈머가 inbox metadata 에 origin 을 기입한다"
```

---

### Task 5: channel-adapter — 클레임 `ORDER BY` 에 origin 강등을 더한다

**Files:**
- Modify: `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts:14-18` (import), `:49-53` (`BULK_EVENT_TYPES` 아래), `:214-221` (`bulkEventTypesSql`), `:246` (`ORDER BY`)
- Test: `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts:327` 의 SQL 렌더 테스트에 단정 추가

**Interfaces:**
- Consumes: `ProductPublishOrigin` (Task 1), inbox 행의 `metadata.origin` (Task 4)
- Produces: 없음 (강등의 끝). Task 6 이 이 쿼리의 순서를 실 DB 로 검증한다.

**절대 건드리지 말 것:** 같은 파일 `:336` 의 `as Promise<T>` 캐스팅(2단계 리뷰 #7)과 성공 경로 CAS 가드 주석(#11) 은 5단계가 그 함수를 재작성하며 흡수한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`inbox-worker.service.spec.ts:327` 의 `it('renders the atomic claim query with an IN list instead of an invalid ANY row cast')` **뒤**에 한 건을 추가한다:

```ts
  it('renders the demotion order with a COALESCE guard so unmarked rows keep the priority lane', async () => {
    const { service, dbMock } = createService();

    await (service as any).claimNextInboxEvent();

    const claimSql = new PgDialect().sqlToQuery(dbMock.execute.mock.calls[0][0]);
    // COALESCE 가 빠지면 마커 없는 행이 `false OR NULL` = NULL 이 되고,
    // NULL 은 ASC 정렬에서 맨 뒤로 가 우선 레인이 통째로 뒤집힌다.
    expect(claimSql.sql).toContain(`COALESCE(metadata->>'origin', '')`);
    expect(claimSql.params).toContain('bulk_import');
    // ORDER BY 항 구분 쉼표와 섞이지 않도록 표현식 전체가 괄호 안에 있어야 한다.
    expect(claimSql.sql).toMatch(/ORDER BY \(/);
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts -t 'COALESCE'`
Expected: FAIL — 렌더된 SQL 에 `COALESCE` 가 없다.

- [ ] **Step 3: 구현한다**

`:14-18` 의 계약 타입 import 에 `ProductPublishOrigin` 을 더한다:

```ts
import type {
  CategoryChangedPayload,
  ProductMasterDeletedPayload,
  ProductPublishOrigin,
} from '@packages/event-contracts/streams/product.stream';
```

`:53` 의 `BULK_EVENT_TYPES` 선언 **바로 아래**에 더한다:

```ts
/**
 * 대량 작업이 낸 이벤트임을 표시하는 origin 값. eventType 만으로는 갈리지 않는
 * 경우 — 같은 `ProductMasterActiveVersionChanged` 라도 단건 UI 게시는 고객이
 * 즉시 체감하고 임포트 일괄게시는 아니다 — 를 위해 존재한다.
 * 값 판단 기준은 BULK_EVENT_TYPES 와 같다: 지연돼도 "반영이 늦을 뿐" 인가?
 */
const BULK_ORIGINS: readonly ProductPublishOrigin[] = ['bulk_import'];
```

`claimNextInboxEvent` 의 `bulkEventTypesSql` 선언 **바로 아래**에 더한다:

```ts
    // 출처가 대량인 행도 같은 후순위 레인으로 보낸다. origin 은 payload 가 아니라
    // metadata 에서 읽는다 — ORDER BY 표현식은 LIMIT 1 이어도 후보 행 전부에 대해
    // 계산되는데, payload 는 full snapshot 이라 TOAST 압축해제가 매 틱 붙는다.
    //
    // COALESCE 가 핵심이다. 빼면 마커 없는 행에서 `false OR NULL` = NULL 이 되고,
    // NULL 은 ASC 정렬에서 맨 뒤로 간다 — 정상 이벤트가 통째로 후순위로 밀려
    // 이 강등이 고치려던 문제가 정확히 반대 방향으로 발생한다. 에러는 안 난다.
    // metadata 가 NULL 인 행(옛 컨슈머가 쓴 행)도 같은 경로로 흡수된다.
    const bulkOriginsSql = sql.join(
      BULK_ORIGINS.map((origin) => sql`COALESCE(metadata->>'origin', '') = ${origin}`),
      sql` OR `,
    );
```

`ORDER BY` 를 고친다 (표현식 전체를 괄호로 감싼다):

```ts
        ORDER BY (${bulkEventTypesSql} OR ${bulkOriginsSql}), created_at ASC
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts`
Expected: PASS (전체 파일)

> 이 파일에 이미 red 인 케이스가 있으면(선행 이슈 #550 의 supersede 단위테스트) **그것만** 남고 나머지가 그린인지 확인한다. 새로 red 가 생기면 안 된다.

- [ ] **Step 5: 빌드 게이트**

Run: `npx nest build channel-adapter`
Expected: exit 0

- [ ] **Step 6: 커밋**

```bash
git add apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts \
        apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts
git commit -m "feat(channel-adapter): inbox 클레임이 origin=bulk_import 행을 후순위 레인으로 강등한다"
```

---

### Task 6: 실 Postgres 로 클레임 순서를 증명하는 통합 테스트

**Files:**
- Create: `apps/channel-adapter/src/adapters/medusa/inbox-claim-order.integration.spec.ts`
- Modify: `package.json` (scripts — `test:channel-dispatch:integration` 바로 아래)

**Interfaces:**
- Consumes: `InboxWorkerService.claimNextInboxEvent()` (Task 5), inbox 행의 `metadata.origin` (Task 4)
- Produces: 없음

**왜 필요한가:** Task 5 의 SQL 문자열 단정은 `COALESCE` 가 *있다*는 것만 본다. NULL 함정은 터져도 **에러가 안 나고** 조용히 레인을 뒤집으므로, 실제 정렬 결과를 봐야만 잡힌다. 레포 선례는 `apps/core/.../product-import-job-lease.integration.spec.ts` 와 `apps/channel-adapter/src/services/shipment-dispatch-persistence.integration.spec.ts` 다.

**DB 주의:** 이 스위트의 `DATABASE_URL` 은 **channel-adapter 의 논리 DB** 를 가리켜야 한다 (`public.inbox_events` 를 복제하기 때문). core DB 를 가리키면 `LIKE public.inbox_events` 에서 즉시 실패한다 — 조용히 통과하지 않으므로 안전하다.

**이 머신에서는 로컬 docker Postgres 를 쓴다.** `docker-compose.yml` 이 띄우는 인스턴스에 `channel_adapter` 논리 DB 가 있고, 계획 작성 시점에 `npx drizzle-kit migrate --config apps/channel-adapter/drizzle.config.ts` 를 적용해 `public.inbox_events` 를 만들어 두었다(이미 적용됨 — 다시 돌릴 필요 없다). 그래서 이 계획의 실행 명령은 전부 다음 형태다:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/channel_adapter \
  npm run test:inbox-claim-order:integration
```

`public.inbox_events` 가 없다는 오류가 나면 위 마이그레이션을 다시 적용한다:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/channel_adapter \
  npx drizzle-kit migrate --config apps/channel-adapter/drizzle.config.ts
```

`apps/channel-adapter/.env.migration` 은 이 리포에 **없다**(`.env.migration.example` 만 있다) — 그 경로를 쓰지 말 것. npm 스크립트 자체는 `test:channel-dispatch:integration` 과 같은 모양(환경변수 주입 없음)으로 두어 레포 관례를 따른다.

- [ ] **Step 1: 테스트 파일을 쓴다**

`apps/channel-adapter/src/adapters/medusa/inbox-claim-order.integration.spec.ts` 생성:

```ts
import { randomUUID } from 'crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { InboxWorkerService } from './inbox-worker.service';
import { channelAdapterSchema } from '../../schema';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');

/**
 * 클레임 쿼리의 **정렬 결과**를 진짜 Postgres 에 대고 본다.
 *
 * 이 스펙이 존재하는 이유: 강등 판정에 jsonb 항이 붙으면서 NULL 함정이 생겼다.
 * `COALESCE` 없이 `event_type = 'X' OR metadata->>'origin' = 'bulk_import'` 를 쓰면
 * 마커 없는 행이 `false OR NULL` = NULL 이 되고, NULL 은 ASC 에서 맨 뒤로 간다.
 * 즉 우선 레인과 후순위 레인이 통째로 뒤바뀌는데 **에러는 안 난다**. 렌더된 SQL
 * 문자열 단정으로는 `COALESCE` 의 존재만 보일 뿐 이 뒤집힘을 증명하지 못한다.
 *
 * **격리**: 일회용 스키마를 만들고 커넥션의 search_path 를 startup 파라미터로 거기
 * 고정한다. `SET search_path` 는 세션 단위라 postgres.js 가 재연결하면 조용히 public
 * 으로 돌아가고, 그러면 클레임이 진짜 큐의 행을 집어 `processing` 으로 만들어 놓고
 * 되돌리지 않는다. (선례: product-import-job-lease.integration.spec.ts:48-56)
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_INBOX_CLAIM_ORDER_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the inbox claim order integration suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** 클레임된 행이 되돌아오지 않도록 충분히 긴 lease. */
const LEASE_MS = 15 * 60 * 1000;

const T0 = new Date('2026-07-29T00:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

describeIfDb('inbox 클레임 레인 강등 순서 (DB 통합)', () => {
  jest.setTimeout(120_000);

  const schemaName = `inbox_order_${randomUUID().replaceAll('-', '')}`;
  let admin: postgres.Sql;
  let client: postgres.Sql;
  let service: InboxWorkerService;

  beforeAll(async () => {
    const bootstrap = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    await bootstrap.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await bootstrap.end();

    admin = postgres(DATABASE_URL as string, {
      max: 1,
      prepare: false,
      connection: { search_path: schemaName },
    });
    // public 의 실제 DDL 을 복제한다 — 손으로 옮겨 적으면 스키마가 갈라지고,
    // 갈라진 테이블에 대고 통과하는 테스트는 아무 것도 증명하지 못한다.
    await admin.unsafe(`CREATE TABLE inbox_events (LIKE public.inbox_events INCLUDING ALL)`);

    client = postgres(DATABASE_URL as string, {
      max: 1,
      prepare: false,
      connection: { search_path: schemaName },
    });

    const db = drizzle(client, { schema: channelAdapterSchema });
    const configService = {
      get: jest.fn((key: string) => (key === 'INBOX_PROCESSING_LEASE_MS' ? String(LEASE_MS) : undefined)),
    };

    // 이 스펙은 claimNextInboxEvent 만 구동한다 — 핸들러 협력자 일곱은 한 번도
    // 호출되지 않으므로 스텁조차 필요 없다.
    service = new InboxWorkerService(
      { db } as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      configService as never,
      undefined as never,
    );
  });

  afterAll(async () => {
    await admin?.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
    await Promise.all([client?.end(), admin?.end()]);
  });

  beforeEach(async () => {
    await admin`DELETE FROM inbox_events`;
  });

  async function seed(row: {
    eventType: string;
    createdAt: Date;
    metadata: Record<string, unknown> | null;
  }): Promise<string> {
    const id = randomUUID();
    await admin`
      INSERT INTO inbox_events
        (id, event_type, aggregate_type, aggregate_id, partition_key,
         payload, metadata, status, attempts, next_attempt_at, created_at)
      VALUES
        (${id}, ${row.eventType}, 'Product', ${'agg-' + id}, ${'agg-' + id},
         ${admin.json({ masterId: 'master-1' })},
         ${row.metadata === null ? null : admin.json(row.metadata)},
         'pending', 0, ${row.createdAt}, ${row.createdAt})
    `;
    return id;
  }

  /** 클레임을 반복해 순서를 뽑는다. private 메서드는 대괄호 접근으로 시그니처를 보존한다. */
  async function claimAll(count: number): Promise<string[]> {
    const claimed: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const event = await service['claimNextInboxEvent']();
      if (!event) break;
      claimed.push(event.id);
    }
    return claimed;
  }

  it('마커 없는 행이 더 최신이어도 대량 행보다 먼저 클레임된다', async () => {
    // 후순위 레인 — 가장 오래된 두 건.
    const bulkImport = await seed({
      eventType: 'ProductMasterActiveVersionChanged',
      createdAt: at(0),
      metadata: { messageId: 'm-bulk', origin: 'bulk_import' },
    });
    const sellableQty = await seed({
      eventType: 'ProductSellableQuantityChanged',
      createdAt: at(1),
      metadata: { messageId: 'm-qty' },
    });

    // 우선 레인 — 전부 위 두 건보다 새롭다.
    const singlePublish = await seed({
      eventType: 'ProductMasterActiveVersionChanged',
      createdAt: at(2),
      metadata: { messageId: 'm-single' },
    });
    const membership = await seed({
      eventType: 'MembershipStatusChanged',
      createdAt: at(3),
      metadata: { messageId: 'm-membership' },
    });
    const legacyNullMetadata = await seed({
      eventType: 'ProductMasterActiveVersionChanged',
      createdAt: at(4),
      metadata: null,
    });

    expect(await claimAll(5)).toEqual([
      // 우선 레인이 created_at ASC 로 먼저
      singlePublish,
      membership,
      legacyNullMetadata,
      // 그 다음 후순위 레인이 created_at ASC 로
      bulkImport,
      sellableQty,
    ]);
  });

  it('metadata 가 NULL 이거나 origin 키가 없는 행을 강등하지 않는다', async () => {
    // COALESCE 가 빠지면 이 두 건이 NULL 로 평가돼 맨 뒤로 밀린다.
    const nullMetadata = await seed({
      eventType: 'ProductMasterActiveVersionChanged',
      createdAt: at(0),
      metadata: null,
    });
    const noOriginKey = await seed({
      eventType: 'ProductMasterActiveVersionChanged',
      createdAt: at(1),
      metadata: { messageId: 'm-1' },
    });
    const demoted = await seed({
      eventType: 'ProductSellableQuantityChanged',
      createdAt: at(2),
      metadata: { messageId: 'm-2' },
    });

    expect(await claimAll(3)).toEqual([nullMetadata, noOriginKey, demoted]);
  });
});
```

- [ ] **Step 2: `package.json` 에 실행 스크립트를 더한다**

`"test:channel-dispatch:integration"` 줄 **바로 아래**에 넣는다:

```json
    "test:inbox-claim-order:integration": "REQUIRE_INBOX_CLAIM_ORDER_DB=1 jest --runInBand apps/channel-adapter/src/adapters/medusa/inbox-claim-order.integration.spec.ts",
```

- [ ] **Step 3: 강등 로직을 임시로 깨뜨려 테스트가 실제로 잡는지 확인한다**

`inbox-worker.service.ts` 의 `bulkOriginsSql` 에서 `COALESCE(...)` 를 잠시 `metadata->>'origin'` 으로 되돌린다.

Run:
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/channel_adapter \
  npm run test:inbox-claim-order:integration
```
Expected: **FAIL** — 두 케이스 모두 순서가 뒤집혀 실패해야 한다. 통과하면 테스트가 함정을 못 잡고 있는 것이므로 시드/단정을 고친다.

- [ ] **Step 4: 되돌리고 통과를 확인한다**

`COALESCE` 를 복구한 뒤 같은 명령을 다시 돌린다.
Expected: PASS (2건)

- [ ] **Step 5: DB 없이도 스위트가 스킵되는지 확인한다**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/inbox-claim-order.integration.spec.ts`
Expected: `describe.skip` 으로 0 tests / skipped — `DATABASE_URL` 이 없을 때 CI 를 깨지 않아야 한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/channel-adapter/src/adapters/medusa/inbox-claim-order.integration.spec.ts package.json
git commit -m "test(channel-adapter): 실 Postgres 로 inbox 레인 강등 순서를 증명한다"
```

---

### Task 7: 타입 게이트를 이 스테이지가 건드리는 spec 파일까지 넓힌다

**Files:**
- Modify: `tsconfig.spec-scope.json`
- Modify: `apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts` (기존 결함 3건 수정)

**Interfaces:**
- Consumes: 없음
- Produces: 없음

**배경:** `nest build` 는 spec 을 제외하므로 spec 의 타입 오류는 `npm run type-check:scoped` 만 잡는다. 현재 그 include 는 `apps/core/.../operations/import/**` 뿐이라 이 스테이지가 건드리는 파일 셋이 밖에 있다. 범위를 넓히면 `product-versions.service.spec.ts` 에 **이미 있던** 오류 3건이 드러난다 — `ProductVersionsService` 생성자가 10인자인데 팩토리 셋이 9인자를 넘긴다(`purchaseConstraints` 누락). jest 는 이걸 못 잡는다. 2단계 리뷰 #12 가 이 게이트를 요구한 취지 그대로다.

> **범위 판단:** 이 3건은 4단계 기능과 무관한 기존 부채다. 잘라내려면 Task 7 전체를 건너뛰고 `tsconfig.spec-scope.json` 을 그대로 두면 된다 — 다른 태스크는 이 태스크에 의존하지 않는다. 다만 그러면 Task 2·4·5 가 만진 spec 파일들은 타입 게이트 밖에 남는다.

- [ ] **Step 1: 확장 후 실패를 확인한다**

`tsconfig.spec-scope.json` 의 `include` 를 바꾼다:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": false
  },
  "include": [
    "apps/core/src/modules/catalog/operations/import/**/*.ts",
    "apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts",
    "apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts",
    "apps/channel-adapter/src/adapters/medusa/inbox-claim-order.integration.spec.ts",
    "apps/channel-adapter/src/consumers/pim-product-event.consumer.spec.ts"
  ]
}
```

Run: `npm run type-check:scoped`
Expected: FAIL — `product-versions.service.spec.ts` 에서 `error TS2554: Expected 10 arguments, but got 9.` 3건 (대략 568·612·898행). **다른 파일에서는 오류가 나오지 않아야 한다** — 나오면 그 파일을 include 에서 빼고 별건으로 남긴다.

- [ ] **Step 2: 세 팩토리에 누락된 인자를 채운다**

`product-versions.service.spec.ts` 의 세 `new ProductVersionsService(...)` 팩토리 각각에서, 마지막 인자 뒤에 `purchaseConstraints` 자리 하나를 더한다. 예를 들어 첫 번째(약 568행)는:

```ts
    return new ProductVersionsService(
      {} as any,
      { publishEvent: jest.fn() } as any,
      { saveEvent: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any, // purchaseConstraints — 이 블록의 케이스들은 호출하지 않는다
    );
```

나머지 둘도 같은 방식으로 `{} as any,` 를 하나씩 더한다. **인자를 중간에 끼워 넣지 말고 맨 뒤에 더한다** — 생성자 파라미터 순서상 `purchaseConstraints` 가 마지막이다 (`product-versions.service.spec.ts:48-59` 의 온전한 팩토리와 대조해 확인할 것).

- [ ] **Step 3: 통과를 확인한다**

Run: `npm run type-check:scoped`
Expected: exit 0, 출력 없음

- [ ] **Step 4: 테스트가 여전히 그린인지 확인한다**

Run: `npx jest apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts`
Expected: PASS (전체 파일)

- [ ] **Step 5: 커밋**

```bash
git add tsconfig.spec-scope.json \
        apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts
git commit -m "chore: spec 타입 게이트를 4단계 대상 파일까지 넓히고 드러난 생성자 인자 누락 3건 수정"
```

---

### Task 8: 최종 검증

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 권위 게이트 두 개**

```bash
npx nest build core && npx nest build channel-adapter
```
Expected: 둘 다 `compiled successfully`, exit 0

- [ ] **Step 2: 스코프 타입 게이트**

```bash
npm run type-check:scoped
```
Expected: exit 0

- [ ] **Step 3: 변경 파일 기준 테스트 차분**

```bash
npx jest \
  packages/event-contracts/streams/__tests__/ \
  apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts \
  apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.spec.ts \
  apps/channel-adapter/src/consumers/pim-product-event.consumer.spec.ts \
  apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts
```
Expected: PASS. **예외는 선행 이슈 #550 의 supersede 케이스뿐** — 그건 base 커밋에서도 red 다. 판단이 서지 않으면 base(`6ab21aeef`)에 임시 워크트리를 띄워 같은 명령을 돌리고 차분으로 비교한다:

```bash
git worktree add /tmp/base-check 6ab21aeef && cd /tmp/base-check && npm install
# 위 jest 명령을 그대로 실행해 red 목록을 비교
# 끝나면: cd - && git worktree remove /tmp/base-check
```

- [ ] **Step 4: 통합 테스트 (DB 필요)**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/channel_adapter \
  npm run test:inbox-claim-order:integration
```
Expected: PASS (2건)

- [ ] **Step 5: 마이그레이션·환경변수가 정말 0인지 확인**

```bash
git diff --stat 6ab21aeef -- '*/drizzle/*' 'apps/*/src/config/env.validation.ts'
```
Expected: 출력 없음 (변경 0)

- [ ] **Step 6: 최종 diff 검토**

```bash
git diff 6ab21aeef --stat
```
Expected: 15개 파일 — 프로덕션 5 + 테스트 6 + `package.json` + `tsconfig.spec-scope.json` + 문서 2 (스펙·이 계획).
테스트 6 = 신규 2 (`product-stream-origin.spec.ts`, `inbox-claim-order.integration.spec.ts`) + 수정 4.

---

## 배포 메모 (구현자가 아니라 운영자용)

- **마이그레이션 없음. 신규 secret·환경변수 없음.**
- core 와 channel-adapter 배포 **순서 무관** — 어느 쪽이 먼저 떠도 현행 동작으로 degrade 한다.
- 배포 시점에 이미 inbox 에 쌓여 있던 임포트 이벤트는 metadata 에 origin 이 없어 강등되지 않는다. **새로 들어오는 것부터** 적용된다.
- 확인 방법: 배포 후 임포트 세션을 하나 게시하고, `inbox_events` 에서 `metadata->>'origin' = 'bulk_import'` 인 행이 생기는지 그리고 그 뒤에 들어온 멤버십·배송 이벤트가 먼저 `published` 되는지 본다.
- **대량 이관은 이 배포 이후에** 한다 (스펙 §2.5 — 그 전에는 상품 1,000개 게시가 우선 레인을 약 50분 점유한다).
