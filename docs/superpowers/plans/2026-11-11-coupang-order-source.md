# 쿠팡 주문 수집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** channel-adapter 가 쿠팡 주문을 5분마다 수집하고, 수집하자마자 상품준비중으로 넘기며, 출고중지요청을 core 에 알리고, 송장 업로드 결과를 정직하게 기록한다.

**Architecture:** 네이버 source(`naver-order.source.ts`)를 본으로 `CoupangOrderSource` 를 더한다. 쿠팡은 변경 피드가 없어 «결제완료 = 우리 손을 안 탄 대기열», «상품준비중 = 이미 수집한 주문의 변화», «출고중지요청 목록»을 매 주기 통째로 훑는다. 상품준비중 처리는 오케스트레이터가 수집 커밋 뒤 부르는 새 선택 훅(`acknowledgeCollected`)이다. 18자리 ID 는 HTTP 응답 파싱 단계에서 문자열로 받는다.

**Tech Stack:** NestJS 11 · TypeScript · `@nestjs/axios` · zod · Jest(ts-jest, transpile-only) · drizzle(channel-adapter DB) · postgres.js(스크립트)

**Spec:** `docs/superpowers/specs/2026-11-11-coupang-order-source-design.md` — 구현자는 이 계획과 함께 읽는다. 결정 번호(§3 의 1~7)는 스펙 번호다.

## Global Constraints

- 🔒 공개 레포다. 실제 쿠팡 응답(수취인·주문자·주소·연락처·주문번호)을 커밋하지 않는다. 테스트 자료는 가짜 값만.
- 쿠팡 호출은 **프로세스당 초당 2회**를 넘지 않는다(판매자 ID 한도 초당 5회 — 롤링 배포로 태스크 둘이 겹쳐도 4회).
- 429 를 받으면 그 프로세스의 쿠팡 호출을 **60초** 멈춘다. 에러 응답이 **5초 안에 20건**이면 **10분** 멈춘다.
- `shipmentBoxId`·`orderId`·`receiptId` 는 코드 어디에서도 JS number 로 들고 있지 않는다 — 문자열(`/^\d+$/`).
- `COUPANG_READ_ONLY=true` 면 GET 이 아닌 쿠팡 호출은 보내기 전에 throw 한다(리허설 방어선).
- 줄 키: `channelOrderItemId = \`${orderId}:${vendorItemId}\``, `channelProductId = String(vendorItemId)`.
- 쿠팡 주문은 나눠 보내지 않는다(결정 6): 업로드 DTO 의 `splitShipping` 은 늘 `false`.
- 쿠팡 시각 문자열에 offset 이 없으면 KST(`+09:00`)로 읽고, 계약에는 UTC ISO 로 싣는다(네이버 `toContractTimestamp` 와 같은 처리).
- 검증 게이트: `npm run type-check` 에러 0, `npx jest --maxWorkers=3` 실패 0. 로컬 E2E 스택이 떠 있으면 둘 다 돌리지 않는다(메모리 부족 재부팅 전례).
- 새 코드에 `any`·`as` 캐스팅을 더하지 않는다(기존 `coupang.adapter.ts` 의 `any` 는 고치는 줄만 걷는다).

## Review Focus

- **offset 없는 쿠팡 시각** — `"2026-11-11T09:00:00"` 은 KST 09:00 = `2026-11-11T00:00:00.000Z`. → Task 3 테스트.
- **상자 둘 중 하나만 상품준비중이 실패한 주문** — 다음 주기에 결제완료인 상자만 다시 넘기고, 주문은 계속 `accepted` 로 남아 core 쪽 변화가 흐른다. → Task 4·5 테스트.
- **우리 스캔 어디에도 없는 주문의 출고중지요청** — 단건 조회로 스냅샷을 만들어 관측을 싣는다(관측이 매핑 없는 주문으로 사라지지 않게). → Task 4 테스트.
- **스캔 도중 429·5xx** — 그 주기 전체를 throw 로 끝내고 부분 결과를 내지 않는다(다음 주기가 통째로 다시 훑는다). → Task 1·4 테스트.
- **셀메이트 몫(상품준비중 이후인데 우리가 수집 안 한 주문)** — 판매주문도 상품준비중 호출도 생기지 않는다. → Task 4·5 테스트.

---

### Task 1: 쿠팡 HTTP 바닥 — 손실 없는 JSON · 속도 제한 · 읽기 전용 스위치 · 긴 ID 를 문자열로

**Files:**
- Create: `apps/channel-adapter/src/adapters/coupang/clients/coupang-json.ts`
- Create: `apps/channel-adapter/src/adapters/coupang/clients/coupang-json.spec.ts`
- Create: `apps/channel-adapter/src/adapters/coupang/clients/coupang-rate-limiter.ts`
- Create: `apps/channel-adapter/src/adapters/coupang/clients/coupang-rate-limiter.spec.ts`
- Modify: `apps/channel-adapter/src/adapters/coupang/clients/coupang-base.client.service.ts`
- Modify: `apps/channel-adapter/src/adapters/coupang/clients/coupang-order.client.service.ts` (`getOrderSheets`·`getSingleOrderSheet`·`getSingleOrderSheetByOrderId`·`acknowledgeOrdersheets`·`uploadInvoices`·`updateInvoices`)
- Modify: `apps/channel-adapter/src/adapters/coupang/clients/coupang-return.client.service.ts` (`getReturnRequests`·`getSingleReturnRequest`·`stoppedShipment`)
- Modify: `apps/channel-adapter/src/zods/coupang/coupang-common.zod.ts`, `coupang-order.zod.ts`, `coupang-return.zod.ts`

