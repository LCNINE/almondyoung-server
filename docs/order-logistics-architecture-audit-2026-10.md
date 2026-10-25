# core 주문·출고 도메인 구조 감사 (2026-10-19)

> 출처: 2026-10-19, #1016 15번 작업 중 «주문·물류 도메인이 덕지덕지 붙어 논리를 잃은 건 아닌가»라는 걱정에서
> 시작한 읽기 전용 감사. 기준 커밋은 `b22640970`(브랜치 `feat/1016-15-dead-line-status-drop`, develop + 15번 ⓑ-2 커밋 2개)이다.
>
> **이 문서는 «사실과 판단»만 담는다. 진행 상태는 담지 않는다.**
> - 죽은 코드 정리의 정본은 **#1097** 이다.
> - 커널 작업은 착수할 때 항목별로 이슈와 계획서(`docs/superpowers/plans/`)를 따로 연다.
>
> 줄 번호는 위 커밋 기준이다. 개수는 문자열 매칭으로 센 **근사치 스냅샷**이다. 판정을 뒤집을 정도의 오차는 아니지만,
> 착수할 때는 §8 의 도출 명령으로 다시 잰다.

## 0. 한 줄 요약

**걱정은 절반만 맞다.** 앞으로 가는 경로(출고 커널·재고 원장·운송장)는 깊고 잘 짜여 있다.
덕지덕지는 도메인 전반이 아니라 **세 곳에 몰려 있다**:
1. **되돌리는 전이에 주인이 없다.** 상자 수명주기와 피킹 custody 가 여기에 해당한다.
2. **`sales-orders.service.ts` 가 god object 다.** 3,018줄이고, 다른 모듈의 테이블을 직접 쓴다.
3. **인쇄 외주가 출고 모델 밖에 있다.**

이 셋을 키운 바탕은 **세 모듈이 스키마 파일 하나를 공유한다**는 점이다. 그래서 경계를 강제하는 장치가 없다.

---

## 1. 조사 방법

네 갈래로 나눠 읽었다. 각 갈래의 핵심 주장은 코드에서 다시 확인했다(§9 에 확인 못 한 것을 따로 적었다).

| 갈래 | 본 것 |
|---|---|
| 판매주문 | `sales-order/` 의 큰 서비스 셋의 책임 군집, 취소·환불·반품 판정의 출처 수, 상태 축, V1/V2 병존, 성장 패턴 |
| 출고 | `fulfillment/` 의 출고 경로 지도, 상태 칼럼별 쓰기 지점, 예외 경로 비중, 모듈 wiring, 성장 패턴 |
| 모듈 경계 | sales-order·fulfillment·inventory 사이의 import 그래프, 다른 모듈 테이블 쓰기·조인, MergedSchema 목록, ADR 과의 어긋남 |
| 상태 모델·변경 이력 | 상태성 칼럼·enum 전수, 파생 상태 함수, 리컨실러가 메우는 빈틈, 2026-08-01 이후 커밋 빈도·fix 비율 |

판단의 렌즈는 Ousterhout 의 «깊은 모듈 / 얕은 모듈»이다.
- **깊은 모듈**은 작은 인터페이스 뒤에 많은 것을 숨긴다.
- **얕은 모듈**은 인터페이스가 구현만큼 복잡하거나, 내부 지식을 호출자에게 떠넘긴다.

---

## 2. 잘 된 곳 (본보기)

- **출고 커널이 하나다.** 자사 출고는 전부 `ShipmentDispatchService` 를 지난다. `shipped` 쓰기, SHIP 원장 기록, 출고 시 예약 소비가 모두 이 한 곳에 있다.
- **재고 원장.** `stock_events`·`stock_ledgers` 를 쓰는 곳은 `StockEventStore` 하나다. arch spec 이 이를 지킨다. fulfillment·sales-order 에서 원장에 직접 쓰는 곳도 0이다.
- **운송장.** `waybills.status` 는 repository 한 파일만 쓴다.
- **FO 생성과 예약 생성은 각각 한 곳이다.** FO 는 `fulfillments.service.ts`, 예약은 `ShipmentReservationService` 가 만든다.
- **피킹 방식↔전략 대응을 컴파일 시점에 강제한다.** `picking-method.contract.ts` 가 `satisfies Record` 로 막고, 전략 레지스트리가 있다.
- **최근 새 개념은 제대로 분리돼 왔다.**
  - 폴더: `channel-cancel-request/`, `channel-order-change/`, `draft-box/`, `line-composition-edit/` 는 reader/manager 계층을 지키고 판정을 순수 함수로 뺐다.
  - 작은 단일 정의 조각: `box-target.ts`, `cancel-readiness.ts`, `exit-waybill.ts`, `line-attributed-custody.ts`, `shipping-profile.ts`, `sku-barcode-resolution.ts`, `fulfillment-phase.ts`, `self-cancel-block.ts`, `return-refund-classification.ts`
