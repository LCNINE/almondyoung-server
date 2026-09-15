# 입고 대기 보호와 입고 화면 상태 일관성

작성일: 2026-09-16 (KST). 기준: `develop`의 `d18b1a940` (#883).
브랜치: `codex/inbound-workflow-consistency`.
상태: 해결 방향 승인 후 작성한 상세 설계. 구현·운영 적용 전 검토본.

## 1. 문제와 목표

두 결함을 현재 코드에서 재현했다.

1. 간편입고 10개 → 일반 이동 6개: 원위치 ON_HAND는 4개이나 적치 대기는 10개다. 나머지 4개도 이동한 뒤 같은 SKU 1개를 입고하면 과거 10개가 다시 대기로 나타난다. 실제 InboundService, MovementService, InboundPutawayReader와 PostgreSQL로 확인했다.
2. 발주 입고 3개의 초안과 발주 취소 확정 기록을 복원해도 발주 화면은 `3개 입고됨`과 활성화된 `적치하기`를 표시한다. 실제 React·IndexedDB·operation runner로 확인했으며 API는 fixture였다.

이번 목표는 입고의 처리 기록을 우회하는 반출을 막고, 간편입고·발주입고·입고내역·적치가 같은 현재 상태를 사용하도록 만드는 것이다. 기존 두 재현뿐 아니라 출고·조정·실사·역분개가 같은 우회를 만드는 것도 막는다.

검사 기준선: 앱 85 files / 512 tests 및 production build 통과, Core 6 suites / 81 tests 통과. 이 숫자는 이번 구현의 검증 결과가 아니다. 실제 기기·배포본 합격도 아니다.

## 2. Global Constraints

- 발주는 수령 정산을 소유하고 입고 커널은 현장 작업을 소유한다. ADR-0039의 의존 방향을 유지한다.
- 원장 변경·입고 누계·업무 로그·문서 정산은 호출자 소유의 같은 PostgreSQL 트랜잭션에서 커밋한다.
- v2 작업 키·원래 요청 본문·사용자/API 범위·확정 결과 재생 계약을 유지한다. 미확인 작업을 새 키로 바꾸지 않는다.
- 재고 정본은 stock_ledgers이며 입고 처리 정본은 inbound_receipt_lines와 해당 업무 기록이다. 둘을 현재 잔량만으로 서로 역산하지 않는다.
- 서버 권한과 창고 범위 검증을 유지한다. 클라이언트 플래그로 재고 보호를 우회하지 않는다.
- 작업자 화면에는 해야 할 행동을 한국어로 안내한다. HTTP 코드·내부 상태·DB 용어는 개발자 진단에 둔다.
- 기존 데이터는 자동 추정 보정하지 않는다. 이번 데이터 도구는 읽기 전용이며 운영 보정 실행은 범위 밖이다.
- 신규 외부 의존성·재고 상태 enum·영구 재고 사본·DB 테이블은 추가하지 않는다. Node 22와 저장소의 Yarn 명령을 사용한다.

## 3. 선택과 범위

### 선택

입고 대기 물량을 공통 재고 쓰기 경계에서 보호한다. 이동 화면은 해당 물량을 선택하면 기존 적치 흐름으로 연결한다. 화면의 재개는 공통 서버 조회로 현재 상태를 확인한다.

### 기각한 대안

- `pendingQty = min(입고잔량, 원장잔량)` 또는 원장이 0이면 숨기기: 같은 SKU의 여러 입고 건과 재입고에서 귀속을 해결하지 못한다.
- 일반 이동 후 비동기로 적치 누계를 갱신하기: 중간 불일치·재시도·이벤트 누락이 새 정합성 문제가 된다.
- 모든 이동에 발주/입고 출처를 끝까지 붙이는 로트 모델: 현재 목표에 필요하지 않으며 혼재 재고 추적이라는 별도 제품 요구다.
- 취소된 초안을 화면별로 지우기: 다른 기기의 적치·취소와 이전 응답의 재생을 다루지 못한다.

### 범위 밖

창고 간 이송 UI, 적치 취소/선반에서 원위치로 되돌린 물량의 입고 재개, 새로운 불량·분실 정산 업무, 경제적 판매가능수량 정의 변경, 로트 추적, 운영 데이터 보정 실행은 포함하지 않는다. 다만 기존 실사/조정이 입고 대기 물량을 침범하면 명시적으로 거절하고 대사를 안내한다. 실물 부족을 처리하는 새 정산 업무가 구현됐다고 표현하지 않는다.

## 4. 입고 대기 보호 규칙

### 4.1 보호 대상과 수량

보호 단위는 `SKU × 창고 × 원위치`다. 다음 조건을 모두 만족하는 입고 라인의 잔량 합계를 `pendingQty`로 정의한다.

- 회차 상태 `posted`.
- 라인의 원위치가 같은 창고의 시스템 로케이션(`isSystem = true`). 현재 적치 대기 reader와 같은 범위다.
- 잔량 = `quantity - putawayFromOriginQty - returnedQty - canceledQty`.
- 출처 `direct`와 `purchase_order` 모두 포함. 일반 선반으로 직접 입고한 라인은 포함하지 않는다.

시스템 위치라는 이유만으로 모든 물량을 금지하지 않는다. 회수로 재작업존에 들어온 물량처럼 입고 대기 라인에 속하지 않는 재고는 일반 가용 물량이다. 음수 잔량·잘못된 원위치 같은 데이터는 0으로 덮지 않고 대사 필요로 분류한다.

```text
onHandQty = 해당 위치의 ON_HAND
pendingQty = 미처리 입고 잔량 합계
batchControlledQty = 활성 출고 세션이 통제하는 수량(기존 정의)
generallyAvailableQty = max(0, onHandQty - pendingQty - batchControlledQty)
```

일반 이동 표시의 generallyMovableQty는 ON_HAND 행에서 generallyAvailableQty와 같고 다른 상태에서는 0이다. 일반 반출 거절은 pendingQty가 원인일 때 INBOUND_ORIGIN_STOCK_PROTECTED, custody만 원인일 때 기존 BATCH_CONTROLLED_STOCK 코드를 유지한다. 보호 합계가 원장을 초과하는 상태는 INBOUND_ORIGIN_STOCK_INCONSISTENT로 구분한다.

새 출고 세션은 `generallyAvailableQty` 안에서만 취득한다. 입고 대기와 출고 세션에 같은 물량을 이중 배정하지 않는다. 기존 세션과 입고 대기의 합이 원장을 초과하면 자동으로 어느 쪽도 줄이지 않고 대사 대상으로 보고한다.

### 4.2 최종 쓰기 경계

`StockEventStore.applyProjection`에서 위치별 ON_HAND 감소를 보호한다. 이곳은 일반 이벤트, 역분개, 회수의 원장 갱신이 합류하는 경계다.

- 기존 stock availability advisory lock을 취득한 뒤 감소 후 ON_HAND가 pendingQty 아래로 내려가는지 검사한다.
- 같은 grain의 ON_HAND→ON_HAND처럼 순변화가 0인 이벤트는 순감소로 계산하지 않는다. 단, 적치는 출발=도착 자체를 거절한다.
- 기존 배치 custody·예약 보호는 유지한다. 일반 반출에는 두 보호 수량의 합을 적용한다.
- 출고의 기존 dispatch authorization은 입고 보호를 우회하지 않는다. 정상 세션 취득 때 대기를 제외하고 최종 원장 감소 때도 입고 잔량을 지킨다.
- 동일 작업의 성공 재생은 원장 갱신을 다시 하지 않으므로 바뀐 잔량 때문에 실패시키지 않는다.
- `reason`, `sourceType`, DTO의 boolean 등으로 예외를 허용하지 않는다.

읽기 전용 SQL/가용성 helper를 `inventory/shared/availability/inbound-origin-availability.ts`에 둔다. core가 inbound 서비스나 procurement 서비스를 import하지 않게 한다. 기존 `BatchControlledStockGuard.getAvailability`는 이 helper의 pendingQty를 함께 반영한다. 출고 계획과 세션 취득은 이미 사용하는 가용성 포트를 통해 동일 규칙을 받는다.

### 4.3 커널에서 정상 작업을 통과시키는 방법

커널의 적치·취소·회송은 다음 순서를 따른다.

1. 기존 문서/라인 잠금과 선행 조건 검증.
2. 해당 SKU·창고의 stock availability lock 및 원위치 현재 상태 확인. 원래 pendingQty와 custody의 합을 실재고가 충족하지 못하면 감소 전에 거절한다.
3. 입고 누계를 먼저 변경하여 처리할 수량만 pendingQty에서 해제한다.
4. 기존 원장 이동/역분개를 수행한다. 공통 가드는 남아 있는 다른 입고의 물량도 보호한다.
5. 업무 로그·발주 정산·회차 상태 변경을 포함해 한 번에 커밋한다.

3번은 같은 트랜잭션의 미커밋 변경이다. 다른 트랜잭션은 이를 볼 수 없으며, 4번 이후 어떤 단계라도 실패하면 누계까지 롤백한다. 별도 우회 권한이나 가상 재고 출고를 만들지 않는다. 호출자가 오류를 잡아 부분 변경만 커밋하는 형태도 금지한다.

적치 완료 목적지는 같은 창고의 활성 일반 로케이션으로 제한한다. 원위치와 동일하거나 시스템 위치이면 완료 처리하지 않는다. 시스템 위치 사이의 재배치는 별도 업무가 필요하며 이번에 임의의 적치로 기록하지 않는다.

### 4.4 잠금 순서

기존 ADR-0039 순서(발주 헤더 → 발주 라인 → 입고 라인 → 입고 헤더의 NO KEY UPDATE)를 유지한다. 취소는 원 RECEIVE 이벤트를 잠근 뒤 stock availability lock을 취득한다. `reverseEvent`가 이벤트 → stock 순서이므로, 먼저 stock을 잡은 뒤 이벤트를 기다리는 역순을 만들지 않는다. 적치/회송은 기존 입고 잠금 다음 stock을 취득한다.

공통 재고 가드는 stock 잠금 아래 입고 잔량을 **일반 SELECT**로 읽으며 기존 입고 라인/헤더를 FOR UPDATE로 잠그지 않는다. 입고 누계/라인 변경 경로 전부가 같은 stock 잠금 안에서 실행되어야 한다. 가드가 stock → 입고 라인 순서로 잠그면 커널과 교착한다. 신규 입고의 원장 증가와 라인 생성도 현재처럼 같은 stock 잠금·트랜잭션 아래 수행한다.

별도 연결 두 개로 이동↔적치, 이동↔신규 입고, 취소↔역분개, 적치↔출고 세션 취득을 양방향 실행한다. 타임아웃만 늘려 통과시키지 않는다.

## 5. API 및 서버 조회 계약

### 5.1 공통 정책과 새 조회

`InboundReceiptStateReader`가 기존 입고내역의 취소 가능 판정과 새 적치 가능 판정을 공통으로 제공한다. 순수 정책은 별도 `inbound-receipt-policy.ts`에 둔다. 조회는 한 SQL 문 또는 REPEATABLE READ 스냅샷으로 누계·원장·custody를 일관되게 읽는다. 조회에서 문서/재고를 변경하거나 작업을 claim하지 않는다.

`GET /inbound/lines/:lineId/state?warehouseId=<uuid>`를 추가한다. `INVENTORY_SCOPE.OPERATE`와 기존 창고 범위 규칙을 적용하고, 조회한 라인·회차의 창고를 필수 비교한다. 취소 라인도 조회한다. 조회 실패를 미존재/취소로 추정하지 않는다.

```ts
type ReceiptActionBlockReason =
  | 'CANCELED'
  | 'ALREADY_PUTAWAY'
  | 'RETURN_EXISTS'
  | 'NOT_TODAY'
  | 'NOT_STAGING_ORIGIN'
  | 'ORIGIN_STOCK_INCONSISTENT'
  | 'MISSING_ORIGIN_OR_EVENT'
  | 'NOTHING_PENDING';
interface ReceiptLineState {
  lineId: string;
  receiptId: string;
  warehouseId: string;
  source: 'direct' | 'purchase_order';
  receiptStatus: 'posted' | 'voided';
  skuId: string;
  skuCode: string;
  skuName: string;
  originLocationId: string | null;
  originLocationCode: string | null;
  quantity: number;
  putawayFromOriginQty: number;
  canceledQty: number;
  returnedQty: number;
  pendingQty: number;
  canPutaway: boolean;
  putawayBlockReason: ReceiptActionBlockReason | null;
  canCancel: boolean;
  cancelBlockReason: ReceiptActionBlockReason | null;
}
```

`pendingQty`는 미처리 수량이며 원장 부족을 이유로 줄이지 않는다. 부족하면 작업 불가와 이유를 반환한다.

판정 우선순위는 다음과 같다. canCancel은 기존 당일 전량 취소 규칙을 유지한다. 조회 정책을 명령 검증으로 대신하지 않는다.

| 조건                                             | canPutaway / 이유                 | canCancel / 이유                  |
| ------------------------------------------------ | --------------------------------- | --------------------------------- |
| canceledQty > 0 또는 회차 voided                 | false / CANCELED                  | false / CANCELED                  |
| 원위치/원 RECEIVE 이벤트 누락 또는 잘못된 원위치 | false / MISSING_ORIGIN_OR_EVENT   | false / MISSING_ORIGIN_OR_EVENT   |
| 원장 < pending + custody 또는 잘못된 누계        | false / ORIGIN_STOCK_INCONSISTENT | false / ORIGIN_STOCK_INCONSISTENT |
| 일반 선반 직접입고                               | false / NOT_STAGING_ORIGIN        | 나머지 기존 취소 조건으로 판정    |
| 미처리 수량 0                                    | false / NOTHING_PENDING           | 나머지 기존 취소 조건으로 판정    |
| 적치 누계 > 0                                    | 잔량이 있으면 true                | false / ALREADY_PUTAWAY           |
| 회송 누계 > 0                                    | 잔량이 있으면 true                | false / RETURN_EXISTS             |
| 서울 기준 당일 아님                              | 잔량이 있으면 true                | false / NOT_TODAY                 |
| 위 조건 모두 통과                                | true / null                       | true / null                       |

취소 직전에는 해당 라인의 전량이 일반 반출 가능 수량과 해제할 입고 물량의 합 안에 드는지 검증한다. 동일 SKU의 다른 라인 대기나 custody를 소비하는 취소는 허용하지 않는다.

기존 `/inbound/receipts` 응답은 유지한다. 기존 cancelBlockReason enum은 mapper로 유지하면서 새 reader/policy로 판정을 모은다. 목록·상태 상세·명령에서 서로 다른 규칙을 구현하지 않는다. 명령은 잠근 시점에 재검증한다.

### 5.2 이동에서 적치로 연결하는 조회

기존 `GET /inbound/putaway/pending`에 선택적인 `originLocationId`를 추가한다. warehouseId·skuIds와 함께 SQL LIMIT 전에 적용하고 cursor scope에도 포함한다. 각 item에 `canPutaway`와 `putawayBlockReason`을 추가하며 기존 필드는 유지한다.

원장이 0인 미처리 행을 조용히 숨기지 않는다. 원장 join을 누락에도 대응하도록 바꾸고 `ORIGIN_STOCK_INCONSISTENT`로 표시한다. 재입고할 때만 과거 행이 되살아나는 표시를 없앤다. 기간/SKU/원위치 검색과 페이지 조회는 유지한다.

`GET /inventory/stocks/location/:locationId`의 item에는 `inboundPendingQty`와 `generallyMovableQty`를 추가한다. 기존 quantity는 바꾸지 않는다. stock-projection reader가 같은 공통 가용성 규칙으로 계산한다.

### 5.3 거절과 호환성

재고를 바꾸지 않고 롤백한 도메인 거절은 HTTP 409로 다음 코드를 반환한다.

- `INBOUND_ORIGIN_STOCK_PROTECTED`: “이 상품은 적치 대기 중이에요. 적치에서 처리해 주세요.”
- `INBOUND_ORIGIN_STOCK_INCONSISTENT`: “입고 기록과 현재 재고가 맞지 않아요. 입고내역과 실물을 확인해 주세요.”
- `INBOUND_PUTAWAY_DESTINATION_INVALID`: “같은 창고의 일반 로케이션을 선택해 주세요.”

warehouse-app과 admin-web의 영속 실행기는 이 세 코드만 확정 미반영으로 분류한다. 401/403/통신 단절/알 수 없는 409의 기존 미확인 판정은 넓히지 않는다. 원래 키로 결과를 확인하고, 수정한 새 의도에만 새 키를 발급한다. 서버가 거절 결과를 별도 보관하지 않는 기존 경로에서는 재확인 시 같은 원래 요청이 성공할 수도 있으므로, 확정 성공과 확정 거절을 모두 올바르게 종결한다.

`work-context.capabilities.inboundWorkflowConsistency = true`를 추가한다. 새 앱은 이 capability가 없는 서버에서 새 이동/입고 후속 작업을 열지 않고 업데이트 확인을 안내한다. 기존 미확인 요청은 원래 계약으로 결과를 확인한다. 구형 앱이 새 거절을 미확인으로 저장했더라도 업데이트 후 같은 키로 재확인해 해제되는지 검사한다.

## 6. 앱의 상태 소유와 동선

### 6.1 로컬과 서버의 분리

로컬은 미전송 입력·원래 키/본문·입고 lineId·선택값을 저장한다. 로컬 fresh와 과거 확정 응답만으로 현재 적치/취소 가능 여부를 결정하지 않는다.

새 `useReceiptLineState`와 `useReceiptReconciliation`을 공통으로 사용한다.

1. 초안·스캔 큐·작업 저장소를 복원한다.
2. 대상 라인과 관계된 미확인 변경을 원래 키로 확인한다. 결과를 모르면 신규 변경을 잠근다.
3. lineId로 현재 상태를 조회한다. 기존 PO 초안에 receiptId가 없어도 읽을 수 있다.
4. 응답 구조와 lineId/warehouseId/source를 검증하고 표시한다.

조회 중/실패/placeholder 응답에서는 변경 작업을 열지 않는다. 입력은 보존하고 명시적인 재확인을 제공한다. scope·lineId·warehouse 전환과 작업 알림마다 요청 세대를 갱신하여 오래된 응답을 버린다. 새 영속 상태 사본이나 영속 revision 컬럼은 만들지 않는다. 실행 직전에도 상태를 다시 읽고, 수량이 바뀌면 입력을 보존하면서 재확인을 요구한다. 최종 판정은 서버 명령이 담당한다.

QuickInboundScreen·PurchaseOrderReceiveScreen·PutawaySheet·InboundHistoryScreen이 공통 조회/복구 규칙을 사용한다. 목록의 모든 행에 N+1 요청을 보내지 않는다. 목록은 공통 서버 projection, 선택한 행만 상세 조회를 쓴다. 여러 staged 행을 가진 간편입고는 기존 회차 단위 조회를 유지하면서 같은 policy 결과를 받는다.

발주 취소는 기존 `/purchase-orders/receipt-lines/:id/cancel`, 직접입고 취소는 `/inbound/cancel`을 사용한다. 입고 커널에서 발주로 역호출하지 않는다.

### 6.2 이동 화면

일반 선반 간 이동은 유지한다. 일반 이동 상한은 `generallyMovableQty`, 입고 대기는 별도의 “적치하기” 동선으로 표시한다. 후보를 `warehouseId + originLocationId + skuId`로 조회한다.

- 후보가 하나여도 바로 전송하지 않는다. 입고 시각/잔량을 보여주고 선택 → 목적지/수량 → 적치 순서로 진행한다.
- 여러 후보는 페이지가 있는 선택 화면을 제공한다. FIFO로 임의의 입고 건을 소비하지 않는다.
- `/putaway`에 선택적인 `skuId`와 `originLocationId` search를 추가한다. 값을 검증하고 현재 선택 창고와 대조한다. 직접 링크/재개에서도 서버를 조회한다.
- 이동에서 넘어온 후보는 전체 기간으로 조회한다. 오래된 입고를 기본 1일 필터로 누락하지 않는다.
- `/movement/move` POST를 `/inbound/putaway`로 자동 재전송하지 않는다. 작업자가 선택한 새 적치 의도에 새 키를 발급한다.

### 6.3 과거 표시의 정정

발주 입고를 내역에서 취소 → 발주 화면 재개 시 “취소됨”을 표시하고 적치/재취소를 숨긴다. 다른 기기에서 적치한 경우도 서버의 현재 잔량을 표시한다. 닫기/다음 입고는 가능하게 하여 과거 배너가 새 입고를 막지 않게 한다. 조회 실패를 취소 성공이나 적치 완료로 간주하지 않는다.

## 7. 기존 데이터와 배포

읽기 전용 `scripts/inventory/audit-inbound-origin-consistency.ts`를 추가한다. 명시적인 DATABASE_URL·warehouseId·출력 파일을 필수로 받고 REPEATABLE READ READ ONLY 스냅샷에서 JSON을 출력한다. 접속 자격증명은 출력하지 않는다.

- bucket별 ON_HAND/pending/custody/free, 입고 line IDs/누계, 미처리 기간 중 일반 MOVE/조정/출고 후보 이벤트.
- 이유는 `INSUFFICIENT_ORIGIN`, `POSSIBLE_BYPASS`, `INVALID_RECEIPT`. event/line IDs를 근거로 남긴다.
- 수량이 맞더라도 과거 이동 후 보충됐을 가능성을 후보로 남긴다. 이벤트의 완전한 귀속을 보장하지 않는다.
- exit 0=후보 없음, 2=확인 필요, 1=조회/입력/출력 실패. 같은 SKU의 여러 입고 중 임의의 행을 골라 보정하지 않는다.

배포 순서:

1. 대상 창고의 감사 보고서를 만들고 후보를 입고/이동 이력 및 실물로 대사한다. 미해결 창고는 새 시험 운영에 포함하지 않는다.
2. 새 앱/admin-web을 배포 가능한 상태로 준비하고 기존 앱의 미확인 작업을 보존한다. 현장 신규 재고 변경을 멈춘 시간대에 Core 가드/조회 계약과 앱을 순차 전환한다.
3. 새 앱에서 capability, 과거 키 확인, 입고 → 적치 → 선반 간 이동 → 출고, 취소 → 재개를 확인한다.
4. 보고서 재조회와 당일 실물 대사 후 제한적으로 사용한다. 문제가 생기면 신규 변경을 멈추고 미확인 기록을 보존한다. 가드를 제거한 롤백을 정상 운영의 대안으로 삼지 않는다.

보정이 필요한 기존 데이터는 보고서의 증거에 근거한 별도의 검토된 작업으로 처리한다. 이번 구현 완료와 대상 창고의 운영 전환 완료는 구분한다.

## 8. 합격 기준과 회귀

| ID  | 합격 기준                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------ |
| A1  | 입고10 → 일반 이동6은 확정 거절. 원장/입고/이벤트/작업 로그 불변, 화면은 적치로 안내                                           |
| A2  | 적치6 후 원위치4·선반6·대기4. 선반 간 이동 후에도 대기4. 나머지 적치4 → 새 입고1이면 새 1개만 정상 대기                        |
| A3  | 같은 SKU의 여러 입고에서 선택한 라인만 누계 변경. 다른 라인의 대기를 소비하지 않음                                             |
| A4  | 취소/회송의 원장과 누계 원자성. 원장·로그·발주 정산 실패 시 전체 rollback                                                      |
| A5  | MOVE/감소 조정/실사 감소/이송 발송/SHIP/RECEIVE 역분개/상태 변경/직접 StockEventStore 호출에도 보호 적용                       |
| A6  | 원장12·입고 대기10이면 자유2만 이동 가능. 일반 선반 직접입고·입고와 무관한 회수 재고 일괄 금지 없음                            |
| A7  | 출고 계획/세션 취득에서 대기 제외, 적치 후 사용 가능. 기존 custody와 이중 배정 없음                                            |
| A8  | 네 종류의 DB 경합을 독립 연결·양쪽 시작 순서로 검증, 교착/과다 감소/중복 처리 없음                                             |
| A9  | 발주 취소 → 재개와 다른 기기 적치 → 재개가 현재 상태를 반영. 기존 초안도 복구 가능                                             |
| A10 | 응답 유실·늦은 GET 역전·401/403·알 수 없는409·저장소 실패에서 잘못된 잠금 해제 없음. 새 거절 세 코드로 영구 미확인이 되지 않음 |
| A11 | 201건 초과 후보·오래된 입고·원위치별 cursor·다른 창고·권한·구형 서버 검사                                                      |
| A12 | 기존 불일치를 이유와 함께 표시하고 실물1을 대기11로 실행시키지 않음. 감사 DB 변경0·자동 추정 보정 없음                         |

계획은 각 ID를 구현 작업에 연결한다. Windows/PDA HID와 네이티브 재시작은 실기기로 확인하고, 기기를 사용할 수 없으면 미검증으로 남긴다.

## 9. 참조

- `docs/adr/0039-document-owns-receipt-settlement-kernel-does-arrival.md`
- `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.ts`
- `apps/core/src/modules/inventory/inbound/services/inbound-putaway.reader.ts`
- `apps/core/src/modules/inventory/core/repositories/stock-event.store.ts`
- `apps/core/src/modules/inventory/core/services/batch-controlled-stock.guard.ts`
- `native/warehouse-app/src/domains/inbound/PurchaseOrderReceiveScreen.tsx`
- `native/warehouse-app/docs/inventory-accuracy-acceptance.md`