**Interfaces:**
- Produces:
  - `COUPANG_LONG_ID_KEYS = ['shipmentBoxId', 'shipmentBoxIds', 'orderId', 'receiptId'] as const`
  - `parseCoupangJson(text: string): unknown` — 위 키의 정수 리터럴(배열 원소 포함)을 문자열로 바꿔 파싱
  - `stringifyCoupangJson(body: unknown): string` — 위 키의 `/^\d+$/` 문자열 값을 따옴표 없는 정수 리터럴로 직렬화
  - `class CoupangRateLimiter { constructor(opts: { perSecond: number; now?: () => number; sleep?: (ms: number) => Promise<void> }); acquire(): Promise<void>; recordRateLimited(): void; recordError(): void; recordSuccess(): void }` 와 공유 인스턴스 `coupangRateLimiter = new CoupangRateLimiter({ perSecond: 2 })`
  - `CoupangBaseClient.send<T>(method: 'GET' | 'PATCH' | 'POST' | 'PUT', path: string, options?: { query?: URLSearchParams; body?: unknown }): Promise<T>` — 서명·제한·읽기 전용 검사·`responseType: 'text'` + `parseCoupangJson`·HTTP 오류는 상태 코드를 메시지에 싣고 throw
  - `CoupangLongIdSchema = z.string().regex(/^\d+$/)` (`coupang-common.zod.ts`). `coupang-order.zod.ts`·`coupang-return.zod.ts` 의 `shipmentBoxId`·`orderId`·`receiptId`(요청 DTO 포함)를 이 스키마로. 그 결과 TS 타입이 `string` 이 된다 — 컴파일 에러는 이 태스크에서 다 고친다(`coupang.adapter.ts` 의 `Number(...)` 변환 포함).

- [ ] **Step 1: 실패하는 테스트 — `coupang-json.spec.ts`**

```ts
it('긴 ID 정수 리터럴을 자릿수 손실 없이 문자열로 읽는다', () => {
  const parsed = parseCoupangJson('{"data":[{"shipmentBoxId":123456789012345678,"orderId":98765432109876543,"vendorItemId":3000000001}]}');
  expect(parsed).toEqual({ data: [{ shipmentBoxId: '123456789012345678', orderId: '98765432109876543', vendorItemId: 3000000001 }] });
});
it('배열 키(shipmentBoxIds)의 원소도 문자열로 읽는다', () => {
  expect(parseCoupangJson('{"shipmentBoxIds":[123456789012345678,2]}')).toEqual({ shipmentBoxIds: ['123456789012345678', '2'] });
});
it('문자열 값 안의 같은 글자는 건드리지 않는다', () => {
  expect(parseCoupangJson('{"memo":"\\"orderId\\":1"}')).toEqual({ memo: '"orderId":1' });
});
it('직렬화는 긴 ID 를 따옴표 없는 정수로 쓴다', () => {
  expect(stringifyCoupangJson({ vendorId: 'A1', shipmentBoxIds: ['123456789012345678'], orderId: '42' }))
    .toBe('{"vendorId":"A1","shipmentBoxIds":[123456789012345678],"orderId":42}');
});
```

- [ ] **Step 2: 실행해 실패 확인** — `npx jest apps/channel-adapter/src/adapters/coupang/clients/coupang-json.spec.ts` → FAIL(모듈 없음)

- [ ] **Step 3: `coupang-json.ts` 구현** — 파싱은 JSON 텍스트를 한 글자씩 훑는 작은 토크나이저로 «문자열 밖에서 `"<키>"` 다음 `:` 뒤 숫자(또는 `[` 안 숫자들)»만 따옴표로 감싼 뒤 `JSON.parse`. 정규식 치환은 문자열 값 안의 같은 글자를 건드리므로 쓰지 않는다(세 번째 테스트). 직렬화는 `JSON.stringify` replacer 로 해당 키 값을 표식 문자열로 바꾼 뒤 표식만 정수로 되돌린다.

- [ ] **Step 4: 실패하는 테스트 — `coupang-rate-limiter.spec.ts`** (가짜 `now`/`sleep`)

```ts
it('초당 2회를 넘는 세 번째 acquire 는 1초 창이 지날 때까지 기다린다', ...); // sleep 이 ~1000ms 로 불림
it('recordRateLimited 뒤 60초 동안 acquire 가 기다린다', ...);           // sleep(60_000) 근처
it('5초 안에 recordError 20번이면 10분 멈춘다', ...);                    // sleep(600_000) 근처
it('recordError 19번 뒤 recordSuccess 는 멈추지 않는다', ...);
```

- [ ] **Step 5: 실행해 실패 확인** → FAIL

- [ ] **Step 6: `CoupangRateLimiter` 구현, 그리고 `CoupangBaseClient.send` 추가** — `send` 는 `acquire` → (읽기 전용이고 GET 아니면 `throw new Error('COUPANG_READ_ONLY: <method> <path> 차단')`) → `generateAuthHeader` → `firstValueFrom(this.http.request({ method, url, data: body === undefined ? undefined : stringifyCoupangJson(body), responseType: 'text', transformResponse: [(d) => d], headers }))` → 429 면 `recordRateLimited()`, 그 밖 4xx/5xx 면 `recordError()` 후 `Error(\`쿠팡 ${status}: ...\`)` throw → 성공이면 `recordSuccess()` 후 `parseCoupangJson`. 위 Files 의 메서드 9개를 `send` 로 옮긴다(응답 봉투 처리·반환 모양은 지금 그대로 둔다 — `acknowledgeOrdersheets`·`uploadInvoices`·`updateInvoices` 는 지금처럼 `body.data` 를 돌려준다). `getOrderSheets` 의 `${response.data}` 로그는 건수로 고친다.