- **불변식 검사기의 연결 컴포넌트 정렬 락**(`fulfillment-invariant.service.ts`)은 동시성 설계로서 단단하다.
- **패치 표지가 적다.** TODO·FIXME·HACK·임시·우회는 비-spec 약 8.9만 줄에 15개뿐이다.

---

## 3. 모듈 경계: 폴더로 나뉜 한 덩어리

### 3.1 스키마가 물리적으로 하나다

`inventory/schema/inventory.schema.ts`(5,077줄) 한 파일에 세 모듈의 테이블이 다 있다.
`sales-order/schema/*.ts` 와 `fulfillment/schema/fulfillment.schema.ts` 는 그 파일을 다시 내보내는 별칭일 뿐이다.
`DbService<typeof wmsSchema>` 를 주입하는 곳이 100곳을 넘는다.

그래서 CLAUDE.md 의 «MergedSchema 는 짧고 검토 가능한 목록» 규칙이 이 세 모듈 사이에서는 **감시하는 게 없다.**
합칠 필요 자체가 없기 때문이다.

### 3.2 import 그래프 (spec 제외)

| 방향 | 대략 | 주로 가져오는 것 |
|---|---|---|
| fulfillment → inventory | 170 | 스키마가 대부분, audit·guard·barcode·lock, 내부 서비스 |
| sales-order → inventory | 28 | 스키마 |
| sales-order → fulfillment | 15 | `ShipmentPlanningService`·`ShipmentReservationService`·`FulfillmentCommandService`·thresholds |
| fulfillment → sales-order | 7 | `SalesOrderModule`, cancel-request 타입, amendments |
| inventory → fulfillment | 3 | 테스트 지원(`__support__`) 파일만 |

- **좁은 공개면이 없다.** index·facade·port 가 없고, 다른 모듈의 내부 서비스와 스키마를 직접 가져온다.
- **순환 의존이 숨어 있다.** `forwardRef` 는 0건이다. 그런데 `FulfillmentModule` 이 `SalesOrderModule` 을 import 하고, 반대 방향은 `moduleRef.get(ShipmentPlanningService, { strict: false })` 로 런타임에 꺼내 쓴다.
  - 꺼내 쓰는 곳: `sales-orders.service.ts:1802`, `channel-order-change.manager.ts:141`
  - 서비스가 없으면 그때서야 throw 한다.
  - `outbound-batch-orchestrator.service.ts:1345,1351` 도 같은 방식으로 planning·consolidation 을 찾는다.

### 3.3 다른 모듈의 테이블에 쓰는 곳

- **sales-order → FO·FO 아이템·예약**
  - `sales-orders.service.ts` 가 FO 를 직접 취소하고(`:611`, `:1540`), FO 아이템 수량을 줄이고(`:2313`), 예약을 해제한다(`:2417`).
  - `channel-order-change.manager.ts` 가 배송지를 FO 에 직접 쓴다.
- **inventory → FO**: `reservation-lifecycle.service.ts` 가 FO·FO 아이템의 예약 수량을 0으로 쓴다.
- **inventory 의 원장(가장 아래 층)이 출고 시도·배치 세션 테이블을 조인해 규칙을 검사한다**(`stock-event.store.ts`). 의존 방향이 거꾸로다.
- **product-matching → 판매주문 라인**: 메타 칼럼(`compositionSource` 등)이다.

### 3.4 ADR 과 어긋난 점

| ADR | 어긋남 |
|---|---|
| 0012 | 예약 대상은 상자 라인이라는 결정은 지켜진다. 그러나 FO 대상 예약 장치(해제·대사·DTO·화면 기본값)가 남아 있다 → #1097 묶음 E |
| 0016 | «출고주문·취소·정정은 서로를 소유하지 않는다»와 달리 sales-order 가 FO 를 직접 취소하고 수량을 줄인다 |
| 0017 | 판매주문 `shipped`/`delivered` 는 «외부 출고» 한 뜻인데, 취소 판정이 아직 그 값으로 분기한다 |
| 0027 | «예약 소진·환원은 한 seam 뒤에»와 달리 예약을 쓰는 곳이 세 모듈에 있다 |
| 0041 | `picking_plans`·`picking_plan_members`·`plan_id` 를 지우는 contract 단계가 안 됐다 → #1097 묶음 C |

