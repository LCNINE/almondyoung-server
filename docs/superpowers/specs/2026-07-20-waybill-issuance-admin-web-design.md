# 운송장(Waybill) 발급 화면 admin-web 배선 — 설계 스펙

- 날짜: 2026-07-20
- 대상: `apps/admin-web`
- 브랜치: `feat/waybill-issuance-admin-web`
- 상태: 설계 승인됨 (구현 전)

## 1. 배경 / 문제

백엔드 운송장(waybill) 모듈은 재설계로 완성돼 있으나(구 invoice/굿스플로 대체), **admin-web에는 발급 계열 액션이 전혀 배선돼 있지 않다.** 현재 FO 상세의 shipment 탭은 `shipment.waybills`를 **read-only 이력**으로만 표시하고, `/order/shipment-round`·`regional-invoice`의 "송장 출력"은 백엔드 waybill 모듈과 미연동된 정적 프린트 UI다.

즉 물류 담당자가 admin-web에서 **운송장을 발급/재발급/무효화하거나 일괄 발급할 수단이 없다.** 백엔드는 준비돼 있으므로 이 작업은 순수 프론트엔드 배선이다.

## 2. 목표 / 비목표

### 목표
- FO 상세 shipment 탭에서 **단건** 운송장 발급 / 수동등록 / 재발급 / 무효화.
- 전용 페이지에서 **일괄** 발급(`/waybills:batch`)과 결과 확인·실패 재시도.
- 발급 상태(비종결 포함)를 정직하게 표기하고, 멱등 안전 재시도를 제공.

### 비목표 (범위 외)
- **물리 운송장 라벨 출력** 및 `labelData` 노출 — 응답 DTO에 라벨 필드가 없고 렌더 산출물도 없다. 별도 후속.
- **백엔드 변경** 일체 (DTO/엔드포인트/스키마).
- tracking ingest(배송추적 이벤트 등록), 모바일 핸디 화면.
- `/order/shipment-round`·`regional-invoice` 기존 프린트 UI 재작업.

## 3. 백엔드 계약 (기존, 변경 없음)

파일: `apps/core/src/modules/fulfillment/waybill/waybill.controller.ts`, `dto/waybill.dto.ts`

| 메서드 · 경로 | 요청 body | 스코프 | 멱등키 | 응답 |
|---|---|---|---|---|
| `POST /shipments/:shipmentId/waybills` | `{ carrier, expectedManifestVersion }` | `warehouse.operate` | 필요 | `WaybillResponseDto` |
| `POST /shipments/:shipmentId/waybills/manual` | `{ carrier, expectedManifestVersion, trackingNo, reason? }` | `warehouse.operate` | 필요 | `WaybillResponseDto` |
| `POST /shipments/:shipmentId/waybills/reissue` | `{ carrier, expectedManifestVersion }` | `warehouse.operate` | 필요 | `WaybillResponseDto` |
| `POST /waybills:batch` | `{ shipmentIds[], carrier }` | `warehouse.operate` | 필요 | `BatchResultItemDto[]` |
| `POST /waybills/:waybillId/void` | `{ reason }` | `shipment.reopen` | 필요 | `WaybillResponseDto` |
| `GET /shipments/:shipmentId/waybill` | — | `warehouse.operate` | — | `WaybillResponseDto` (활성) |

- `WaybillResponseDto`: `id, shipmentId, source('carrier'|'manual'), carrier, status, trackingNo|null, custOrdNo|null, manifestVersion, issuedAt|null, voidedAt|null, lastError|null`
- `BatchResultItemDto`: `shipmentId, status('registered'|'failed'|'pending'|'allocated'), trackingNo|null, reason|null`
- carrier enum(`carrierValues`): `CJ, HANJIN, LOTTE, LOGEN, KDEXP, CJGLS`. **게이트웨이 구현은 HANJIN 단독** — 나머지는 발급 시 레지스트리에서 실패.
- 발급 상태머신: `pending → allocated → registered → used` (+ `failed`, `abandoned`, `voided`). **`registered`/`used`만 발급 성공(운송장번호 확보).** carrier HTTP는 트랜잭션 밖이라 응답이 비종결(`pending`/`allocated`)로 돌아올 수 있음. `allocated`는 재시도 CAP 없음(한진 ERROR-09 멱등) → **동일 idempotency-key 재구동 안전.**

