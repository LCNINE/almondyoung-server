# 배치에 든 상자로 합포장을 시작하는 화면 (#1182)

## 배경

고객이 CS 로 추가 주문을 넣었는데, 기존 주문의 상자가 이미 배치에 들어가 검수 중일 때가 있다. 이때 두 주문을 한 상자로 보내려면 지금은 `POST /consolidations` 를 직접 불러야 한다.

어드민 합포장 화면(`/order/consolidation`)이 `findCandidates` 결과만 보여 주는데, 이 목록은 draft 이면서 막힘이 없는 상자만 담는다. 배치에 든 상자는 송장·작업 항목·검수 수량 때문에 빠진다.

서버의 나머지는 이미 동작한다.

- 막힘이 있는 상자로 합포장을 요청하면 바로 합치지 않고 `CONSOLIDATION_PENDING` 으로 대기한다(`deferConsolidation`).
- 막힘이 풀리면 재개된다. 배치에서 완전히 빠질 때 한 번 시도하고, 그 뒤로는 리컨실러 `resume-pending-consolidation` 이 확인한다. 리컨실러 잡은 매분 돌지만 할 일이 없던 상자는 `IDLE_RECHECK_MIN`(10분) 뒤에 다시 보므로, 송장 취소 뒤 합쳐지기까지 최대 10분쯤 걸린다(`order-reconcile.state.ts`).
- `planned` 원본도 `draft` 로 되돌리지 않고 그대로 합쳐진다. 활성화의 편집 허용 상태가 `draft`·`planned`·`recovery_required` 이고(`shipment-manifest-edit.ts`), 예약은 `retargetConfirmed` 로 옮긴다. `planned → pending → completed` 통합 테스트가 이미 있다(`consolidation.integration.spec.ts`).
- 배치에서 뺀 상자의 담아 둔 상품을 되돌림 바구니로 꺼내면 `inspectedQty` 가 줄고, 되돌림 바구니 보관은 원본 라인에 묶이지 않아 `CUSTODY_REQUIRES_UNPICK` 이 풀린다. 송장은 `registered` 로 남아 일반 무효화가 된다.

## 시안

- 어드민 웹과 창고 스테이션: https://claude.ai/artifact/Nku8dDoB2qKgWMk8rEnSja
  - 왼쪽 프레임: 어드민 웹, 출고주문 상세에서 합포장
  - 오른쪽 프레임: 창고 스테이션 F2 배치 현황 → F1 상품 꺼내기 (후속 이슈 범위)

## 범위

이 문서가 구현하는 것은 어드민 웹이다. 서버는 읽기 라우트 두 개만 더한다. 상자 상태를 바꾸는 서버 로직은 건드리지 않는다. 주문·출고 커널이 재작성될 예정이라 쓰기 경로를 늘리지 않는다.

범위 밖:

- 대기 중인 합포장 취소. 서버에 그런 경로가 없다(`CONSOLIDATION_PENDING` 에서 `draft` 로 가는 전환이 없다). 화면은 요청 전에 "취소할 수 없어요"를 알린다.
- 수동 재개 버튼. 리컨실러가 매분 시도하고, 포기하면 정체 보드에 잡힌다.
- 창고 전체 목록에서 막힌 상자까지 훑는 화면(기존 합포장 화면에 토글). 어디까지 진행된 상자를 후보로 보일지 운영 정책부터 정해야 한다.
- 직배(입점사) 상자.
- 창고 앱 변경. 아래 "후속: 창고 스테이션" 절에 적고 별도 이슈로 둔다.

## 어드민 흐름

### 진입

출고주문 상세 → 운영 액션 → 배송 탭의 상자 동작 줄(`ShipmentActions`)에 **합포장** 버튼을 둔다. 다른 동작과 같은 `size="sm" variant="outline"` 이다.