- [ ] **Step 7: 통과 확인** — `npx jest apps/channel-adapter/src/adapters/coupang apps/channel-adapter/src/zods --maxWorkers=3` → PASS, 그리고 `npx tsc --noEmit -p apps/channel-adapter/tsconfig.app.json` → 에러 0 (파일 이름이 다르면 `npm run type-check`)

- [ ] **Step 8: Commit** — `git commit -m "[channel-adapter] 쿠팡 긴 ID 를 문자열로 받고 호출 속도·읽기 전용을 한 곳에서 지킨다 (#1245)"`

### Task 2: 송장 업로드 결과를 정직하게 · 나눠 보내지 않기 · 송장 수정 고치기

**Files:**
- Modify: `apps/channel-adapter/src/adapters/coupang/coupang.adapter.ts` (`transformCoupangResponseToSyncResult`·`translateOrderToInvoiceDtos`·`translateOrderToUpdateInvoiceDtos`)
- Modify: `apps/channel-adapter/src/services/channel-capabilities.ts` (coupang `multipleTrackingNumbers: false`)
- Test: `apps/channel-adapter/src/services/shipment-dispatch-translations.spec.ts`, `apps/channel-adapter/src/services/channel-capabilities.spec.ts`, `apps/channel-adapter/src/services/shipment-dispatch-inbox.worker.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 문자열 ID 타입. 클라이언트 `uploadInvoices`/`updateInvoices` 반환 = `{ responseCode: number; responseList: Array<{ shipmentBoxId: string; succeed: boolean; resultCode: string; retryRequired: boolean; resultMessage: string }> }`
- Produces: `transformCoupangResponseToSyncResult(result: CoupangInvoiceResult, commandType: string): SyncResult` — `success` 는 `responseCode === 0` 이고 `succeed: false` 가 하나도 없을 때만

- [ ] **Step 1: 실패하는 테스트** (`shipment-dispatch-translations.spec.ts` — mock 을 **클라이언트가 실제로 돌려주는 모양**(봉투 없음)으로 바꾼다)

```ts
it('쿠팡이 항목을 거절하면 dispatch.ship 은 실패다', async () => {
  orderClient.uploadInvoices.mockResolvedValue({ responseCode: 1, responseList: [
    { shipmentBoxId: '123456789012345678', succeed: false, resultCode: 'INVALID_STATUS', retryRequired: false, resultMessage: '상품준비중이 아님' }] });
  const result = await adapter.executeCommand(shipCommand);
  expect(result.success).toBe(false);
  expect(result.errors?.[0].message).toContain('INVALID_STATUS');
});
it('주문의 살아 있는 품목 일부만 보내려 하면 업로드하지 않고 실패한다', ...);   // uploadInvoices 미호출, 메시지에 '나눠 보내기'
it('업로드 DTO 의 splitShipping 은 false, shipmentBoxId 는 문자열 그대로', ...);
it('dispatch.update_tracking 은 주문의 살아 있는 품목 전부로 updateInvoices 를 부른다', ...);
```
`channel-capabilities.spec.ts`: `expect(getChannelFulfillmentCapabilities('coupang')?.multipleTrackingNumbers).toBe(false)`. worker spec: 쿠팡 `isPartial` 주문은 manual 로 간다.

- [ ] **Step 2: 실행해 실패 확인** → FAIL

- [ ] **Step 3: 구현** — 결과 변환은 `result.responseList` 를 읽고 오류 메시지에 `resultCode`·`resultMessage` 를 싣는다. `translateOrderToInvoiceDtos` 는 «살아 있는 품목»(`shippingCount − cancelCount − holdCountForCancel > 0`) 집합과 요청 vendorItemId 집합이 같지 않으면 `Error('쿠팡 주문은 나눠 보내지 않는다 …')`, DTO 는 `splitShipping: false, preSplitShipped: false`. `translateOrderToUpdateInvoiceDtos` 는 items 없이 주문의 살아 있는 품목 전부로 DTO 를 만든다.

- [ ] **Step 4: 통과 확인** — `npx jest apps/channel-adapter/src/services/shipment-dispatch apps/channel-adapter/src/services/channel-capabilities --maxWorkers=3` → PASS

- [ ] **Step 5: Commit** — `"[channel-adapter] 쿠팡 송장 업로드 거절을 실패로 기록하고 쿠팡 주문은 나눠 보내지 않는다 (#1245)"`

### Task 3: 쿠팡 응답 해석 한 곳 — `coupang-order-fields.ts`

**Files:**
- Create: `apps/channel-adapter/src/services/order-collection/coupang-order-fields.ts`
- Create: `apps/channel-adapter/src/services/order-collection/coupang-order-fields.spec.ts`

**Interfaces:**
- Produces:
  - `interface CoupangOrderItemInfo { vendorItemId: string; productName: string; shippingCount: number; cancelCount: number; holdCountForCancel: number; unitPrice: number; orderPrice: number }` (금액은 `{units, nanos}` 의 `units`)
  - `interface CoupangOrderSheetInfo { shipmentBoxId: string; orderId: string; status: 'ACCEPT' | 'INSTRUCT' | 'DEPARTURE' | 'DELIVERING' | 'FINAL_DELIVERY' | 'NONE_TRACKING'; orderedAt: string; paidAt: string; shippingPrice: number; shippingAddress: ShippingAddress; items: CoupangOrderItemInfo[] }` — 시각은 UTC ISO
  - `parseCoupangOrderSheet(raw: unknown): CoupangOrderSheetInfo` — 필수 칸이 없거나 형이 틀리면 칸 이름을 담아 throw
  - `interface CoupangCancelReceiptInfo { receiptId: string; orderId: string; receiptStatus: string; createdAt: string; cancelCountSum: number; items: Array<{ vendorItemId: string; cancelCount: number }> }`, `parseCoupangCancelReceipt(raw: unknown): CoupangCancelReceiptInfo`
  - `toCoupangContractTimestamp(value: string): string`
- 파일 머리 주석에 «리허설(스펙 §4.8) 응답으로 확정할 추정» 목록을 둔다: 시각 offset 없음=KST · 수취인 연락처는 `receiverNumber ?? safeNumber` · 배송 메모는 `parcelPrintMessage` · `shippingPrice` 가 상자 단위.

- [ ] **Step 1: 실패하는 테스트** — 손으로 만든 가짜 발주서(이름 `홍길동`, 주소 `서울시 테스트구 1`, 전화 `050-0000-0000`, ID 는 18자리 가짜)로:

```ts
it('offset 없는 시각을 KST 로 읽어 UTC ISO 로 싣는다', () => {
  expect(toCoupangContractTimestamp('2026-11-11T09:00:00')).toBe('2026-11-11T00:00:00.000Z');
  expect(toCoupangContractTimestamp('2026-11-11T09:00:00+09:00')).toBe('2026-11-11T00:00:00.000Z');
});
it('발주서를 해석한다 — 수취인 실번호가 없으면 안심번호', ...); // shippingAddress.phone === '050-0000-0000'
it('vendorItemId 가 없는 품목이면 칸 이름을 담아 throw', ...);   // toThrow('orderItems[0].vendorItemId')
it('출고중지요청 접수를 해석한다', ...);                           // cancelCountSum, items 2개
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 형 검사는 작은 zod 스키마(`passthrough`)로. 원본 키는 그대로 두고 해석 결과만 돌려준다.
- [ ] **Step 4: 통과 확인** — `npx jest apps/channel-adapter/src/services/order-collection/coupang-order-fields.spec.ts` → PASS
- [ ] **Step 5: Commit** — `"[channel-adapter] 쿠팡 발주서·출고중지요청 해석을 한 파일에 모은다 (#1245)"`

