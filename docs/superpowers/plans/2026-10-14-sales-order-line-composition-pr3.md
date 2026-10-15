# 판매주문 라인 구성 PR 3 (admin-web 화면) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영자가 매칭체크·출고 주문 상세에서 라인 하나의 SKU 구성을 «이 주문만» 지정·변경하고, 상품매칭 저장 뒤 «기존 출고에도 적용»을 고를 수 있게 한다 — PR 2 가 연 API 를 부르는 화면과, 그 화면이 요구하는 core 읽기·오류 본문 보강.

**Architecture:** core 는 응답에 칸만 더한다 — FO 상세 `lines`, 매칭체크 행 `composition`(표시용 읽기 함수 하나를 둘이 쓴다), `LINE_BOX_NOT_DRAFT` 의 박스 목록을 `details` 로 옮기고 `GlobalExceptionFilter` 허용목록에 넣는다. admin-web 은 판정(오류 코드 → 문구·링크, 미리보기 → 단계 표시, FO 항목 → «대체됨», 행 → 다이얼로그 초기값)을 순수 함수 한 모듈에 모아 jest 로 지키고, 컴포넌트는 그 결과만 그린다. SKU 고르기는 `InventoryMatchingDialog` 수동 탭에서 `PickedSkuList`·`SkuSearchPanel` 로 뽑아 새 `LineCompositionDialog` 와 같이 쓴다.

**Tech Stack:** NestJS 11 · Drizzle ORM · Jest(ts-jest) / Next.js(App Router) · React · TanStack Query · axios `client` · shadcn ui