- 보이는 조건: 상자가 창고 출고 상자이고, 상태가 `draft`·`planned` 이거나 그 밖의 합칠 수 있는 상태다(`TERMINAL_OR_UNSAFE_SOURCE_STATUSES` 와 다른 복구 중인 상자는 빼기). 권한은 아래 "권한" 절.
- 권한이 없으면 버튼을 숨긴다. 역할 이름으로 판정하지 않는다.

### 권한

서버 `consolidate` 는 상황에 따라 권한을 더 요구한다(`consolidation.service.ts` 의 `requirePermission` 호출).

| 상황 | 필요한 권한 |
|---|---|
| 항상 | `fulfillment.shipment.consolidate` |
| 원본 중 하나라도 `draft` 가 아니거나 막힘이 있음 (배치에 든 상자는 늘 해당) | + `fulfillment.shipment.reopen` |
| 합친 상자의 수령인이 원본 중 하나와 다름 (배송 메모만 달라도 해당. 원본 메모 중 하나를 골라도 다른 원본과는 다르다) | + `fulfillment.shipment.override_recipient` |
| 후보·진행 조회 | `fulfillment.shipment.read` (출고주문 상세 진입 권한 `fulfillment.order.read` 와 다르다) |

- 기준 상자가 `draft` 가 아니면 합포장 버튼은 `consolidate` 와 `reopen` 이 둘 다 있을 때만 보인다.
- `override_recipient` 가 없으면 1단계에서 배송 메모가 다른 주문을 고를 수 없게 하고 "배송 메모가 달라 합치려면 수령인 변경 권한이 필요해요"라고 쓴다.
- 기존 훅 `useCreateShipmentConsolidation` 은 `consolidate` 만 선언한다. 화면은 이 훅의 권한에 더해 위 조건을 `PermissionCheckpoints` 류의 판정으로 함께 본다. 서버가 최종 판정자이고, 화면은 눌러 봐야 403 이 나는 버튼을 미리 숨기는 역할이다.
- 이 권한들은 처음 등록할 때 admin 과 물류 매니저에게만 부여된다(`permission-catalog.ts`). CS 업무 계정에 줄지는 역할 관리의 일이라 범위 밖이다.

### 1단계: 같이 보낼 주문 고르기 (Sheet)

- 맨 위에 **지금 보고 있는 주문** 카드를 둔다. 주문번호, 고객, 상품, 배송지, 배송 메모, 진행 상태(예: 창고에서 검수 중)를 보여 준다.
- 그 아래에 같은 고객의 다른 상자를 주문 카드로 나열한다. 카드 전체가 체크박스다.
- 카드마다 배송지와 배송 메모를 보여 주고, 기준 주문과 비교해 "(같음)"/"(다름)"을 붙인다.
- 분류:
  - **고를 수 있음**: 같은 창고, 같은 배송 프로필, 같은 고객, 창고 출고 상자, 합칠 수 있는 상태, **배송지(배송 메모 제외)가 같음**.
    - 배송 메모만 다르면 고를 수 있다. 메모는 2단계에서 고른다.
  - **고를 수 없음**: 배송지가 다르다. 회색, 비활성. 이유를 한 줄로 쓴다.
- 서버의 호환성 검사(`assertCompatibleSources`)는 수령인을 막지 않는다. 다르면 `override_recipient` 권한을 요구할 뿐이다. 배송지가 다른 주문을 막는 건 화면의 운영 판단이다. 주소가 다르면 고객이 따로 받으려는 뜻일 가능성이 크다.
- 비교 기준: `canonicalConsolidationRecipient` 는 이름·전화·주소·메모를 모두 본다. 1단계의 "배송지"는 이름·전화·우편번호·도로명·상세주소, "배송 메모"는 `deliveryNote` 로 나눠 비교한다. 수령인 정보가 불완전한 상자(정규화 결과 null)와 고객을 식별할 수 없는 상자(`customerKey` null)는 목록에서 빼지 않고 "정보가 부족해 합칠 수 없어요"로 보여 준다.
- 이 단계에서는 아무것도 저장하지 않는다.

