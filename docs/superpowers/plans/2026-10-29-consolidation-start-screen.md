# 배치에 든 상자로 합포장 시작 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 출고주문 상세에서 배치에 든 상자로 합포장을 요청하고, 막힘을 풀어 합쳐질 때까지 진행을 안내하는 어드민 화면을 만든다.

**Architecture:** core 에 읽기 라우트 두 개(`consolidation-options`, `consolidation-progress`)를 더한다. 요청·배치 빼기·송장 무효화는 기존 쓰기 라우트와 기존 훅을 그대로 쓴다. 판정 로직(후보 분류, 진행 칸, 요청 본문)은 양쪽 모두 순수 함수로 떼어 단위 테스트한다.

**Tech Stack:** NestJS + Drizzle(core), Next.js + React Query + shadcn(admin-web), Jest.

**Spec:** `docs/superpowers/specs/2026-10-29-consolidation-start-screen-design.md`
시안: https://claude.ai/artifact/Nku8dDoB2qKgWMk8rEnSja (왼쪽 프레임만 이 계획의 범위)

## Global Constraints

- 상자 상태를 바꾸는 서버 로직은 건드리지 않는다. 쓰기는 기존 `POST /shipments/consolidations`, `DELETE /outbound-batches/:batchId/shipments/:shipmentId`, `POST /waybills/:waybillId/void` 만 쓴다.
- 새 라우트는 `@RequirePermission('fulfillment.shipment.read')`. 경로 파라미터는 기존 관례대로 `:id`.
- 수령인을 응답하는 라우트는 `@PiiResponse` + `scripts/security/pii-routes.ts` 의 `PII_ROUTES`·`PII_RECIPIENT_ROUTES` 둘 다.
- 합포장 요청은 늘 `recipientSourceShipmentId` 로 보낸다. 브라우저가 `recipientSnapshot` 을 만들지 않는다(직접 입력 없음).
- 화면 문구는 해요체, 한 문장 한 메시지. 특수 인용부호(«» 「」 『』) 금지. 주석에 이슈 번호 금지, 뻔한 설명 주석 금지.
- 권한은 역할 이름이 아니라 권한 키로 판정한다. 권한이 없으면 버튼을 숨긴다.
- 자동 합치기 안내 문구는 "10분 안에". "1분" 금지.
- 테스트 실행은 `--maxWorkers=2`. 전체 스위트는 마지막 태스크에서만.
- Service 는 흐름만, 조회·판정은 Reader/순수 함수(CLAUDE.md 레이어 규칙). `any`·`as` 금지.

## Review Focus