---

## 4. 출고(fulfillment)

### 4.1 나가는 길은 하나, 되돌아오는 길은 여럿

상자가 나가는 경로는 다섯 개다: 배치(전략 3종), 단순출고, 로케이션 출고(단순출고를 감싼다), 강제출고, 직배송.
자사 출고는 모두 `ShipmentDispatchService` 하나로 모인다. **이 부분은 깊다.**

되돌리는 쪽은 경로마다 따로 구현돼 있다. 상자를 `draft` 로 되돌리는 쓰기가 여러 곳이고, 리셋하는 것이 서로 다르다.

| 위치 | 직전 상태 확인 | `manifestVersion` | `recoveryCode` |
|---|---|---|---|
| `shipment-recall.service.ts` (출고 되돌리기) | `status='recovery_required' AND recoveryCode=…` | 올림 | 비움 |
| `short-pick-exit.service.ts` | `status='planned' AND manifestVersion=…` | 올림 | 비움 |
| `shipment-planning.service.ts:1200` (`applyPendingCancellation`) | id 만 | 그대로 | 비움 |
| `shipment-planning.service.ts:1360` (`revert_planned`) | id 만 | 그대로 | 그대로 |
| `shipment-planning.service.ts:1409` (`applyDraftCancellation`) | id 만 | 올림 | 그대로 |

**이것을 지금 당장 버그로 보지는 않는다.** planning 쪽은 그 앞에서 `lockShipmentAggregate` 로 잠그고 검사한다.
문제는 «이 전이가 합법인가, 무엇을 리셋해야 하나»라는 지식이 쓰는 곳마다 흩어져 있다는 점이다.
새 되돌리기 경로를 만드는 사람이 매번 그걸 다시 추론해야 한다. **얕은 모듈의 정의 그대로다.**

### 4.2 상태 칼럼별 쓰기 지점

| 대상 | 쓰는 곳 |
|---|---|
| `shipments.status` | 6파일 14곳 |
| 작업 항목 status | 6파일 16곳. 전략 3개가 각자 `ready_to_pack`·`queued` 를 쓴다 |
| FO status | 3모듈에 걸쳐 9파일 |

전이를 한 곳에서 거르는 문지기로 보이는 파일 셋 중 실제로 그 역할을 하는 것은 없다.
- `shipment-aggregate.ts` 는 읽기·락 헬퍼다.
- `work-item-status.ts` 는 상수 목록이다.
- `fulfillment-invariant.service.ts` 는 잠그고 검증하지만 전이 규칙은 모른다.

같은 상자를 잠그는 방식도 두 가지다. 하나는 «낙관 로드 → 불변식 → 재로드 → 서명 비교»로, 4곳이 각자 구현한다. 다른 하나는 dispatch 의 예약 그래프 락이다.

### 4.3 FO 상태는 모델이 둘이다

FO status 는 원래 아이템 수량에서 계산하는 투영값이다(`fulfillment-progress.service.ts`).
그런데 판매주문의 «상자 전 취소»와 직배송(`fulfillments.service.ts`)이 status 를 직접 쓴다.
직배송이 쓰는 `'shipped'` 는 투영 어휘에 아예 없는 값이다. FO 아이템 취소 표현도 둘이다.
- planning: `canceledQty` 증가
- sales-order: `qty` 감소, 0이면 `'canceled'`

> 2026-10-24: 판매주문 쪽은 K7 PR3 으로 출고 명령으로 옮겨졌다 — 지금 상태는 §8.1 K3.

### 4.4 예외 경로의 비중

예외 전용 서비스는 7개, 약 3.4k줄이다: recall, short-pick, short-pick-exit, withdrawal, box-return, return-bin, session-recovery.
큰 서비스 안에 섞인 예외 로직까지 합치면 서비스 코드의 약 28% 다.
- **이탈 축은 하위 도메인으로 묶여 있다.** withdrawal·short-pick-exit·box-return 이 `exit-waybill`·`cancel-readiness`·`exitIfDrained` 를 공유한다.
- **대기 오퍼레이션 재개 API 는 두 벌이다.** planning 과 consolidation 이 같은 모양(`readiness`·`resume`·`tryResume`·`find`)을 각자 갖고, 서로를 `moduleRef` 로 찾는다.
- **세션 이벤트 해석도 두 벌이다.** 쓰기 쪽(`batch-inventory-session.service.ts`)과 재생 쪽(`batch-session-recovery.service.ts`)이 따로 해석한다. #1004·#1008 이 둘을 매번 같이 고쳤다.

