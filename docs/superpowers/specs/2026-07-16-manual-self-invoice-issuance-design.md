# 수동(`self`) 송장 입력 경로 — 설계

- 날짜: 2026-07-16
- 상태: 승인됨 (구현 계획 대기)
- 범위: 백엔드 (`apps/core` fulfillment 모듈)
- 스키마 마이그레이션: 없음 (`invoiceMethodEnum`에 `'self'` 이미 존재)

## 1. 배경 / 문제

Core의 송장(invoice/운송장) 발급은 `InvoiceOrchestrator`의 비동기 durable saga다. `POST /shipments/:id/invoices`는 검증 후 `invoiceOperations`를 `pending`으로 큐잉하고 `202`만 반환하며, 실제 택배사 호출은 `InvoiceRecoveryWorker`(10초 크론)가 provider를 골라 수행한다. provider는 하드코딩된 두 개(`goodsflow` / `hanjin`)뿐이다.

현재 두 자동 발급 경로가 모두 막혀 있다:

- **goodsflow**: 어댑터는 완전 구현(`goodsflow-delivery.provider.ts`, `https://api.goodsflow.com` 호출)이지만 외부 요인으로 실사용 불가. issue capability(`safeToRepeat`/`lookupByIdempotencyKey`)가 둘 다 `false`라 `executeIssue`(`invoice-orchestrator.service.ts:459`)가 HTTP 호출 전에 `'unsupported'`를 던지고 operation을 `failed` 처리한다. void/lookup만 유지(`env.validation.ts:42` "한진 전환 후 조회/취소 호환용으로만 유지").
- **hanjin**: `hanjin-delivery.provider.ts`는 배선돼 있으나 의도적 fail-closed 스텁. `isConfigured()`가 항상 `false`, 모든 메서드가 "disabled until the official API and idempotency/recovery contract is verified" throw. 공식 API 계약 미확정(`env.validation.ts:47` "계약 승인 전까지 미설정 ... 503 반환").

`invoiceMethodEnum = ['goodsflow', 'self', 'hanjin']`에서 `self`(수동 입력)는 정의돼 있으나 **write 경로가 없다**. 발급 DTO의 `provider`가 `@IsIn(['goodsflow','hanjin'])`이고, `issueMethod`를 쓰는 유일한 곳이 `issueForShipment`의 `issueMethod: dto.provider`(`:179`)이기 때문이다. Task 25에서 V1의 `'direct'`(운영자 번호 직입력)를 제거하면서 옛 수동 경로도 은퇴했다.

결과적으로 **뚫려 있는 발급 경로가 하나도 없다.** 이 설계는 한진 API 정식 구현 없이 운영을 언블록하기 위해, 운영자가 외부에서 확보한 송장번호(예: 한진 운송장)를 planned shipment에 직접 기록하는 `self` 수동 경로를 연다.

## 2. 목표 / 비목표

**목표**
- 운영자가 외부에서 받은 송장번호 + 택배사를 planned shipment에 동기적으로 기록 → `issued` self 송장 생성.
- self 송장이 달린 shipment이 정상 디스패치(출고)되도록 디스패치 게이트를 완화.
- 오입력 정정용 수동 void (발송 전만).

**비목표 (out of scope)**
- admin-web UI.
- provider 배송추적 피더 (추적 이벤트 인입 경로 `POST :dispatchAttemptId/tracking-events`는 이미 provider 무관·dispatchAttempt 키잉이라 self가 새로 막지 않음; 피더 자체는 별개 문제이며 goodsflow 사망으로 어차피 휴면).
- self 송장의 발송 후 recall(취소).
- 한진 API 구현.
- 스키마 마이그레이션 (없음).

## 3. 결정 사항

| # | 결정 | 비고 |
|---|------|------|
| 범위 | 발급 + 수동 void, 백엔드 한정 | `uq_invoices_shipment_active` 부분 유니크 인덱스 때문에 오입력 self 송장은 void 전엔 같은 shipment 재발급이 영구 차단 → 정정 수단이 사실상 필수 |
| API 모양 | **별도 동기 엔드포인트** | self는 provider 호출이 없어 operation row·worker 불필요 → 기존 async saga(`issueForShipment`/`void`)와 근본적으로 다름. saga 메서드는 손대지 않고 manifest 가드 헬퍼만 재사용 |
| (a) carrier | `carrierValues` 전체 허용 | 한진이 주 용도지만 CJ 등 수동 입력을 막을 이유 없음 |
| (b) reason | **optional** | 감사 로그에 있으면 기록, 없으면 생략 |
| (c) void 안전범위 | **발송 전(`issued` + shipment `planned`)만** 허용 | 물리 발송된 라벨은 데이터 수정으로 void 불가; 발송 후 recall은 out-of-scope |

## 4. 상세 설계

### 4.1 엔드포인트 (`ShipmentInvoiceController`에 추가)

| 라우트 | 핸들러 | 응답 | 스코프 |
|--------|--------|------|--------|
| `POST /shipments/:shipmentId/invoices/manual` | `issueManualInvoice()` | `201` + invoice | `FULFILLMENT_SCOPE.WAREHOUSE_OPERATE` |
| `POST /invoices/:invoiceId/void-manual` | `voidManualInvoice()` | `200` + invoice | `FULFILLMENT_SCOPE.SHIPMENT_REOPEN` |