### Task 4: `CoupangOrderSource`

**Files:**
- Create: `apps/channel-adapter/src/services/order-collection/coupang-order.source.ts`
- Create: `apps/channel-adapter/src/services/order-collection/coupang-order.source.spec.ts`

**Interfaces:**
- Consumes: Task 3 해석기, `CoupangOrderClient.getAllOrderSheetsByStatus(from, to, status)`·`getSingleOrderSheetByOrderId(orderId)`, `CoupangReturnClient.getReturnRequests(params)`
- Produces: `@Injectable() class CoupangOrderSource implements ReplayableChannelOrderSource, WindowedChannelOrderSource` (`channel = 'coupang'`), `fetchOrdersInWindow(since: Date | null): Promise<WindowedFetchResult>`, `fetchOrder(externalOrderId: string): Promise<ChannelOrderSnapshot | null>`. Task 5 가 `acknowledgeCollected` 를 더한다.

동작(스펙 §4.1·4.2·4.5):
- 한 주기 = 결제완료 스캔(지금−31일 ~ 지금, 일 단위 형식 `yyyy-MM-dd+09:00`) + 상품준비중 스캔(같은 범위) + 출고중지요청 `status=RU` 스캔(같은 범위) + 즉시취소 `cancelType=CANCEL` 스캔(`since ?? 지금−24h` ~ 지금, 31일 상한). 어느 호출이든 실패하면 **그 주기 전체를 throw** 한다.
- 발주서를 `orderId` 로 묶어 주문당 스냅샷 하나. 출고중지요청의 `orderId` 가 두 스캔에 없으면 `getSingleOrderSheetByOrderId` 로 채운다(실패는 그 주문의 `fetchFailures`).
- `paymentState`: 상자 중 하나라도 `ACCEPT` → `'accepted'`. 아니고 모든 품목의 `cancelCount === shippingCount` → `'terminal'`. 그 밖 → `'pending'`(셀메이트 몫이면 만들지 않고, 우리 주문이면 변화만 흐르게 — 오케스트레이터 `eligibleForOrderCreation` 경로).
- 줄: 품목마다 하나. `quantity = shippingCount`(원 수량), `cancelled = cancelCount === shippingCount`, `unitPrice`. 같은 주문에 같은 `vendorItemId` 가 둘이면 그 주문을 `fetchFailures` 로(사유에 «같은 옵션 두 줄») — 스펙 §4.2 의 «격리»를 처리 실패 행(`order_collection_processing_failed`, 격리함에 보인다)으로 한다.
- `amounts.total` = 살아 있는 품목 `(shippingCount − cancelCount) × unitPrice` 합 + 상자 배송비 합, `allLinesTotal` = 전 품목 `orderPrice` 합 + 배송비, `currency: 'KRW'`.
- lifecycle: 품목 `cancelCount > 0` → 줄 단위 `OrderCancelled`(`cancelledLines: [{ channelOrderItemId, quantity: cancelCount }]`, `eventKey: \`cancelled:${channelOrderItemId}:${cancelCount}\``, `cancelledBy: 'coupang'`). 전 품목 전량이면 주문 단위 한 건(`eventKey: 'cancelled'`). `holdCountForCancel` 은 관측을 내지 않는다(출고중지요청과 같은 수량을 두 번 세지 않는다). 출고중지요청 접수 → `ChannelCancelRequested`(`channelRequestRef = channelRequestKey = receiptId`, `eventKey: \`cancel-request:${receiptId}\``, `needsApproval: receiptStatus === 'RELEASE_STOP_UNCHECKED'`, `items` = 접수 품목별 `{ channelOrderItemId, quantity: cancelCount }`, 양수만).
- `sourceUpdatedAt` = 주기 시작 시각, `completedWindowEnd` = 주기 시작 시각(통째로 다시 훑으므로 경계 손실이 없다), `createdAt` = 첫 상자 `paidAt`, `raw` = 원 발주서·접수 그대로.
- `fetchOrder` 는 `getSingleOrderSheetByOrderId` 로 같은 스냅샷을 만든다(0건이면 `null`).