---

## 5. 판매주문(sales-order)

### 5.1 세 서비스는 god object 다

**`sales-orders.service.ts`** (3,018줄)에는 다섯 책임이 섞여 있다: 생성·수집, 조회·통계, 취소 엔진(약 1,600줄로 파일의 절반 이상), 비즈니스 링크·타임라인, 수정·확정.

**`store-return-exchange.service.ts`** (2,133줄)는 반품과 교환 상태기계를 거의 복붙으로 두 벌 갖는다(`markCollected` / `markExchangeCollected`).

**`store-sales-orders.service.ts`** (1,757줄)에는 액션 화면, 취소 진입점 4개, wallet 환불 재시도, 배송조회 V2/legacy 가 섞여 있다.

세 서비스 모두 CLAUDE.md 계층 규칙을 어긴다.
- drizzle 을 직접 import 하고 쿼리한다.
- Nest HTTP 예외를 던진다.
- 받쳐 줄 Reader/Manager 가 없다.
- `store-return-exchange` 는 `this.db.db.transaction` 을 직접 연다(ADR-0025 위반).

### 5.2 같은 사실을 여러 벌로 계산한다

| 사실 | 벌 수 | 위치 |
|---|---|---|
| 취소 수량 | 3 | `metadata.cancelledLines` TS 파싱(`sales-orders.service.ts`), 그 SQL 판(`cancelled-quantity.sql.ts`), FO 아이템 `canceledQty`(`v2-cancellation-units.ts`) |
| «출고됐다» | 4 | `fulfillment-phase.ts`(`hasShippedEvidence`), `sales-orders.service.ts` 통계(주석은 «동일»이라지만 FO 만 봄), `shipBlockCounts`, `order-shipment-phase.sql.ts` |
| «배송완료» (반품·교환 자격) | 3, 기준이 서로 다름 | 버튼 `isReturnEligible`(모든 상자 delivered), 교환 `assertOrderDelivered`(FO 하나라도 completed), 반품 생성(출고 시도별 tracking) |
| 청구 수량 | 5, 상태 필터가 다름 | `store-return-exchange.service.ts` 안. 완료 건을 소진으로 세는 곳과 안 세는 곳이 섞여 있다 |
| «어디까지 왔나» | 3 | 관리자 뱃지·일별 통계(`order-shipment-phase.sql.ts`, 셀메이트 출고는 보고 인쇄는 안 봄), 고객 화면(`fulfillment-phase.ts`, 인쇄는 보고 외부 출고는 안 봄), 정체 보드(`order-progress.judge-sql.ts`) |
| 환불 비례배분 | 2, 공식이 다름 | 부분취소 `partial-cancellation-refund-calculator.ts`(`unitPrice×qty`), 반품 `store-return-exchange.service.ts` `calculateReturnRefund`(`totalPrice` 우선) |

**셀메이트 출고나 인쇄가 섞인 주문에서는 관리자 화면과 고객 화면이 서로 다른 단계를 보인다.**

**환불 공식 두 벌은 같은 라인에 다른 금액을 낼 수 있다.** 2026-10-19 에 «일단 넘어간다»로 보류했다.
라이브에서 실제 차이가 난 주문은 아직 확인하지 않았다.

### 5.3 취소 인터페이스가 얕다

`cancel()` 자체는 크다. 그런데 호출자 6곳이 그 앞뒤 단계를 각자 기억해야 한다: 사전검사 → 인쇄 gate/record/hold → 취소 → 환불기록.
- 호출자: `store-sales-orders.service.ts` 4곳, `order-events.consumer.ts`, `channel-order-change.manager.ts` 2곳
- 인쇄 기능(`d4780e8ed`, 10-14) 뒤 사흘 동안 인쇄×취소 fix 가 7건 나왔다. 진입점마다 따로 패치한 것이다.

**«V1/V2» 는 버전이 아니라 «상자가 생겼나»다.** 분기는 `hasV2FulfillmentHistory` 에서 갈린다.
상자 생기기 전 취소는 전부 «V1» 경로로 간다. **레거시가 아니라 현역이니 지우면 안 된다.**
이름이 이 사실을 숨긴다.

---

## 6. 상태 모델과 리컨실러

주문 하나의 여정을 저장된 축 약 15개와 독립 파생 판정 3벌이 기술한다(배치 단위 축 제외).