1. 수령인이 PII 마스킹으로 가려진 응답: 화면이 가린 문자열을 비교하면 같은 주소도 "다름"으로 보인다. 같음/다름 판정은 서버 `reason` 만 쓴다. → Task 1·5 테스트.
2. 후보를 불러온 뒤 다른 사람이 상자를 바꿔 요청이 `SHIPMENT_STALE_MANIFEST_VERSION`/`SHIPMENT_STALE_RESERVATION_VERSION` 409 를 받음: "그사이 상자가 바뀌었어요. 다시 불러올게요"와 함께 후보를 다시 읽는다. → Task 6 테스트.
3. 추가 주문 상자도 배치·송장을 가진 경우(원본 둘 다 막힘): 진행 칸은 가장 뒤처진 원본 기준, 지금 할 일은 그 상자의 송장번호를 적는다. → Task 5 테스트.
4. 합쳐진 뒤 원본(대체된 상자)이나 다른 원본(#3027 쪽) 상세를 열어도 같은 진행·완료 패널이 보인다. → Task 3 테스트.
5. 요청 버튼 연타·응답 유실 재시도: 같은 멱등키로 다시 보내 같은 결과를 받는다(기존 합포장 화면 방식). → Task 6 테스트.

---

### Task 1: 후보 분류 순수 함수 (core)

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/consolidation-options.ts`
- Test: `apps/core/src/modules/fulfillment/services/consolidation-options.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/services/consolidation.service.ts` (export 만: `canonicalConsolidationRecipient` 은 이미 export. 비교 헬퍼를 이 파일에서 가져다 쓴다)

**Interfaces:**
- Produces:
  - `type ConsolidationOptionReason = 'ok' | 'memo_differs' | 'address_differs' | 'incomplete_recipient' | 'unknown_customer'`
  - `classifyConsolidationOption(input: { sourceRecipient: unknown; sourceCustomerKey: string | null; optionRecipient: unknown; optionCustomerKey: string | null }): { reason: ConsolidationOptionReason; selectable: boolean }`
  - `selectable` 은 `ok`·`memo_differs` 일 때만 true.

- [ ] **Step 1: 실패하는 테스트**

```ts
const base = { recipientName: '김알몬', phone: '010-1234-5678', postalCode: '14500', roadAddress: '경기 부천시 원미로 12', detailAddress: '101호' };
it('같은 수령인이면 ok', () => expect(classifyConsolidationOption({ sourceRecipient: base, sourceCustomerKey: 'id:c1', optionRecipient: { ...base }, optionCustomerKey: 'id:c1' })).toEqual({ reason: 'ok', selectable: true }));
it('전화 표기만 달라도 ok', () => expect(classifyConsolidationOption({ sourceRecipient: base, sourceCustomerKey: 'id:c1', optionRecipient: { ...base, phone: '01012345678' }, optionCustomerKey: 'id:c1' }).reason).toBe('ok'));
it('메모만 다르면 memo_differs, 고를 수 있다', () => expect(classifyConsolidationOption({ sourceRecipient: base, sourceCustomerKey: 'id:c1', optionRecipient: { ...base, deliveryNote: '문 앞에 놔 주세요' }, optionCustomerKey: 'id:c1' })).toEqual({ reason: 'memo_differs', selectable: true }));
it('주소가 다르면 address_differs', () => expect(classifyConsolidationOption({ sourceRecipient: base, sourceCustomerKey: 'id:c1', optionRecipient: { ...base, roadAddress: '서울 마포구 양화로 45' }, optionCustomerKey: 'id:c1' })).toEqual({ reason: 'address_differs', selectable: false }));
it('이름이 다르면 address_differs', () => expect(classifyConsolidationOption({ sourceRecipient: base, sourceCustomerKey: 'id:c1', optionRecipient: { ...base, recipientName: '박알몬' }, optionCustomerKey: 'id:c1' }).reason).toBe('address_differs'));
it('수령인이 불완전하면 incomplete_recipient', () => expect(classifyConsolidationOption({ sourceRecipient: base, sourceCustomerKey: 'id:c1', optionRecipient: { ...base, detailAddress: '' }, optionCustomerKey: 'id:c1' }).reason).toBe('incomplete_recipient'));
it('고객을 모르면 unknown_customer', () => expect(classifyConsolidationOption({ sourceRecipient: base, sourceCustomerKey: 'id:c1', optionRecipient: base, optionCustomerKey: null }).reason).toBe('unknown_customer'));
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/services/consolidation-options.spec.ts --maxWorkers=2`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

`canonicalConsolidationRecipient` 로 양쪽을 정규화한다. 둘 중 하나라도 null 이면 `incomplete_recipient`. 고객 키가 하나라도 null 이면 `unknown_customer`(고객 키가 서로 다른 상자는 Task 2 의 조회 단계에서 이미 빠진다). `deliveryNote` 를 뺀 나머지 키가 다르면 `address_differs`, 같고 `deliveryNote` 만 다르면 `memo_differs`. 판정 순서: unknown_customer → incomplete_recipient → address → memo.

- [ ] **Step 4: 통과 확인** (Step 2 명령, PASS)

- [ ] **Step 5: 커밋** (사용자가 커밋을 요청했을 때만)

```bash
git add apps/core/src/modules/fulfillment/services/consolidation-options.ts apps/core/src/modules/fulfillment/services/consolidation-options.spec.ts
git commit -m "feat(core): 합포장 후보를 같음·메모만 다름·배송지 다름으로 가른다"
```

### Task 2: `GET /shipments/:id/consolidation-options` (core)

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/consolidation-options.reader.ts`
- Modify: `apps/core/src/modules/fulfillment/dto/consolidation.dto.ts` (응답 DTO)
- Modify: `apps/core/src/modules/fulfillment/controllers/consolidation.controller.ts`
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts` (reader provider)
- Modify: `scripts/security/pii-routes.ts` (`PII_ROUTES`, `PII_RECIPIENT_ROUTES` 에 `'core GET /shipments/:id/consolidation-options'`)
- Test: `apps/core/src/modules/fulfillment/services/consolidation-options.reader.integration.spec.ts` (`describeIfDb`, 픽스처는 `services/__support__/consolidation-fixtures.ts`)

**Interfaces:**
- Consumes: Task 1 `classifyConsolidationOption`
- Produces (응답 DTO `ConsolidationOptionsResponseDto`):
  - `source: ConsolidationOptionShipmentDto`
  - `options: ConsolidationOptionDto[]` — `ConsolidationOptionShipmentDto` + `reason: ConsolidationOptionReason`, `selectable: boolean`
  - `ConsolidationOptionShipmentDto = { shipmentId, status, salesOrderNos: string[], itemSummary: string, totalQty: number, recipientSnapshot: object, batchId: string | null, waybillTrackingNo: string | null, manifestVersion, reservationVersion, createdAt }`
  - `ConsolidationOptionsReader.findOptions(shipmentId: string, tx?: DbTx): Promise<ConsolidationOptionsResponseDto>`

- [ ] **Step 1: 실패하는 통합 테스트**

픽스처로 같은 고객의 상자 넷을 만든다: 기준(planned, 배치·송장 있음), 같은 수령인(draft), 메모만 다름(draft), 주소 다름(planned). 다른 고객 상자 하나, 같은 고객의 `shipped` 상자 하나, 다른 창고 상자 하나.

```ts
const res = await reader.findOptions(sourceId);
expect(res.source.shipmentId).toBe(sourceId);
expect(res.options.map((o) => [o.shipmentId, o.reason, o.selectable])).toEqual(
  expect.arrayContaining([[sameId, 'ok', true], [memoId, 'memo_differs', true], [addrId, 'address_differs', false]]),
);
expect(res.options.map((o) => o.shipmentId)).not.toEqual(expect.arrayContaining([otherCustomerId, shippedId, otherWarehouseId, sourceId]));
```

- [ ] **Step 2: 실패 확인**

Run: `dotenv -e apps/core/.env -- npx jest apps/core/src/modules/fulfillment/services/consolidation-options.reader.integration.spec.ts --maxWorkers=2 --runInBand`
Expected: FAIL

- [ ] **Step 3: 구현**

- 기준 상자의 판매주문에서 고객 키를 구한다(`ConsolidationService.customerKey` 와 같은 규칙: `customerId` 우선, 없으면 이름+전화). 같은 규칙을 쓰도록 `customerKey` 계산을 순수 함수로 꺼내 `consolidation-options.ts` 로 옮기고 서비스도 그걸 부른다.
- 후보 조회: 같은 창고, 같은 `shippingProfileId`, `supplierId IS NULL`, 상태 `draft`·`planned`, id ≠ 기준, 그리고 판매주문의 `customerId`(없으면 `customerName`+`customerPhone`)가 같은 상자. 창고 전체를 읽어 메모리에서 거르지 않는다.
- 창고 출고가 아닌 라인(`fulfillmentMode !== 'in_house'`, `drop_shipped`)이 있는 상자는 뺀다.
- `batchId` 는 `excluded`·`completed` 가 아닌 작업 항목의 배치, `waybillTrackingNo` 는 종료 상태가 아닌 송장.
- 컨트롤러: `@Get(':id/consolidation-options')` 를 기존 `@Get('consolidation-candidates')` **아래**에 둔다(정적 경로가 먼저 매칭되게). `@PiiResponse` 는 `source.recipientSnapshot.*` 와 `options[].recipientSnapshot.*` 각 필드, `subjects: [{ path: 'source.shipmentId', type: 'shipment' }, { path: 'options[].shipmentId', type: 'shipment' }]`, `rawWithByField` 는 기존 후보와 같이 `OPEN_WITH_RECIPIENT`.

- [ ] **Step 4: 통과 확인** (Step 2 명령) + `npx jest scripts/security --maxWorkers=2` PASS

- [ ] **Step 5: 커밋** (요청 시)

```bash
git commit -m "feat(core): 기준 상자로 합포장 후보를 막힌 상자까지 조회한다"
```

### Task 3: `GET /shipments/:id/consolidation-progress` (core)

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/consolidation-progress.reader.ts`
- Modify: `apps/core/src/modules/fulfillment/dto/consolidation.dto.ts`
- Modify: `apps/core/src/modules/fulfillment/controllers/consolidation.controller.ts`
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts`
- Test: `apps/core/src/modules/fulfillment/services/consolidation-progress.reader.integration.spec.ts` (`describeIfDb`)

**Interfaces:**
- Consumes: `ConsolidationService.resumeReadiness(operationId, tx)`, `shipmentReconcileState`(rule `'resume-pending-consolidation'`)
- Produces (`ConsolidationProgressResponseDto`, 수령인 없음):
  - `{ operationId: string; status: 'pending' | 'completed'; targetShipmentId: string | null; sources: ConsolidationProgressSourceDto[] } | null` (이 상자가 원본인 합포장이 없으면 `null`)
  - `ConsolidationProgressSourceDto = { shipmentId, trackingNo: string | null, batchId: string | null, workItemStatus: string | null, waybillId: string | null, waybillStatus: string | null, blockers: string[], gaveUpAt: string | null, nextCheckAt: string | null }`
  - `ConsolidationProgressReader.findForShipment(shipmentId: string, tx?: DbTx): Promise<ConsolidationProgressResponseDto | null>`

- [ ] **Step 1: 실패하는 통합 테스트**

기존 `consolidation.integration.spec.ts` 의 `planned → pending → completed` 시나리오 픽스처를 재사용한다.

```ts
// 대기 중
const pending = await reader.findForShipment(sourceA);
expect(pending?.status).toBe('pending');
expect(pending?.sources.find((s) => s.shipmentId === sourceA)?.blockers).toEqual(expect.arrayContaining(['ACTIVE_WORK_ITEM']));
expect(JSON.stringify(pending)).not.toContain('recipient');
// 다른 원본으로 물어도 같은 작업
expect((await reader.findForShipment(sourceB))?.operationId).toBe(pending?.operationId);
// 완료 뒤
await completeConsolidation();
const done = await reader.findForShipment(sourceA);
expect(done).toMatchObject({ status: 'completed', targetShipmentId: expect.any(String) });
expect((await reader.findForShipment(sourceB))?.targetShipmentId).toBe(done?.targetShipmentId);
// 합포장과 무관한 상자
expect(await reader.findForShipment(unrelatedId)).toBeNull();
```

- [ ] **Step 2: 실패 확인** (Task 2 와 같은 꼴의 명령, 이 파일)

- [ ] **Step 3: 구현**

- `shipment_operation_members` 에서 `shipmentId` 이고 `role = 'source'` 인 `consolidate` 작업 중 가장 최근(`createdAt` 내림차순) 하나를 찾는다. 상태와 무관.
- `pending` 이면 `resumeReadiness` 의 `blockers` 를 원본별로 펼치고, 원본마다 작업 항목(배치·상태), 종료 아닌 송장(id·상태·번호), `shipmentReconcileState` 의 `gaveUpAt`·`nextCheckAt` 를 붙인다.
- `completed` 면 `role = 'target'` 멤버의 `shipmentId` 를 `targetShipmentId` 로.
- 컨트롤러: `@Get(':id/consolidation-progress')`, `@RequirePermission('fulfillment.shipment.read')`. PII 선언 없음.

- [ ] **Step 4: 통과 확인** + `npx jest scripts/security --maxWorkers=2`

- [ ] **Step 5: 커밋** (요청 시) `feat(core): 합포장 진행을 원본별 막힘과 완료 상자로 돌려준다`

### Task 4: admin-web API 클라이언트·쿼리

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/orders/consolidation.client.ts`
- Modify: `apps/admin-web/src/lib/types/dto/fulfillment.ts` (Task 2·3 응답 타입)
- Modify: `apps/admin-web/src/lib/services/orders/queries.ts`
- Modify: `apps/admin-web/src/lib/auth/medusa-permissions.ts` 는 건드리지 않는다(core 만 호출)

**Interfaces:**
- Produces:
  - `useConsolidationOptions(shipmentId: string, enabled: boolean)` → `ConsolidationOptionsResponse`
  - `useConsolidationProgress(shipmentId: string)` → `ConsolidationProgressResponse | null`, 진행 중(`status === 'pending'`)이면 `refetchInterval: 15_000`
  - 쿼리 키 `orderQueryKeys.consolidationOptions(id)`, `orderQueryKeys.consolidationProgress(id)`

- [ ] **Step 1:** 타입·클라이언트·훅을 더한다(기존 `getShipment`·`useShipmentDetail` 꼴).
- [ ] **Step 2:** `npm run type-check` 에러 0.
- [ ] **Step 3: 커밋** (요청 시) `feat(admin-web): 합포장 후보·진행 조회 훅`

### Task 5: admin-web 순수 함수 — 진행 칸과 요청 본문

**Files:**
- Create: `apps/admin-web/src/features/order/fulfillments/detail/consolidation-model.ts`
- Test: `apps/admin-web/src/features/order/fulfillments/detail/consolidation-model.spec.ts`

**Interfaces:**
- Consumes: Task 4 타입
- Produces:
  - `type ConsolidationStep = 'exclude' | 'unpick' | 'void' | 'auto'`
  - `type SourceProgress = { step: ConsolidationStep } | { step: 'stuck'; reason: 'dispatch_attempt' | 'waybill_not_registered' | 'short_pick' }`
  - `sourceProgress(source: ConsolidationProgressSource): SourceProgress`
  - `overallProgress(sources: ConsolidationProgressSource[]): { current: SourceProgress; shipmentId: string; trackingNo: string | null; gaveUp: boolean }` — 가장 뒤처진 원본(`exclude < unpick < void < auto`, `stuck` 은 늘 우선)
  - `buildConsolidationRequest(input: { source: ConsolidationOptionShipment; picked: ConsolidationOptionShipment[]; memoFrom: string; reason: string }): CreateShipmentConsolidationBody` — `recipientSourceShipmentId: memoFrom`, `sources` 는 기준 + 고른 상자의 `{ shipmentId, expectedManifestVersion, expectedReservationVersion }`
  - `memoChoices(source, picked): Array<{ shipmentId: string; label: string; orderNo: string }>` — 서버 `reason === 'memo_differs'` 인 상자가 없으면 빈 배열(선택 단계 생략)

- [ ] **Step 1: 실패하는 테스트**

```ts
const src = (o: Partial<ConsolidationProgressSource>): ConsolidationProgressSource => ({ shipmentId: 's1', trackingNo: 'T1', batchId: null, workItemStatus: null, waybillId: null, waybillStatus: null, blockers: [], gaveUpAt: null, nextCheckAt: null, ...o });
it('작업 항목이 배치에서 진행 중이면 exclude', () => expect(sourceProgress(src({ blockers: ['ACTIVE_WORK_ITEM'], workItemStatus: 'packing' }))).toEqual({ step: 'exclude' }));
it('빼는 중이면 unpick', () => expect(sourceProgress(src({ blockers: ['ACTIVE_WORK_ITEM'], workItemStatus: 'withdrawing' }))).toEqual({ step: 'unpick' }));
it('검수 수량만 남으면 unpick', () => expect(sourceProgress(src({ blockers: ['CUSTODY_REQUIRES_UNPICK'] }))).toEqual({ step: 'unpick' }));
it('registered 송장만 남으면 void', () => expect(sourceProgress(src({ blockers: ['ACTIVE_INVOICE'], waybillStatus: 'registered' }))).toEqual({ step: 'void' }));
it('registered 가 아닌 송장은 stuck', () => expect(sourceProgress(src({ blockers: ['ACTIVE_INVOICE'], waybillStatus: 'pending' }))).toEqual({ step: 'stuck', reason: 'waybill_not_registered' }));
it('발송 시도가 있으면 stuck', () => expect(sourceProgress(src({ blockers: ['DISPATCH_ATTEMPT_EXISTS'] }))).toEqual({ step: 'stuck', reason: 'dispatch_attempt' }));
it('결품 처리 중이면 stuck', () => expect(sourceProgress(src({ blockers: ['ACTIVE_WORK_ITEM'], workItemStatus: 'short_pick_recovery' }))).toEqual({ step: 'stuck', reason: 'short_pick' }));
it('막힘 없으면 auto', () => expect(sourceProgress(src({}))).toEqual({ step: 'auto' }));
it('원본 둘이면 뒤처진 쪽과 그 송장번호', () => expect(overallProgress([src({ shipmentId: 'a', trackingNo: 'TA' }), src({ shipmentId: 'b', trackingNo: 'TB', blockers: ['ACTIVE_WORK_ITEM'], workItemStatus: 'packing' })])).toMatchObject({ current: { step: 'exclude' }, shipmentId: 'b', trackingNo: 'TB' }));
it('포기한 원본이 있으면 gaveUp', () => expect(overallProgress([src({ gaveUpAt: '2026-10-29T00:00:00Z' })]).gaveUp).toBe(true));
it('요청 본문은 늘 recipientSourceShipmentId 만', () => {
  const body = buildConsolidationRequest({ source: opt('s1', 3, 2), picked: [opt('s2', 1, 1)], memoFrom: 's2', reason: '고객 추가 주문' });
  expect(body).toEqual({ sources: [{ shipmentId: 's1', expectedManifestVersion: 3, expectedReservationVersion: 2 }, { shipmentId: 's2', expectedManifestVersion: 1, expectedReservationVersion: 1 }], recipientSourceShipmentId: 's2', reason: '고객 추가 주문' });
  expect(body).not.toHaveProperty('recipientSnapshot');
});
it('메모 선택지는 서버 reason 으로만 정한다(가린 문자열을 비교하지 않는다)', () => {
  const masked = { ...opt('s2', 1, 1), reason: 'ok' as const, recipientSnapshot: { deliveryNote: '***' } };
  expect(memoChoices(opt('s1', 3, 2), [masked])).toEqual([]);
});
```

- [ ] **Step 2:** `npm run test:admin-web -- consolidation-model --maxWorkers=2` FAIL
- [ ] **Step 3:** 구현. 막힘은 없는데 재개가 안 되는 경우(버전 바뀜·정비 모드·다른 원본 주문 판정)는 따로 판정하지 않고 리컨실러 포기(`gaveUp`)로만 드러낸다. 서버가 그 이유를 응답하지 않아 화면이 추측할 근거가 없다.
- [ ] **Step 4:** PASS
- [ ] **Step 5: 커밋** (요청 시) `feat(admin-web): 합포장 진행 칸과 요청 본문을 순수 함수로 정한다`

### Task 6: 합포장 시작 Sheet

**Files:**
- Create: `apps/admin-web/src/features/order/fulfillments/detail/consolidation-sheet.tsx`
- Modify: `apps/admin-web/src/features/order/fulfillments/detail/shipment-actions.tsx` (버튼)
- Test: `apps/admin-web/src/features/order/fulfillments/detail/consolidation-sheet.spec.tsx`

**Interfaces:**
- Consumes: Task 4 `useConsolidationOptions`, Task 5 `buildConsolidationRequest`·`memoChoices`, 기존 `useCreateShipmentConsolidation`, `usePermissionCheck().can`/`canRun`
- Produces: `<ConsolidationSheet shipmentId open onOpenChange onRequested />`

- [ ] **Step 1: 실패하는 테스트** (React Testing Library, 훅은 jest mock)

```tsx
it('배송지가 다른 주문은 고를 수 없다', ...) // address_differs 카드가 aria-disabled, 클릭해도 체크 안 됨
it('카드 어디를 눌러도 체크된다', ...)       // role=checkbox 카드 클릭 → aria-checked=true
it('override_recipient 가 없으면 memo_differs 카드도 비활성이고 이유를 쓴다', ...) // "배송 메모가 달라 합치려면 수령인 변경 권한이 필요해요"
it('메모가 다른 주문을 고르면 2단계에서 메모를 골라야 요청이 켜진다', ...)
it('요청은 recipientSourceShipmentId 로 보낸다', ...) // mutateAsync 인자 검사
it('버전 409 면 안내하고 후보를 다시 읽는다', ...)   // SHIPMENT_STALE_MANIFEST_VERSION → toast "그사이 상자가 바뀌었어요. 다시 불러올게요", refetch 호출
it('응답을 잃고 다시 누르면 같은 멱등키를 쓴다', ...) // 첫 호출 reject(network), 두 번째 호출의 idempotencyKey 동일
```

- [ ] **Step 2:** `npm run test:admin-web -- consolidation-sheet --maxWorkers=2` FAIL
- [ ] **Step 3: 구현**
  - 시안 왼쪽 프레임의 1단계·2단계 그대로. 1단계 맨 위 "지금 보고 있는 주문" 카드(배송지·배송 메모·진행 상태). 카드마다 배송지·배송 메모와 `(같음)`/`(다름)` — 표시는 서버 `reason` 기준.
  - 2단계: 순서 네 줄(기준 상자가 `draft` 가 아니거나 배치·송장이 있을 때만), "요청하면 취소할 수 없어요" 경고, 메모 선택(Task 5 `memoChoices` 가 비면 생략, 대신 "합친 상자의 배송 메모 · …(고른 주문 모두 같아요)"), 작업 사유 필수.
  - 멱등키: 기존 `features/order/consolidation/template/index.tsx` 의 키 보존 방식과 같게(요청 내용이 같으면 같은 키).
  - `shipment-actions.tsx`: `canRun(useCreateShipmentConsolidation)` 이고, 상자가 `draft` 가 아니면 `can(['fulfillment.shipment.reopen'])` 도 참일 때만 **합포장** 버튼(`size="sm" variant="outline"`). 직배 상자·종료 상태·`recovery_required` 면 숨긴다.
- [ ] **Step 4:** PASS + `npm run test:admin-web -- mutation-guard screen-access --maxWorkers=2` PASS
- [ ] **Step 5: 커밋** (요청 시) `feat(admin-web): 출고주문 상세에서 같은 고객 주문과 합포장을 요청한다`

### Task 7: 합포장 진행 패널

**Files:**
- Create: `apps/admin-web/src/features/order/fulfillments/detail/consolidation-progress-panel.tsx`
- Modify: `apps/admin-web/src/features/order/fulfillments/detail/shipment-tab.tsx` (`ShipmentDetailView` 맨 위에 패널)
- Test: `apps/admin-web/src/features/order/fulfillments/detail/consolidation-progress-panel.spec.tsx`

**Interfaces:**
- Consumes: Task 4 `useConsolidationProgress`, Task 5 `overallProgress`, 기존 `useExcludeShipmentFromBatch`, `useVoidWaybill`, `usePermissionCheck`
- Produces: `<ConsolidationProgressPanel shipmentId />` (진행 응답이 null 이면 아무것도 그리지 않음)

- [ ] **Step 1: 실패하는 테스트**

```tsx
it('exclude 단계면 배치에서 빼기 버튼, 권한 없으면 숨김', ...)
it('unpick 단계면 창고에 전할 문구와 복사 버튼', ...) // 문구에 배치 이름·송장번호 포함
it('void 단계면 운송장 취소 버튼, registered 일 때만', ...)
it('auto 단계면 "10분 안에 자동으로 합쳐져요"', ...)
it('stuck 이면 "이 화면에서 처리할 수 없는 상태예요"와 정체 보드 링크', ...)
it('gaveUp 이면 "자동으로 합쳐지지 않았어요"', ...)
it('completed 면 "합쳐졌어요"와 새 상자 링크(/order/fulfillments?shipmentId=<target>)', ...)
it('원본이 둘이면 지금 할 일에 그 상자의 송장번호를 적는다', ...)
```

- [ ] **Step 2:** `npm run test:admin-web -- consolidation-progress-panel --maxWorkers=2` FAIL
- [ ] **Step 3: 구현**
  - 시안대로 진행 칸 네 개(배치에서 빼기·상품 꺼내기·운송장 취소·자동으로 합치기, 담당 나/창고/나/자동)와 "지금 할 일" 하나.
  - 배치 빼기 사유는 `'합포장'` 고정 문자열을 보낸다. 운송장 무효화 사유도 `'합포장으로 재발급'` 고정.
  - 버튼 성공 뒤 `orderQueryKeys.consolidationProgress` 와 `orderQueryKeys.shipment` 를 무효화한다.
- [ ] **Step 4:** PASS
- [ ] **Step 5: 커밋** (요청 시) `feat(admin-web): 합포장 진행과 지금 할 일을 상자 화면에 보인다`

### Task 8: 검증

- [ ] `npm run type-check` 에러 0
- [ ] `npm run lint`
- [ ] `npx jest --maxWorkers=2` 실패 0
- [ ] `npm run test:admin-web -- --maxWorkers=2` 실패 0
- [ ] `dotenv -e apps/core/.env -- npx jest apps/core/src/modules/fulfillment/services/consolidation --maxWorkers=2 --runInBand` (로컬 DB)
- [ ] 수동: #1181 4번 묶음을 이 화면으로 끝까지(로컬 E2E: `npm run bootstrap:e2e:local` → `npm run start:all:local`)