**Spec:** `docs/superpowers/specs/2026-10-13-sales-order-line-composition-design.md` §7.4·§8·§8.1·§9.3 (이슈 #1063, #1016 14번 행). PR 2 계획 `docs/superpowers/plans/2026-10-13-sales-order-line-composition-pr2.md` 가 core 쪽 관례의 본이다.

## Global Constraints

- **시작 조건:** PR 2(#1066)는 develop `d78d94fed` 에 머지됐고 라이브다(2026-10-14 Core td 242, 롤아웃 20:28 KST 완료, 라이브 DB 에 `ck_fulfillment_order_items_qty_nonnegative` 존재)
- 워크트리: `git worktree add .claude/worktrees/feat-1063-line-composition-pr3 -b feat/1063-line-composition-pr3 develop`. node_modules 가 없으면 **절대경로 심링크**:
  ```bash
  WT=/home/pauseb/workspace/almondyoung-server/.claude/worktrees/feat-1063-line-composition-pr3
  [ -e $WT/node_modules ] || ln -s /home/pauseb/workspace/almondyoung-server/node_modules $WT/node_modules
  [ -e $WT/apps/admin-web/node_modules ] || ln -s /home/pauseb/workspace/almondyoung-server/apps/admin-web/node_modules $WT/apps/admin-web/node_modules
  ```
  서브에이전트는 워크트리 밖(메인 체크아웃)을 고치지 않는다 — 태스크 끝에 메인에서 `git -C /home/pauseb/workspace/almondyoung-server status --short` 가 비어 있는지(기존 `?? scripts/ops/1016-36-ambiguous-refund-preflight.js` 제외) 확인한다
- 게이트(모두 0): `npm run type-check` · `npx jest --maxWorkers=2` · `npm run test:admin-web` · **`(cd apps/admin-web && npx tsc --noEmit)`** — CI 는 admin-web tsc 를 돌리지 않으므로 마지막 것은 사람이 지키는 게이트다
- core 통합 스펙은 **스크래치 DB `core_1063`** 로만 돌린다. 공유 postgres 컨테이너를 재생성하는 러너(`test:core:integration:local` 등)는 쓰지 않는다:
  ```bash
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx drizzle-kit migrate --config apps/core/drizzle.config.ts
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath <파일>
  ```
- **마이그레이션 없음.** core 변경은 전부 응답 칸 추가·오류 본문 모양이다. `schema.ts` 를 건드리면 계획 위반이다
- 통합 스펙은 `describeIfDb`(`process.env.DATABASE_URL` 가드), 스펙 안에서 `dotenv.config()` 금지
- core: `any`·`as` 캐스팅 금지(스펙 파일의 `as never` 더블은 기존 관례). 인벤토리 쿼리는 `db.query.*`·`with` 금지. public 메서드는 `tx?: DbTx` 마지막 인자
- admin-web: 판정은 순수 함수(`src/features/order/line-composition/line-composition-view.ts`, `picked-skus.ts`)에 두고 `*.spec.ts` 로 테스트한다 — admin-web 은 컴포넌트 테스트 환경이 없다. 컴포넌트에 분기 로직을 새로 두지 않는다
- 문구(메모리 ui-minimal-text): 정상 상태는 숨긴다. 새 문구는 «개별 지정», «대체됨», «이 주문만», 거절 사유, 일괄 적용 단계의 숫자 라벨·결과뿐. 매칭 출처(`matching`)는 표시하지 않는다(정상 상태)
- 작업자 문구는 «송장»(메모리 worker-facing-term-songjang) — «라벨»·«인보이스» 쓰지 않는다
- 오류 본문은 axios `client` 인터셉터가 `CustomError({ statusCode, response: <본문> })` 로 던진다. 코드는 `parseServerError`(`src/lib/api/server-error.ts`)로 읽는다 — 새 파서를 만들지 않는다
- 코드 주석은 한국어로 «왜»만. 채팅 서식(화살표·굵게) 금지
- 배포: core 와 admin-web 을 같은 `sst deploy` 에 실어도 된다. **Core 롤아웃이 끝난 뒤에 화면을 쓴다**(§9.2). admin-web 은 새 칸이 없으면 그 표시를 숨기고 서버 메시지로 물러선다

## Review Focus

- **옛 core(또는 모양이 어긋난 `details`)에서 `LINE_BOX_NOT_DRAFT` 가 오면** 거절 사유 문구는 보이고 링크만 없다 — 화면이 Core 보다 먼저 뜨는 배포 순서에서 그대로 일어난다 → Task 4 `compositionErrorView` 테스트(details 없음·박스 항목 깨짐)
- **출고 주문 상세에서 같은 FO 로 가는 링크는 내지 않는다** — 배치 없는 박스의 링크가 지금 보고 있는 페이지면 무의미하다 → Task 4 테스트(`currentFulfillmentOrderId`)
- **굳힌 라인의 다이얼로그 초기값은 상품매칭이 아니라 라인 구성이다** — 상품매칭이 바뀐 뒤 «이 주문만»을 열면 박스에 든 것과 다른 SKU 가 채워지면 안 된다. 굳히지 않은 라인만 `matchedSkus` 로 채운다 → Task 4 `matchingRowTarget` 테스트
- **«대체됨»은 `qty === 0` 하나로만 정한다** — `canceledQty > 0` 인 고객 취소 항목·부분 감소(`qty > 0`)는 상태 그대로다 → Task 4 `foItemStatusLabel` 테스트
- **일괄 적용 단계는 `applicable && changeable > 0` 일 때만 뜬다** — 개별 지정·작업 중 건너뜀만 있는 경우, `applicable=false`(void·링크 0), 미리보기 조회 실패 모두 단계 없이 끝난다(저장은 이미 성공) → Task 4 `existingLinesStep` 테스트 + Task 8 의 조회 실패 처리

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `libs/shared/src/filters/http-exception.filter.ts` (수정) | `LINE_BOX_NOT_DRAFT` 의 `details` 를 모양 검증 후 통과 |
| `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.manager.ts` (수정) | 박스 목록을 `details: { fulfillmentOrderId, boxes }` 로 싣는다 |
| `apps/core/src/modules/product-matching/line-composition/line-composition-views.ts` (신규) | 표시용 라인 구성 읽기(SKU 코드·이름 포함) — FO 상세·매칭체크가 같이 쓴다 |
| `apps/core/src/modules/fulfillment/services/fulfillments.service.ts` · `dto/fulfillment-order-response.dto.ts` (수정) | FO 상세 `lines` |
| `apps/core/src/modules/product-matching/services/product-matching.service.ts` (수정) | 매칭체크 행 `composition` |
| `apps/admin-web/src/lib/types/dto/line-composition.ts` (신규) | API 모양 |
| `apps/admin-web/src/lib/api/domains/orders/line-composition.client.ts` (신규) | PUT·미리보기·적용 호출 |
| `apps/admin-web/src/lib/services/orders/line-composition.ts` (신규) | 뮤테이션 훅 + 무효화 |
| `apps/admin-web/src/features/order/line-composition/line-composition-view.ts` (신규) | 판정 순수 함수 전부 |
| `apps/admin-web/src/features/order/line-composition/picked-skus.ts` (신규) | 고른 SKU 목록 조작 순수 함수 |
| `apps/admin-web/src/features/order/line-composition/components/sku-composition-picker.tsx` (신규) | `PickedSkuList`·`SkuSearchPanel`(수동 탭에서 뽑음) |
| `apps/admin-web/src/features/order/line-composition/components/line-composition-dialog.tsx` (신규) | «이 주문만» 다이얼로그 |
| `apps/admin-web/src/features/order/line-composition/components/existing-lines-dialog.tsx` (신규) | 상품매칭 저장 뒤 «기존 출고에도 적용» 단계 |
| `apps/admin-web/src/features/order/matching/components/table/index.tsx`·`InventoryMatchingDialog.tsx` (수정) | 버튼·«개별 지정»·후속 단계 연결, 피커 사용 |
| `apps/admin-web/src/features/order/fulfillments/detail/line-compositions.tsx` (신규) · `components/detail/index.tsx` (수정) | FO 상세의 라인 구성 구역·«대체됨» |

---

### Task 1: core — `LINE_BOX_NOT_DRAFT` 박스 목록이 HTTP 응답까지 가게 한다

PR 2 는 박스 목록을 예외 본문 최상위 `boxes` 에 실었는데 `GlobalExceptionFilter` 가 `code`·`message`·`errors`·허용목록 `details` 밖의 칸을 버린다. 그래서 화면에 도착하지 않았다. PR 2 통합 스펙은 매니저 예외만 봐서 이걸 못 잡았으므로, 이번에는 **매니저 예외를 필터에 통과시킨 결과**를 스펙으로 묶는다.

**Files:**
- Modify: `libs/shared/src/filters/http-exception.filter.ts`
- Modify: `libs/shared/src/filters/http-exception.filter.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.manager.ts` (`changeFrozenLine` 입력·`LINE_BOX_NOT_DRAFT` throw, 호출 두 곳)
- Modify: `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.integration.spec.ts` (`LINE_BOX_NOT_DRAFT` 테스트, 약 179–201줄)

**Interfaces:**
- Produces(HTTP 409 본문): `{ success: false, error: 'LINE_BOX_NOT_DRAFT', code: 'LINE_BOX_NOT_DRAFT', message, details: { fulfillmentOrderId: string | null, boxes: Array<{ shipmentId: string; status: string; batchId: string | null; hasActiveWaybill: boolean }> } }` — Task 4 가 읽는다

- [ ] **Step 1: 필터 스펙에 실패 테스트 추가**

`libs/shared/src/filters/http-exception.filter.spec.ts` 의 `describe('preparation details allowlist', …)` 블록 **뒤에** 추가:

```ts
describe('line box details allowlist (#1063)', () => {
  function render(code: string, details: unknown) {
    let body: unknown;
    const reply = {
      status: () => reply,
      send: (value: unknown) => {
        body = value;
      },
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => reply, getRequest: () => ({ method: 'PUT', url: '/' }) }),
    } as ArgumentsHost;
    new GlobalExceptionFilter().catch(new ConflictException({ code, message: 'blocked', details }), host);
    return body;
  }
  const box = { shipmentId: 's-1', status: 'planned', batchId: 'b-1', hasActiveWaybill: false };

  it('passes the blocking boxes so the screen can link to the batch', () => {
    expect(render('LINE_BOX_NOT_DRAFT', { fulfillmentOrderId: 'fo-1', boxes: [box] })).toMatchObject({
      code: 'LINE_BOX_NOT_DRAFT',
      details: { fulfillmentOrderId: 'fo-1', boxes: [box] },
    });
  });

  it('accepts a null fulfillmentOrderId and drops fields outside the shape', () => {
    const body = render('LINE_BOX_NOT_DRAFT', {
      fulfillmentOrderId: null,
      secret: 'hidden',
      boxes: [{ ...box, batchId: null, secret: 'hidden' }],
    });
    expect(body).toMatchObject({ details: { fulfillmentOrderId: null, boxes: [{ ...box, batchId: null }] } });
    expect(JSON.stringify(body)).not.toContain('hidden');
  });

  it.each([
    ['OTHER', { fulfillmentOrderId: 'fo-1', boxes: [box] }],
    ['LINE_BOX_NOT_DRAFT', { fulfillmentOrderId: 'fo-1' }],
    ['LINE_BOX_NOT_DRAFT', { fulfillmentOrderId: 7, boxes: [box] }],
    ['LINE_BOX_NOT_DRAFT', { fulfillmentOrderId: 'fo-1', boxes: [{ ...box, hasActiveWaybill: 'no' }] }],
    ['LINE_BOX_NOT_DRAFT', { fulfillmentOrderId: 'fo-1', boxes: [null] }],
  ])('drops malformed %s details', (code, details) => {
    expect(render(String(code), details)).not.toHaveProperty('details');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest libs/shared/src/filters/http-exception.filter.spec.ts`
Expected: 새 describe 의 앞 두 테스트 FAIL(`details` 없음). `drops malformed` 는 이미 PASS 일 수 있다.

- [ ] **Step 3: 필터 구현**

`libs/shared/src/filters/http-exception.filter.ts` — `interface ErrorResponse` 바로 아래에 추가:

```ts
type PreparationDetails = { reasonCode: string; recovery: 'retry_preparation' | 'review_batch' };

interface LineBoxRef {
  shipmentId: string;
  status: string;
  batchId: string | null;
  hasActiveWaybill: boolean;
}

interface LineBoxNotDraftDetails {
  fulfillmentOrderId: string | null;
  boxes: LineBoxRef[];
}

// 판매주문 라인 구성 수정(#1063)을 막은 박스 — 화면이 박스·배치 링크를 만든다. 모양이 하나라도 어긋나면 통째로 버린다
function lineBoxNotDraftDetails(candidate: unknown): LineBoxNotDraftDetails | undefined {
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  const fulfillmentOrderId = 'fulfillmentOrderId' in candidate ? candidate.fulfillmentOrderId : undefined;
  if (fulfillmentOrderId !== null && typeof fulfillmentOrderId !== 'string') return undefined;
  const rawBoxes = 'boxes' in candidate ? candidate.boxes : undefined;
  if (!Array.isArray(rawBoxes)) return undefined;
  const boxes: LineBoxRef[] = [];
  for (const raw of rawBoxes) {
    if (typeof raw !== 'object' || raw === null) return undefined;
    const shipmentId = 'shipmentId' in raw ? raw.shipmentId : undefined;
    const status = 'status' in raw ? raw.status : undefined;
    const batchId = 'batchId' in raw ? raw.batchId : undefined;
    const hasActiveWaybill = 'hasActiveWaybill' in raw ? raw.hasActiveWaybill : undefined;
    if (typeof shipmentId !== 'string' || typeof status !== 'string') return undefined;
    if (batchId !== null && typeof batchId !== 'string') return undefined;
    if (typeof hasActiveWaybill !== 'boolean') return undefined;
    boxes.push({ shipmentId, status, batchId, hasActiveWaybill });
  }
  return { fulfillmentOrderId, boxes };
}
```

`catch` 안의 선언을 바꾼다:

```ts
    let details: PreparationDetails | LineBoxNotDraftDetails | undefined;
```

`SIMPLE_OUTBOUND_PLAN_INVALIDATED` 의 `if (…) { details = { reasonCode: …, recovery: … }; }` 블록 닫는 괄호 바로 뒤에 `else if` 를 잇는다:

```ts
      } else if (status === 409 && errorCode === 'LINE_BOX_NOT_DRAFT') {
        details = lineBoxNotDraftDetails(candidate);
      }
```

- [ ] **Step 4: 필터 스펙 통과 확인**

Run: `npx jest libs/shared/src/filters/http-exception.filter.spec.ts`
Expected: PASS(기존 테스트 포함)

- [ ] **Step 5: 통합 스펙을 «필터를 지난 본문»으로 바꾼다 (실패 테스트)**

`line-composition-edit.integration.spec.ts` 맨 위 import 에 추가:

```ts
import { ArgumentsHost } from '@nestjs/common';
import { GlobalExceptionFilter } from '@app/shared';
```

`lineOf` 함수 아래에 추가:

```ts
// 매니저 예외를 실제 응답 필터에 통과시킨다 — PR 2 는 예외 본문만 보고, 필터가 박스 목록을 버리는 걸 못 잡았다
function throughFilter(error: unknown): unknown {
  let body: unknown;
  const reply = {
    status: () => reply,
    send: (value: unknown) => {
      body = value;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => reply, getRequest: () => ({ method: 'PUT', url: '/' }) }),
  } as ArgumentsHost;
  new GlobalExceptionFilter().catch(error, host);
  return body;
}
```

`LINE_BOX_NOT_DRAFT` 테스트의 `await expect(…).rejects.toMatchObject({ response: { code: 'LINE_BOX_NOT_DRAFT', boxes: [...] } })` 를 다음으로 바꾼다:

```ts
      const error = await w.edit.manager
        .assignToLine(fx.salesOrderId, fx.lineIds[0], [{ skuId: fx.spareSkuIds[0], qtyPerUnit: 1 }], null, actor, tx)
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(throughFilter(error)).toMatchObject({
        code: 'LINE_BOX_NOT_DRAFT',
        details: {
          fulfillmentOrderId: fx.fulfillmentOrderId,
          boxes: [{ shipmentId: fx.shipmentId, status: 'planned', batchId: null, hasActiveWaybill: false }],
        },
      });
```

- [ ] **Step 6: 실패 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.integration.spec.ts -t "LINE_BOX_NOT_DRAFT"`
Expected: FAIL — 응답에 `details` 없음(매니저가 아직 최상위 `boxes` 에 싣는다). 테스트 이름이 `-t` 로 안 걸리면 `-t` 를 빼고 파일 전체를 돌린다.

- [ ] **Step 7: 매니저 구현**

`changeFrozenLine` 의 `input` 타입에 칸을 더한다(`salesOrderLineId` 다음 줄):

```ts
      /** 박스 링크용. 일괄 적용 경로에서 FO 를 못 찾았으면 null — 그때는 박스가 없어 이 오류까지 오지 않는다 */
      fulfillmentOrderId: string | null;
```

`LINE_BOX_NOT_DRAFT` throw 를 바꾼다:

```ts
      throw conflict('LINE_BOX_NOT_DRAFT', `Line ${input.salesOrderLineId} is in boxes that are not editable`, {
        // 응답 필터는 허용목록 details 만 통과시킨다(GlobalExceptionFilter) — 최상위 칸은 화면에 도착하지 않는다
        details: {
          fulfillmentOrderId: input.fulfillmentOrderId,
          boxes: blocking.map((box) => ({
            shipmentId: box.shipmentId,
            status: box.status,
            batchId: box.batchId,
            hasActiveWaybill: box.hasActiveWaybill,
          })),
        },
      });
```

호출 두 곳에 칸을 넣는다 — `assignToLine` 의 `this.changeFrozenLine(trx, { salesOrderId, salesOrderLineId: line.id, …` 에 `fulfillmentOrderId: fo.id,`, `applyToOrder` 의 `this.changeFrozenLine(trx, { salesOrderId, salesOrderLineId: line.id, …` 에 `fulfillmentOrderId: fo?.id ?? null,`.

- [ ] **Step 8: 통과 확인 + 타입**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.integration.spec.ts apps/core/src/modules/fulfillment/line-composition-edit/apply-to-existing-lines.integration.spec.ts`
Expected: PASS 전부(일괄 적용은 `code` 만 읽으므로 영향 없음)

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 9: Commit**

```bash
git add libs/shared/src/filters/http-exception.filter.ts libs/shared/src/filters/http-exception.filter.spec.ts \
  apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.manager.ts \
  apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.integration.spec.ts
git commit -m "fix(core): LINE_BOX_NOT_DRAFT 박스 목록을 details 로 실어 응답 필터를 통과시킨다 (#1063)"
```

---

### Task 2: core — 화면용 라인 구성 읽기(FO 상세 `lines`, 매칭체크 `composition`)

라인의 구성 항목을 내려주는 GET 이 없었다. 판정·비교용 `selectFrozenCompositions` 는 SKU id 만 내고 정렬 계약이 걸려 있으니 건드리지 않는다. 표시용 함수를 따로 둔다.

**Files:**
- Create: `apps/core/src/modules/product-matching/line-composition/line-composition-views.ts`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts` (`getOne`, 약 798–945줄)
- Modify: `apps/core/src/modules/fulfillment/dto/fulfillment-order-response.dto.ts` (`FulfillmentOrderV2ResponseDto`)
- Modify: `apps/core/src/modules/product-matching/services/product-matching.service.ts` (`getOrderLines`, 약 689–840줄)
- Test: `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-views.integration.spec.ts` (신규)

**Interfaces:**
- Produces:
  ```ts
  export interface CompositionItemView { skuId: string; skuCode: string; skuName: string; qtyPerUnit: number }
  export interface LineCompositionView {
    salesOrderLineId: string; productName: string; quantity: number;
    compositionSource: CompositionSource | null; composition: CompositionItemView[];
  }
  export function selectCompositionItemViews(db: DbTx | DbService<typeof wmsSchema>['db'], lineIds: readonly string[]): Promise<Map<string, CompositionItemView[]>>
  export function selectLineCompositionViews(db: DbTx | DbService<typeof wmsSchema>['db'], lineIds: readonly string[]): Promise<LineCompositionView[]>
  ```
- HTTP: `GET /fulfillments/:id` 응답에 `lines: LineCompositionView[]`, `GET /matchings/order-lines` 행에 `composition: CompositionItemView[]`(굳히지 않은 라인은 `[]`) — Task 3 이 타입으로 옮긴다

- [ ] **Step 1: 실패하는 통합 스펙 작성**

`apps/core/src/modules/fulfillment/line-composition-edit/line-composition-views.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { selectCompositionItemViews } from '../../product-matching/line-composition/line-composition-views';
import { ProductMatchingService } from '../../product-matching/services/product-matching.service';
import { inRollbackTx, makeDb, seedSalesOrder, wireLogistics } from '../services/__support__';
import { ambientDbService } from '../services/__support__/simple-outbound-wiring';
import { seedOrderWithDraftBox } from '../draft-box/__support__/draft-box-fixtures';
import { wireLineCompositionEdit } from './__support__/line-composition-edit-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID() };

function wire(tx: DbTx) {
  const dbService = ambientDbService(tx);
  const logistics = wireLogistics(dbService);
  const edit = wireLineCompositionEdit(dbService, logistics);
  return { dbService, logistics, edit };
}

async function skuViews(tx: DbTx, ids: string[]) {
  const rows = await tx
    .select({ id: wmsTables.skus.id, code: wmsTables.skus.code, name: wmsTables.skus.name })
    .from(wmsTables.skus)
    .where(inArray(wmsTables.skus.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

describeIfDb('라인 구성 표시 읽기 (#1063 스펙 §8.1)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it('FO 상세 lines 가 FO 생성이 굳힌 구성을 SKU 코드·이름과 함께 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 2, qtyPerUnits: [1, 3] }] });
      const skus = await skuViews(tx, fx.skuIdsByLine[0]);

      const detail = await w.logistics.fulfillments.getOne(fx.fulfillmentOrderId, tx);

      expect(detail?.lines).toHaveLength(1);
      const [line] = detail?.lines ?? [];
      expect(line).toMatchObject({ salesOrderLineId: fx.lineIds[0], quantity: 2, compositionSource: 'matching' });
      expect(line.productName).toEqual(expect.any(String));
      expect(line.composition).toEqual(
        expect.arrayContaining(
          fx.skuIdsByLine[0].map((skuId, k) => ({
            skuId,
            skuCode: skus.get(skuId)?.code,
            skuName: skus.get(skuId)?.name,
            qtyPerUnit: [1, 3][k],
          })),
        ),
      );
    });
  });

  it('운영자 지정 뒤: 출처 operator, 새 구성, 빠진 SKU 의 FO 항목은 qty 0·canceledQty 0 (화면의 «대체됨» 재료)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, {
        lines: [{ quantity: 1, qtyPerUnits: [1] }],
        spareSkus: 1,
      });
      await w.edit.manager.assignToLine(
        fx.salesOrderId,
        fx.lineIds[0],
        [{ skuId: fx.spareSkuIds[0], qtyPerUnit: 1 }],
        null,
        actor,
        tx,
      );

      const detail = await w.logistics.fulfillments.getOne(fx.fulfillmentOrderId, tx);

      expect(detail?.lines?.[0]).toMatchObject({
        compositionSource: 'operator',
        composition: [expect.objectContaining({ skuId: fx.spareSkuIds[0], qtyPerUnit: 1 })],
      });
      const replaced = detail?.items.find((item) => item.skuId === fx.skuIdsByLine[0][0]);
      expect(replaced).toMatchObject({ qty: 0, canceledQty: 0 });
    });
  });

  it('굳히지 않은 라인은 구성 맵에 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { lineIds } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 1 }] });
      const views = await selectCompositionItemViews(tx, lineIds);
      expect(views.has(lineIds[0])).toBe(false);
    });
  });

  it('매칭체크 행에 composition 이 실린다(굳힌 라인)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const fx = await seedOrderWithDraftBox(tx, w.logistics, { lines: [{ quantity: 1, qtyPerUnits: [2] }] });
      const marker = `pr3-${randomUUID()}`;
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ productName: marker })
        .where(eq(wmsTables.salesOrderLines.id, fx.lineIds[0]));
      const service = new ProductMatchingService(w.dbService, {} as never, {} as never, {} as never, {} as never);

      const page = await service.getOrderLines({ keyword: marker, keywordType: 'productName' }, tx);

      expect(page.data).toHaveLength(1);
      expect(page.data[0]).toMatchObject({
        compositionSource: 'matching',
        composition: [expect.objectContaining({ skuId: fx.skuIdsByLine[0][0], qtyPerUnit: 2 })],
      });
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/line-composition-edit/line-composition-views.integration.spec.ts`
Expected: FAIL — `line-composition-views` 모듈 없음

- [ ] **Step 3: 읽기 함수 작성**

`apps/core/src/modules/product-matching/line-composition/line-composition-views.ts`:

```ts
import { eq, inArray } from 'drizzle-orm';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { CompositionSource } from './line-composition';