- [ ] **Step 1: 실패하는 테스트** (클라이언트 mock, 가짜 값)

```ts
it('결제완료 주문은 accepted, 줄 키는 orderId:vendorItemId', ...);
it('상품준비중뿐인 주문은 pending — 셀메이트 몫이면 만들지 않는다', ...);
it('상자 둘 중 하나가 아직 결제완료면 주문은 accepted', ...);
it('부분 취소 확정은 줄 단위 OrderCancelled, 수량은 cancelCount', ...);
it('holdCountForCancel 만 있으면 취소 관측을 내지 않는다', ...);
it('출고중지요청은 receiptId 를 참조·키로 한 ChannelCancelRequested', ...);
it('스캔에 없는 주문의 출고중지요청은 단건 조회로 스냅샷을 만든다', ...);
it('같은 vendorItemId 두 줄인 주문은 fetchFailures 로 간다', ...);
it('스캔 중 하나라도 실패하면 throw 하고 부분 결과를 내지 않는다', ...);
it('completedWindowEnd 는 주기 시작 시각', ...);
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** (`naver-order.source.ts` 의 파일 구성·로그 말투를 따른다)
- [ ] **Step 4: 통과 확인** — `npx jest apps/channel-adapter/src/services/order-collection/coupang-order.source.spec.ts` → PASS
- [ ] **Step 5: Commit** — `"[channel-adapter] 쿠팡 주문 수집 source — 결제완료 대기열·출고중지요청 관측 (#1245)"`

### Task 5: 수집 커밋 뒤 상품준비중 — `acknowledgeCollected` 훅

**Files:**
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order-source.interface.ts`
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order-provider.interface.ts`
- Modify: `apps/channel-adapter/src/services/order-collection/translating-order.provider.ts`
- Modify: `apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.ts` (`poll` 의 항목 루프 뒤, `closeRecoveredProcessingFailures` 다음)
- Modify: `apps/channel-adapter/src/services/order-collection/coupang-order.source.ts`
- Test: `order-poller.orchestrator.spec.ts`, `translating-order.provider.spec.ts`, `coupang-order.source.spec.ts`

**Interfaces:**
- Produces:
  - `interface AcknowledgingChannelOrderSource extends ChannelOrderSource { acknowledgeCollected(externalOrderIds: string[]): Promise<void> }`, `isAcknowledgingSource(source): source is AcknowledgingChannelOrderSource`
  - `ChannelOrderProvider.acknowledgeCollected?(externalOrderIds: string[]): Promise<void>` — `TranslatingOrderProvider` 는 source 가 구현할 때만 이 메서드를 가진다
  - 오케스트레이터: 이번 주기 `kind: 'order'` 항목 중 처리에 성공해 `wmsOrderId` 가 있고 `eligibleForOrderCreation !== false` 인 주문 id 를 모아(중복 제거) 한 번 부른다. throw 는 잡아 `logger.error` 만 — 주기 결과·워터마크를 바꾸지 않는다(그 주문은 결제완료로 남아 다음 주기가 다시 넘긴다).
  - `CoupangOrderSource.acknowledgeCollected`: 주문마다 `getSingleOrderSheetByOrderId` → `status === 'ACCEPT'` 상자만 → 50개씩 `acknowledgeOrdersheets({ vendorId, shipmentBoxIds })`. 응답의 `succeed: false` 는 `resultCode`·`retryRequired` 와 함께 warn. 배송지 재조회는 따로 하지 않는다 — 다음 주기 상품준비중 스캔이 굳은 배송지를 읽어 해시 경로로 `OrderModified` 를 낸다(최대 5분 창, 스펙 §4.3 의 «직후 단건 조회»를 이것으로 대신한다).

- [ ] **Step 1: 실패하는 테스트**

```ts
// order-poller.orchestrator.spec.ts
it('새로 만든 주문과 이미 수집된 accepted 주문을 acknowledgeCollected 로 넘긴다', ...);
it('eligibleForOrderCreation=false 주문(셀메이트 몫 포함)은 넘기지 않는다', ...);
it('처리 실패·격리된 주문은 넘기지 않는다', ...);
it('acknowledgeCollected 가 throw 해도 주기는 성공으로 끝난다', ...);
it('훅이 없는 provider(Medusa·Naver)는 전과 같다', ...);
// coupang-order.source.spec.ts
it('결제완료 상자만 50개씩 상품준비중으로 넘긴다', ...);
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npx jest apps/channel-adapter/src/services/order-collection --maxWorkers=3` → PASS
- [ ] **Step 5: Commit** — `"[channel-adapter] 수집이 커밋된 쿠팡 주문을 곧바로 상품준비중으로 넘긴다 (#1245)"`

### Task 6: 쿠팡 출고중지 자동 승인 — 채널별 스위치 · 접수 전체 수량

**Files:**
- Modify: `apps/channel-adapter/src/services/order-cancel/customer-cancel-approver.ts`
- Modify: `apps/channel-adapter/src/config/env.validation.ts`
- Test: `apps/channel-adapter/src/services/order-cancel/customer-cancel-approver.spec.ts`

**Interfaces:**
- Consumes: `CoupangReturnClient.getSingleReturnRequest(receiptId: string)` (Task 1 뒤 문자열)
- Produces: `isApprovalActFor(channel: 'naver' | 'coupang', env?: NodeJS.ProcessEnv): boolean` = `CHANNEL_CANCEL_APPROVAL_MODE === 'act'`(옛 값, 두 채널 모두) 또는 `CHANNEL_CANCEL_APPROVAL_ACT_CHANNELS`(쉼표 목록)에 그 채널이 있음. env.validation 에 `CHANNEL_CANCEL_APPROVAL_ACT_CHANNELS: z.string().optional()`.
- 쿠팡 실행부: `getSingleReturnRequest(receiptId)` 의 `cancelCountSum` 으로 `stoppedShipment({ vendorId, receiptId, cancelCount })`. `cancelCountSum <= 0` 이면 지금처럼 `coupang_cancel_count_unknown`. 명령의 `lines` 합은 더 쓰지 않는다. 🔴 막힘 주석(`act 전 막음`)을 걷는다.

- [ ] **Step 1: 실패하는 테스트**

```ts
it('ACT_CHANNELS=coupang 이면 쿠팡만 act, 네이버는 관찰', ...);
it('옛 MODE=act 는 두 채널 모두 act', ...);
it('쿠팡 act 는 접수 단건 조회의 cancelCountSum 으로 출고중지완료를 부른다', async () => {
  coupang.getSingleReturnRequest.mockResolvedValue({ data: [{ receiptId: '555', cancelCountSum: 3 }] });
  // 명령 lines 합은 1 이어도
  expect(coupang.stoppedShipment).toHaveBeenCalledWith({ vendorId: 'vendor-1', receiptId: '555', cancelCount: 3 });
});
```
기존 `'coupang act mode calls stoppedShipment with the receipt id'`·`'coupang without a known cancel count …'` 는 새 근거로 고친다. `getSingleReturnRequest` 의 실제 반환 봉투 모양은 Task 1 에서 정한 그대로 따른다.

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npx jest apps/channel-adapter/src/services/order-cancel --maxWorkers=3` → PASS
- [ ] **Step 5: Commit** — `"[channel-adapter] 쿠팡 출고중지 자동 승인을 채널별로 켜고 접수 전체 수량을 쓴다 (#1245)"`