### 2단계: 확인하고 요청

- 합쳐질 주문과 결과(상자 1개, 송장 1장)를 보여 준다.
- 기준 상자가 이미 배치에 들어가 있으면 요청 뒤의 순서를 미리 보여 준다: 배치에서 빼기(나) → 담아 둔 상품 꺼내기(창고) → 운송장 취소(나) → 자동으로 합치기.
- **요청하면 취소할 수 없다**는 것과, 합쳐질 때까지 기준 주문이 출고되지 않는다는 것을 알린다.
- 배송 메모가 다른 주문을 골랐으면 **합친 상자에 붙일 배송 메모**를 고른다: 기준 주문의 메모 / 각 주문의 메모. 원래 주문들의 메모는 바뀌지 않는다.
  - 고른 메모의 원본 상자를 `recipientSourceShipmentId` 로 보낸다. 브라우저가 수령인 원문을 만들지 않는다.
  - 시안에 있던 **직접 입력은 뺀다.** 직접 입력은 `recipientSnapshot` 을 브라우저가 만들어야 하는데, 응답의 수령인이 PII 마스킹으로 가려져 있으면(권한 부족이나 열람 기록 실패) 가린 주소가 그대로 저장된다. 필요해지면 서버 DTO 에 메모만 덮어쓰는 필드를 더하는 방식으로 따로 다룬다.
- 작업 사유 필수.
- 요청: 기존 `POST /consolidations`. 멱등키는 기존 합포장 화면(`features/order/consolidation`)이 쓰는 방식을 그대로 따른다.

### 요청 뒤: 진행 패널

배송 탭 맨 위에 **합포장 진행 중** 패널을 둔다. 진행 표시 네 칸과, 그 아래 **지금 할 일** 하나만 크게 보여 준다.

| 칸 | 담당 | 지금 할 일일 때 |
|---|---|---|
| 배치에서 빼기 | 나 | [배치에서 빼기] 버튼. 기존 `DELETE /outbound-batches/:batchId/shipments/:shipmentId` |
| 상품 꺼내기 | 창고 | 기다리는 중. 창고에 전할 문구와 복사 버튼 |
| 운송장 취소 | 나 | [운송장 취소] 버튼. 기존 `POST /waybills/:waybillId/void` |
| 자동으로 합치기 | 자동 | "10분 안에 자동으로 합쳐져요" |

- 운송장 취소는 배치에서 완전히 빠진 뒤에만 켠다. 서버는 배치에 든 상자의 송장 무효화도 받지만, 창고가 그 송장으로 작업 중일 때 무효화하면 현장이 꼬인다.
- 운송장 취소 버튼은 송장이 `registered` 일 때만 보인다. `ACTIVE_INVOICE` 는 `pending`·`allocated`·`used` 도 포함하는데, 이 상태는 일반 무효화가 거절한다.
- 버튼은 각각의 권한(`fulfillment.warehouse.operate`, `fulfillment.shipment.reopen`)으로만 판정하고, 없으면 숨긴다.
- **원본이 여럿이면 원본마다 진행을 따로 센다.** 추가 주문 상자도 배치나 송장을 가질 수 있다. 칸은 원본 전체 중 가장 뒤처진 단계를 보이고, 지금 할 일 아래에 어느 상자의 일인지 송장번호로 적는다.
- **정상 경로 밖의 상태**는 칸에 끼워 맞추지 않고 "이 화면에서 처리할 수 없는 상태예요" + 이유 + 정체 보드 링크로 보여 준다.
  - `DISPATCH_ATTEMPT_EXISTS`(발송 시도가 있음. 배치 빼기도 거절될 수 있다)
  - 송장이 `registered` 가 아닌 `ACTIVE_INVOICE`
  - 작업 항목이 `short_pick_recovery`(결품 처리 중. 일반 빼기로 안 된다)
  - 막힘은 없는데 재개가 안 되는 경우(원본 버전이 바뀜, 정비 모드, 다른 원본 주문의 판정이 막음)