export interface CompositionItemView {
  skuId: string;
  skuCode: string;
  skuName: string;
  qtyPerUnit: number;
}

export interface LineCompositionView {
  salesOrderLineId: string;
  productName: string;
  quantity: number;
  compositionSource: CompositionSource | null;
  composition: CompositionItemView[];
}

type Reader = DbTx | DbService<typeof wmsSchema>['db'];

/**
 * 화면 표시용 라인 구성(SKU 코드 순). 판정·비교는 selectFrozenCompositions 를 쓴다 — 그쪽 정렬은 sameComposition 의 계약이라
 * 표시 요구(이름·코드 조인)를 거기 섞지 않는다.
 */
export async function selectCompositionItemViews(
  db: Reader,
  lineIds: readonly string[],
): Promise<Map<string, CompositionItemView[]>> {
  if (lineIds.length === 0) return new Map();
  const table = wmsTables.salesOrderLineCompositions;
  const rows = await db
    .select({
      salesOrderLineId: table.salesOrderLineId,
      skuId: table.skuId,
      qtyPerUnit: table.qtyPerUnit,
      skuCode: wmsTables.skus.code,
      skuName: wmsTables.skus.name,
    })
    .from(table)
    .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, table.skuId))
    .where(inArray(table.salesOrderLineId, [...lineIds]))
    .orderBy(wmsTables.skus.code);
  const byLine = new Map<string, CompositionItemView[]>();
  for (const row of rows) {
    const items = byLine.get(row.salesOrderLineId) ?? [];
    items.push({ skuId: row.skuId, skuCode: row.skuCode, skuName: row.skuName, qtyPerUnit: row.qtyPerUnit });
    byLine.set(row.salesOrderLineId, items);
  }
  return byLine;
}

/** 출고 주문 상세가 라인마다 구성과 출처를 그린다(스펙 §8-2). 굳히지 않은 라인은 composition 이 빈 배열이다 */
export async function selectLineCompositionViews(
  db: Reader,
  lineIds: readonly string[],
): Promise<LineCompositionView[]> {
  if (lineIds.length === 0) return [];
  const lines = wmsTables.salesOrderLines;
  const rows = await db
    .select({
      id: lines.id,
      productName: lines.productName,
      quantity: lines.quantity,
      compositionSource: lines.compositionSource,
    })
    .from(lines)
    .where(inArray(lines.id, [...lineIds]))
    .orderBy(lines.createdAt);
  const items = await selectCompositionItemViews(db, lineIds);
  return rows.map((row) => ({
    salesOrderLineId: row.id,
    productName: row.productName,
    quantity: row.quantity,
    compositionSource: row.compositionSource ?? null,
    composition: items.get(row.id) ?? [],
  }));
}
```

- [ ] **Step 4: FO 상세에 `lines`**

`fulfillments.service.ts` import 에 추가:

```ts
import { selectLineCompositionViews } from '../../product-matching/line-composition/line-composition-views';
```

`getOne` 의 `return { ...fulfillmentOrder, progress, shipments: shipmentList, items: itemsWithSku, … }` 바로 앞에:

```ts
    const lineIds = uniqueStrings(
      itemsWithSku.map((item) => item.salesOrderLineId).filter((id): id is string => id !== null),
    );
    const lines = await selectLineCompositionViews(db, lineIds);
```

반환 객체의 `items: itemsWithSku,` 다음 줄에 `lines,` 를 넣는다.

`dto/fulfillment-order-response.dto.ts` — `FulfillmentOrderV2ResponseDto` 위에 클래스 둘을 추가하고, 그 클래스에 칸을 더한다:

```ts
export class LineCompositionItemViewDto {
  @ApiProperty() skuId: string;
  @ApiProperty() skuCode: string;
  @ApiProperty() skuName: string;
  @ApiProperty({ description: '판매 1개당 SKU 수량' }) qtyPerUnit: number;
}

export class FulfillmentOrderLineViewDto {
  @ApiProperty() salesOrderLineId: string;
  @ApiProperty() productName: string;
  @ApiProperty() quantity: number;
  @ApiProperty({ enum: ['matching', 'operator'], nullable: true, description: 'NULL = 아직 굳히지 않음' })
  compositionSource: string | null;
  @ApiProperty({ type: [LineCompositionItemViewDto] }) composition: LineCompositionItemViewDto[];
}
```

`FulfillmentOrderV2ResponseDto` 의 `items` 다음:

```ts
  @ApiProperty({ type: [FulfillmentOrderLineViewDto], description: 'FO 항목이 가리키는 판매주문 라인과 그 구성' })
  lines: FulfillmentOrderLineViewDto[];
```

- [ ] **Step 5: 매칭체크 행에 `composition`**

`product-matching.service.ts` import 에 추가:

```ts
import { selectCompositionItemViews } from '../line-composition/line-composition-views';
```

`getOrderLines` 의 `const skusByMatchingId = new Map…` 루프 다음, `const data = rows.map(…)` 앞에:

```ts
      // 굳힌 라인은 상품매칭이 아니라 라인 구성을 보여 준다 — 개별 지정·상품매칭 변경 뒤에는 둘이 다르다
      const compositionsByLine = await selectCompositionItemViews(
        trx,
        rows.filter((row) => row.compositionSource !== null).map((row) => row.lineId),
      );
```

`data` 매핑의 `compositionSource: row.compositionSource ?? undefined,` 다음 줄:

```ts
        composition: compositionsByLine.get(row.lineId) ?? [],
```

- [ ] **Step 6: 통과 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/line-composition-edit/line-composition-views.integration.spec.ts`
Expected: PASS 4건

Run: `npx jest apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts apps/core/src/modules/product-matching/services/product-matching.service.spec.ts`
Expected: PASS — 단위 스펙의 가짜 tx 는 조인·조건을 무시하고 상태 테이블 행을 돌려준다(`salesOrderLines`·`salesOrderLineCompositions` 둘 다 상태에 있다). 깨지면 가짜에 그 테이블을 추가한다. 테스트를 지우지 않는다

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/product-matching/line-composition/line-composition-views.ts \
  apps/core/src/modules/fulfillment/services/fulfillments.service.ts \
  apps/core/src/modules/fulfillment/dto/fulfillment-order-response.dto.ts \
  apps/core/src/modules/product-matching/services/product-matching.service.ts \
  apps/core/src/modules/fulfillment/line-composition-edit/line-composition-views.integration.spec.ts
git commit -m "feat(core): FO 상세 lines·매칭체크 composition — 라인 구성을 화면에 내려준다 (#1063)"
```

---

### Task 3: admin-web — 타입·API 클라이언트·뮤테이션 훅

**Files:**
- Create: `apps/admin-web/src/lib/types/dto/line-composition.ts`
- Modify: `apps/admin-web/src/lib/types/dto/matching.ts` (`OrderLineDto`, 174줄)
- Modify: `apps/admin-web/src/lib/types/dto/fulfillment.ts` (`FulfillmentOrderDetail`, 84줄)
- Create: `apps/admin-web/src/lib/api/domains/orders/line-composition.client.ts`
- Create: `apps/admin-web/src/lib/api/domains/orders/line-composition.client.spec.ts`
- Create: `apps/admin-web/src/lib/services/orders/line-composition.ts`

**Interfaces:**
- Produces(타입, `@/lib/types/dto/line-composition`):
  ```ts
  export type CompositionSource = 'matching' | 'operator';
  export interface CompositionItemInput { skuId: string; qtyPerUnit: number }
  export interface CompositionItemView extends CompositionItemInput { skuCode: string; skuName: string }
  export interface LineCompositionView { salesOrderLineId: string; productName: string; quantity: number; compositionSource: CompositionSource | null; composition: CompositionItemView[] }
  export interface PutLineCompositionRequest { items: CompositionItemInput[]; note?: string }
  export interface LineCompositionChangeResponse { salesOrderLineId: string; source: CompositionSource; items: CompositionItemInput[]; changedShipmentIds: string[]; amendmentId: string | null }
  export interface ExistingLinesImpact { variantId: string; applicable: boolean; newComposition: CompositionItemInput[] | null; changeable: number; skippedOperator: number; skippedInProgress: number; alreadySame: number }
  export type ApplySkipReason = 'operator' | 'in_progress' | 'same' | 'units_ambiguous' | 'not_applicable';
  export interface ApplyToExistingLinesResult { changed: number; skipped: Array<{ reason: ApplySkipReason; count: number }> }
  ```
- Produces(클라이언트): `lineCompositionClient.assign(salesOrderId, salesOrderLineId, body)`, `.existingLinesImpact(variantId)`, `.applyToExistingLines(variantId)`
- Produces(훅): `useAssignLineComposition()` — `mutateAsync({ salesOrderId, salesOrderLineId, body })`; `useApplyToExistingLines()` — `mutateAsync(variantId)`

- [ ] **Step 1: 타입 파일**

`apps/admin-web/src/lib/types/dto/line-composition.ts` — 위 Interfaces 블록을 그대로 쓴다(파일 머리에 `// core line-composition-edit.dto.ts · line-composition-views.ts 의 응답 모양 (#1063)`).

`matching.ts` 의 `OrderLineDto` 에 칸 둘(`matchedSkus` 다음), 파일 위 import:

```ts
import type { CompositionItemView, CompositionSource } from './line-composition';
```

```ts
  /** 라인 구성 출처. 없으면 아직 굳히지 않음(현재 상품매칭을 따른다) */
  compositionSource?: CompositionSource;
  /** 굳힌 라인의 구성. 옛 core 는 이 칸을 안 준다 */
  composition?: CompositionItemView[];
```

`fulfillment.ts` 의 `FulfillmentOrderDetail` 에 칸 하나(`shipments?` 다음), import 추가:

```ts
import type { LineCompositionView } from './line-composition';
```

```ts
  /** FO 항목이 가리키는 판매주문 라인과 구성. 옛 core 는 이 칸을 안 준다 */
  lines?: LineCompositionView[];
```

- [ ] **Step 2: 클라이언트 실패 테스트**

`apps/admin-web/src/lib/api/domains/orders/line-composition.client.spec.ts`:

```ts
jest.mock('@/const', () => ({ ALMONDYOUNG_API_BASE_URL: '/core' }), {
  virtual: true,
});

jest.mock('../../client', () => ({
  client: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

import { client } from '../../client';
import { lineCompositionClient } from './line-composition.client';

const mockedClient = client as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
};

describe('line composition client (#1063)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedClient.get.mockResolvedValue({ data: { changeable: 0 } });
    mockedClient.post.mockResolvedValue({ data: { changed: 0, skipped: [] } });
    mockedClient.put.mockResolvedValue({ data: { salesOrderLineId: 'l' } });
  });

  it('PUT 은 판매주문·라인 경로에 본문 그대로', async () => {
    await lineCompositionClient.assign('so/1', 'line/1', { items: [{ skuId: 's', qtyPerUnit: 2 }] });
    expect(mockedClient.put).toHaveBeenCalledWith('/core/sales-orders/so%2F1/lines/line%2F1/composition', {
      items: [{ skuId: 's', qtyPerUnit: 2 }],
    });
  });

  it('미리보기·적용은 matchings/variants 경로', async () => {
    await lineCompositionClient.existingLinesImpact('v/1');
    await lineCompositionClient.applyToExistingLines('v/1');
    expect(mockedClient.get).toHaveBeenCalledWith('/core/matchings/variants/v%2F1/existing-lines-impact');
    expect(mockedClient.post).toHaveBeenCalledWith('/core/matchings/variants/v%2F1/apply-to-existing-lines');
  });
});
```

Run: `npm run test:admin-web -- apps/admin-web/src/lib/api/domains/orders/line-composition.client.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 클라이언트**

`apps/admin-web/src/lib/api/domains/orders/line-composition.client.ts`:

```ts
'use client';

// 판매주문 라인 구성(#1063) — 주문별 지정·상품매칭의 기존 출고 적용
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type {
  ApplyToExistingLinesResult,
  ExistingLinesImpact,
  LineCompositionChangeResponse,
  PutLineCompositionRequest,
} from '../../../types/dto/line-composition';
import { client } from '../../client';

const enc = encodeURIComponent;

// 셋 다 멱등이라(같은 구성 재전송 = 무변경, 적용 재전송 = «이미 같음») Idempotency-Key 없이 보낸다.
// client 는 키 없는 변경 요청을 재시도하지 않는다
export const lineCompositionClient = {
  assign: async (
    salesOrderId: string,
    salesOrderLineId: string,
    body: PutLineCompositionRequest
  ): Promise<LineCompositionChangeResponse> => {
    const response = await client.put(
      `${ALMONDYOUNG_API_BASE_URL}/sales-orders/${enc(salesOrderId)}/lines/${enc(salesOrderLineId)}/composition`,
      body
    );
    return response.data;
  },

  existingLinesImpact: async (variantId: string): Promise<ExistingLinesImpact> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/matchings/variants/${enc(variantId)}/existing-lines-impact`
    );
    return response.data;
  },

  applyToExistingLines: async (variantId: string): Promise<ApplyToExistingLinesResult> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/matchings/variants/${enc(variantId)}/apply-to-existing-lines`
    );
    return response.data;
  },
};
```

Run: `npm run test:admin-web -- apps/admin-web/src/lib/api/domains/orders/line-composition.client.spec.ts`
Expected: PASS

- [ ] **Step 4: 훅**

`apps/admin-web/src/lib/services/orders/line-composition.ts`:

```ts
'use client';

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { lineCompositionClient } from '@/lib/api/domains/orders/line-composition.client';
import type { PutLineCompositionRequest } from '@/lib/types/dto/line-composition';
import { matchingQueryKeys } from '@/lib/services/matching/query-keys';
import { orderQueryKeys } from './query-keys';

// 라인 구성이 바뀌면 FO 상세(박스·항목), 매칭체크 목록(개별 지정·해결 여부), 주문 목록(매칭 배지)이 같이 바뀐다
function invalidateCompositionReaders(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: orderQueryKeys.fulfillments });
  queryClient.invalidateQueries({ queryKey: matchingQueryKeys.orderLineLists() });
  queryClient.invalidateQueries({ queryKey: orderQueryKeys.orders });
}

export const useAssignLineComposition = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      salesOrderId: string;
      salesOrderLineId: string;
      body: PutLineCompositionRequest;
    }) => lineCompositionClient.assign(input.salesOrderId, input.salesOrderLineId, input.body),
    onSuccess: () => invalidateCompositionReaders(queryClient),
  });
};

export const useApplyToExistingLines = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variantId: string) => lineCompositionClient.applyToExistingLines(variantId),
    onSuccess: () => invalidateCompositionReaders(queryClient),
  });
};
```

- [ ] **Step 5: admin-web tsc**

Run: `(cd apps/admin-web && npx tsc --noEmit)`
Expected: 에러 0

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/lib/types/dto/line-composition.ts apps/admin-web/src/lib/types/dto/matching.ts \
  apps/admin-web/src/lib/types/dto/fulfillment.ts apps/admin-web/src/lib/api/domains/orders/line-composition.client.ts \
  apps/admin-web/src/lib/api/domains/orders/line-composition.client.spec.ts apps/admin-web/src/lib/services/orders/line-composition.ts
git commit -m "feat(admin-web): 라인 구성 API 타입·클라이언트·훅 (#1063)"
```

---

### Task 4: admin-web — 판정 순수 함수(오류 → 문구·링크, 미리보기 → 단계, 항목 → «대체됨», 행 → 초기값)

화면의 모든 분기를 여기 둔다. 컴포넌트(Task 6~8)는 이 결과만 그린다.

**Files:**
- Create: `apps/admin-web/src/features/order/line-composition/line-composition-view.ts`
- Create: `apps/admin-web/src/features/order/line-composition/line-composition-view.spec.ts`
- Create: `apps/admin-web/src/features/order/line-composition/picked-skus.ts`
- Create: `apps/admin-web/src/features/order/line-composition/picked-skus.spec.ts`

**Interfaces:**
- Consumes: Task 3 의 타입, `parseServerError`(`src/lib/api/server-error.ts`), `OrderLineDto`(`src/lib/types/dto/matching.ts`)
- Produces(`line-composition-view.ts`):
  ```ts
  export const OPERATOR_BADGE = '개별 지정';
  export function sourceBadge(source: CompositionSource | null | undefined): string | null
  export function foItemStatusLabel(item: { qty: number; status: string }): string
  export interface LineCompositionTarget { salesOrderId: string; salesOrderLineId: string; productName: string; quantity: number; composition: CompositionItemView[] }
  export function matchingRowTarget(line: OrderLineDto): LineCompositionTarget
  export interface ExistingLinesStepView { changeable: number; counts: Array<{ label: string; count: number }> }
  export function existingLinesStep(impact: ExistingLinesImpact | null | undefined): ExistingLinesStepView | null
  export function applyResultText(result: ApplyToExistingLinesResult): string
  export interface CompositionErrorView { message: string; retry: boolean; links: Array<{ label: string; href: string }> }
  export const COMPOSITION_ERROR_MESSAGES: Record<string, string>
  export function compositionErrorView(error: unknown, options?: { currentFulfillmentOrderId?: string }): CompositionErrorView
  ```
- Produces(`picked-skus.ts`):
  ```ts
  export interface PickedSku { skuId: string; skuName: string; quantity: number }
  export type AddPickedResult = { ok: true; list: PickedSku[] } | { ok: false; reason: 'duplicate' };
  export function addPicked(list: readonly PickedSku[], sku: { id: string; name: string }): AddPickedResult
  export function removePicked(list: readonly PickedSku[], skuId: string): PickedSku[]
  export function setPickedQuantity(list: readonly PickedSku[], skuId: string, value: number): PickedSku[]
  export function pickedFromComposition(items: readonly CompositionItemView[]): PickedSku[]
  export function toCompositionItems(list: readonly PickedSku[]): CompositionItemInput[]
  ```

- [ ] **Step 1: `picked-skus` 실패 테스트**

`apps/admin-web/src/features/order/line-composition/picked-skus.spec.ts`:

```ts
import {
  addPicked,
  pickedFromComposition,
  removePicked,
  setPickedQuantity,
  toCompositionItems,
} from './picked-skus';

const a = { skuId: 'a', skuName: 'A', quantity: 1 };

describe('picked skus', () => {
  it('adds a new SKU with quantity 1 and refuses a duplicate', () => {
    expect(addPicked([], { id: 'a', name: 'A' })).toEqual({ ok: true, list: [a] });
    expect(addPicked([a], { id: 'a', name: 'A' })).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('removes by skuId', () => {
    expect(removePicked([a, { ...a, skuId: 'b' }], 'a')).toEqual([{ ...a, skuId: 'b' }]);
  });

  it('keeps quantity a positive integer (0·소수·NaN → 1 이상 정수)', () => {
    expect(setPickedQuantity([a], 'a', 3.7)[0].quantity).toBe(3);
    expect(setPickedQuantity([a], 'a', 0)[0].quantity).toBe(1);
    expect(setPickedQuantity([a], 'a', Number('x'))[0].quantity).toBe(1);
  });

  it('converts between line composition and picked list', () => {
    const picked = pickedFromComposition([{ skuId: 'a', skuCode: 'C', skuName: 'A', qtyPerUnit: 2 }]);
    expect(picked).toEqual([{ skuId: 'a', skuName: 'A', quantity: 2 }]);
    expect(toCompositionItems(picked)).toEqual([{ skuId: 'a', qtyPerUnit: 2 }]);
  });
});
```

Run: `npm run test:admin-web -- apps/admin-web/src/features/order/line-composition/picked-skus.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 2: `picked-skus` 구현**

`apps/admin-web/src/features/order/line-composition/picked-skus.ts`:

```ts
import type { CompositionItemInput, CompositionItemView } from '@/lib/types/dto/line-composition';

/** 고른 SKU 와 판매 1개당 수량. 상품매칭 수동 탭과 «이 주문만» 다이얼로그가 같은 목록을 쓴다 */
export interface PickedSku {
  skuId: string;
  skuName: string;
  quantity: number;
}

export type AddPickedResult = { ok: true; list: PickedSku[] } | { ok: false; reason: 'duplicate' };

export function addPicked(list: readonly PickedSku[], sku: { id: string; name: string }): AddPickedResult {
  if (list.some((item) => item.skuId === sku.id)) return { ok: false, reason: 'duplicate' };
  return { ok: true, list: [...list, { skuId: sku.id, skuName: sku.name, quantity: 1 }] };
}

export function removePicked(list: readonly PickedSku[], skuId: string): PickedSku[] {
  return list.filter((item) => item.skuId !== skuId);
}

// core 가 1개당 수량을 양의 정수로만 받는다(COMPOSITION_ITEMS_INVALID) — 입력 중 빈 칸·소수도 여기서 막는다
export function setPickedQuantity(list: readonly PickedSku[], skuId: string, value: number): PickedSku[] {
  const quantity = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
  return list.map((item) => (item.skuId === skuId ? { ...item, quantity } : item));
}

export function pickedFromComposition(items: readonly CompositionItemView[]): PickedSku[] {
  return items.map((item) => ({ skuId: item.skuId, skuName: item.skuName, quantity: item.qtyPerUnit }));
}

export function toCompositionItems(list: readonly PickedSku[]): CompositionItemInput[] {
  return list.map((item) => ({ skuId: item.skuId, qtyPerUnit: item.quantity }));
}
```

Run: `npm run test:admin-web -- apps/admin-web/src/features/order/line-composition/picked-skus.spec.ts`
Expected: PASS

- [ ] **Step 3: `line-composition-view` 실패 테스트**

`apps/admin-web/src/features/order/line-composition/line-composition-view.spec.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import type { OrderLineDto } from '@/lib/types/dto/matching';
import {
  COMPOSITION_ERROR_MESSAGES,
  applyResultText,
  compositionErrorView,
  existingLinesStep,
  foItemStatusLabel,
  matchingRowTarget,
  sourceBadge,
} from './line-composition-view';

// axios client 인터셉터가 던지는 모양: CustomError({ statusCode, response: <응답 본문> })
function serverError(status: number, body: Record<string, unknown>) {
  return { message: String(body.message ?? ''), statusCode: status, response: body };
}

const box = (over: Record<string, unknown> = {}) => ({
  shipmentId: 's-1',
  status: 'planned',
  batchId: null,
  hasActiveWaybill: false,
  ...over,
});