겹치는 곳(서로 어긋날 수 있는 곳):
- FO status 는 투영인데 직접 쓰기가 있다 (§4.3)
- FO 아이템 취소 표현이 둘이다 (§4.3)
- «어디까지 왔나» 파생이 셋이다 (§5.2)
- 직배송은 `FO.status` 와 `direct_ship_status` 가 같은 사실을 든다. 정합성은 가드 하나에 기댄다.
- 주문 취소가 세 곳에 기록된다: `SO.status='cancelled'`, `sales_order_cancellations` 행, `FO.status='canceled'`(철자도 다르다)
- 반품 모델이 두 벌 병존한다: 옛 `returns` 와 새 `return_requests`

`order-reconcile` 규칙 4개는 모두 «이벤트 경로에서 재개 신호가 빠졌다»를 사후 스캔으로 메운다.
- `wake-awaiting-matching`(12번)
- `resume-pending-consolidation`(25번)
- `resume-pending-cancellation`(30번)
- `retry-channel-settlement`(36번)

«경로에 신호를 더하지 않는다»는 의도된 방침(D4)이긴 하다. **하지만 되돌리는 전이에 주인이 없는 한 이 목록은 계속 늘 것이다.**

> 감사 중 «좀비 예약 리컨실러의 원인은 `sales-orders.service.ts` 의 예약 해제 catch»라는 주장이 나왔다. **기각한다.**
> 그 경로는 상자가 없을 때만 타고, 상자가 없으면 SHIPMENT_LINE 예약도 없다. FO 대상 예약은 생산자가 0이라 삼킬 실패가 사실상 없다.

---

## 7. 피킹 전략 세 벌: ADR-0030 의 판단과 재측정

### 7.1 왜 세 벌로 뒀나

ADR-0030(2026-08-15)이 근거를 남겼다.
- **계획 층은 공유했다.** 세 전략 diff 가 4줄 이하였다.
- **custody 층**(`completePick`·`handoff`·`unpickShipment`·`scan`)은 diff 64~108줄로 로직이 진짜 달랐다(`BULK_CART → SORTING → PACKING` vs `WORKER → PACKING`). hook 으로 밀어 넣으면 ADR-0026 이 경계한 과추상화가 된다고 보고 **일부러 통합하지 않았다.**
- 재검토 조건: **«custody 세 벌이 측정상 수렴하면 같은 방식으로 다시 검토한다.»**

**당시 판단은 맞았다.** 측정에 근거했고, base class 기각 이유(Nest DI, 통합 spec 의 `spyOn` 0회)도 타당하다.

### 7.2 ADR-0041 이후 수렴했다

ADR-0041(2026-09-30)이 배정을 작업 항목으로 옮기면서 세 벌이 가까워졌다.
같은 방법(전략명 정규화, 주석·빈 줄 제외, 메서드별 diff 줄 수)으로 다시 잰 결과다. 스크립트는 §10 에 있다.

| 메서드 | discrete↔tote | discrete↔aggregate | tote↔aggregate | 0030 당시 discrete↔aggregate |
|---|---|---|---|---|
| `unpickShipment` | **11** | 58 | 67 | 82~108 |
| `completePick` | 28 | 57 | 51 | 82~108 |
| `handoff` | 44 | 44 | 56 | 82~108 |
| `scan` | 진짜 다름 | 진짜 다름 | — | — |

**남은 차이는 거의 «명령 전에 누가 custody 를 들고 있어야 하나» 하나다.**
- discrete: `WORKER` / 작업자
- tote: `TOTE` / 박스에 배정된 토트. 여기에 후처리 `releaseEmptyShipmentTotes` 가 하나 더 붙는다.
- aggregate: `SORTING`·`PACKING` / ref

나머지는 세 벌이 동일하다: 명령 실행, 작업 항목 잠금, 피커 확인, 송장 게이트, 배정 루프, `ready_to_pack`/`queued` 전이, 응답.

### 7.3 가장 강한 증거: 송장 재출력 게이트

#992 가 같은 규칙(스펙 I5, «낡은 송장으로는 전진하지 않는다»)을 세 파일 7곳에 각각 넣었다.
그리고 «모든 복사본이 게이트를 부르나»를 확인하려고 AST 가드 spec `picking/label-currency-gate.guard.spec.ts` 를 새로 만들었다.
**가로지르는 규칙을 지키는 데 복사본 점검 spec 이 필요하다면, 그 규칙은 커널에 있어야 한다.**