- 리컨실러가 포기했으면 "자동으로 합쳐지지 않았어요"와 정체 보드 링크를 보여 준다. 포기는 원본별 `resume-pending-consolidation` 규칙의 `gaveUpAt` 으로 본다.
- 합쳐지면 초록 패널과 **새 상자로 가기**를 보여 준다. 기존 상자는 `superseded` 로 흐리게 남는다.

## 서버: 읽기 라우트 두 개

둘 다 `apps/core` fulfillment 의 consolidation 컨트롤러에 둔다. 상태를 바꾸지 않는다.

### `GET /shipments/:shipmentId/consolidation-options`

기준 상자와 같은 고객의 다른 상자를 분류해 돌려준다.

- 응답(초안): `source`(기준 상자 요약·수령인·진행 단계), `options[]`(상자 요약, 수령인, `selectable`, `reason`: `ok` | `memo_differs` | `address_differs`, 버전들).
- 분류는 서비스 안의 순수 함수로 두고 단위 테스트한다. 고객 판정은 기존 `customerKey`, 주소 비교는 `canonicalConsolidationRecipient` 에서 `deliveryNote` 를 뺀 값으로 한다.
- 수령인(이름·연락처·주소)을 응답하므로 `@PiiResponse` 가 필요하다. 기존 `consolidation-candidates` 처럼 `OPEN_WITH_RECIPIENT` 를 쓰면 `pii-routes.ts` 의 `PII_ROUTES` 와 `PII_RECIPIENT_ROUTES` 둘 다에 올린다(`pii-routes.spec.ts`).
  - 가릴 필드와 대상 식별자 경로는 이 응답 모양(`source.*`, `options[].*`)에 맞춰 새로 쓴다. 기존 후보의 `subjects: '[].shipmentId'` 를 복사하지 않는다(기존 응답은 그룹 아래 `shipments[]` 라 맞지 않는다).
- 권한: `@RequirePermission('fulfillment.shipment.read')`.
- 제외 사유도 `reason` 에 담는다: `ok`, `memo_differs`, `address_differs`, `incomplete_recipient`, `unknown_customer`. 다른 창고·다른 배송 프로필·직배·종료·다른 복구 중인 상자는 목록에 넣지 않는다.

### `GET /shipments/:shipmentId/consolidation-progress`

이 상자가 원본인 합포장의 진행 상태를 돌려준다. 대기 중이든 끝났든 같은 라우트가 답한다.

- 대기 중: 기존 `findPendingOperationIdForSource` + `resumeReadiness` 를 쓴다. 리컨실러가 이미 쓰는 메서드다.
- **끝난 뒤**: 두 메서드는 pending 만 찾으므로, 이 상자가 `source` 멤버인 가장 최근 `consolidate` 작업을 상태와 무관하게 찾는 조회를 서비스에 더한다. 완료면 `targetShipmentId` 를 돌려줘 새로고침 뒤에도 "합쳐졌어요" 패널과 새 상자 링크를 복원한다. 합쳐진 원본은 `superseded` 라 상자 화면을 다시 열 수 있다.
- 응답(초안): `operationId`, `status`(`pending`·`completed`), `sources[]`(원본별 `shipmentId`, `trackingNo`, `batchId`, 작업 항목 상태, 송장 id·상태, `blockers`, `gaveUpAt`, 다음 재확인 시각), 완료 시 `targetShipmentId`.
- **수령인을 담지 않는다.** id·상태·송장번호만 돌려주므로 PII 선언이 필요 없다. 기존 manifest·완료 응답을 그대로 돌려주면 `recipientSnapshot` 이 섞이니 DTO 를 따로 둔다.
- 진행 칸 매핑은 화면의 순수 함수로 둔다(원본별로 계산한 뒤 가장 뒤처진 것):
  - `ACTIVE_WORK_ITEM` 이고 작업 항목이 `withdrawing` 이 아니면 1칸
  - 작업 항목이 `withdrawing` 이거나 `CUSTODY_REQUIRES_UNPICK` 이면 2칸
  - `ACTIVE_INVOICE` 만 남고 송장이 `registered` 면 3칸
  - 막힘이 없으면 4칸
  - 그 밖(위 "정상 경로 밖의 상태")은 예외 표시