describe('sourceBadge', () => {
  it('shows only the operator source — matching is the normal state', () => {
    expect(sourceBadge('operator')).toBe('개별 지정');
    expect(sourceBadge('matching')).toBeNull();
    expect(sourceBadge(null)).toBeNull();
    expect(sourceBadge(undefined)).toBeNull();
  });
});

describe('foItemStatusLabel', () => {
  it('qty 0 = 구성 변경으로 빠진 SKU → «대체됨»', () => {
    expect(foItemStatusLabel({ qty: 0, status: 'pending' })).toBe('대체됨');
  });
  it('고객 취소·부분 감소는 상태 그대로', () => {
    expect(foItemStatusLabel({ qty: 2, status: 'partial' })).toBe('partial');
    expect(foItemStatusLabel({ qty: 1, status: 'pending' })).toBe('pending');
  });
});

describe('matchingRowTarget', () => {
  const base: OrderLineDto = {
    id: 'line-1',
    variantId: 'v-1',
    productName: '상품',
    quantity: 2,
    salesOrderId: 'so-1',
    channelOrderId: 'c-1',
    salesChannel: 'medusa',
    orderDate: '2026-10-14T00:00:00.000Z',
    matchedSkus: [{ skuId: 'm', skuName: '매칭 SKU', skuCode: 'M', quantity: 3 }],
  };

  it('굳힌 라인은 라인 구성으로 채운다(상품매칭이 바뀌었어도 박스에 든 것)', () => {
    const target = matchingRowTarget({
      ...base,
      compositionSource: 'matching',
      composition: [{ skuId: 'f', skuCode: 'F', skuName: '굳힌 SKU', qtyPerUnit: 1 }],
    });
    expect(target).toEqual({
      salesOrderId: 'so-1',
      salesOrderLineId: 'line-1',
      productName: '상품',
      quantity: 2,
      composition: [{ skuId: 'f', skuCode: 'F', skuName: '굳힌 SKU', qtyPerUnit: 1 }],
    });
  });

  it('굳히지 않은 라인은 현재 상품매칭으로 채운다', () => {
    expect(matchingRowTarget(base).composition).toEqual([
      { skuId: 'm', skuCode: 'M', skuName: '매칭 SKU', qtyPerUnit: 3 },
    ]);
  });

  it('옛 core(composition 칸 없음)는 상품매칭으로 물러선다', () => {
    expect(matchingRowTarget({ ...base, compositionSource: 'operator' }).composition).toHaveLength(1);
  });
});

describe('existingLinesStep', () => {
  const impact = {
    variantId: 'v',
    applicable: true,
    newComposition: [{ skuId: 's', qtyPerUnit: 1 }],
    changeable: 3,
    skippedOperator: 1,
    skippedInProgress: 0,
    alreadySame: 2,
  };

  it('바꿀 것이 있을 때만 단계가 뜨고, 0 인 칸은 숨긴다', () => {
    expect(existingLinesStep(impact)).toEqual({
      changeable: 3,
      counts: [
        { label: '바꿀 수 있음', count: 3 },
        { label: '개별 지정', count: 1 },
        { label: '이미 같음', count: 2 },
      ],
    });
  });

  it.each([
    ['건너뜀만 있음', { ...impact, changeable: 0, skippedInProgress: 4 }],
    ['적용 불가(void·링크 0)', { ...impact, applicable: false }],
  ])('%s → 단계 없음', (_name, value) => {
    expect(existingLinesStep(value)).toBeNull();
  });

  it('미리보기가 없으면 단계 없음', () => {
    expect(existingLinesStep(null)).toBeNull();
    expect(existingLinesStep(undefined)).toBeNull();
  });
});

describe('applyResultText', () => {
  it('건너뜀이 없으면 바뀐 수만', () => {
    expect(applyResultText({ changed: 3, skipped: [] })).toBe('바뀜 3');
  });
  it('건너뜀은 합계와 사유별', () => {
    expect(
      applyResultText({
        changed: 1,
        skipped: [
          { reason: 'operator', count: 2 },
          { reason: 'in_progress', count: 1 },
          { reason: 'units_ambiguous', count: 1 },
        ],
      }),
    ).toBe('바뀜 1 · 건너뜀 4(개별 지정 2 · 작업 중 1 · 수량 계산 불가 1)');
  });
});