## 4. 프론트 아키텍처 (기존 패턴 준수)

3층 구조를 그대로 따른다:

```
lib/api/domains/orders/*.client.ts   (axios 래퍼)
      ↓
lib/services/orders/{mutations,queries}.ts  (React Query 훅) → index.ts 재노출
      ↓
features/order/**                    (화면)
```

미러 대상 표준: `features/order/fulfillments/detail/shipment-actions.tsx`(분할/계획/recall — 멱등키·재시도·스코프 게이팅·다이얼로그 폼), `lib/api/domains/orders/fulfillments.client.ts`.

## 5. 접근 (선택: A — 계층 재사용 + 전용 발급 큐)

- 단건: 기존 shipment 액션 패턴을 미러해 FO 상세에 인라인 추가.
- 일괄: 새 `/order/waybill-issue` 전용 페이지.
- (탈락) B: outbound-batches 다이얼로그 — 배치 결과/재시도 UX가 갇힘. C: shipment-round 흡수 — 페이지 성격·역할 가드(admin/master) 상충.

## 6. 상세 설계

### 6.1 API 클라이언트 계층
신규 `lib/api/domains/orders/waybills.client.ts`:
- `issue(shipmentId, { carrier, expectedManifestVersion }, idempotencyKey)`
- `manual(shipmentId, { carrier, expectedManifestVersion, trackingNo, reason? }, idempotencyKey)`
- `reissue(shipmentId, { carrier, expectedManifestVersion }, idempotencyKey)`
- `batch({ shipmentIds, carrier }, idempotencyKey)`
- `void(waybillId, { reason }, idempotencyKey)`
- `getActive(shipmentId)`

멱등키는 기존 관례대로 `Idempotency-Key` 헤더로 전달. `index.ts`(`lib/api/domains/orders/index.ts`)에 재노출.

타입은 `lib/types/dto/fulfillment.ts`에 추가: `WaybillResponse`, `BatchResultItem`, `IssueWaybillRequest`, `RegisterManualWaybillRequest`, `IssueBatchWaybillRequest`, `VoidWaybillRequest`, `CarrierCode`. 기존 `ShipmentWaybillHistory`는 재사용(이미 존재).

### 6.2 서비스(React Query) 계층
`lib/services/orders/mutations.ts`:
- `useIssueWaybill`, `useRegisterManualWaybill`, `useReissueWaybill`, `useVoidWaybill`, `useBatchIssueWaybills`

`lib/services/orders/queries.ts`:
- `useActiveWaybill(shipmentId)` — 발급 후 종결 확인 폴링용.

성공/무효화 시 관련 쿼리 무효화: shipment 상세(`useShipmentDetail`), FO 상세, (배치는) 발급 큐 목록. `query-keys` 규약을 따른다.

### 6.3 스코프 상수
`lib/services/orders/operation-policy.ts`의 `FULFILLMENT_SCOPES`에 추가:
```
reopen: 'fulfillment.shipment.reopen'
```
- 발급/수동/재발급/일괄 → `operate` 게이팅.
- 무효화(void) → `reopen` 게이팅.
`ACTION_SCOPE` 매핑 및 `canShowFulfillmentAction` 커버.

### 6.4 단건 인라인 액션 — `features/order/fulfillments/detail/waybill-actions.tsx` (신규)
- shipment-actions.tsx(627줄)에 얹지 않고 **형제 컴포넌트로 분리**해 파일 비대화 방지.
- shipment-tab.tsx의 "운송장 이력" 섹션 상단에 마운트: 활성 운송장 상태 뱃지 + 액션 버튼.
- 버튼(스코프 게이팅):
  - `발급`(operate): carrier 선택, `expectedManifestVersion`은 `shipment.manifestVersion` 자동.
  - `수동등록`(operate): + `trackingNo`, `reason?`.
  - `재발급`(operate): 발급과 동일 폼.
  - `무효화`(reopen): 대상 waybill 선택(`shipment.waybills` 중 활성) + `reason`(필수).