- 둘 다 `idempotency-key` 헤더 필수. `commands.execute`가 빈 키를 `FULFILLMENT_IDEMPOTENCY_KEY_REQUIRED`(400)로 거부하므로 provider 경로와 동일한 계약.
- 기존 3개 라우트(`.../invoices` 발급, `.../void`, `invoice-operations/:id`)와 async saga 메서드는 **불변**.

### 4.2 DTO (`dto/shipment-invoice.dto.ts`)

**`IssueManualInvoiceDto`**
- `expectedManifestVersion: number` — 필수 (기존과 동일 낙관적 잠금)
- `carrierCode` — 필수, `@IsIn(carrierValues)` (물리 택배사; `enum-values.ts`의 `carrierValues`/`CarrierEnum` 사용)
- `trackingNo: string` — 필수, trim 후 non-empty, 길이 ≤ 128 (스키마 `varchar(128)`)
- `reason?: string` — optional (감사용)
- `note?: string` — optional

**`VoidManualInvoiceDto`**
- `reason?: string` — optional
- `note?: string` — optional

### 4.3 `issueManualInvoice(shipmentId, dto, idempotencyKey, actor, tx?)`

`commands.execute<InvoiceResponseDto>({ commandType: 'shipment.invoice.issue.manual', idempotencyKey, canonicalRequest: { actorId, shipmentId, ...dto } }, handler)` 안에서 트랜잭션으로 수행. 기존 `issueForShipment`의 가드를 **그대로 재사용**:

1. `workflowGate.assertV2MutationAllowed('shipment.invoice.issue')` — maintenance 모드면 503.
2. 입력 검증: `carrierCode ∈ carrierValues`; `trackingNo` trim non-empty·길이. `reason`은 있을 때만 사용(optional이라 `assertReason` 호출 안 함).
3. `lockManifest(shipmentId, trx)` (`:754`) → `shipment.status === 'planned'` 단언 (아니면 `conflict('SHIPMENT_NOT_PLANNED', ...)`).
4. `manifestVersion === dto.expectedManifestVersion` 단언 (아니면 `conflict('SHIPMENT_STALE_MANIFEST_VERSION', ...)`).
5. `assertNoActiveInvoice(shipmentId, trx)` (`:953`).
6. `assertRecipientComplete` (`:1152`) / `assertTrustedLineIdentity` (`:1135`). **`assertProfileComplete`는 self에서 호출하지 않는다** — 이 가드는 `carrierAccountRef`(`:1174`, goodsflow center code)를 요구하는데, goodsflow 계정이 죽은 지금 이를 강제하면 수동 발급 자체가 막혀 스톱갭 목적이 무력화된다. self는 carrier API를 안 쓰므로 sender/carrier 계정 완비를 요구할 근거가 없다. recipient 완비(물리 배송 + 디스패치 hash)와 line identity(manifest 정합)만 요구.
7. `invoices` insert:
   - `trackingNo: dto.trackingNo` (실 번호, `pending:` 아님)
   - `carrier: dto.carrierCode`
   - `issueMethod: 'self'`
   - `externalServiceId: null`
   - `issuedForFulfillmentOrderId: manifest.fulfillmentOrderIds[0]` (compat)
   - `shipmentId`, `manifestVersion`, `recipientHash: canonicalShipmentRecipientHash(...)`
   - `status: 'issued'` (즉시 확정 — `issuing`/operation/worker 전혀 없음)
8. `trackingNo` 유니크(`invoices.tracking_no UNIQUE`) 위반 → `conflict('INVOICE_TRACKING_ALREADY_EXISTS', ...)`으로 매핑.
9. `audit.logUserActionRequired('shipment.invoice.issue.manual', 'fulfillment', ..., { userId: actor.id }, { invoiceId, shipmentId, carrier, trackingNo, reason }, trx)`.
10. 삽입된 invoice를 응답 DTO로 매핑해 반환.

**operation row·InvoiceRecoveryWorker 전혀 관여 안 함.**

### 4.4 ⭐ 디스패치 게이트 완화 (`assertDispatchableInvoice`, `:414`)

기존(`:435`)이 `!invoice.externalServiceId?.trim()`이면 거부한다. self 송장은 `externalServiceId`가 없으므로, 그대로 두면 아래 5개 디스패치 호출부가 전부 거부한다:

- `picking/discrete-picking.strategy.ts:1135`
- `picking/aggregate-then-sort.strategy.ts:1331`
- `picking/pick-to-tote.strategy.ts:1483`
- `services/outbound-batch-orchestrator.service.ts:965`
- `services/shipment-dispatch.service.ts:609`

**수정**: `issueMethod === 'self'`일 때 `externalServiceId` 요구를 건너뛴다. `carrier` 존재, `trackingNo` non-empty 및 `pending:` 접두 아님, manifest/recipient hash 일치는 **그대로 요구**. provider 송장 경로는 동작 불변.