describe('compositionErrorView', () => {
  it('배치에 든 박스 → 배치 링크(드로어가 열린다)', () => {
    const view = compositionErrorView(
      serverError(409, {
        code: 'LINE_BOX_NOT_DRAFT',
        message: 'blocked',
        details: { fulfillmentOrderId: 'fo-1', boxes: [box({ batchId: 'b-1', status: 'draft' })] },
      }),
    );
    expect(view.message).toBe('배치에 들어간 박스가 있습니다. 배치에서 뺀 뒤 다시 하세요.');
    expect(view.links).toEqual([{ label: '배치 열기', href: '/order/outbound-batches?batchId=b-1' }]);
    expect(view.retry).toBe(false);
  });

  it('배치 없는 박스 → 출고 주문 링크, 같은 배치·FO 는 한 번만', () => {
    const view = compositionErrorView(
      serverError(409, {
        code: 'LINE_BOX_NOT_DRAFT',
        details: {
          fulfillmentOrderId: 'fo-1',
          boxes: [box({ hasActiveWaybill: true }), box({ shipmentId: 's-2' }), box({ shipmentId: 's-3', batchId: 'b-1' }), box({ shipmentId: 's-4', batchId: 'b-1' })],
        },
      }),
    );
    expect(view.links).toEqual([
      { label: '출고 주문 열기', href: '/order/fulfillments/fo-1' },
      { label: '배치 열기', href: '/order/outbound-batches?batchId=b-1' },
    ]);
  });

  it('송장이 있는 박스는 송장 사유를 먼저 말한다(배치 없음)', () => {
    const view = compositionErrorView(
      serverError(409, { code: 'LINE_BOX_NOT_DRAFT', details: { fulfillmentOrderId: 'fo-1', boxes: [box({ status: 'draft', hasActiveWaybill: true })] } }),
    );
    expect(view.message).toBe('송장이 발행된 박스가 있습니다. 송장을 취소한 뒤 다시 하세요.');
  });

  it('보고 있는 출고 주문으로 가는 링크는 내지 않는다', () => {
    const view = compositionErrorView(
      serverError(409, { code: 'LINE_BOX_NOT_DRAFT', details: { fulfillmentOrderId: 'fo-1', boxes: [box()] } }),
      { currentFulfillmentOrderId: 'fo-1' },
    );
    expect(view.message).toBe('확정된 박스가 있습니다. 작성 중 박스만 바꿀 수 있습니다.');
    expect(view.links).toEqual([]);
  });

  it.each([
    ['details 없음(옛 core)', { code: 'LINE_BOX_NOT_DRAFT', message: 'blocked' }],
    ['박스 항목이 깨짐', { code: 'LINE_BOX_NOT_DRAFT', details: { fulfillmentOrderId: 'fo-1', boxes: [{ shipmentId: 1 }] } }],
  ])('%s → 사유 문구는 보이고 링크만 없다', (_name, body) => {
    const view = compositionErrorView(serverError(409, body));
    expect(view.message).toBe('작성 중이 아닌 박스에 담겨 있어 바꿀 수 없습니다.');
    expect(view.links).toEqual([]);
  });

  it('경합 재시도 코드는 retry', () => {
    expect(compositionErrorView(serverError(409, { code: 'SHIPMENT_COMPONENT_CHANGED_RETRY' })).retry).toBe(true);
    expect(compositionErrorView(serverError(409, { code: 'FULFILLMENT_INVARIANT_COMPONENT_CHANGED_RETRY' })).retry).toBe(true);
  });

  it('모르는 코드·코드 없는 404·검증 400 은 서버 메시지 그대로', () => {
    expect(compositionErrorView(serverError(409, { code: 'NEW_CODE', message: '새 사유' })).message).toBe('새 사유');
    expect(compositionErrorView(serverError(404, { message: 'Line x is not in sales order y' })).message).toBe(
      'Line x is not in sales order y',
    );
    expect(compositionErrorView(serverError(400, { message: ['items must contain at least 1 elements'] })).message).toBe(
      'items must contain at least 1 elements',
    );
  });

  it('core 수정 경로가 던지는 코드는 전부 문구가 있다', () => {
    // 코드 목록은 core 소스가 정본이다 — 새 코드가 생기면 이 스펙이 빨개진다
    const root = join(__dirname, '../../../../../../apps/core/src/modules/fulfillment');
    const sources = [
      'line-composition-edit/line-composition-edit.manager.ts',
      'draft-box/draft-box-amender.ts',
      'draft-box/box-target.ts',
    ].map((file) => readFileSync(join(root, file), 'utf8'));
    const thrown = new Set<string>();
    for (const source of sources) {
      for (const match of source.matchAll(/(?:conflict|badRequest)\('([A-Z_]+)'|code: '([A-Z_]+)'/g)) {
        thrown.add(match[1] ?? match[2]);
      }
    }
    // amend 가드(shipment-aggregate)와 불변식 재시도는 다른 파일이 던지지만 이 경로에서 나온다(스펙 §7.4)
    for (const code of [
      'SHIPMENT_ACTIVE_WORK_ITEM',
      'SHIPMENT_CUSTODY_EXISTS',
      'SHIPMENT_ACTIVE_INVOICE',
      'FULFILLMENT_INVARIANT_COMPONENT_CHANGED_RETRY',
    ]) {
      thrown.add(code);
    }
    expect(thrown.size).toBeGreaterThan(10);
    expect([...thrown].filter((code) => !(code in COMPOSITION_ERROR_MESSAGES))).toEqual([]);
  });
});
```

Run: `npm run test:admin-web -- apps/admin-web/src/features/order/line-composition/line-composition-view.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: `line-composition-view` 구현**

`apps/admin-web/src/features/order/line-composition/line-composition-view.ts`:

```ts
// 판매주문 라인 구성(#1063) 화면 판정. 컴포넌트는 이 결과만 그린다 — admin-web 은 컴포넌트 테스트 환경이 없다
import { parseServerError } from '@/lib/api/server-error';
import type {
  ApplySkipReason,
  ApplyToExistingLinesResult,
  CompositionItemView,
  CompositionSource,
  ExistingLinesImpact,
} from '@/lib/types/dto/line-composition';
import type { OrderLineDto } from '@/lib/types/dto/matching';

export const OPERATOR_BADGE = '개별 지정';

// 매칭 출처는 정상 상태라 표시하지 않는다(ui-minimal-text)
export function sourceBadge(source: CompositionSource | null | undefined): string | null {
  return source === 'operator' ? OPERATOR_BADGE : null;
}

// qty 0 은 구성 변경으로 빠진 SKU 다. 고객 취소는 canceledQty 가 들고 qty 는 그대로라 여기 걸리지 않는다
export function foItemStatusLabel(item: { qty: number; status: string }): string {
  return item.qty === 0 ? '대체됨' : item.status;
}

export interface LineCompositionTarget {
  salesOrderId: string;
  salesOrderLineId: string;
  productName: string;
  quantity: number;
  composition: CompositionItemView[];
}

// 굳힌 라인은 박스에 든 구성(라인 구성)으로 채운다 — 상품매칭이 바뀐 뒤엔 둘이 다르다. 굳히지 않았거나 옛 core 면 상품매칭으로
export function matchingRowTarget(line: OrderLineDto): LineCompositionTarget {
  const frozen = line.composition ?? [];
  const composition =
    frozen.length > 0
      ? frozen
      : line.matchedSkus.map((sku) => ({
          skuId: sku.skuId,
          skuCode: sku.skuCode ?? '',
          skuName: sku.skuName,
          qtyPerUnit: sku.quantity,
        }));
  return {
    salesOrderId: line.salesOrderId,
    salesOrderLineId: line.id,
    productName: line.productName,
    quantity: line.quantity,
    composition,
  };
}

export interface ExistingLinesStepView {
  changeable: number;
  counts: Array<{ label: string; count: number }>;
}

// 바꿀 것이 없으면 적용 버튼이 할 일이 없다 — 건너뜀만 있어도 단계를 띄우지 않는다(스펙 §8-3)
export function existingLinesStep(impact: ExistingLinesImpact | null | undefined): ExistingLinesStepView | null {
  if (!impact || !impact.applicable || impact.changeable <= 0) return null;
  const counts = [
    { label: '바꿀 수 있음', count: impact.changeable },
    { label: OPERATOR_BADGE, count: impact.skippedOperator },
    { label: '작업 중', count: impact.skippedInProgress },
    { label: '이미 같음', count: impact.alreadySame },
  ].filter((entry, index) => index === 0 || entry.count > 0);
  return { changeable: impact.changeable, counts };
}

const SKIP_REASON_LABEL: Record<ApplySkipReason, string> = {
  operator: OPERATOR_BADGE,
  in_progress: '작업 중',
  same: '이미 같음',
  units_ambiguous: '수량 계산 불가',
  not_applicable: '적용 불가',
};

export function applyResultText(result: ApplyToExistingLinesResult): string {
  const total = result.skipped.reduce((sum, entry) => sum + entry.count, 0);
  if (total === 0) return `바뀜 ${result.changed}`;
  const parts = result.skipped.map((entry) => `${SKIP_REASON_LABEL[entry.reason]} ${entry.count}`);
  return `바뀜 ${result.changed} · 건너뜀 ${total}(${parts.join(' · ')})`;
}

const RETRY_CODES = new Set(['SHIPMENT_COMPONENT_CHANGED_RETRY', 'FULFILLMENT_INVARIANT_COMPONENT_CHANGED_RETRY']);
const RETRY_MESSAGE = '박스가 방금 바뀌었습니다. 다시 시도해 주세요.';

// core 가 수정 경로에서 던지는 코드 → 거절 사유. 목록은 spec 이 core 소스에서 다시 도출해 대조한다
export const COMPOSITION_ERROR_MESSAGES: Record<string, string> = {
  LINE_NOT_PHYSICAL: '디지털 상품 라인은 구성을 지정할 수 없습니다.',
  DROP_SHIP_NOT_SUPPORTED: '직배송 출고·직배송 SKU 에는 지정할 수 없습니다.',
  LINE_BOX_NOT_DRAFT: '작성 중이 아닌 박스에 담겨 있어 바꿀 수 없습니다.',
  BOX_NOT_DRAFT: '작성 중이 아닌 박스에 담겨 있어 바꿀 수 없습니다.',
  COMPOSITION_NOT_FROZEN: '출고는 만들어졌지만 구성이 기록되지 않은 라인입니다. 개발팀에 알려 주세요.',
  COMPOSITION_UNITS_AMBIGUOUS: '박스에 담긴 수량을 판매 단위로 나눌 수 없어 바꿀 수 없습니다.',
  COMPOSITION_ITEMS_INVALID: 'SKU 를 중복 없이 고르고 1개당 수량은 1 이상 정수로 넣어 주세요.',
  LINE_NOT_IN_FULFILLMENT: '출고에 실리지 않은 라인이라 바꿀 수 없습니다.',
  SALES_ORDER_CANCELLED: '취소된 주문입니다.',
  SALES_ORDER_CLOSED: '이미 출고된 주문입니다.',
  FULFILLMENT_ORDER_CLOSED: '닫힌 출고 주문입니다.',
  SKU_NOT_FOUND: '없는 SKU 입니다.',
  SKU_HOLDER_MISMATCH_FOR_3PL: '3PL 출고에는 같은 화주의 SKU 만 지정할 수 있습니다.',
  SHIPMENT_COMPONENT_CHANGED_RETRY: RETRY_MESSAGE,
  FULFILLMENT_INVARIANT_COMPONENT_CHANGED_RETRY: RETRY_MESSAGE,
  SHIPMENT_ACTIVE_WORK_ITEM: '배치 작업에 들어간 박스입니다. 배치에서 뺀 뒤 다시 하세요.',
  SHIPMENT_CUSTODY_EXISTS: '피킹·검수된 수량이 있는 박스입니다. 피킹을 되돌린 뒤 다시 하세요.',
  SHIPMENT_ACTIVE_INVOICE: '송장이 발행된 박스입니다. 송장을 취소한 뒤 다시 하세요.',
  AMEND_WOULD_EMPTY_BOX: '박스가 비게 되어 바꿀 수 없습니다.',
};

export interface CompositionErrorView {
  message: string;
  retry: boolean;
  links: Array<{ label: string; href: string }>;
}

interface BlockingBox {
  batchId: string | null;
  hasActiveWaybill: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

// 응답 필터가 허용한 details(GlobalExceptionFilter lineBoxNotDraftDetails)만 믿는다. 모양이 어긋나면 링크 없이 문구만 보인다
function blockingBoxesOf(error: unknown): { fulfillmentOrderId: string | null; boxes: BlockingBox[] } | null {
  const root = record(error);
  const response = record(root?.response);
  const body = record(response?.data) ?? response;
  const details = record(body?.details);
  if (!details || !Array.isArray(details.boxes)) return null;
  const fulfillmentOrderId = typeof details.fulfillmentOrderId === 'string' ? details.fulfillmentOrderId : null;
  const boxes: BlockingBox[] = [];
  for (const raw of details.boxes) {
    const entry = record(raw);
    if (!entry || typeof entry.shipmentId !== 'string' || typeof entry.hasActiveWaybill !== 'boolean') return null;
    if (entry.batchId !== null && typeof entry.batchId !== 'string') return null;
    boxes.push({ batchId: entry.batchId, hasActiveWaybill: entry.hasActiveWaybill });
  }
  return { fulfillmentOrderId, boxes };
}

function lineBoxNotDraftView(
  error: unknown,
  currentFulfillmentOrderId: string | undefined,
): CompositionErrorView {
  const blocked = blockingBoxesOf(error);
  if (!blocked) return { message: COMPOSITION_ERROR_MESSAGES.LINE_BOX_NOT_DRAFT, retry: false, links: [] };
  const message = blocked.boxes.some((b) => b.batchId)
    ? '배치에 들어간 박스가 있습니다. 배치에서 뺀 뒤 다시 하세요.'
    : blocked.boxes.some((b) => b.hasActiveWaybill)
      ? '송장이 발행된 박스가 있습니다. 송장을 취소한 뒤 다시 하세요.'
      : '확정된 박스가 있습니다. 작성 중 박스만 바꿀 수 있습니다.';
  const links: CompositionErrorView['links'] = [];
  const seen = new Set<string>();
  const push = (label: string, href: string) => {
    if (seen.has(href)) return;
    seen.add(href);
    links.push({ label, href });
  };
  for (const b of blocked.boxes) {
    if (b.batchId) {
      // 배치 드로어에 «빼기»가 있다 — 박스 상세 경로는 따로 없다
      push('배치 열기', `/order/outbound-batches?batchId=${encodeURIComponent(b.batchId)}`);
    } else if (blocked.fulfillmentOrderId && blocked.fulfillmentOrderId !== currentFulfillmentOrderId) {
      push('출고 주문 열기', `/order/fulfillments/${encodeURIComponent(blocked.fulfillmentOrderId)}`);
    }
  }
  return { message, retry: false, links };
}

export function compositionErrorView(
  error: unknown,
  options: { currentFulfillmentOrderId?: string } = {},
): CompositionErrorView {
  const parsed = parseServerError(error, '구성을 바꾸지 못했습니다.');
  if (parsed.code === 'LINE_BOX_NOT_DRAFT') return lineBoxNotDraftView(error, options.currentFulfillmentOrderId);
  const known = parsed.code ? COMPOSITION_ERROR_MESSAGES[parsed.code] : undefined;
  return {
    message: known ?? parsed.message,
    retry: parsed.code !== null && RETRY_CODES.has(parsed.code),
    links: [],
  };
}
```

> `record()` 의 `as Record<string, unknown>` 은 `src/lib/api/server-error.ts` 의 같은 이름 함수와 같은 근거(객체 검사 직후 좁히기)다 — 새 패턴이 아니다.

- [ ] **Step 5: 통과 확인**

Run: `npm run test:admin-web -- apps/admin-web/src/features/order/line-composition`
Expected: PASS 전부. `core 수정 경로가 던지는 코드는 전부 문구가 있다` 가 빨갛다면 출력에 나온 코드에 문구를 더한다(코드를 목록에서 빼지 않는다)

Run: `(cd apps/admin-web && npx tsc --noEmit)`
Expected: 에러 0

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/features/order/line-composition/
git commit -m "feat(admin-web): 라인 구성 화면 판정 순수 함수 — 오류 문구·박스 링크·일괄 적용 단계·대체됨 (#1063)"
```

---

### Task 5: admin-web — SKU 고르기를 `InventoryMatchingDialog` 에서 뽑는다 (동작 변경 없음)

따로 있는 «SKU 검색 다이얼로그»는 없다(`SearchDialog` 는 공급처·화주 검색). 수동 탭 안의 «현재 매칭된 재고상품» 목록과 «재고상품 검색» 입력·결과 표를 두 컴포넌트로 옮긴다. 레이아웃은 그대로 두려고 하나가 아니라 둘로 나눈다. 검색어 상태는 부모가 든다 — 부모의 effect 두 개(`setSkuSearch(baseName)`·`setSkuSearch(masterName)`)가 프리필한다.

**Files:**
- Create: `apps/admin-web/src/features/order/line-composition/components/sku-composition-picker.tsx`
- Modify: `apps/admin-web/src/features/order/matching/components/table/InventoryMatchingDialog.tsx`

**Interfaces:**
- Consumes: Task 4 `PickedSku`·`addPicked`·`removePicked`·`setPickedQuantity`
- Produces:
  ```ts
  export function PickedSkuList(props: { value: PickedSku[]; onRemove: (skuId: string) => void; onQuantityChange: (skuId: string, value: number) => void }): JSX.Element
  export function SkuSearchPanel(props: { query: string; onQueryChange: (query: string) => void; suggestedQuery?: string; picked: PickedSku[]; onAdd: (sku: { id: string; name: string }) => void }): JSX.Element
  ```

- [ ] **Step 1: 컴포넌트 파일 작성**

`apps/admin-web/src/features/order/line-composition/components/sku-composition-picker.tsx` — 마크업은 `InventoryMatchingDialog.tsx` 수동 탭(«현재 매칭된 재고상품» 목록, «재고상품 검색»의 입력 줄부터 «페이지 네이션» div 까지)에서 **그대로** 옮긴 것이다:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Button, FormInput, FormNumberInput, FormSelect } from '@/components/common';
import { useSkuSearch } from '@/lib/services/inventory';
import { cn } from '@/lib/utils/cn';
import type { PickedSku } from '../picked-skus';

function useDebounced<T>(value: T, delay = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** 고른 SKU 와 판매 1개당 수량 — 상품매칭 수동 탭과 «이 주문만» 다이얼로그가 같이 쓴다 */
export function PickedSkuList({
  value,
  onRemove,
  onQuantityChange,
}: {
  value: PickedSku[];
  onRemove: (skuId: string) => void;
  onQuantityChange: (skuId: string, value: number) => void;
}) {
  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm border border-dashed rounded-lg">
          현재 매칭된 재고상품이 없습니다.
        </div>
      ) : (
        value.map((sku) => (
          <div key={sku.skuId} className="bg-white border rounded-lg p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{sku.skuName}</div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <FormNumberInput
                  className="w-12 h-7 text-center text-xs"
                  value={String(sku.quantity)}
                  onChange={(e) => onQuantityChange(sku.skuId, Number(e.target.value))}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (isNaN(v) || v < 1) onQuantityChange(sku.skuId, 1);
                  }}
                  min={1}
                  step={1}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-red-600 hover:bg-red-50 text-xs"
                  onClick={() => onRemove(sku.skuId)}
                >
                  삭제
                </Button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/** 재고상품 검색 입력과 결과 표. 검색어는 부모가 든다(부모가 판매상품명으로 프리필한다) */
export function SkuSearchPanel({
  query,
  onQueryChange,
  suggestedQuery,
  picked,
  onAdd,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  suggestedQuery?: string;
  picked: PickedSku[];
  onAdd: (sku: { id: string; name: string }) => void;
}) {
  const [searchType, setSearchType] = useState('name');
  const debounced = useDebounced(query, 350);
  const { data: skuResults, isLoading: searching } = useSkuSearch(debounced, 1, 20);
  // 서버가 이미 거른다 — 클라이언트는 추가로 거르지 않는다
  const results = skuResults?.items ?? [];

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <FormSelect
          options={[{ value: 'name', label: '재고 상품명' }]}
          value={searchType || 'name'}
          onValueChange={setSearchType}
          className="w-40"
        />
        <div className="flex-1 relative">
          <FormInput
            placeholder="재고 상품명으로 검색"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="pr-10"
          />
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
        </div>
        <Button
          className="bg-orange-500 hover:bg-orange-600 text-white px-4"
          onClick={() => {
            // 검색은 useSkuSearch 가 디바운스된 검색어로 자동 실행한다
          }}
        >
          찾기
        </Button>
        {suggestedQuery && (
          <Button variant="outline" onClick={() => onQueryChange(suggestedQuery)}>
            판매상품명으로 검색
          </Button>
        )}
      </div>

      <div className="bg-white border rounded-lg">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-700">등록</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-700">재고상품 명</th>
              <th className="text-center px-4 py-2 text-xs font-medium text-gray-700">공급처</th>
            </tr>
          </thead>
          <tbody>
            {searching ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" />
                </td>
              </tr>
            ) : results.length > 0 ? (
              results.map((sku) => {
                const isLinked = picked.some((s) => s.skuId === sku.id);
                return (
                  <tr key={sku.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Button
                        size="sm"
                        variant={isLinked ? 'outline' : 'primary'}
                        className={cn(
                          'h-7 px-3 text-xs',
                          isLinked ? 'text-gray-500' : 'bg-orange-500 hover:bg-orange-600 text-white'
                        )}
                        onClick={() => !isLinked && onAdd({ id: sku.id, name: sku.name })}
                        disabled={isLinked}
                      >
                        {isLinked ? '등록됨' : '등록'}
                      </Button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm">{sku.name}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {/* 검색 응답은 suppliers 배열이다 — 옛 코드의 sku.supplier 는 늘 비어 «자체제작»만 보였다 */}
                      <div className="text-sm text-gray-600">{sku.suppliers[0]?.name ?? '자체제작'}</div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-500">
                  {debounced ? '검색 결과가 없습니다.' : '검색어를 입력해주세요'}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* 페이지 네이션 */}
        <div className="text-center py-2 border-t">
          <span className="text-xs text-gray-400">페이지 네이션</span>
        </div>
      </div>
    </div>
  );
}
```

> 마크업은 옛 수동 탭과 같다. 바뀐 것 둘: `(sku: any)` 가 `SkuResponseDto` 로 추론되고, 공급처 칸이 실제 응답 칸(`suppliers[0]`)을 읽는다(코어 `sku-catalog.reader.ts` `getById` 가 `suppliers: [{ id, name }]` 를 싣는다). `Button` 의 `variant="primary"` 는 `@/components/common` 의 Button 이 받는 값이다(옛 코드 그대로).

- [ ] **Step 2: `InventoryMatchingDialog` 에서 사용**

`InventoryMatchingDialog.tsx`:

1. import 추가:
   ```ts
   import { PickedSkuList, SkuSearchPanel } from '../../../line-composition/components/sku-composition-picker';
   import { addPicked, removePicked, setPickedQuantity, type PickedSku } from '../../../line-composition/picked-skus';
   ```
2. 파일의 `useDebounced` 함수와 `type LinkedSku = {…}` 를 지우고, `useState<LinkedSku[]>` 를 `useState<PickedSku[]>` 로.
3. `const [searchType, setSearchType] = useState('name');`, `const debounced = …`, `const { data: skuResults, isLoading: searching } = useSkuSearch(…)` 를 지운다. effect 1 의 `setSearchType('name');` 줄도 지운다. `skuSearch`·`setSkuSearch` 상태는 **남긴다**.
4. 핸들러 셋을 순수 함수로:
   ```ts
   /** 수동 매칭 - SKU 추가 */
   const handleAddSku = (sku: { id: string; name: string }) => {
     const result = addPicked(linkedSkus, sku);
     if (result.ok) setLinkedSkus(result.list);
     else toast.error('이미 매칭된 재고상품입니다.');
   };

   /** 수동 매칭 - SKU 제거 */
   const handleRemoveSku = (skuId: string) => setLinkedSkus(removePicked(linkedSkus, skuId));

   /** 수동 매칭 - 수량 업데이트 */
   const handleUpdateQuantity = (skuId: string, value: number) =>
     setLinkedSkus(setPickedQuantity(linkedSkus, skuId, value));
   ```
5. `const filteredSkuResults = …` 두 줄을 지운다.
6. «현재 매칭된 재고상품» `<h3>` 아래 `<div className="space-y-2">{linkedSkus.length === 0 ? … }</div>` 블록을 다음으로:
   ```tsx
   <PickedSkuList value={linkedSkus} onRemove={handleRemoveSku} onQuantityChange={handleUpdateQuantity} />
   ```
7. «재고상품 검색» 의 머리(`<div className="flex items-center justify-between mb-3">…</div>`)는 남기고, 그 아래 입력 줄부터 «페이지 네이션» div 를 닫는 `</div>` 까지를 다음으로:
   ```tsx
   <SkuSearchPanel
     query={skuSearch}
     onQueryChange={setSkuSearch}
     suggestedQuery={sellingProductName}
     picked={linkedSkus}
     onAdd={handleAddSku}
   />
   ```
8. 쓰이지 않게 된 import(`useSkuSearch`, `Search`, 그리고 다른 탭에서 안 쓰면 `FormSelect`·`FormNumberInput`·`FormInput`)를 지운다 — 남기면 lint 가 잡는다.

- [ ] **Step 3: 검증**

Run: `(cd apps/admin-web && npx tsc --noEmit)`
Expected: 에러 0

Run: `(cd apps/admin-web && npx eslint src/features/order/matching/components/table/InventoryMatchingDialog.tsx src/features/order/line-composition)`
Expected: 새 경고·에러 0(기존 파일에 있던 경고는 이 태스크와 무관하면 그대로 둔다)

Run: `npm run test:admin-web -- apps/admin-web/src/features/order/matching`
Expected: PASS(기존 `build-matching-links`·`matching-save-route` 등)

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/src/features/order/line-composition/components/sku-composition-picker.tsx \
  apps/admin-web/src/features/order/matching/components/table/InventoryMatchingDialog.tsx
git commit -m "refactor(admin-web): 상품매칭 수동 탭의 SKU 고르기를 PickedSkuList·SkuSearchPanel 로 뽑는다 (#1063)"
```

---

### Task 6: admin-web — «이 주문만» 다이얼로그 + 매칭체크 연결

**Files:**
- Create: `apps/admin-web/src/features/order/line-composition/components/line-composition-dialog.tsx`
- Modify: `apps/admin-web/src/features/order/matching/components/table/index.tsx`

**Interfaces:**
- Consumes: Task 3 `useAssignLineComposition`, Task 4 `LineCompositionTarget`·`compositionErrorView`·`matchingRowTarget`·`sourceBadge`·`pickedFromComposition`·`toCompositionItems`·`addPicked`·`removePicked`·`setPickedQuantity`, Task 5 `PickedSkuList`·`SkuSearchPanel`
- Produces: `export function LineCompositionDialog(props: { target: LineCompositionTarget | null; onClose: () => void; currentFulfillmentOrderId?: string }): JSX.Element | null` — Task 7 이 쓴다

- [ ] **Step 1: 다이얼로그 작성**

`apps/admin-web/src/features/order/line-composition/components/line-composition-dialog.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAssignLineComposition } from '@/lib/services/orders/line-composition';
import {
  compositionErrorView,
  type CompositionErrorView,
  type LineCompositionTarget,
} from '../line-composition-view';
import {
  addPicked,
  pickedFromComposition,
  removePicked,
  setPickedQuantity,
  toCompositionItems,
  type PickedSku,
} from '../picked-skus';
import { PickedSkuList, SkuSearchPanel } from './sku-composition-picker';