### Task 7: 배선 · 인프라 · 판정 · 문서

**Files:**
- Modify: `apps/channel-adapter/src/adapter.module.ts` (`CHANNEL_ORDER_PROVIDER` factory·`inject` 에 `CoupangOrderSource`, providers 배열에 클래스)
- Modify: `apps/channel-adapter/src/services/order-collection/syncable-channels.ts` (`'coupang'` 추가)
- Modify: `deployments/lcnine/services/infra/services.ts` — `new sst.Secret('CoupangAccessKey', '1')`·`('CoupangSecretKey', '1')`·`('CoupangVendorId', '1')`, channel-adapter env 의 자리표시 `'1'` 셋을 `.value` 로, `CHANNEL_CANCEL_APPROVAL_ACT_CHANNELS: 'coupang'` 추가. 🔴 기본값 `'1'` 을 빼지 말 것(기본값 없으면 값 안 넣은 stage 의 services 배포 전체가 멈춘다), `''` 로도 하지 말 것(`env.validation.ts` 가 빈 `COUPANG_*` 로 기동 거부) — 스펙 §4.7
- Modify: `scripts/ops/cutover-preflight/rules.ts` + `checks/wiring.ts` — 쿠팡 자격증명 판정을 IaC 텍스트에서 «실제 Secret 값»으로 옮긴다. `.value` 로 바뀐 뒤엔 `isPlaceholderEnv(iac, 'COUPANG_ACCESS_KEY')` 가 언제나 거짓이라 자리표시가 남아도 ✓ 가 되기 때문이다.
  - `rules.ts`: `isPlaceholderValue(value: string | undefined): boolean` = 없음·빈 값·`'1'`·`dummy` 포함이면 참. `isPlaceholderEnv` 는 따옴표 안 값을 꺼내 이 함수로 판정하게 바꾼다(정의 한 곳).
  - `rules.ts`: `linkedSecretValue(name: string, env = process.env): string | null | undefined` — `SST_RESOURCE_<name>` 가 없으면 `null`(`sst shell` 밖이라 못 잰다), 있으면 JSON 의 `value`.
  - `wiring.ts`: 시장 표에서 `COUPANG_ACCESS_KEY` 줄을 빼고, `CoupangAccessKey`·`CoupangSecretKey`·`CoupangVendorId` 마다 — `null` 이면 `r.info('… 못 잼 — services sst shell 에서 다시')`, 자리표시면 `r.bad('쿠팡 자격증명 <name> 이 자리표시 값이다 — 쿠팡 주문이 들어오지 않는다', 'npx sst secret set <name> <값> --stage live 뒤 services 재배포 (#1245)')`, 아니면 `r.ok`. 값은 출력에 찍지 않는다. 네이버 줄은 그대로 둔다(#1244 가 같은 방식으로 옮긴다).
- Modify: `scripts/ops/cutover-preflight/checks/market.ts` + `index.ts` — 컷오버 뒤 점검 `checkCoupangCollectedHasCoreOrder(core, adapter, r)`: channel_adapter `wms_order_mappings`(`sales_channel='coupang'`, 30분 지난 행)의 `channel_order_id` 중 core `sales_orders`(`sales_channel='coupang'`, 같은 `channel_order_id`)에 없는 건수. 0 이 아니면 ✗ 와 «DLQ 화면에서 OrderCreated 거절 사유 확인 (#1245)». `checkMedusaReservations` 처럼 두 `readOnly` 를 겹쳐 부른다.
- Modify: `package.json`(`test:coupang:integration` 삭제), `CLAUDE.md`(그 명령 줄 삭제), `apps/channel-adapter/CLAUDE.md`(«source 는 `MedusaOrderSource` 하나» → 지금 셋)
- Test: `scripts/ops/cutover-preflight/rules.spec.ts` — `isPlaceholderValue` 가 `undefined`·`''`·`'1'`·`'https://dummy.com'` 은 참, 실제 같은 값은 거짓 / `linkedSecretValue` 가 `SST_RESOURCE_X` 없으면 `null`, `'{"value":"1"}'` 이면 `'1'` / 기존 `isPlaceholderEnv` 기대 그대로 통과. 기존 `channel-order-sync.controller.spec.ts` 의 «coupang 은 400» 기대를 새 동작으로

- [ ] **Step 1: 고칠 기대부터 바꾼다** — `channel-order-sync.controller.spec.ts` 의 쿠팡 기대를 «즉시 끌어오기 대상»으로 바꾸고 실패 확인
- [ ] **Step 2: 배선 구현**
- [ ] **Step 3: 판정 확인** — `npx jest scripts/ops/cutover-preflight` → PASS, `grep -n CoupangOrderSource apps/channel-adapter/src/adapter.module.ts` 가 `inject:` 줄을 보여 준다(판정의 `orderSourceWired` 가 그 줄을 찾는다). 판정 스크립트 자체는 DB 없이 exit 2 가 정상이라 여기서 돌리지 않는다
- [ ] **Step 4: 전체 게이트** — `npm run type-check` → 0, `npx jest --maxWorkers=3` → 실패 0
- [ ] **Step 5: Commit** — `"[channel-adapter] 쿠팡 source 배선·자격증명 시크릿·컷오버 판정 한 줄 (#1245)"`

배포 메모(PR 본문에 옮긴다): 배포 전 사람 작업 없음 — Secret 셋은 코드 기본값 `'1'` 로 뜨고, 판매채널 쿠팡 행이 비활성이라 배포해도 휴면이다. 판정은 쿠팡 자격증명 줄 셋을 ✗ 로 보여 주는 게 정상이다. **키를 받은 날** `npx sst secret set CoupangAccessKey|CoupangSecretKey|CoupangVendorId <값> --stage live` → services 재배포 → 판정 ✓ → 판매채널 행 켜기(스펙 §5, 런북 #1251).

### Task 8: 리허설 명령 — 읽기 전용 수집 · 가짜 값 자료

**Files:**
- Create: `scripts/ops/coupang-rehearsal/index.ts`
- Create: `scripts/ops/coupang-rehearsal/anonymize.ts`
- Create: `scripts/ops/coupang-rehearsal/anonymize.spec.ts`
- Create: `scripts/ops/coupang-rehearsal/README.md` (실행 순서: WING 에 사무실 PC IP 추가 → 실행 → 자료 만들기 → 원본 삭제 → IP 빼기)

**Interfaces:**
- Consumes: Task 1 클라이언트(`new CoupangOrderClient(new HttpService(axios.create()))` 처럼 Nest 없이 생성), Task 3 해석기, Task 4 source
- Produces:
  - 실행: `COUPANG_VENDOR_ID=… COUPANG_ACCESS_KEY=… COUPANG_SECRET_KEY=… npx tsx scripts/ops/coupang-rehearsal/index.ts --out=<레포 밖 디렉터리>` — 시작하자마자 `process.env.COUPANG_READ_ONLY = 'true'`. `--out` 이 레포 안이면 exit 2.
  - 출력: `<out>/raw/*.json`(원 응답) · 화면 보고(결제완료 = 넘겨받을 주문 수와 주문번호 목록, 상품준비중이면서 송장 없는 주문 목록, `parseCoupangOrderSheet` 실패 건과 칸 이름, 같은 옵션 두 줄 주문 수, `CoupangOrderSource.fetchOrdersInWindow(null)` 결과 요약)
  - `npx tsx scripts/ops/coupang-rehearsal/anonymize.ts --in=<out>/raw --to=apps/channel-adapter/src/services/order-collection/__fixtures__/coupang` — `anonymizeCoupangPayload(value: unknown, ids: Map<string, string>): unknown`: 수취인·주문자 이름 → `테스트고객N`, 전화·안심번호 → `050-0000-NNNN`, `addr1`/`addr2` → `서울시 테스트구 N` / `N호`, 이메일 → `user-N@example.com`, `shipmentBoxId`·`orderId`·`receiptId` → 같은 자릿수의 가짜 숫자(같은 원값 → 같은 가짜값, `ids` 로 일관), `parcelPrintMessage` → `배송 메모`. 그 밖 칸(상태·수량·금액·`vendorItemId`)은 그대로.

- [ ] **Step 1: 실패하는 테스트 — `anonymize.spec.ts`**

```ts
it('개인정보 칸을 가짜 값으로, 같은 주문번호는 같은 가짜 번호로 바꾼다', ...);
it('상태·수량·금액·vendorItemId 는 그대로 둔다', ...);
it('결과 JSON 문자열 어디에도 원래 이름·전화·주소가 남지 않는다', ...);
```

- [ ] **Step 2: 실패 확인** — `npx jest scripts/ops/coupang-rehearsal` → FAIL
- [ ] **Step 3: 구현** (`index.ts` 는 읽기만 — DB·Kafka 에 닿지 않는다)
- [ ] **Step 4: 통과 확인** → PASS. `COUPANG_READ_ONLY=true` 로 `acknowledgeOrdersheets` 를 부르면 throw 하는지 Task 1 테스트가 이미 지킨다.
- [ ] **Step 5: Commit** — `"[ops] 쿠팡 리허설 — 읽기 전용 수집과 가짜 값 자료 만들기 (#1245)"`

리허설 뒤(이 계획의 범위 밖, 사람이 돌리고 Claude 가 이어서): 가짜 값 자료로 `coupang-order-fields.spec.ts` 에 실제 모양 테스트를 더하고, 머리 주석의 추정을 확정하거나 고친다.

### Task 9: 넘겨받은 셀메이트 주문의 재고 되돌리기

**Files:**
- Create: `scripts/sellmate/stock-delta.ts` — `sync-stock.ts` 의 delta 적용 블록(ADJUST_UP/ADJUST_DOWN `stock_events` + 원장 갱신, 잠금 포함)을 `applyStockDelta(tx, { skuId, delta, source })` 로 뽑는다. `sync-stock.ts` 는 이걸 부르도록 바꾼다(동작 불변).
- Create: `scripts/sellmate/handover-stock-addback.ts`
- Create: `scripts/sellmate/handover-stock-addback.spec.ts`

**Interfaces:**
- Produces:
  - `computeAddBack(row: { current: number; unshipped: number; handedOver: number }): number` = `max(0, current − (unshipped − handedOver)) − max(0, current − unshipped)` (스펙 §4.9)
  - 실행: `npx tsx scripts/sellmate/handover-stock-addback.ts --stock=<마지막 sync 에 쓴 재고 파일> --sellmate-collected-at=<셀메이트 마지막 주문수집 버튼 시각, ISO> [--apply]` — 기본 dry-run(품목별 표만), `--apply` 일 때만 `applyStockDelta(…, source: 'sellmate-handover')`.
  - 넘겨받은 주문 = core `sales_orders` 중 `sales_channel='coupang'` 이고 채널 결제 시각이 `--sellmate-collected-at` 보다 **15분 넘게 이른** 주문(셀메이트가 수집해 미발송에 넣은 주문 — 스펙 §4.9 의 «셀메이트가 수집했고 아직 안 보낸 주문»). 결제 시각이 그 앞뒤 15분 안이면 판정하지 않고 «사람이 확인» 목록으로만 낸다(쿠팡 목록 반영이 ~10분 늦다). 결제 시각은 core `sales_orders.order_date` 다 — Task 4 가 스냅샷 `createdAt` 에 첫 상자 `paidAt` 을 싣고, core 가 그 값을 `orderDate` 로 저장한다(`sales-orders.service.ts` 의 `orderDate: payload.createdAt`).
  - 품목별 넘겨받은 수량 = 그 주문들의 살아 있는 줄 수량을 SKU 별로 합한 것. SKU 해석은 core 가 그 줄을 예약할 때 쓰는 해석과 같아야 한다. 품목 키 = `sku.code`(= 셀메이트 옵션정보일련번호, `scripts/sellmate/README.md`).
  - `current`·`unshipped` 는 `parseStockRows` 가 이미 읽는 열(`현재재고`·`미발송주문수`)을 원값으로 돌려주도록 넓혀 쓴다.
  - 같은 `source: 'sellmate-handover'` 이벤트가 이미 있으면 `--apply` 를 거절한다(한 번만 도는 스크립트).

- [ ] **Step 1: 실패하는 테스트**

```ts
it('미발송에 잡힌 넘겨받은 수량만큼 되돌린다', () => expect(computeAddBack({ current: 10, unshipped: 4, handedOver: 3 })).toBe(3));
it('0 으로 잘렸던 품목은 실물만큼만 되돌린다', () => expect(computeAddBack({ current: 3, unshipped: 5, handedOver: 5 })).toBe(3));
it('넘겨받은 주문이 없으면 0', () => expect(computeAddBack({ current: 7, unshipped: 2, handedOver: 0 })).toBe(0));
it('여전히 모자라면 0', () => expect(computeAddBack({ current: 2, unshipped: 6, handedOver: 1 })).toBe(0));
```
그리고 `sync-stock.spec.ts` 가 추출 뒤에도 그대로 PASS.

- [ ] **Step 2: 실패 확인** — `npx jest scripts/sellmate` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npx jest scripts/sellmate --maxWorkers=3` → PASS
- [ ] **Step 5: Commit** — `"[sellmate] 넘겨받은 쿠팡 주문만큼 마지막 재고 sync 의 차감을 되돌린다 (#1245)"`

---

## 끝난 뒤

- PR 하나(`feat/1245-coupang-order-source` → develop). 본문에 Task 7 배포 메모, 사람 작업(스펙 §5), 리허설 뒤 이어서 할 일(Task 8 끝).
- 배포: channel-adapter 만, 마이그 없음. `deploy:preflight` 로 남의 마이그 확인 후 배치에 싣는다.
- 런북 #1251 에 넣을 줄: 셀메이트 마지막 날 순서(송장까지 → 키 전환 → 첫 수집 확인 → Task 9 dry-run → `--apply`), «쿠팡 주문은 정체 보드에서 나눠 보내지 않는다», 키 만료 180일.