0030 이후 세 전략 파일을 건드린 커밋은 3개다. 그중 2개가 세 파일을 함께 고쳤고, 나머지 1개(#1004)는 전략 고유 동작만 고쳤다.

### 7.4 판단

**0030 이 스스로 정한 재검토 조건이 `completePick`·`unpickShipment` 에서 충족됐다.**
`handoff` 는 경계선이고, `scan` 은 여전히 전략 고유다.

---

## 8. 커널 후보

«커널»은 작은 인터페이스 뒤에서 한 개념의 전이·규칙을 혼자 소유하는 모듈을 말한다. 바깥은 그것을 우회해 쓰지 못한다.
바깥에서 우회하는 쓰기는 가드 spec 으로 막는다(`@CronOnce` 가드와 같은 방식).

### 8.1 출고 줄기

**K1. 피킹 작업 항목 명령 커널** (먼저)
- **소유하는 것:** `WorkItemCommand.forward()` / `.rollback()` 이 명령 실행, 작업 항목 잠금, 피커 확인, (forward 만) 송장 게이트, 마지막 상태 전이를 맡는다.
- **전략이 넘기는 것:** 본문이 아니라 **정책 값**이다. «명령 전에 custody 를 들고 있어야 할 키 목록»과 선택적 후처리 하나. hook 본문이 아니므로 ADR-0026 의 과추상화가 되지 않는다.
- **전략에 남는 것:** 토트 등록·배정·해제, 카트 담기·분류·인계 같은 고유 동작.
- **없애는 것:** 게이트 가드 spec, 작업 항목 상태 쓰기 여러 곳.
- **착수 전 확인:** ADR-0030 의 안전망 근거(통합 spec 이 `spyOn` 을 0회 쓴다)가 지금도 유지되는지 다시 잰다. 0030 의 custody 조항을 부분 대체하는 ADR 을 쓴다.
- **먼저 하는 이유:** 측정 근거와 ADR 재검토 조건이 이미 있다. 범위가 작다. K2 의 연습이 된다.
- **ADR-0045 로 완료(2026-10-19).**

**K2. 상자 수명주기 (`ShipmentLifecycle`)**
- **소유하는 것:** 상태 전이 + 구성(줄·수령인·프로필·manifestVersion). 전이 함수 `transitionShipments` 가 전이표(from → to), 직전 상태 CAS, 목표 상태별 리셋 규칙(`manifestVersion`·`recoveryCode`·`plannedAt` 등)을 맡고, 구성 편집의 문 `editShipmentManifest` 가 잠금·전제 검사·`manifestVersion` 증가·예약 재계산을 맡는다.
- **넣지 않는 것:** «언제 취소하나» 같은 업무 판단. 전이의 합법성만 넣는다.
- **없애는 것:** §4.1 표의 서로 다른 리셋, §4.2 의 상태 쓰기 분산, 잠금 방식의 중복 구현.
- **ADR-0046 으로 완료(2026-10-19).**

**K3. FO 상태는 투영만**
- 커널이라기보다 «FO status 는 아무도 직접 쓰지 않는다»는 규칙이다.
- 직배송도 수량 사실(`shippedQty`)만 쓰고, 투영이 상태를 정한다.
- **판매주문 쪽은 K7 PR3 으로 끝났다(2026-10-24).** 상자 전 취소의 FO·FOI 쓰기는 출고 명령 `UnboxedDemandCancellation`(`fulfillment/unboxed-demand/`)이 하고, FO 상태는 투영이 정한다. FOI 취소 표현은 `canceledQty` 하나다 — §4.3 의 «`qty` 감소»는 없어졌다. ADR-0049 «현재 상태».
- **남은 것(2026-10-24 기준):**
  - 직배 `FulfillmentsService.ship()` 이 FO·FOI 에 `'shipped'`(투영 어휘에 없는 값)를 직접 쓴다. 같은 경로가 `FulfillmentShipped` 의 `trackingNumber` 를 `''` 로 내보내 이벤트 스키마 `min(1)` 을 어긴다 — 직배 «완료 처리»를 개통하면 막힌다(PR #1126 «알려진 문제»).
  - 넘긴 직배 FO 가 전량 취소돼도 `directShipStatus` 가 `forwarded` 로 남는다. «주문 목록»에 수량 0 으로 남고 «완료 처리»는 409 다(PR #1128 «알려진 문제»).
  - 판매주문 모듈이 출고 테이블을 직접 쓰는 예외 둘 — 배송지 변경(`channel-order-change.manager.ts`)과 공동현관 비번 파기(`entrance-password-cleaner.ts`). 정본은 `order-cancellation.guard.spec.ts` 의 예외 목록이고, 줄어드는 방향만 허용된다.
  - fulfillment 모듈 안의 FO 직접 쓰기 — **status 는 갈랐다(K3 PR1).** FO·FOI status 는 투영 함수 `reprojectFulfillmentOrders`(`fulfillment/fulfillment-order/`)만 쓰고, 예외는 옛 직배 `fulfillments.service.ts` 하나다. 정본은 `fulfillment-order-status-writes.guard.spec.ts` 의 허용 목록. 다른 칸(`shippedAt`·수량·예약 합) 쓰기는 «다시 재는 명령»의 FO 줄로 잰다.
  - K3 본편은 직배를 «입점사가 보내는 상자»로 옮기는 일이다 — 설계 `docs/superpowers/specs/2026-10-25-k3-drop-ship-supplier-shipments-design.md`(PR 8개, §7).
  - 입점사 상자 스키마(상자 주인·넘김 묶음·못 보냄·입점사 발송 시도)와 창고 흐름 가드가 생겼다(K3 PR2, 휴면). 정본은 ADR-0050 과 `supplier-shipment-entry.guard.spec.ts`.
- **전제:** 직배는 라이브 0건(개통 전, 2026-10-24 실측). 동작 변경의 라이브 영향은 착수 때 다시 잰다.

**K4. 대기 오퍼레이션 재개 레지스트리**
- **소유하는 것:** 오퍼레이션 타입별 `readiness`/`resume` 핸들러 등록.
- **없애는 것:** planning·consolidation 의 API 두 벌, `moduleRef` 서비스 로케이터, 그리고 리컨실러 재개 규칙이 하나씩 늘어나는 구조.

**K5. 배치 세션 이벤트 리듀서**
- **소유하는 것:** 순수 함수 `applySessionEvent(state, event)`. 쓰기와 재생이 같이 쓴다.
- **효과:** 쓰기와 복구가 어긋날 수 없게 된다.

### 8.2 판매주문 줄기

**K6. 라인 수량 사실** (판매주문 줄기의 바닥)
- 주문·취소·출고·배송완료·청구·환불가능 수량을 SQL 뷰나 함수 하나로 둔다.
- TS 판정, SQL 통계, 자격 검증이 모두 이것만 읽는다.
- **없애는 것:** §5.2 표의 여러 벌.
- K7·K8 이 이 숫자를 읽으므로 먼저다.
- **ADR-0047 로 완료(2026-10-23 라이브).** 남은 것: FO `sales_order_id` NOT NULL — contract 라 `deploy → migrate` 순서로 따로 싣는다.

**K7. 주문 취소 (`OrderCancellation.request(intent)`)**
- **소유하는 것:** 사전검사 → 인쇄 보류 → 적용(상자 전/후를 내부에서 고른다) → 환불기록.
- **호출자:** 의도만 넘긴다.
- **같이 정리:** «V1/V2» 를 «상자 전/후»로 이름을 바꾼다.
- **인쇄 외주:** 인쇄를 이행 단위 하나로 모델링하는 문제는 이 커널과 함께 다룬다.
- **ADR-0049 로 완료(2026-10-24 라이브).** K8 로 넘긴 것: 결정 대기 환불 둘 중 하나를 «환불 실행»한 뒤 남은 건의 «환불 실행»이 최신 링크를 읽어 아무것도 안 하는 것(부분취소 금액 규칙이 먼저), 반품 환불의 Wallet 호출 가드 예외.

**K8. 환불 금액 정책 + 반품·교환 수명주기**
- 환불 금액 정책 하나를 취소와 반품이 같이 쓴다.
- 반품·교환은 종류별 전이표 하나로 합친다. 트랜잭션은 `db.run` 으로 전파한다.

### 8.3 순서

```
출고:     K1 피킹 → K2 상자 수명주기 → K3 FO 투영 → K4 재개 레지스트리   (K5 는 독립)
판매주문: K6 라인 수량 → K7 취소 → K8 환불·반품
```

두 줄기는 서로 독립이라 나란히 갈 수 있다. K3 의 «sales-order 의 FO 직접 쓰기 제거»는 K7 과 만난다.

### 8.4 커널을 만들지 않을 곳

- 출고 커널, 재고 원장, 운송장은 이미 깊다. 다른 커널의 본보기로 둔다.
- 예약은 `ShipmentReservationService` 에 거의 모여 있다. 남은 예외(sales-order 의 직접 UPDATE)는 #1097 묶음 E 에서 FO 대상 예약을 걷을 때 같이 사라진다.

---

## 9. 한계와 확인 못 한 것

- 쓰기 지점·import 수는 문자열 매칭 근사치다.
- **교환 검증이 취소 수량을 빼지 않는 것 같다.** 이미 취소된 수량에 교환이 열릴 수 있다는 뜻인데, 추정이고 미검증이다(`store-return-exchange.service.ts` 의 교환 청구 검증).
- **옛 wallet 직접 환불**(`requestWalletRefundAfterCancel`)이 3pl 주문에만 닿는 사실상 죽은 코드인지는 라이브 확인이 필요하다.
- 환불 공식 두 벌의 실제 금액 차이는 확인하지 않았다(§5.2, 보류).
- 2026-08 이전 fulfillment 이력은 «Squashed commit» 14개라 성장 패턴을 읽을 수 없었다.

### 다시 재는 명령

```bash
# 상자 상태 쓰기 지점
grep -rn "update(wmsTables.shipments)" apps/core/src/modules --include=*.ts | grep -v '\.spec\.'
grep -rn "status: 'draft'" apps/core/src/modules/fulfillment --include=*.ts | grep -v '\.spec\.'
# FO 직접 쓰기 (K3)
grep -rnE "\.update\((wmsTables|inventoryTables)\.fulfillmentOrders\)" apps/core/src/modules --include=*.ts | grep -v '\.spec\.'
grep -rniE "update\s+\"?fulfillment_orders\b|update \\$\{(wmsTables|inventoryTables)\.fulfillmentOrders\}" apps/core/src/modules --include=*.ts | grep -v '\.spec\.'
# 숨은 순환 의존(서비스 로케이터)
grep -rn "strict: *false" apps/core/src/modules --include=*.ts | grep -v '\.spec\.'
# 다른 모듈 스키마 import
grep -rln "inventory/schema/inventory.schema" apps/core/src/modules/{fulfillment,sales-order} --include=*.ts | grep -v '\.spec\.' | wc -l
# 피킹 전략 diff (§10 스크립트)
python3 -I <§10 스크립트를 저장한 경로>/strat_diff.py apps/core/src/modules/fulfillment/picking
```

---

## 10. 부록: 피킹 전략 메서드 diff 측정 스크립트

ADR-0030 의 «공유층에는 측정된 것만» 규칙을 다시 적용할 때 쓴다. 저장소 밖 임시 경로에 저장해 돌린다.
첫 인자는 `picking/` 디렉터리다. 선택 인자 `x y method`(x·y 는 `d`·`t`·`a`)를 주면 그 쌍의 diff 를 출력한다.

```python
import re, sys, difflib

base = sys.argv[1]
files = {'d': 'discrete-picking.strategy.ts', 't': 'pick-to-tote.strategy.ts', 'a': 'aggregate-then-sort.strategy.ts'}
pat = re.compile(r'^  (?:private |public |protected )?(?:async )?([a-zA-Z]+)\(')


def methods(src):
    lines = src.split('\n')
    out = {}
    i = 0
    while i < len(lines):
        m = pat.match(lines[i])
        if m and m.group(1) != 'constructor':
            depth = 0
            body = []
            started = False
            j = i
            for j in range(i, len(lines)):
                body.append(lines[j])
                depth += lines[j].count('{') - lines[j].count('}')
                if '{' in lines[j]:
                    started = True
                if started and depth == 0:
                    break
            out[m.group(1)] = body
            i = j
        i += 1
    return out


NAMES = r"discrete|pick_to_tote|pickToTote|aggregate_then_sort|aggregateThenSort|Discrete|PickToTote|AggregateThenSort"


def norm(ls):
    return [re.sub(NAMES, 'S', l).strip() for l in ls
            if l.strip() and not l.strip().startswith(('//', '*', '/*'))]


M = {k: methods(open(base + '/' + f).read()) for k, f in files.items()}
for name in ['scan', 'handoff', 'completePick', 'unpickShipment']:
    print(name)
    for x, y in [('d', 't'), ('d', 'a'), ('t', 'a')]:
        a = norm(M[x].get(name, []))
        b = norm(M[y].get(name, []))
        d = sum(1 for l in difflib.unified_diff(a, b, lineterm='', n=0)
                if l[:1] in '+-' and not l.startswith(('+++', '---')))
        r = difflib.SequenceMatcher(None, a, b).ratio()
        print(f"  {x}{y}: {len(a)}/{len(b)} lines, diff={d}, ratio={r:.2f}")
if len(sys.argv) > 2:
    x, y, name = sys.argv[2], sys.argv[3], sys.argv[4]
    for l in difflib.unified_diff(norm(M[x][name]), norm(M[y][name]), lineterm='', n=1):
        print(l)
```