이것이 이 작업의 린치핀 — 없으면 self 출고 자체가 불가능. provider 송장이 `externalServiceId` 없이 여전히 거부되는 회귀 테스트가 필수.

### 4.5 `voidManualInvoice(invoiceId, dto, idempotencyKey, actor, tx?)`

`commands.execute`(`commandType: 'shipment.invoice.void.manual'`) 안에서 트랜잭션으로 수행:

1. `workflowGate.assertV2MutationAllowed('shipment.invoice.void')`.
2. invoice `for update` 잠금; 존재·소속 shipment 확인 (없으면 `NotFoundException`).
3. `issueMethod === 'self'` 단언 — provider 송장은 durable void saga를 써야 하므로 `BadRequestException('Provider-issued invoices must use the durable void endpoint')`.
4. `status === 'issued'` 단언 (이미 `voided`/`used`/`voiding` 등은 거부).
5. **안전범위**: invoice가 `used`이거나 shipment이 `shipped`/`in_transit`/`delivered`면 거부 → `conflict('INVOICE_ALREADY_DISPATCHED', ...)`. (발송된 라벨은 recall이 필요하며 out-of-scope)
6. `invoices` update: `status: 'voided'`, `voidedAt: now`. → 부분 유니크 인덱스(`status <> 'voided'`)가 풀려 같은 shipment에 정정 재발급 가능.
7. `audit.logUserActionRequired('shipment.invoice.void.manual', ...)`.
8. void된 invoice 반환.

provider `cancelInvoice`·operation row 없음.

### 4.6 기존 `void()` 가드 메시지 조정 (선택, 사소)

`void()`(`:274`)의 `issueMethod !== 'goodsflow' && !== 'hanjin'` 분기 메시지를 self 수동 void 엔드포인트로 안내하도록 문구만 조정. 동작 불변.

### 4.7 에러 스타일

이 orchestrator는 자체 `conflict()` 헬퍼(`:1220`, `ConflictException` 반환)와 Nest 예외(`NotFoundException`/`BadRequestException`)를 쓴다. 새 코드도 **파일 기존 스타일에 맞춰** `conflict()` 헬퍼와 Nest 예외를 사용한다(`@app/shared` 예외 신규 도입 안 함).

## 5. 파일 변경 목록

| 파일 | 변경 |
|------|------|
| `dto/shipment-invoice.dto.ts` | `IssueManualInvoiceDto`, `VoidManualInvoiceDto` 추가; `InvoiceResponseDto`(응답 매핑) 필요 시 추가 |
| `services/invoice-orchestrator.service.ts` | `issueManualInvoice()`, `voidManualInvoice()` 추가; `assertDispatchableInvoice` self 분기 완화; `void()` 가드 메시지 조정 |
| `controllers/shipment-invoice.controller.ts` | `POST .../invoices/manual`, `POST .../:invoiceId/void-manual` 라우트 추가 |
| (테스트) | 아래 §6 |

## 6. 테스트

**Unit — `issueManualInvoice`**
- happy: `issued` self 송장 삽입(`issueMethod:'self'`, `externalServiceId:null`, 실 `trackingNo`).
- 거부: non-`planned` shipment / stale manifest version / active invoice 이미 존재 / recipient 불완전 / 중복 `trackingNo`(유니크) / maintenance 모드 503.
- `carrierAccountRef` 없는 프로필의 shipment에도 발급 성공(assertProfileComplete 미적용 확인).
- optional `reason` 없이도 성공.

**Unit — `assertDispatchableInvoice` (회귀 가드)**
- self 송장(`externalServiceId` 없음) → **통과**.
- provider 송장(`externalServiceId` 없음) → **여전히 거부**.
- self 송장이 carrier 없음 / `trackingNo` pending: → 거부.

**Unit — `voidManualInvoice`**
- happy: `issued` self → `voided`.
- 거부: provider 송장(`BadRequest`) / 이미 `voided` / `used`거나 shipment `shipped`.
- void 후 같은 shipment 재발급이 `assertNoActiveInvoice`를 통과.

**Integration**
- 수동 발급 → `assertDispatchableInvoice` 통과 → shipment 디스패치·`shipped`.
- 수동 발급(오번호) → `void-manual` → 정정 재발급 성공.

**Controller spec**
- 두 라우트 배선·스코프(`WAREHOUSE_OPERATE`/`SHIPMENT_REOPEN`) 적용·`idempotency-key` 헤더 스레딩.

## 7. 리스크 / 유의

- **디스패치 게이트 완화가 유일한 공유코드 수정** — provider 송장 회귀를 반드시 테스트로 고정.
- **배송 상태 자동 갱신 없음** — self 송장은 provider 추적이 없어 출고 후 `shipped`에서 자동 진행 안 함(기존 추적 이벤트 엔드포인트로 수동 인입은 가능). 운영상 알려진 한계로 수용.
- **멱등성** — `commands.execute` 재사용으로 double-submit 방어. `idempotency-key` 헤더 필수.
- **마이그레이션 없음** — 순수 코드 변경. expand-contract 컨벤션 대상 아님.