- 권한: `fulfillment.shipment.read`.

## 어드민 게이트

- 새 뮤테이션 훅을 만들지 않는다. 합포장·배치 빼기·운송장 무효화는 기존 훅(`useCreateShipmentConsolidation`, `useExcludeShipmentFromBatch`, `useVoidWaybill`)을 쓰고, 화면은 `run={useX}` 로 판정한다(`mutation-guard.gate.spec.ts`). 합포장 버튼은 위 "권한" 절의 추가 조건도 함께 본다.
- 새 페이지가 아니라 기존 출고주문 상세 안의 Sheet 라 `screen-access.ts` 추가는 없다. 다만 `/order/fulfillments` 의 PII 화면 선언(`pii-screens.ts`)과 새 조회가 맞는지 확인한다.
- 새 라우트 둘은 기존 권한을 쓰는 GET 이라 `route-classification.spec.ts` 의 예외 등록이 필요 없다.
- Core 만 부르므로 `medusa-permissions.ts` 추가는 없다.

## 테스트

- core: 후보 분류 순수 함수 단위 테스트(같음 / 메모만 다름 / 주소 다름 / 수령인 불완전 / 고객 식별 불가 / 다른 프로필 / 종료 상태).
- core: 두 라우트의 라우트 분류·PII 스펙.
- core 통합(`describeIfDb`): `planned` + 검수 수량 있음 → 합포장 요청(pending) → 배치 제외 → 되돌림 바구니로 꺼냄 → 송장 무효화 → 리컨실러 재개 → completed. 그 뒤 진행 조회가 `completed` 와 `targetShipmentId` 를 돌려주는지. `reopen`·`override_recipient` 가 없을 때 403 인지.
- admin-web: 진행 칸 매핑 순수 함수 단위 테스트(원본 여럿, 예외 상태 포함). 메모 선택이 늘 `recipientSourceShipmentId` 만 보내는지.
- 수동: #1181 4번 묶음을 이 화면으로 끝까지.

## 후속: 창고 스테이션 (별도 이슈)

시안 오른쪽 프레임. 지금 스테이션 코드에 세 가지만 더한다.

1. **F2 배치 현황**: 오른쪽 상세의 박스 목록 위에 **지금 할 일** 상자를 두고, 꺼내야 할 박스를 목록에서 떼어 문장과 버튼(상품 꺼내러 가기)으로 보여 준다. 칸 이름 "빠지는 중"은 "할 일"로 바꾼다.
2. 그 버튼을 누르면 F1 에 그 박스의 꺼내기 화면(`WithdrawWork`)이 바로 열린다. 지금은 송장을 찾아 F1 에서 스캔해야 한다.
3. F1 꺼내기 화면에 합포장 안내("합포장 때문에 빠지는 박스예요")를 붙이고, 끝나면 "이 박스에서 할 일은 끝이에요."를 보여 준다.
   - 시안의 "합친 상자는 새 송장으로 다시 검수 목록에 올라와요"는 빼거나 고친다. 합쳐진 새 상자는 `draft` 로 생기고, 계획 확정·송장 발급·배치 넣기는 사람이 한다. 자동으로 올라온다고 약속할 근거가 없다.

근거 데이터는 이미 있다: 배치 작업 항목의 `waitingOperationId`, `exclusionReason`(`outbound-batch-v2.dto.ts`). 지금 송장 조회 응답(`shipment-waybill.reader.ts`)과 배치 송장 상태 응답에는 합포장 여부가 없어 필드를 더해야 한다. 알림(푸시)은 하지 않는다.