- 각 액션은 멱등키 생성(`createIdempotentCommand`) 후 mutateAsync. 실패 시 `getServerDenyMessage`로 토스트.

### 6.5 상태/에러 시맨틱 (핵심)
- 발급/수동/재발급 응답 `status`가 `registered`|`used`가 **아니면 성공으로 표시하지 않는다.** "발급 진행중"으로 두고:
  1. **동일 idempotency-key 안전 재시도** 버튼 제공(allocated CAP 없음·멱등),
  2. `useActiveWaybill` 폴링으로 종결(`registered`/`used`) 확인 후 성공 토스트.
- `status === 'failed' | 'abandoned'` 또는 `lastError` 존재 시 오류로 표기(재시도 안내).
- shipment-actions의 retry/operation 패턴을 변형: 여긴 saga `operationId`가 없으므로 **waybill status 기반** 폴링/재구동으로 구현.

### 6.6 일괄 발급 큐 — `/order/waybill-issue` (신규 페이지)
- 라우트: `app/(admin)/order/waybill-issue/page.tsx`, RouteGuard는 `operate` 스코프 기준(기존 order 페이지 가드 관례 확인 후 정렬).
- 기능: **활성 운송장이 없는 planned shipment** 목록 조회 → 다중선택(체크박스) → carrier 지정 → `POST /waybills:batch`.
  - 대상 shipment 목록 소스는 기존 fulfillment/shipment 조회 훅을 재사용(정확한 필터 소스는 구현 시 확정 — planned 상태 & 활성 waybill 부재 기준).
- 결과 표: `BatchResultItemDto[]` 렌더(`shipmentId`, `status`, `trackingNo`, `reason`). `failed` 항목만 재선택 → 재시도.
- feature 디렉토리: `features/order/waybill-issue/`(template + components).

### 6.7 Carrier 처리
- 공용 carrier select 컴포넌트: enum(`carrierValues`) 기반, **HANJIN만 활성**, 나머지는 `disabled` + "미지원" 표기. 기본값 `HANJIN`. 게이트웨이 확장 시 활성 목록만 넓히면 됨.

### 6.8 네비게이션
- 사이드바 주문·출고(`order-shipment`) 메뉴(`lib/utils/menu.ts`)에 "운송장 발급"(`/order/waybill-issue`) 항목 추가.

## 7. 테스트
- `waybills.client.ts` 유닛: 각 메서드의 URL/메서드/바디/멱등헤더 검증(기존 `v2-clients.spec.ts` 미러).
- mutation 훅: 성공/실패 및 쿼리 무효화.
- 상태 시맨틱 컴포넌트 테스트: **비종결 상태(pending/allocated) 시 성공 미표기 + 재시도 노출**, `failed` 시 오류 표기.
- 배치: 부분 실패 응답에서 `failed`만 재시도 대상으로 남는지.

## 8. 영향 파일 요약
신규:
- `lib/api/domains/orders/waybills.client.ts`
- `features/order/fulfillments/detail/waybill-actions.tsx`
- `app/(admin)/order/waybill-issue/page.tsx` + `features/order/waybill-issue/**`
- carrier select 공용 컴포넌트(위치는 구현 시 결정)

수정:
- `lib/types/dto/fulfillment.ts` (waybill 요청/응답 타입 추가)
- `lib/services/orders/mutations.ts`, `queries.ts`, `index.ts`
- `lib/services/orders/operation-policy.ts` (`reopen` 스코프)
- `lib/api/domains/orders/index.ts`
- `features/order/fulfillments/detail/shipment-tab.tsx` (waybill-actions 마운트)
- `lib/utils/menu.ts` (메뉴 항목)

## 9. 리스크 / 확인 포인트
- **비종결 응답 처리**가 이 작업의 진짜 난도. 발급 POST가 happy-path에서 `registered`까지 몰아주는지, 자주 `pending`/`allocated`로 끊기는지는 구현 시 실측 필요(폴링 간격·타임아웃 결정에 영향).
- 일괄 발급 대상 shipment 필터의 정확한 소스 훅 확정 필요(planned & 활성 waybill 부재).
- `reopen` 스코프가 프론트 권한 로딩 경로에 실제로 실려 오는지(백엔드 role 매핑엔 존재) 확인.