/** 판매주문 라인 하나의 구성을 이 주문에만 지정한다(#1063 스펙 §7.1). 상품매칭은 바뀌지 않는다 */
export function LineCompositionDialog({
  target,
  onClose,
  currentFulfillmentOrderId,
}: {
  target: LineCompositionTarget | null;
  onClose: () => void;
  currentFulfillmentOrderId?: string;
}) {
  const assign = useAssignLineComposition();
  const [picked, setPicked] = useState<PickedSku[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<CompositionErrorView | null>(null);

  useEffect(() => {
    if (!target) return;
    setPicked(pickedFromComposition(target.composition));
    setQuery(target.productName);
    setError(null);
  }, [target?.salesOrderLineId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return null;

  const onSave = async () => {
    setError(null);
    try {
      await assign.mutateAsync({
        salesOrderId: target.salesOrderId,
        salesOrderLineId: target.salesOrderLineId,
        body: { items: toCompositionItems(picked) },
      });
      toast.success('이 주문의 구성을 저장했습니다.');
      onClose();
    } catch (e) {
      setError(compositionErrorView(e, { currentFulfillmentOrderId }));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>이 주문만</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-gray-700">
          {target.productName} · 수량 {target.quantity}개
        </div>
        <PickedSkuList
          value={picked}
          onRemove={(skuId) => setPicked(removePicked(picked, skuId))}
          onQuantityChange={(skuId, value) => setPicked(setPickedQuantity(picked, skuId, value))}
        />
        <SkuSearchPanel
          query={query}
          onQueryChange={setQuery}
          suggestedQuery={target.productName}
          picked={picked}
          onAdd={(sku) => {
            const result = addPicked(picked, sku);
            if (result.ok) setPicked(result.list);
            else toast.error('이미 매칭된 재고상품입니다.');
          }}
        />
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p>{error.message}</p>
            {error.links.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-3">
                {error.links.map((link) => (
                  <Link key={link.href} href={link.href} className="underline">
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
          <Button onClick={onSave} disabled={picked.length === 0 || assign.isPending}>
            {error?.retry ? '다시 시도' : '저장'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 매칭체크 표 연결**

`apps/admin-web/src/features/order/matching/components/table/index.tsx`:

1. import 추가:
   ```ts
   import { Badge } from '@/components/ui/badge';
   import { LineCompositionDialog } from '../../../line-composition/components/line-composition-dialog';
   import {
     matchingRowTarget,
     sourceBadge,
     type LineCompositionTarget,
   } from '../../../line-composition/line-composition-view';
   ```
2. `MatchingContent` 함수 본문 맨 앞(첫 `if` 앞)에 개별 지정 분기 — 개별 지정 라인은 상품매칭 상태가 아니라 라인 구성을 보인다:
   ```tsx
   const badge = sourceBadge(line.compositionSource);
   if (badge) {
     return (
       <div className="space-y-1 py-1">
         <Badge variant="secondary">{badge}</Badge>
         {(line.composition ?? []).map((item) => (
           <div key={item.skuId} className="text-sm text-gray-800">
             {item.skuName}
             {item.qtyPerUnit > 1 && (
               <span className="ml-1 text-xs text-gray-500">×{item.qtyPerUnit}</span>
             )}
           </div>
         ))}
       </div>
     );
   }
   ```
3. `OrderLineRows` props 에 `onOverride: (line: OrderLineDto) => void;` 를 더하고(구조분해·타입 둘 다), «주문 상세 행»의 주문번호 `<div className="text-xs">…</div>` 를 다음으로:
   ```tsx
   <div className="flex items-center gap-2 text-xs">
     <span className="text-gray-400">주문번호</span>
     <span className="text-blue-600 underline cursor-pointer hover:text-blue-800">
       {line.channelOrderId}
     </span>
     <Button
       size="sm"
       variant="outline"
       className="ml-auto h-6 px-2 text-xs"
       onClick={() => onOverride(line)}
     >
       이 주문만
     </Button>
   </div>
   ```
4. `MatchingTable` 에 상태와 다이얼로그:
   ```ts
   const [overrideTarget, setOverrideTarget] = useState<LineCompositionTarget | null>(null);
   ```
   `<OrderLineRows … />` 에 `onOverride={(target) => setOverrideTarget(matchingRowTarget(target))}` 를 넘기고, `<ProductRegistrationDialog … />` 다음에:
   ```tsx
   {/* 이 주문만 — 상품매칭을 만들지 않고 이 라인의 구성을 지정한다 */}
   <LineCompositionDialog target={overrideTarget} onClose={() => setOverrideTarget(null)} />
   ```

- [ ] **Step 3: 검증**

Run: `(cd apps/admin-web && npx tsc --noEmit)`
Expected: 에러 0

Run: `(cd apps/admin-web && npx eslint src/features/order/matching/components/table/index.tsx src/features/order/line-composition)`
Expected: 새 경고·에러 0

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/src/features/order/line-composition/components/line-composition-dialog.tsx \
  apps/admin-web/src/features/order/matching/components/table/index.tsx
git commit -m "feat(admin-web): 매칭체크 «이 주문만» — 라인 구성 지정 다이얼로그와 개별 지정 표시 (#1063)"
```

---

### Task 7: admin-web — 출고 주문 상세의 라인 구성·«대체됨»

**Files:**
- Create: `apps/admin-web/src/features/order/fulfillments/detail/line-compositions.tsx`
- Modify: `apps/admin-web/src/features/order/fulfillments/components/detail/index.tsx`

**Interfaces:**
- Consumes: Task 3 `FulfillmentOrderDetail.lines`, Task 4 `sourceBadge`·`foItemStatusLabel`·`LineCompositionTarget`, Task 6 `LineCompositionDialog`

- [ ] **Step 1: 구역 컴포넌트**

`apps/admin-web/src/features/order/fulfillments/detail/line-compositions.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { FulfillmentOrderDetail } from '@/lib/types/dto/fulfillment';
import { LineCompositionDialog } from '../../line-composition/components/line-composition-dialog';
import { sourceBadge, type LineCompositionTarget } from '../../line-composition/line-composition-view';

/** 판매 라인마다 구성과 개별 지정 여부(#1063 스펙 §8-2). 옛 core 는 lines 를 안 줘서 구역이 숨는다 */
export function LineCompositions({ fo, canEdit }: { fo: FulfillmentOrderDetail; canEdit: boolean }) {
  const [target, setTarget] = useState<LineCompositionTarget | null>(null);
  const lines = fo.lines ?? [];
  const salesOrderId = fo.salesOrderId;
  if (lines.length === 0) return null;

  return (
    <Container>
      <Header title={`판매 라인 (${lines.length})`} />
      <div className="overflow-x-auto p-3">
        <table className="w-full text-sm">
          <tbody>
            {lines.map((line) => {
              const badge = sourceBadge(line.compositionSource);
              return (
                <tr key={line.salesOrderLineId} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{line.productName}</div>
                    <div className="text-xs text-gray-500">수량 {line.quantity}개</div>
                  </td>
                  <td className="py-2 pr-3">
                    {line.composition.map((item) => (
                      <div key={item.skuId}>
                        {item.skuName}
                        {item.qtyPerUnit > 1 && (
                          <span className="ml-1 text-xs text-gray-500">×{item.qtyPerUnit}</span>
                        )}
                      </div>
                    ))}
                  </td>
                  <td className="py-2 pr-3">{badge && <Badge variant="secondary">{badge}</Badge>}</td>
                  <td className="py-2 text-right">
                    {canEdit && salesOrderId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setTarget({
                            salesOrderId,
                            salesOrderLineId: line.salesOrderLineId,
                            productName: line.productName,
                            quantity: line.quantity,
                            composition: line.composition,
                          })
                        }
                      >
                        이 주문만
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <LineCompositionDialog
        target={target}
        onClose={() => setTarget(null)}
        currentFulfillmentOrderId={fo.id}
      />
    </Container>
  );
}
```

- [ ] **Step 2: 상세 화면에 붙이기**

`components/detail/index.tsx`:

1. import:
   ```ts
   import { LineCompositions } from '../../detail/line-compositions';
   import { foItemStatusLabel } from '../../../line-composition/line-composition-view';
   ```
2. `{/* FOI 라인 */}` `<Container>` **바로 앞**에:
   ```tsx
   <LineCompositions fo={fo} canEdit={canOperate && !isTerminal} />
   ```
3. FOI 표의 상태 칸 `{item.status}` 를 `{foItemStatusLabel(item)}` 로.

- [ ] **Step 3: 검증**

Run: `(cd apps/admin-web && npx tsc --noEmit)`
Expected: 에러 0

Run: `(cd apps/admin-web && npx eslint src/features/order/fulfillments)`
Expected: 새 경고·에러 0

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/src/features/order/fulfillments/detail/line-compositions.tsx \
  apps/admin-web/src/features/order/fulfillments/components/detail/index.tsx
git commit -m "feat(admin-web): 출고 주문 상세에 판매 라인 구성·개별 지정·«대체됨» (#1063)"
```

---

### Task 8: admin-web — 상품매칭 저장 뒤 «기존 출고에도 적용» 단계

1080줄 다이얼로그의 렌더를 건드리지 않으려고, 저장 다이얼로그는 `onSaved(variantId)` 만 알린다. 미리보기 조회와 후속 단계(작은 다이얼로그)는 매칭체크 표가 띄운다. 운영자에게는 «저장 → 영향이 있으면 한 단계»로 같다.

**Files:**
- Create: `apps/admin-web/src/features/order/line-composition/components/existing-lines-dialog.tsx`
- Modify: `apps/admin-web/src/features/order/matching/components/table/InventoryMatchingDialog.tsx` (props·`onSave` 끝)
- Modify: `apps/admin-web/src/features/order/matching/components/table/index.tsx`

**Interfaces:**
- Consumes: Task 3 `lineCompositionClient.existingLinesImpact`·`useApplyToExistingLines`, Task 4 `existingLinesStep`·`applyResultText`·`ExistingLinesStepView`, `parseServerError`
- Produces: `useExistingLinesFollowUp(): { state: { variantId: string; step: ExistingLinesStepView } | null; check: (variantId: string) => Promise<void>; close: () => void }`, `ExistingLinesDialog({ state, onClose })`

- [ ] **Step 1: 후속 단계 컴포넌트·훅**

`apps/admin-web/src/features/order/line-composition/components/existing-lines-dialog.tsx`:

```tsx
'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { lineCompositionClient } from '@/lib/api/domains/orders/line-composition.client';
import { parseServerError } from '@/lib/api/server-error';
import { useApplyToExistingLines } from '@/lib/services/orders/line-composition';
import { applyResultText, existingLinesStep, type ExistingLinesStepView } from '../line-composition-view';

type FollowUp = { variantId: string; step: ExistingLinesStepView };

/** 상품매칭 저장 뒤 이미 굳힌 출고에 미칠 영향을 묻고, 바꿀 것이 있을 때만 단계를 연다(스펙 §8-3) */
export function useExistingLinesFollowUp() {
  const [state, setState] = useState<FollowUp | null>(null);
  const check = useCallback(async (variantId: string) => {
    try {
      const step = existingLinesStep(await lineCompositionClient.existingLinesImpact(variantId));
      if (step) setState({ variantId, step });
    } catch (error) {
      // 상품매칭 저장은 이미 끝났다 — 미리보기 실패로 저장을 실패처럼 보이게 하지 않는다
      console.error('기존 출고 영향 조회 실패:', error);
    }
  }, []);
  const close = useCallback(() => setState(null), []);
  return { state, check, close };
}

export function ExistingLinesDialog({ state, onClose }: { state: FollowUp | null; onClose: () => void }) {
  const apply = useApplyToExistingLines();
  if (!state) return null;

  const onApply = async () => {
    try {
      const result = await apply.mutateAsync(state.variantId);
      toast.success(applyResultText(result));
      onClose();
    } catch (error) {
      toast.error(parseServerError(error, '기존 출고에 적용하지 못했습니다.').message);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>기존 출고에도 적용</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {state.step.counts.map((entry) => (
            <span key={entry.label}>
              {entry.label} <span className="font-semibold tabular-nums">{entry.count}</span>
            </span>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
          <Button onClick={onApply} disabled={apply.isPending}>
            기존 출고에도 적용
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 저장 다이얼로그가 알린다**

`InventoryMatchingDialog.tsx`:

1. props 타입에 `onSaved?: (variantId: string) => void;` 를 더하고 구조분해에 `onSaved` 를 넣는다.
2. `onSave` 끝의
   ```ts
         toast.success('상품매칭을 저장했습니다.');
         onClose();
   ```
   를 다음으로(비매칭 저장은 적용할 것이 없다 — 미리보기도 `applicable=false` 다):
   ```ts
         toast.success('상품매칭을 저장했습니다.');
         if (activeTab !== 'none') onSaved?.(line.variantId);
         onClose();
   ```

- [ ] **Step 3: 매칭체크 표가 후속 단계를 띄운다**

`components/table/index.tsx`:

1. import:
   ```ts
   import {
     ExistingLinesDialog,
     useExistingLinesFollowUp,
   } from '../../../line-composition/components/existing-lines-dialog';
   ```
2. `MatchingTable` 안 `const changeMatchingStrategy = …` 다음에 `const followUp = useExistingLinesFollowUp();`
3. `<InventoryMatchingDialog … />` 에 `onSaved={followUp.check}` 를 넘긴다
4. `<LineCompositionDialog … />` 다음에 `<ExistingLinesDialog state={followUp.state} onClose={followUp.close} />`

- [ ] **Step 4: 검증**

Run: `(cd apps/admin-web && npx tsc --noEmit)`
Expected: 에러 0

Run: `npm run test:admin-web -- apps/admin-web/src/features/order`
Expected: PASS

Run: `(cd apps/admin-web && npx eslint src/features/order/matching src/features/order/line-composition)`
Expected: 새 경고·에러 0

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/features/order/line-composition/components/existing-lines-dialog.tsx \
  apps/admin-web/src/features/order/matching/components/table/InventoryMatchingDialog.tsx \
  apps/admin-web/src/features/order/matching/components/table/index.tsx
git commit -m "feat(admin-web): 상품매칭 저장 뒤 영향이 있으면 «기존 출고에도 적용» 단계 (#1063)"
```

---

### Task 9: 게이트 전체 + PR

**Files:** 없음(검증·PR 본문)

- [ ] **Step 1: 게이트 넷**

```bash
npm run type-check                                   # 에러 0
npx jest --maxWorkers=2                              # 실패 0 (OOM 이 나면 --maxWorkers=2 그대로 한 번 더)
npm run test:admin-web                               # 실패 0
(cd apps/admin-web && npx tsc --noEmit)              # 에러 0 — CI 가 안 돈다
```

- [ ] **Step 2: core 통합(스크래치 DB)**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath \
  apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.integration.spec.ts \
  apps/core/src/modules/fulfillment/line-composition-edit/apply-to-existing-lines.integration.spec.ts \
  apps/core/src/modules/fulfillment/line-composition-edit/line-composition-views.integration.spec.ts
```
Expected: PASS 전부

- [ ] **Step 3: 메인 체크아웃 오염 확인**

Run: `git -C /home/pauseb/workspace/almondyoung-server status --short`
Expected: `?? scripts/ops/1016-36-ambiguous-refund-preflight.js` 하나뿐

- [ ] **Step 4: push·PR**

```bash
git push -u origin feat/1063-line-composition-pr3
gh pr create --base develop --title "feat(admin-web): 판매주문 라인 구성 PR 3 — 이 주문만·기존 출고 적용·대체됨 (#1063)" --body-file <본문>
```

PR 본문에 반드시 넣을 것:
- 무엇: 스펙 §8·§8.1. core 변경 셋(필터 허용목록 `LINE_BOX_NOT_DRAFT`, FO 상세 `lines`, 매칭체크 `composition`) — **전부 additive, 마이그 없음**
- PR 2 결함 하나를 고친다: `LINE_BOX_NOT_DRAFT` 의 박스 목록이 응답 필터에서 버려지고 있었다(라이브 td 242 에서도 그렇다)
- 배포: core 와 admin-web 을 같은 `sst deploy` 로. **Core 롤아웃이 끝난 뒤에 화면을 쓴다** — `aws ecs describe-services --cluster lcnine-services-live-ClusterCluster-zbwvckhv --services Core --region ap-northeast-2` 로 새 td 가 PRIMARY·COMPLETED 인지 본다. admin-web 이 먼저 떠도 깨지지 않는다(새 칸 없으면 구역·링크가 숨는다)
- 스모크(사람, 브라우저 로그인 필요): ① 매칭체크에서 «해결된 라인 제외»를 끄고 FO 전 라인에 «이 주문만» → 행이 «개별 지정»으로 ② FO 상세 «판매 라인» 구역에서 구성 변경 → 빠진 SKU 항목이 «대체됨» ③ 확정 박스 라인을 바꾸려 하면 거절 사유 + 링크 ④ 상품매칭 저장 뒤 바꿀 것이 있으면 단계, 없으면 단계 없음
- 범위 밖: `features/matching/products`·`features/matching/variants` 의 상품매칭 편집 다이얼로그는 «기존 출고에도 적용» 단계를 띄우지 않는다(스펙이 `InventoryMatchingDialog` 만 정함)
- 끝 줄: `https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo`
