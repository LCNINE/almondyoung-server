# warehouse-app Phase 2 — 입고/검수 (핸드헬드) 설계

- 날짜: 2026-07-25
- 브랜치: `feat/warehouse-app-phase2-inbound`
- 상위 문서: `docs/superpowers/specs/2026-07-20-warehouse-native-app-design.md` (마스터 설계) §11 Phase 2
- 선행: Phase 0(토대·하드웨어·로그인), Phase 1(재고 상세·조정·실사, #538), 재고 이동(#539)

## 1. 배경

핸드헬드 앱은 재고조회·조정·실사·이동까지 실동작한다. 남은 미구현 화면은 `/inbound`(Phase 2), `/picking`(Phase 3), `/packing`(Phase 4), `/shipments` 이며, 로드맵 순서상 다음이 입고/검수다.

백엔드 `/inbound` 표면은 이미 두툼하다 (`apps/core/src/modules/inventory/inbound/controllers/inbound.controllers.ts`). 실입고 3종(`simple` / `individual` / `plans/receive`), 검수(`verify-barcode`), 적치(`putaway`), 사후 정정(`return` / `cancel` / 라인 메모), 조회(`pending` / `receipts` / `work-logs` / `status`) 가 모두 존재하고 전부 `idempotencyKey` 를 요구한다. core 는 전역 `JwtAuthGuard` 만 걸려 있고 inbound 에 별도 role 가드가 없으므로, Phase 1·이동과 동일하게 인증만 통과하면 된다.

따라서 이 Phase 의 무게중심은 **새 API 를 만드는 것이 아니라 현장 워크플로우를 설계하는 것**이다. 백엔드 변경은 세 건으로 제한한다(§8).

## 2. 범위

**포함**

- 입고예정(발주 연계) 기반 입고 — 예정 목록 → 예정 상세 → 항목 스캔 → 수량 확정 → 입고
- 무계획 간편입고 — 스캔 카트 → 일괄 등록
- 적치 — 입고 직후 연속 흐름 (건너뛰기 가능)
- 직전 입고 취소 — 적치 전·당일·전량
- 하이브리드 수량 입력 — NumberPad 기본 + 스캔 누적
- `/putaway` 플레이스홀더 라우트 + 허브 타일 (후속 자리 확보)
- packingUnit 계약 정상화 (컬럼 타입은 그대로)

**제외**

| 항목 | 사유 |
|---|---|
| 회송(`return`) · 라인 메모 | admin-web 에 이미 있음. 현장 앱은 "방금 실수" 되돌리기만 |
| 개별입고(`/inbound/individual`) | 간편입고가 기능적으로 포함 |
| 전수조사 모드(`simple-fullscan`) | 하이브리드 수량이 흡수 |
| SKU 로 예정 역조회 | "예정 선택 → 항목 스캔" 을 기본 동선으로 확정 (§3) |
| 적치 대기 목록 | 후속. 자리(플레이스홀더)만 확보 |
| 오프라인 큐 | 마스터 설계 §14 — 온라인 우선 |
| `packing_unit` 컬럼 타입 좁히기 | ADR-0005 상 3-PR expand-contract. 별도 백로그 |

## 3. 결정 로그

| 결정 | 선택 | 근거 |
|---|---|---|
| 입고 기준 | 예정 우선, 없으면 간편 (둘 다) | 현장 현실. 발주 연계 물건과 비연계 물건이 섞여 들어옴 |
| 적치 범위 | 포함 — 입고 직후 연속 흐름 | 현장 동선(받음→올림→꽂음)과 일치. 나중에 하려면 건너뛰기 |
| 수량 입력 | 하이브리드 (NumberPad + 스캔 누적) | 박스 단위 대량은 빠르게, 전수 검수는 스캔으로. `simple-fullscan` 의 존재가 전수 스캔 니즈를 방증 |
| 불일치 정책 | 부족 허용 · 초과는 경고 후 허용 | 백엔드가 둘 다 통과시키므로 앱이 정책 지점. 현장을 막지 않으면서 오타는 걸러냄 |
| 정정 범위 | 직전 입고 취소만 | 백엔드 제약(전량·적치 전·당일)이 이미 "방금 실수" 로 좁혀져 있음 |
| 탐색 방향 | 예정 선택 → 항목 스캔 | 이동 화면의 "출발지 먼저" 와 같은 결. 팔레트 한 판이 한 발주에 대응 |
| 적치 배선 | 항상 입고기본존 → `putaway` 2콜 | 예정·간편 경로가 동일해지고 PUTAWAY 워크로그(from→to)가 남음 |
| packingUnit | 계약만 number 로 정리, 컬럼은 varchar 유지 | 마이그레이션 0 으로 400 버그를 없애고 의미를 고정 |

## 4. 화면·라우트 구조

`/inbound` 를 허브가 아니라 **입고예정 목록 그 자체**로 둔다. 허브 타일에서 한 번에 예정 목록이 나오고, 간편입고는 그 화면의 보조 진입점이다 — "예정 우선, 없으면 간편" 을 탭 한 번 아낀 형태.

```
/inbound                 입고예정 목록 (홈)
                         · 창고 미선택 시 WarehousePicker
                         · 발주처·예정일 요약 카드, 잔여수량 배지
                         · 상단 [간편입고] 버튼
/inbound/plans/$planId   예정 상세 — 항목 목록 + 바코드 스캔 → 입고 시트
/inbound/quick           간편입고 — 스캔 카트 → 일괄 등록 → 적치 대기 목록
/putaway                 플레이스홀더 (후속 Phase)
```

수량 확정과 적치는 **라우트가 아니라 시트(모달)** 다. 이동 화면의 품목 시트와 같은 방식이라 뒤로가기 동작과 스캔 라우팅 규칙을 검증된 패턴 그대로 재사용한다.

`routeTree.tsx` 의 `/inbound` 플레이스홀더를 걷어내고, `HandheldHome` 의 "입고/검수" 타일은 그대로 둔다(이미 `/inbound` 를 가리킴). "적치" 타일을 새로 추가하되 Phase 2 에서는 플레이스홀더를 연다 — 허브에 자리가 있으면 후속에서 화면만 갈아 끼우면 되고, 현장에도 "곧 생긴다" 가 보인다.

**파일 배치** — 훅이 많으므로 실사 도메인 관례(`queries.ts`/`mutations.ts`)를 따른다.

```
src/domains/inbound/
  types.ts
  queries.ts              usePendingPlans
  mutations.ts            useReceiveFromPlan · useSimpleInbound · usePutaway · useCancelInbound
  PendingPlanListScreen.tsx
  PlanReceiveScreen.tsx
  QuickInboundScreen.tsx
  ReceiveSheet.tsx        수량 확정 시트 — 예정 기반 전용
  PutawaySheet.tsx        대상 로케이션 스캔 — 두 화면 공용
  useScanCount.ts         스캔 누적 로직 — 두 화면 공용
src/app/routes/           InboundRoute · PlanReceiveRoute · QuickInboundRoute
```

## 5. 흐름

### 5.1 예정 기반 (`/inbound/plans/$planId`)

```
예정 카드 탭 → 항목 목록 (예정 / 입고 / 잔여)
  ↓ 상품 바코드 스캔
매칭된 항목의 입고 시트 — 수량 = 잔여수량 프리필
  ↓ 같은 바코드 재스캔마다 +packingUnit(없으면 +1) · NumberPad 로 직접 수정 가능
[입고] → 초과면 "예정보다 N개 많습니다" 확인 다이얼로그
  ↓ POST /inbound/plans/receive → { receiptId, lineId }
결과 배너: "○○ 20개 입고됨  [적치하기] [취소]"
  ↓ [적치하기] → 적치 시트 → POST /inbound/putaway
```

예정에 없는 바코드를 찍으면 시트를 열지 않고 "이 예정에 없는 품목입니다" 로 막는다 — 다른 발주 물건을 잘못 밀어 넣는 걸 차단하는 지점이다.

### 5.2 간편입고 (`/inbound/quick`)

```
스캔 → 카트에 누적 (같은 SKU 재스캔 = +packingUnit, 행별 NumberPad 수정)
[등록] → POST /inbound/simple → lines[]
  ↓ 화면이 그대로 "적치 대기 목록" 으로 전환
각 라인 탭 → 적치 시트 → POST /inbound/putaway
```

### 5.3 적치 시트 (공통)

이동 화면의 대상지 선택을 그대로 재사용한다 — `useLocationSearch` + 코드 완전일치 단건 자동선택 + **"직전 대상지 사용"** 버튼. 팔레트 하나를 한 자리에 통째로 꽂는 경우가 버튼 한 번씩으로 끝나므로, 회차 단위 일괄 적치를 따로 만들지 않아도 실질 속도가 나온다.

### 5.4 직전 입고 취소

결과 배너에만 붙는다. 백엔드 제약(`inbound.service.ts` `cancelInbound`)이 정확히 "방금 실수 되돌리기" 로 좁혀져 있으므로 그대로 따른다:

- 전량만 (부분 취소 불가)
- 적치 전에만 (`putawayFromOriginQty > 0` 이면 거부)
- 당일만 (Asia/Seoul)
- 원위치 ON_HAND 가 전량 남아 있어야 함

적치를 마치면 취소 버튼은 사라진다.

## 6. 스캔 라우팅

이동 화면과 같은 "모드에 따라 라우팅" 규칙. 시트 상태가 곧 기대하는 바코드 종류를 결정하므로 상품/로케이션 바코드를 형태로 구분할 필요가 없다.

예정 기반(`PlanReceiveScreen`):

| 상태 | 스캔 해석 |
|---|---|
| 항목 목록 (시트 닫힘) | 상품 바코드 → SKU 조회 → 예정 항목 매칭. 없으면 "이 예정에 없는 품목" |
| 입고 시트 열림 | 같은 SKU 바코드면 수량 +packingUnit. 다른 SKU 는 무시 + 짧은 경고 |
| 적치 시트 열림 | 로케이션 코드 |

간편입고(`QuickInboundScreen`) — 별도 수량 시트가 없다. 카트 행의 NumberPad 로 직접 고친다:

| 상태 | 스캔 해석 |
|---|---|
| 카트 (시트 닫힘) | 상품 바코드 → 이미 있는 SKU 면 +packingUnit, 새 SKU 면 행 추가 |
| 적치 시트 열림 | 로케이션 코드 |

**packingUnit 해석** — `packingUnit` 은 SKU 가 아니라 **바코드 행마다** 달린 값이다. `GET /inventory/skus?barcode=` 가 그 SKU 의 바코드 전체를 돌려주므로, 앱은 **스캔한 바코드와 일치하는 행**의 `packingUnit` 을 쓴다. 박스 바코드는 +20, 낱개 바코드는 +1 이 된다. 값이 없거나 숫자로 파싱되지 않으면 **+1 로 폴백**한다.

`sku_barcodes.packing_unit` 은 현재 **전량 NULL 이다** (§8.3 의 400 버그 때문에 값이 저장된 적이 없다). 따라서 Phase 2 출시 직후의 실효 동작은 모든 스캔이 +1 이고, §8.3 이 배포된 뒤 운영에서 포장단위를 채우기 시작하면 박스 스캔이 배수로 잡히기 시작한다. 이 전환은 앱 배포 없이 데이터만으로 일어난다.

## 7. 데이터 계층

**쿼리 / 뮤테이션** — 기존 키 관례를 잇는다.

```
queries.ts    usePendingPlans(warehouseId)   ['inbound-pending', warehouseId]
                → GET /inbound/pending?warehouseId=

mutations.ts  useReceiveFromPlan   POST /inbound/plans/receive
              useSimpleInbound     POST /inbound/simple
              usePutaway           POST /inbound/putaway
              useCancelInbound     POST /inbound/cancel
```

바코드→SKU 는 **기존 `useSkuByBarcode` 를 재사용**한다. `POST /inbound/verify-barcode` 는 쓰지 않는다 — 예정 항목과의 대조는 앱이 이미 들고 있는 목록으로 하는 편이 왕복 한 번을 아끼고, 불일치를 400 에러가 아니라 화면 안내로 다룰 수 있다. 다만 `SkuSearchItem` 타입에 `barcodes[]`(id·barcode·isPrimary·packingUnit)를 추가해야 한다 — 현재 타입에는 없다.

**무효화** — 넷 다 원장을 움직이므로 실사 패턴대로 `onSuccess` 가 아니라 **`onSettled`** 에서 무효화한다. 서버는 커밋됐는데 응답만 유실되면 `onSuccess` 는 영영 불리지 않고, 그 상태로 stale 캐시가 남는다. 대상은 `['inbound-pending']` · `['location-contents']` · `['sku-warehouse-stock']` · `['sku-stock-summary']`.

**예정 상세의 출처** — 예정 단건 조회 API 는 없다. `/inbound/plans/$planId` 는 `usePendingPlans` 가 이미 받아 둔 목록에서 `planId` 로 골라 쓰고, 캐시가 비어 있으면(딥링크·앱 재시작) 같은 쿼리를 다시 태운 뒤 고른다. 목록과 상세가 한 쿼리를 공유하므로 입고 후 무효화 한 번이 양쪽에 반영된다. 창고 컨텍스트도 목록과 동일하게 `useWarehouse` 를 쓴다.

**빈 예정 제외** — `getInboundPending` 은 `inboundPlans.status = 'pending'` 으로 헤더를 고르고 항목은 `status = 'pending'` 인 것만 담는데, `receiveFromPlan` 이 항목만 `confirmed` 로 바꾸고 **헤더 상태는 갱신하지 않는다.** 따라서 전량 입고된 예정이 `items: []` 로 계속 내려온다. 앱은 잔여 항목이 없는 예정을 목록에서 제외한다.

**멱등키** — 이동 화면의 회전 규칙 그대로. payload(항목·수량·대상지)가 바뀌면 새 키를 발급하고, 값이 그대로인 재시도는 같은 키를 유지한다. "요청은 커밋됐는데 응답만 유실" 뒤 값을 고쳐 재제출할 때 옛 payload 를 같은 키로 replay 하는 사고를 막는다. `receive` / `putaway` / `cancel` 은 각각 독립된 키를 쓴다.

## 8. 백엔드 변경

### 8.1 `receiveFromPlan` 이 lineId 를 반환 (additive)

현재 응답은 `{ success, receiptId }` 뿐인데 `putaway` 는 `lineId` 를 요구한다. 예정 기반 입고 직후 적치를 이으려면 lineId 가 필요하다. 라인 insert 에 `.returning()` 을 붙이고 응답에 `lineId` 를 추가한다. `simple` / `individual` 은 이미 라인을 반환하므로 손대지 않는다.

### 8.2 `cancelInbound` 의 예정 연계 복원 (결함 수정)

현재 `cancelInbound` 은 라인을 취소하고 이벤트를 역분개하지만 `inboundPlanItems.receivedQty` 를 되돌리지 않는다. 예정 20개를 20개 입고 → 취소 → 재입고하면 예정 누계가 40 으로 잡히고 항목이 `confirmed` 로 굳는다.

`line.planItemId` 가 있으면 `receivedQty` 를 차감하고 `status` 를 `pending` 으로 복원한다. 예정 무관 라인(간편/개별)의 동작은 그대로 둔다.

### 8.3 packingUnit 계약 정상화

**현상** — 의미는 명백히 숫자인데(admin-web 이 `{packingUnit}개입` 으로 렌더) 계층마다 타입이 다르다:

| 계층 | 타입 | 위치 |
|---|---|---|
| 컬럼 | `varchar(64)` nullable | `inventory.schema.ts:567` |
| 백엔드 DTO | `string` + `@IsString()` | `add-barcode.dto.ts:11-13`, `create-stock-entry-by-skuid.dto.ts:52` |
| admin-web 읽기 타입 | `string \| null` | `lib/types/dto/inventory.ts:69` |
| admin-web 쓰기 타입 | `number` | `lib/types/dto/inventory.ts:816` |
| admin-web 이 보내는 값 | `Number(...)` → 숫자 | `barcode-list-section/index.tsx:32` |

전역 ValidationPipe 는 `transform: true` 지만 `enableImplicitConversion` 이 꺼져 있어(`platform/http/validation-pipe.ts:11-17`) JSON 숫자가 `@IsString()` 을 통과하지 못한다. **admin-web 에서 포장단위를 채워 바코드를 추가하면 400 이 난다.** 비워두면 `undefined` 로 통과하므로 드러나지 않았다.

**조치** — 컬럼은 `varchar(64)` 로 두고 계약만 정리한다 (마이그레이션 0):

1. `AddBarcodeDto.packingUnit` / `CreateStockEntryBySkuIdDto.packingUnit` → `@IsInt() @Min(1) @IsOptional() packingUnit?: number`
2. 저장 시 `String(n)` — `sku-catalog.manager.ts:229`, `stock-event.service.ts:68`
3. 읽기 시 숫자 파싱 — `sku-catalog.reader.ts`(113·252·428), `sku.mapper.ts:10`, `inbound.service.ts:1114`. 공용 헬퍼를 두고 **비숫자·빈 문자열은 `null`** 로 떨군다. 컬럼이 전량 NULL 임이 확인됐으므로 backfill 은 필요 없고, 이 방어는 앞으로 varchar 컬럼에 손으로 이상한 값이 들어가는 경우만 대비한다
4. 응답 DTO `sku-response.dto.ts:24` → `number | null`
5. admin-web `BarcodeDto.packingUnit` → `number | null`. 렌더(`{n}개입`)는 그대로

읽기 응답의 타입이 `string` 에서 `number` 로 바뀌므로 **읽기 계약 변경**이다. 현재 확인된 소비자는 admin-web 과 (신규) warehouse-app 뿐이지만, 다른 소비자가 없는지 확인이 필요하다 (§11).

## 9. 에러 처리

`ErrorContext` 에 `'inbound'` 를 추가한다. 이 화면에서 400 이 뜨는 실제 사유가 좁으므로 구분해 안내한다:

| 상황 | 문구 |
|---|---|
| 적치 — 원위치 잔량 부족 | 입고기본존 재고가 부족해요. 새로고침 후 확인해 주세요. |
| 취소 — 이미 적치됨 | 이미 적치해서 취소할 수 없어요. 재고 이동으로 되돌려 주세요. |
| 취소 — 당일 아님 | 오늘 입고분만 취소할 수 있어요. |

나머지(401/403·5xx·404·ConflictError)는 기존 `errorMessage` 의 공통 처리를 그대로 탄다.

**중간 실패** — 입고는 성공했는데 적치가 실패하면 재고는 입고기본존에 그대로 남는다(손실 없음). 배너를 "적치 미완료" 로 유지하고 재시도할 수 있게 둔다.

## 10. 테스트

**앱 (vitest + Testing Library, 가짜 트랜스포트)**

- `useScanCount` — 같은 바코드 누적, packingUnit 배수, **파싱 실패 시 +1 폴백**, 다른 SKU 스캔 무시
- `mutations` — 멱등키 회전(payload 변경 시 새 키 / 무변경 재시도 시 유지), `onSettled` 무효화 키
- `PendingPlanListScreen` — 창고 미선택 시 피커, **잔여 항목 없는 예정 제외**, 잔여수량 배지
- `PlanReceiveScreen` — 스캔 매칭, 예정 외 바코드 거부, 초과 시 확인 다이얼로그, 결과 배너, **적치 후 취소 버튼 사라짐**
- `QuickInboundScreen` — 카트 누적, 등록 후 적치 대기 목록 전환
- `PutawaySheet` — 코드 완전일치 자동선택, 직전 대상지 재사용
- `routeTree` — 신규 3개 라우트 + `/putaway` 플레이스홀더

**백엔드 (Jest)** — `inbound.service.idempotency.spec.ts` 옆에 붙인다.

- `receiveFromPlan` 이 `lineId` 를 반환한다
- `cancelInbound` 이 예정 연계 라인을 취소하면 `receivedQty` 가 차감되고 항목이 `pending` 으로 돌아온다 (지금은 안 돌아옴 — 이 테스트가 결함을 고정)
- 예정 무관 라인 취소는 기존 동작 그대로
- `AddBarcodeDto` 가 숫자 `packingUnit` 을 수용하고 문자열은 거부한다
- packingUnit 파싱 헬퍼 — 숫자 문자열은 number, 비숫자·빈 문자열·null 은 null

**기기 수동 스모크** — HID 스캔으로 상품/로케이션 바코드가 각 시트에서 올바로 라우팅되는지. 자동화 대상이 아니다.

## 11. 알려진 한계 · 검증 항목

**한계** — 적치를 건너뛰거나 앱을 껐다 켜면 그 미적치 라인을 다시 찾아갈 화면이 Phase 2 에는 없다. 남은 물건은 기존 **재고 이동** 화면(입고기본존 → 선반)으로 처리하면 되고 원장 결과는 동일하다. 다만 그 경로는 `PUTAWAY` 가 아니라 `MOVE` 로 기록된다. `/putaway` 플레이스홀더가 이 후속의 자리다.

**구현 전 확인**

1. `packingUnit` 읽기 응답을 소비하는 곳이 admin-web 말고 또 있는지 (storefront·channel-adapter·medusa)
2. dev 환경에 실제 입고예정 데이터가 있는지 — 없으면 스모크용 시드가 필요

`sku_barcodes.packing_unit` 의 데이터 분포는 확인됐다 — 전량 NULL 이다.
