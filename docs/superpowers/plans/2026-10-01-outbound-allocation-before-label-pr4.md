# PR 4 — 결품 재배정 (#990) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 결품이 나면 다른 로케이션의 일반 가용재고로 그 자리에서 다시 채운다. 박스는 배치에 남고, 송장은 바뀐 로케이션을 찍은 새 판으로 재출력된다. 채우지 못하면 박스는 배치에서 빠진다. 이미 집은 물건은 되돌림 바구니로 빼고, 다 빠지는 순간 예약·송장을 정리하며 박스는 초안으로 돌아간다.

**Architecture:** 결품 보고는 한 트랜잭션이다. 흐름은 이렇다.

1. 로케이션 L 의 **안 집은 몫**(`AT_SOURCE`) k 개를 부족 승인(`APPROVE_SHORTAGE`)하고, 같은 트랜잭션에서 L 의 배정을 −k 한다. 이벤트에는 배정 id 를 싣는다.
2. `reconcileAllocation`(목표 = 줄 수량 그대로)으로 **L 을 뺀** 로케이션들의 일반 가용에서 k 를 다시 채우고 인계(`HAND_IN`)한다.
3. 채우면 박스·송장·예약은 그대로다. 지문이 바뀌어 I5 게이트가 재출력 전까지 막는다.
4. 못 채우면 PR 3 의 이탈(`BoxWithdrawalService.begin`, `exit_to = draft`)을 시작한다. 작업 항목은 결품 오퍼레이션을 기다린다.
5. 배정 합이 0 이 되는 트랜잭션에서 나가기(`exitIfDrained`)가 결품을 마무리한다. 부족분 예약을 무효화하고, 송장을 로컬 무효화하고, 박스를 `draft` 로 돌린다.
6. 그 송장 번호를 다시 스캔하면 `withdrawn` 이다.

옛 경로는 모두 사라진다: 격리(`short_pick_recovery`), 비동기 재개(`resumePending`), 결품 반환(`RETURN_TO_SOURCE`).

**Tech Stack:** NestJS 11 · Drizzle ORM(postgres.js) · Jest(core·admin-web) · warehouse-app(React 19 + Vitest, Tauri — 이 PR 에서 코드 변경 없음)

**Spec:** `docs/superpowers/specs/2026-09-30-outbound-allocation-before-label-design.md` — §1~§5 공통, §8(PR 2·3 이 정한 것 포함)·§9·§10.5·§11·§12·§13·§14·§15 PR 4 절, 그리고 이 계획이 스펙 본문에 더한 «PR 4 계획이 정함». S1 스펙 `2026-09-29-outbound-live-allocation-design.md` §5.5 가 결품의 원래 설계이고, §12-3(«`approveShortage` 의 원장 처리» 확인)의 답이 아래 정한 것 2 다. 실행자는 이 계획과 두 스펙을 **함께** 읽는다.

**트래킹:** #986 / 이 PR: #990. 선행: PR 1 #992(develop `835b53b54`), PR 2 #1001(`1beebf45a`), PR 3 #1004(`42cee3098`). 참고 계획: `docs/superpowers/plans/2026-10-01-outbound-allocation-before-label-pr3.md`(이탈·되돌림·테스트 배선의 선례).

## Global Constraints

- **PR 3 이 배포돼 있어야 시작한다**(#990 시작 조건) — 2026-10-01 사용자 확인: PR 3 배포됨.
- **core 와 admin-web 을 이 PR 하나에서 바꾸고 함께 배포한다. warehouse-app 은 바꾸지 않는다**(정한 것 12). 스펙 §15 의 «core 와 warehouse-app 을 함께» 에 대한 예외이고, 이유는 결품 보고가 admin-web 에만 있다는 것이다(사용자 결정 2026-10-01).
- **스키마 변경 없음 — 마이그레이션 0.** 세션 이벤트 `event_type` 은 varchar 이고, `short_pick_recovery` 상태 값 제거는 contract(§11)다. 그래서 배포 순서는 `sst deploy`(core + admin-web) 하나다. 배포 전 확인 쿼리는 Task 10 에 있다.
- 서비스 계층의 fulfillment HTTP 오류는 `ConflictException({ code, message })` 로 낸다. 목록이 필요하면 `errors` 를 쓴다(전역 필터가 본문에 그대로 싣는다). waybill 오류는 `ConflictError('<CODE>: …')` 처럼 메시지 접두어로 낸다.
- 트랜잭션: 공개 메서드는 마지막 인자로 `tx?: DbTx` 를 받고 `this.dbService.run(fn, tx)` 로 돈다. private 헬퍼는 `trx: DbTx` 를 필수로 받는다(ADR-0025). `db.query.*`·`with` 는 쓰지 않는다. `any` 도 쓰지 않는다. 근거 없는 `as` 도 쓰지 않는다(테스트 배선의 `as never` 스텁은 기존 관례라 허용).
- **잠금 순서**(스펙 §13 + PR 2·3 이 정한 전역 순서): 구성요소(불변식 검사기 `assertFulfillmentOrders`) → 박스·줄 → 작업 항목 → **세션 → 보관 행** → SKU 가용 잠금 → 재고 원장. 이 계획의 새 경로는 둘이다.
  - **결품 보고:** 구성요소 → 박스·줄(`FOR UPDATE`) → 작업 항목 → 세션·보관(`lockOpenSession`) → 배정 행(`planShortages`) → 결품 오퍼레이션·멤버 INSERT(새 행이라 다투는 쪽이 없다. 멤버 FK 의 암묵 `KEY SHARE` 는 이미 `FOR UPDATE` 로 쥔 박스에 걸린다) → 부족 승인 → SKU 가용 잠금·원장(`lockSkuCapacities`, 재배정). 못 채우면 이어서 이탈이 돈다: `begin` 의 반납 → `exitIfDrained`.
  - **결품 마무리**(나가기 안): 이미 쥔 구성요소·작업 항목·세션 **뒤에** 결품 오퍼레이션 행을 잡고, 예약 그래프 → SKU 가용 잠금(`invalidateForShortPick`) → 송장 → 박스 순으로 간다. 세션 변경(`mutate`)은 «결품 오퍼레이션 → 세션» 순이다. 그런데 그 순서로 잡는 곳은 오퍼레이션을 만든 보고 트랜잭션뿐이고, 보고가 커밋된 뒤에는 그 오퍼레이션으로 새 세션 이벤트를 쓰지 않는다. 마무리와 전체 취소의 넘겨받기(정한 것 7)는 둘 다 작업 항목 잠금에서 줄을 선다.
- 게이트:
  - `npm run type-check` 에러 0
  - `npx jest --maxWorkers=2` 실패 0(OOM 회피)
  - `npx jest scripts/security` — IDOR 가드는 서비스 파일의 줄번호를 좌표로 쓴다. 빨가면 가드가 알려 주는 대로 좌표를 갱신한다.
  - admin-web: `npm run test:admin-web`, `cd apps/admin-web && npx tsc --noEmit`(루트 type-check 는 admin-web 을 보지 않는다)
  - warehouse-app: `cd native/warehouse-app && npx tsc -b && npx vitest run`(변경 없음 확인용)
- 통합 스펙은 `describeIfDb` 가드를 쓰고, 스펙 안에서 `dotenv.config()` 를 부르지 않는다.
  - 실행: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <패턴>`(`--runInBand` 고정)
  - 로컬 `core` DB 가 다른 브랜치 마이그 잔재로 멈추면 **새 DB** 를 만든다:
    1. `docker compose exec -T postgres createdb -U postgres core_990`
    2. `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_990 npx drizzle-kit migrate --config apps/core/drizzle.config.ts`
    3. `DATABASE_URL=…/core_990 npx jest --testPathPattern=<패턴> --runInBand`
- 작업자 문구는 «라벨»이 아니라 **«송장»** 이다. admin-web 문구도 같다.
- 코드 좌표는 함수·파일 이름으로 적는다. 줄 번호로 찾지 말 것.
- **코드 블록은 설계를 담은 초안이다.** 이름·시그니처·오류 코드·잠금 순서·트랜잭션 경계는 그대로 지킨다. 타입 에러나 import 경로 같은 기계적 차이는 주변 코드에 맞춰 고친다. 설계가 코드와 맞지 않으면 멈추고 컨트롤러에 알린다(스펙 반영이 필요할 수 있다).
- **이 계획이 정한 것** — 스펙 본문에 «PR 4 계획이 정함» 으로 이미 반영했다(이 계획과 같은 커밋). 1·2·3·12 는 사용자 결정(2026-10-01)이다. 구현하며 바뀌면 Task 10 이 «PR 4 구현이 정함» 으로 고친다.
  1. **결품 = 안 집은 몫**(사용자 결정). «L 에서 k 개 모자람» 은 L 선반에 아직 남은(집지 않은) 몫에서 k 를 뺀다는 뜻이다.
     - 부족 승인은 `AT_SOURCE`(줄 없음)에서만 한다.
     - k 의 상한은 두 값의 작은 쪽이다: 그 줄·L 의 «배정 − 줄 귀속 보관», 그리고 L 의 `AT_SOURCE` 에서 같은 보고의 다른 줄 몫을 뺀 것. 넘으면 `SHORT_PICK_EXCEEDS_UNPICKED`(`errors`: 줄·로케이션·요청·가능 수량)로 거절하고 아무것도 바꾸지 않는다.
     - 이미 집은 물건의 파손은 결품이 아니다. 범위 밖이고, 지금은 박스 빼기로 처리한다.
     - 그래서 결품 보고는 작업 항목이 `queued`·`picking` 일 때만 받는다. 포장 단계로 되돌리는 `reconcileStage` 는 늘어날 때(S2)의 일이다.
  2. **원장은 건드리지 않는다**(사용자 결정 — 스펙 §9·S1 §5.5 «원장 처리는 지금과 같다», S1 §12-3 의 확인 결과).
     - 부족 승인은 세션 통제만 푼다. L 의 `ON_HAND` 는 그대로라 없는 k 개가 L 의 일반 가용으로 되살아난다(유령 재고).
     - 그래서 **재배정 후보에서 이번 보고의 (SKU, 로케이션)을 뺀다.**
     - E12 의 «창고 가용이 음수가 될 수 있다» 는 일어나지 않는다. 대신 다음 시작·합류가 L 의 유령 재고를 배정받으면 결품이 또 난다(지금도 같다). 스펙 E12·§16 을 사실대로 고쳤고, 원장 반영은 후속 이슈다(Task 10).
  3. **못 채움 → 나갈 때 결품 마무리**(사용자 결정). 전제: planned 박스는 확정 예약이 줄 수량과 같아야 한다(불변식 `CONFIRMED_RESERVATION`). 그래서 부족분 예약을 무효화하면 박스는 `draft` 로 가야 하고, 그러면 옛 manifest 의 송장도 무효화해야 한다(`ACTIVE_INVOICE_VERSION`). 그런데 집은 물건을 빼는 «뺄 상품» 화면은 송장 스캔으로 열린다.
     - 그래서 이렇게 한다: 보고 트랜잭션은 부족 승인 → 집지 않은 몫 반납 → `withdrawing`(`exit_to = draft`, `waiting_operation_id` = 결품 오퍼레이션)까지 한다.
     - 빼는 동안 박스는 `planned` 이고 송장·예약은 그대로다. 송장을 스캔하면 `withdrawing`(뺄 상품)이다.
     - **배정 합이 0 이 되는 트랜잭션**(집은 게 없으면 보고 트랜잭션)에서 결품을 마무리한다: 부족분 예약 무효화(`invalidateForShortPick`), 활성 송장 로컬 무효화, 박스 `draft`(manifest +1, `planned_at` null), 줄 `inspected_qty` 0·`line_version` +1, 결품 오퍼레이션 `completed`.
     - 송장이 `registered` 가 아니어서 무효화할 수 없으면 두 곳에서 거절한다. 보고 때 못 채움이면 `SHORT_PICK_INVOICE_NOT_VOIDABLE`(기존 코드)로 먼저 거절하고, 마지막 되돌림 때는 `WITHDRAWAL_WAYBILL_NOT_VOIDABLE`(PR 3 코드)로 거절한다.
  4. **나간 뒤 옛 송장 스캔은 `withdrawn`**(사용자 결정 — «빠진 박스예요. 송장은 버려 주세요.»).
     - by-waybill 의 무효 송장 폴백을 넓힌다. 그 번호의 최근 무효 송장이 결품 마무리로 무효화된 것이면(결품 오퍼레이션 after 스냅샷의 `voidedWaybillId`) `withdrawn`, `exitTo = 'draft'`, `batchId`·`workItemId` 는 `null` 이다.
     - 박스가 그 뒤 다시 계획돼 새 송장을 받아도 옛 번호는 `withdrawn` 이다.
  5. **재배정.** 목표는 줄 수량 그대로다. 규칙은 `reconcileAllocation` → `allocateLines`(E8)이고, 후보는 `lockSkuCapacities` 의 일반 가용에서 정한 것 2 의 (SKU, 로케이션)을 뺀 것이다.
     - 전부 아니면 전무다. 한 줄이라도 못 채우면 채우지 않고 이탈한다.
     - 채울 로케이션에 이 작업 항목의 배정 행이 이미 있으면 그 행을 늘린다. 행의 `source_stock_version` 은 그대로 둔다 — 복구가 인계 이벤트와 행의 버전을 견주기 때문이다. 없으면 행을 만든다.
     - 인계 키는 `hand-in:<명령 id>:<배정 id>` 다(합류와 같다).
  6. **채움의 결과:** 박스·작업 항목(상태·claim·리스)·송장·예약을 건드리지 않는다. 결품 오퍼레이션은 그 트랜잭션에서 `completed` 다. 송장 내용 지문이 바뀌어 I5 가 재출력 전까지 전진 명령을 막는다. 현장 흐름은 PR 1 의 재출력 화면 그대로다.
  7. **전체 취소(E10)가 결품으로 빼는 중인 박스에 오면 넘겨받는다.** 결품 오퍼레이션을 `completed`(after `{ supersededByOperationId }`)로 닫고, 작업 항목이 취소 오퍼레이션을 기다리게 바꾸고 `exit_to` 를 `canceled` 로 올린다. 부족분 예약은 무효화하지 않는다 — 취소 완료가 전부 푼다. 부분 취소(E11)는 기존 `CANCELLATION_WORK_ITEM_ALREADY_WAITING` 거절 그대로다.
  8. **세션 이벤트:**
     - 부족 승인 멱등 키는 `shortage:<결품 오퍼레이션 id>:<배정 id>` 다.
     - payload 는 기존 필드(`shortPickOperationId`·`shipmentLineId`·`sourceLocationId`·`reasonCode`·`reason`·`approverId`)에 **`workItemId`·`allocationId`** 를 더한다.
     - `RETURN_TO_SOURCE` 생산자(`returnShortPickCustody`·`returnToSource`)는 사라진다. `returned_qty` 는 `PUTAWAY_RETURN` 합이다(②).
  9. **복구 규칙:** 배정마다 `Σ HAND_IN − Σ HAND_BACK − Σ REMOVE_TO_RETURN_BIN − Σ APPROVE_SHORTAGE(allocationId 있음) = qty` 다.
     - `allocationId` 가 없는 옛 결품 이벤트(`APPROVE_SHORTAGE`·`RETURN_TO_SOURCE`)는 옛 검사 그대로 재생한다 — 과거 세션이 있다.
     - 줄·로케이션 «보관 ≤ 배정» 검사는 새 부족 승인을 세지 않는다. 이미 배정에서 빠진 몫이기 때문이다.
  10. **I3 공유 식의 `excluded` 필터를 걷는다(①).** PR 4 뒤로는 모든 나가기가 배정을 0 으로 남긴다: 반납·되돌림은 PR 2·3 이, 결품은 부족 승인·반납·되돌림이 한다. 남는 건 PR 4 이전에 결품으로 제외된 옛 행뿐이고, 배포 전 SQL 로 열린 세션에 그런 행이 없음을 확인한다(Task 10).
  11. **옛 결품 경로 제거:**
      - 없앤다: `quarantineWorkItem`(`short_pick_recovery` 생산자), `resumePending`·`markRecoveryRequired`, 박스 `recovery_required`/`SHORT_PICK_PENDING` 생산자, `reconcileAffectedCustody`·`assertNoPositiveCustody`.
      - 읽는 쪽은 남긴다 — 옛 행과 contract 때문이다: `short_pick_recovery` 를 읽는 `blockerOf`·`ACTIVE_WORK_ITEM_STATUSES`·`allocation.locks` 목록.
      - 결품 보고는 이제 한 트랜잭션이라 `recovery_required` 오퍼레이션이 생기지 않는다.
  12. **warehouse-app 은 바꾸지 않는다**(사용자 결정). 결품 보고는 admin-web 에만 있다. 결품 뒤 현장 흐름은 이미 있다:
      - 채움 → 송장 스캔 `reprint_required`(바뀐 줄), 배치 카드 «재출력 필요 N»
      - 못 채움 → 전진 명령 `SHIPMENT_WITHDRAWN`, 송장 스캔 `withdrawing`(뺄 상품)
      - 나간 뒤 → `withdrawn`(exitTo 무관, 한 문구)
      - 새 거절 코드는 앱이 부르지 않는 결품 명령에서만 난다.
  13. **응답:** `ShipmentShortPickResponseDto` 에 세 필드를 더한다.
      - `outcome`(`refilled`|`withdrawing`|`exited`)
      - `refills`(줄·SKU·로케이션·코드·수량)
      - `shortages`(못 채운 줄·사유 — 시작·합류 실패와 같은 `STOCK_SHORT`/`INBOUND_PENDING` 판정)

      `operationStatus` 는 `withdrawing` 일 때만 `pending` 이다. `invoiceOperationId` 는 클라이언트 호환으로 `null` 을 계속 싣는다.
  14. **새 거절 코드:**
      - `SHORT_PICK_EXCEEDS_UNPICKED`(정한 것 1)
      - `SHORT_PICK_WORK_ITEM_WAITING`(작업 항목이 다른 오퍼레이션을 기다림 — 방어)
      - 재사용: `SHIPMENT_WITHDRAWN`(빼는 중인 박스의 결품 보고), `PICKING_SESSION_NOT_ACTIVE`(세션 `recovery_required`), `WITHDRAWAL_WAYBILL_NOT_VOIDABLE`
      - 사라지는 코드: `SHORT_PICK_INVOICE_NOT_VOIDED`·`SHORT_PICK_OPERATION_NOT_RESUMABLE`·`SHORT_PICK_OPERATION_MEMBER_MISMATCH`·`SHORT_PICK_SHIPMENT_NOT_RECOVERING`·`SHORT_PICK_CUSTODY_REMAINS`·`SHORT_PICK_CUSTODY_EXCEEDS_ALLOCATION`·`SHORT_PICK_CUSTODY_INSUFFICIENT`·`SESSION_RETURN_EXCEEDS_OPERATION_INTENT`
- **이 PR 에서 하지 않는 것:**
  - 결품의 원장 반영(ADJUST_DOWN — 후속 이슈)
  - 집은 뒤 발견한 파손의 교체
  - 앱의 결품 보고 화면
  - 부분 취소(E11), 박스 내용 변경(S2)
  - `short_pick_recovery` 상태 값 제거(contract)

## Review Focus

1. **이미 몇 개 집은 줄에서 결품.** 박스 B 에 A 3개가 필요하고, L1 에서 1개를 집은 뒤(작업자 손) 2개 결품을 보고한다. 기대:
   - 손의 1개는 장부에 그대로(`WORKER` 1) 남는다.
   - L1 배정 3 → 1, L2 에서 2 를 새로 배정한다.
   - 작업자 화면·송장이 «L1 1(이미 집음) + L2 2» 가 된다.
   - 3개 결품을 보고하면 `SHORT_PICK_EXCEEDS_UNPICKED`.
   - → Task 6 테스트.
2. **결품 로케이션이 곧바로 다시 뽑히는 것.** 부족 승인 직후 L1 에는 유령 재고가 생긴다. 기대: 재배정은 L1 을 절대 고르지 않는다(L1 말고 재고가 없으면 채우지 못하고 이탈). 다음 배치의 시작은 L1 을 고를 수 있다(정한 것 2 — 후속 이슈). → Task 4·Task 6 테스트.
3. **못 채웠는데 집은 물건이 있는 박스.** 기대:
   - 보고 직후 박스는 `planned`·송장 유효·예약 전량이고 작업 항목은 `withdrawing` 이다. 송장 스캔은 `withdrawing` + 뺄 목록이다.
   - 마지막 물건을 바구니에 넣는 트랜잭션에서 예약 −k(released), 송장 voided, 박스 `draft`, 결품 오퍼레이션 `completed` 가 함께 일어난다.
   - 그 뒤 송장 스캔은 `withdrawn`, 복구는 healthy, 불변식은 0 이다.
   - → Task 6·Task 8 테스트.
4. **결품으로 빼는 중인 박스에 전체 취소.** 기대: 판매 주문 취소가 실패하지 않는다. 결품 오퍼레이션은 넘겨받혀 닫히고, 마지막 되돌림에서 취소가 완료된다(박스 `canceled`, 예약 전량 해제). → Task 7 테스트.
5. **토탈피킹·바구니 피킹에서의 결품.** 카트에 이미 실린 몫은 «안 집은 몫»이 아니다(`AT_SOURCE` 가 아니다). 기대:
   - 벌크 수집 전 결품은 채움·못 채움 모두 된다.
   - 카트에 다 실은 뒤의 결품은 `SHORT_PICK_EXCEEDS_UNPICKED` 다.
   - 끝에 불변식 0, 복구 healthy.
   - → Task 7 테스트.

---

## 파일 지도

core (`apps/core/src/modules/fulfillment/` 기준)

| 파일 | 책임 | 태스크 |
| --- | --- | --- |
| `services/batch-inventory-session.service.ts` | 부족 승인의 배정 신원·«안 집은 몫» 검사, `RETURN_TO_SOURCE` 생산자 제거, `returned_qty` | 1 |
| `services/__support__/short-pick-fixtures.ts` (신규) | 결품 오퍼레이션 행·여분 로케이션 재고 픽스처 | 1 |
| `services/batch-session-recovery.service.ts` | 새 부족 승인 재생, 배정 규칙 | 2 |
| `services/fulfillment-invariant.service.ts` | I3 공유 식 필터 제거 | 3 |
| `services/box-allocation.manager.ts` | `approveShortages`·`planRefill`·`applyRefill`, 상태 적재 공통화 | 4 |
| `services/short-pick-exit.service.ts` (신규) · `services/box-withdrawal.service.ts` · `services/shipment-planning.service.ts` | 결품 마무리·넘겨받기, 나가기·승격 연결, 송장 판정 이름 | 5 |
| `services/shipment-short-pick.service.ts` · `dto/shipment-short-pick.dto.ts` · `controllers/shipment-short-pick.controller.ts` | 보고 재작성, 응답 | 6 |
| `reader/shipment-waybill.reader.ts` | 무효 송장 폴백을 결품 이탈로 | 8 |
| `fulfillment.module.ts` · `services/__support__/simple-outbound-wiring.ts` · `services/__support__/box-withdrawal-wiring.ts` · 생성자를 직접 부르는 스펙들 | 배선 | 5·6 |

admin-web (`apps/admin-web/src/` 기준)

| 파일 | 책임 | 태스크 |
| --- | --- | --- |
| `lib/types/dto/fulfillment.ts` · `lib/services/orders/short-pick-outcome.ts` (신규) · `features/order/picking-list/components/short-pick-dialog/index.tsx` | 새 응답 타입, 결과 문구 순수 함수, 다이얼로그 | 9 |

---

### Task 1: 세션 — 부족 승인은 «안 집은 몫»에서 배정 신원을 싣고, 결품 반환(`RETURN_TO_SOURCE`) 생산자를 없앤다

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/batch-inventory-session.service.ts` (`ApproveBatchShortageInput`, `approveShortage`, `assertShortageAllocation`, `mutate`, `MutationEventType`; 삭제 `returnShortPickCustody`·`returnToSource`·`ReturnShortPickCustodyInput`·`remainingShortPickAllocation`)
- Create: `apps/core/src/modules/fulfillment/services/__support__/short-pick-fixtures.ts`
- Modify(Test): `apps/core/src/modules/fulfillment/services/batch-inventory-session.integration.spec.ts`, `apps/core/src/modules/fulfillment/services/batch-inventory-session.service.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ApproveBatchShortageInput {
    sessionId: string;
    idempotencyKey: string;
    shortPickOperationId: string;
    workItemId: string;      // 신규
    allocationId: string;    // 신규
    shipmentLineId: string;
    quantity: number;
    from: BatchInventoryBucket; // custodyType 'AT_SOURCE', shipmentLineId 없음 — 아니면 400
    reasonCode: ApprovedShortageReasonCode;
    reason: string;
    approverId: string;
  }
  export const shortageIdempotencyKey = (shortPickOperationId: string, allocationId: string) =>
    `shortage:${shortPickOperationId}:${allocationId}`;
  ```
- Produces (`__support__/short-pick-fixtures.ts`):
  ```ts
  export async function seedShortPickOperation(tx: DbTx, input: {
    shipmentId: string; workItemId: string; sessionId: string; actorId: string; reason?: string;
    lines: Array<{ shipmentLineId: string; sourceLocationId: string; shortQty: number; allocationQty: number }>;
  }): Promise<{ id: string; reason: string }>;
  export async function seedSpareStock(tx: DbTx, base: { skuId: string; warehouseId: string }, qty: number,
    codePrefix?: string): Promise<{ locationId: string; code: string }>;
  ```
- 사라짐: `returnShortPickCustody`, `returnToSource`, `ReturnShortPickCustodyInput`, `remainingShortPickAllocation`, `MutationEventType` 의 `'RETURN_TO_SOURCE'`

- [ ] **Step 1: 픽스처를 만든다** — `services/__support__/short-pick-fixtures.ts`

```ts
import { randomUUID } from 'crypto';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';

/**
 * 결품 오퍼레이션 행 + source 멤버 — 세션·복구 스펙이 보고 명령 없이 부족 승인을 부를 때 쓴다(보고 명령이 만드는 모양 그대로).
 * 실제 보고(`ShipmentShortPickService.report`)는 이 행을 자기 트랜잭션에서 만든다.
 */
export async function seedShortPickOperation(
  tx: DbTx,
  input: {
    shipmentId: string;
    workItemId: string;
    sessionId: string;
    actorId: string;
    reason?: string;
    lines: Array<{ shipmentLineId: string; sourceLocationId: string; shortQty: number; allocationQty: number }>;
  },
): Promise<{ id: string; reason: string }> {
  const id = randomUUID();
  const reason = input.reason ?? 'inventory_shortage';
  await tx.insert(wmsTables.shipmentOperations).values({
    id,
    type: 'short_pick',
    status: 'pending',
    operatorId: input.actorId,
    reason,
    idempotencyKey: `short-pick-fixture-${id}`,
    requestHash: 'f'.repeat(64),
    beforeManifestSnapshot: {
      intent: {
        kind: 'short_pick',
        operationId: id,
        shipmentId: input.shipmentId,
        workItemId: input.workItemId,
        sessionId: input.sessionId,
        actorId: input.actorId,
        reason,
        lines: input.lines,
      },
    },
  });
  await tx.insert(wmsTables.shipmentOperationMembers).values({ operationId: id, shipmentId: input.shipmentId, role: 'source' });
  return { id, reason };
}

/** 같은 창고·SKU 의 다른 로케이션에 일반 재고를 둔다 — 재배정 후보. 코드는 픽스처 로케이션(`SIMPLE-ZONE-…`)보다 뒤(`SPARE-…`). */
export async function seedSpareStock(
  tx: DbTx,
  base: { skuId: string; warehouseId: string },
  qty: number,
  codePrefix = 'SPARE',
): Promise<{ locationId: string; code: string }> {
  const code = `${codePrefix}-${randomUUID()}`;
  const [location] = await tx
    .insert(wmsTables.locations)
    .values({ warehouseId: base.warehouseId, code, locationType: 'zone' })
    .returning();
  await tx.insert(wmsTables.stockLedgers).values({
    skuId: base.skuId,
    warehouseId: base.warehouseId,
    locationId: location.id,
    stockState: 'ON_HAND',
    qty,
  });
  return { locationId: location.id, code };
}
```

- [ ] **Step 2: 실패하는 통합 테스트를 쓴다** — `batch-inventory-session.integration.spec.ts` 의 `it('attributes pooled short-pick outcomes to one allocation without consuming sibling custody', …)` 전체를 아래 셋으로 **바꾼다**. 그 테스트의 형제 박스 픽스처(판매 주문 → 이행 주문 → 형제 박스·줄·예약·작업 항목·배정)는 첫 케이스의 앞부분으로 옮겨 그대로 쓴다.

```ts
  it('부족 승인은 안 집은 몫(AT_SOURCE)에서 배정 신원을 싣고 줄인다 — 형제 박스의 보관은 그대로, 같은 키는 재생', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedAllocatedBatch(tx, { quantity: 3 });
      // (옛 테스트의 형제 박스 픽스처를 여기 그대로 — siblingLine 배정 2, 같은 로케이션)
      const session = await handIn(services, fixture.batch.id, tx);
      // 한 개는 집었다 — WORKER 1(줄 귀속). 안 집은 몫 = 3 − 1 = 2
      await services.sessions.moveCustody(
        {
          sessionId: session.id,
          idempotencyKey: `pick-${randomUUID()}`,
          actorId,
          quantity: 1,
          from: { skuId: fixture.source.skuId, sourceLocationId: fixture.source.locationId, custodyType: 'AT_SOURCE' },
          to: {
            skuId: fixture.source.skuId,
            sourceLocationId: fixture.source.locationId,
            custodyType: 'WORKER',
            custodyRef: actorId,
            shipmentLineId: fixture.line.id,
          },
        },
        tx,
      );
      const operation = await seedShortPickOperation(tx, {
        shipmentId: fixture.shipment.id,
        workItemId: fixture.workItem.id,
        sessionId: session.id,
        actorId,
        lines: [{ shipmentLineId: fixture.line.id, sourceLocationId: fixture.source.locationId, shortQty: 2, allocationQty: 3 }],
      });
      const input = {
        sessionId: session.id,
        idempotencyKey: shortageIdempotencyKey(operation.id, fixture.allocation.id),
        shortPickOperationId: operation.id,
        workItemId: fixture.workItem.id,
        allocationId: fixture.allocation.id,
        shipmentLineId: fixture.line.id,
        quantity: 2,
        from: { skuId: fixture.source.skuId, sourceLocationId: fixture.source.locationId, custodyType: 'AT_SOURCE' as const },
        reasonCode: 'MISSING' as const,
        reason: operation.reason,
        approverId: actorId,
      };

      const approved = await services.sessions.approveShortage(input, tx);

      expect(approved.session).toMatchObject({ shortageQty: 2, returnedQty: 0 });
      expect(approved.event.payload).toMatchObject({
        shortPickOperationId: operation.id,
        workItemId: fixture.workItem.id,
        allocationId: fixture.allocation.id,
      });
      // AT_SOURCE = 3(본 박스) + 2(형제) − 1(집음) − 2(부족) = 2 — 형제 몫 2 가 그대로다
      const [atSource] = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
            eq(wmsTables.batchInventorySessionBalances.custodyType, 'AT_SOURCE'),
          ),
        );
      expect(atSource.qty).toBe(2);
      expect((await services.sessions.approveShortage(input, tx)).replayed).toBe(true);
    });
  });

  it('부족 승인은 줄 귀속 보관에서 하지 않고, 안 집은 몫을 넘지 않는다', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedAllocatedBatch(tx, { quantity: 3 });
      const session = await handIn(services, fixture.batch.id, tx);
      const worker = {
        skuId: fixture.source.skuId,
        sourceLocationId: fixture.source.locationId,
        custodyType: 'WORKER' as const,
        custodyRef: actorId,
        shipmentLineId: fixture.line.id,
      };
      await services.sessions.moveCustody(
        {
          sessionId: session.id,
          idempotencyKey: `pick-${randomUUID()}`,
          actorId,
          quantity: 2,
          from: { skuId: fixture.source.skuId, sourceLocationId: fixture.source.locationId, custodyType: 'AT_SOURCE' },
          to: worker,
        },
        tx,
      );
      const operation = await seedShortPickOperation(tx, {
        shipmentId: fixture.shipment.id,
        workItemId: fixture.workItem.id,
        sessionId: session.id,
        actorId,
        lines: [{ shipmentLineId: fixture.line.id, sourceLocationId: fixture.source.locationId, shortQty: 2, allocationQty: 3 }],
      });
      const base = {
        sessionId: session.id,
        shortPickOperationId: operation.id,
        workItemId: fixture.workItem.id,
        allocationId: fixture.allocation.id,
        shipmentLineId: fixture.line.id,
        reasonCode: 'MISSING' as const,
        reason: operation.reason,
        approverId: actorId,
      };
      await expect(
        services.sessions.approveShortage(
          { ...base, idempotencyKey: `s-${randomUUID()}`, quantity: 1, from: worker },
          tx,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      // 안 집은 몫 = 3 − 2 = 1 < 2
      await expectConflict(
        services.sessions.approveShortage(
          {
            ...base,
            idempotencyKey: shortageIdempotencyKey(operation.id, fixture.allocation.id),
            quantity: 2,
            from: { skuId: fixture.source.skuId, sourceLocationId: fixture.source.locationId, custodyType: 'AT_SOURCE' },
          },
          tx,
        ),
        'SESSION_SHORTAGE_EXCEEDS_ALLOCATION',
      );
    });
  });

  it('완료된 결품 오퍼레이션은 같은 키의 재생만 받는다', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedAllocatedBatch(tx, { quantity: 3 });
      const session = await handIn(services, fixture.batch.id, tx);
      const operation = await seedShortPickOperation(tx, {
        shipmentId: fixture.shipment.id,
        workItemId: fixture.workItem.id,
        sessionId: session.id,
        actorId,
        lines: [{ shipmentLineId: fixture.line.id, sourceLocationId: fixture.source.locationId, shortQty: 1, allocationQty: 3 }],
      });
      const input = {
        sessionId: session.id,
        idempotencyKey: shortageIdempotencyKey(operation.id, fixture.allocation.id),
        shortPickOperationId: operation.id,
        workItemId: fixture.workItem.id,
        allocationId: fixture.allocation.id,
        shipmentLineId: fixture.line.id,
        quantity: 1,
        from: { skuId: fixture.source.skuId, sourceLocationId: fixture.source.locationId, custodyType: 'AT_SOURCE' as const },
        reasonCode: 'MISSING' as const,
        reason: operation.reason,
        approverId: actorId,
      };
      await services.sessions.approveShortage(input, tx);
      await tx
        .update(wmsTables.shipmentOperations)
        .set({ status: 'completed' })
        .where(eq(wmsTables.shipmentOperations.id, operation.id));
      expect((await services.sessions.approveShortage(input, tx)).replayed).toBe(true);
      await expectConflict(
        services.sessions.approveShortage({ ...input, idempotencyKey: `completed-new-${randomUUID()}` }, tx),
        'SESSION_SHORTAGE_OPERATION_COMPLETED',
      );
    });
  });
```

같은 파일의 `returnToSource` 를 쓰는 두 테스트를 되돌림 바구니 경로로 바꾼다:
- `it('moves custody idempotently, rejects payload reuse, returns it, and replays after terminal settlement', …)`
- `it('rebuilds from the post-lock event stream when a concurrent return settles first', …)`

바꾸는 방법은 세 단계다.
1. 옮긴 `WORKER` 보관을 `removeToReturnBin` 으로 바구니에 넣는다(바구니는 `seedReturnBin(tx, fixture.source.warehouseId, actorId)`, 배정 id 는 `fixture.allocation.id`).
2. 같은 수만큼 배정 행을 줄인다 — 실행부(`BoxAllocationManager`)가 하는 일이고, 복구 규칙이 요구한다.
3. 종결 이벤트를 `putawayReturn` 으로 바꾼다. 기대값 `returnedQty: fixture.quantity`·`status: 'settled'`·재생 `replayed: true` 는 그대로다.

첫 테스트의 종결 부분은 이렇게 된다:

```ts
      const bin = await seedReturnBin(tx, fixture.source.warehouseId, actorId);
      await services.sessions.removeToReturnBin(
        {
          sessionId: session.id,
          operationId: randomUUID(),
          actorId,
          workItemId: fixture.workItem.id,
          allocationId: fixture.allocation.id,
          shipmentLineId: fixture.line.id,
          skuId: fixture.source.skuId,
          sourceLocationId: fixture.source.locationId,
          quantity: fixture.quantity,
          from: { custodyType: 'WORKER', custodyRef: handoff.to.custodyRef, shipmentLineId: fixture.line.id },
          returnBin: bin,
        },
        tx,
      );
      await tx
        .update(wmsTables.pickingSourceAllocations)
        .set({ qty: 0 })
        .where(eq(wmsTables.pickingSourceAllocations.id, fixture.allocation.id));
      const putaway = {
        sessionId: session.id,
        operationId: randomUUID(),
        actorId,
        skuId: fixture.source.skuId,
        sourceLocationId: fixture.source.locationId,
        quantity: fixture.quantity,
        returnBin: bin,
      };
      const returned = await services.sessions.putawayReturn(putaway, tx);
      expect(returned.session).toMatchObject({ status: 'settled', returnedQty: fixture.quantity });
      const terminalReplay = await services.sessions.putawayReturn(putaway, tx);
      expect(terminalReplay).toMatchObject({ replayed: true, event: { id: returned.event.id } });
```

동시성 테스트(`rebuilds from the post-lock event stream …`)는 이렇게 바꾼다. 테스트 이름에서 «return» 은 그대로 둔다.
- `concurrentDb.transaction` 전(커밋)에 바구니 등록 → `removeToReturnBin` → 배정 0 을 한다.
- 트랜잭션 안의 `returnToSource` 를 `putawayReturn` 으로 바꾼다.
- 기대 `status: 'settled'` 와 advisory 잠금 단언은 그대로다.

`seedReturnBin` 은 `./__support__/simple-outbound-fixtures` 에서 import 한다(PR 3). `BadRequestException` 은 `@nestjs/common` 에서 import 한다.

`batch-inventory-session.service.spec.ts` 에서는 `remainingShortPickAllocation` import 와 `it('reserves sibling-safe capacity after active, returned, settled, and shortage attribution', …)` 을 지운다. 함수가 사라진다.

- [ ] **Step 3: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- batch-inventory-session.integration`
Expected: FAIL — `workItemId`/`allocationId` 가 payload 에 없음, 줄 귀속 보관에서의 승인이 거절되지 않음, `shortageIdempotencyKey` 미정의.

- [ ] **Step 4: 세션 서비스를 고친다** — `batch-inventory-session.service.ts`

1. `MutationEventType` 에서 `'RETURN_TO_SOURCE'` 를 지운다. `returnToSource`·`returnShortPickCustody`·`ReturnShortPickCustodyInput`·`remainingShortPickAllocation` 을 지운다. `ReturnBatchCustodyInput` 은 `SettleBatchCustodyInput` 이 확장하므로 남긴다.
2. 멱등 키 헬퍼:

```ts
/** 부족 승인 — 결품 한 번이 한 배정에서 한 번(정한 것 8). */
export const shortageIdempotencyKey = (shortPickOperationId: string, allocationId: string): string =>
  `shortage:${shortPickOperationId}:${allocationId}`;
```

3. `ApproveBatchShortageInput` 에 `workItemId`·`allocationId` 를 더하고 `approveShortage` 를 바꾼다:

```ts
  /**
   * 결품 = 안 집은 몫(PR 4 계획이 정함 1). 공유 AT_SOURCE 에서만 빼고, 어느 배정의 몫인지 신원을 싣는다 — 배정 행 감소는
   * 호출자(BoxAllocationManager.approveShortages)가 같은 트랜잭션에서 한다(복구 규칙 정한 것 9). 원장은 건드리지 않는다(정한 것 2).
   */
  async approveShortage(input: ApproveBatchShortageInput, tx?: DbTx) {
    const from = normalizedBucket(input.from);
    if (from.custodyType !== 'AT_SOURCE' || from.shipmentLineId || from.custodyRef) {
      throw new BadRequestException('Approved shortage must come from unpicked AT_SOURCE custody');
    }
    for (const [name, value] of [
      ['shortPickOperationId', input.shortPickOperationId],
      ['workItemId', input.workItemId],
      ['allocationId', input.allocationId],
      ['shipmentLineId', input.shipmentLineId],
      ['reason', input.reason],
      ['approverId', input.approverId],
    ] as const) {
      if (!value.trim()) throw new BadRequestException(`${name} is required`);
    }
    if (!isApprovedShortageReasonCode(input.reasonCode)) {
      throw new BadRequestException('reasonCode must be one of MISSING, DAMAGED, DEFECTIVE');
    }
    return this.mutate(
      {
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        eventType: 'APPROVE_SHORTAGE',
        actorId: input.approverId,
        skuId: input.from.skuId,
        quantity: input.quantity,
        from,
        to: null,
        context: {
          shortPickOperationId: input.shortPickOperationId,
          workItemId: input.workItemId,
          allocationId: input.allocationId,
          shipmentLineId: input.shipmentLineId,
          sourceLocationId: from.sourceLocationId,
          reasonCode: input.reasonCode,
          reason: input.reason.trim(),
          approverId: input.approverId,
        },
      },
      tx,
    );
  }
```

4. `mutate` 를 고친다:
   - `RETURN_TO_SOURCE` 갈래(`assertShortageAllocation` 호출)를 지운다.
   - 헤더 `returnedQty` 는 `input.eventType === 'PUTAWAY_RETURN'` 일 때만 올린다(정한 것 8, ②).
   - 주석: `// returned_qty = 되돌림 적치(PUTAWAY_RETURN) 합(PR 4 계획이 정함 8). 옛 RETURN_TO_SOURCE 는 생산자가 없고 복구만 재생한다.`

5. `assertShortageAllocation` 을 새 규칙으로 다시 쓴다(APPROVE_SHORTAGE 전용):

```ts
  private async assertShortageAllocation(
    input: { sessionId: string; eventType: MutationEventType; actorId: string; skuId: string; quantity: number;
      from: SessionEventSide; context?: Record<string, unknown> },
    intent: ShortPickOperationIntentProof | null,
    tx: DbTx,
  ): Promise<void> {
    const { shortPickOperationId, shipmentLineId, sourceLocationId, workItemId, allocationId } = input.context ?? {};
    if (
      typeof shortPickOperationId !== 'string' ||
      typeof shipmentLineId !== 'string' ||
      typeof workItemId !== 'string' ||
      typeof allocationId !== 'string' ||
      sourceLocationId !== input.from.sourceLocationId
    ) {
      throw new BadRequestException('Approved shortage requires exact operation, work item, allocation, line, and source');
    }
    const intentLine = intent?.lines.find(
      (line) => line.shipmentLineId === shipmentLineId && line.sourceLocationId === sourceLocationId,
    );
    if (
      !intent ||
      intent.operationId !== shortPickOperationId ||
      intent.sessionId !== input.sessionId ||
      intent.workItemId !== workItemId ||
      intent.actorId !== input.actorId ||
      input.context?.reason !== intent.reason ||
      !intentLine
    ) {
      throw this.conflict(
        'SESSION_SHORTAGE_OPERATION_INTENT_MISMATCH',
        'Shortage approval is outside the immutable short-pick operation intent',
      );
    }
    // (기존 그대로) 오퍼레이션이 이 줄을 source 멤버로 소유하는지 — SESSION_SHORTAGE_OPERATION_OWNERSHIP_MISMATCH
    // (기존 그대로) 같은 오퍼레이션·줄·로케이션·보관 grain 의 이벤트가 이미 있는지 — SESSION_SHORTAGE_OPERATION_DUPLICATE
    const [allocation] = await tx
      .select({
        workItemId: wmsTables.pickingSourceAllocations.workItemId,
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        qty: wmsTables.pickingSourceAllocations.qty,
        skuId: wmsTables.shipmentLines.skuId,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId))
      .where(eq(wmsTables.pickingSourceAllocations.id, allocationId))
      .limit(1)
      .for('update');
    if (
      !allocation ||
      allocation.workItemId !== workItemId ||
      allocation.shipmentLineId !== shipmentLineId ||
      allocation.sourceLocationId !== sourceLocationId ||
      allocation.skuId !== input.skuId
    ) {
      throw this.conflict('SESSION_SHORTAGE_NOT_ALLOCATED', 'Approved shortage does not match an exact persisted allocation');
    }
    const [approved] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionEvents.quantity}), 0)::int` })
      .from(wmsTables.batchInventorySessionEvents)
      .where(
        and(
          eq(wmsTables.batchInventorySessionEvents.sessionId, input.sessionId),
          eq(wmsTables.batchInventorySessionEvents.eventType, 'APPROVE_SHORTAGE'),
          sql`${wmsTables.batchInventorySessionEvents.payload}->>'shortPickOperationId' = ${shortPickOperationId}`,
          sql`${wmsTables.batchInventorySessionEvents.payload}->>'allocationId' = ${allocationId}`,
        ),
      );
    if (Number(approved?.qty ?? 0) + input.quantity > intentLine.shortQty) {
      throw this.conflict(
        'SESSION_SHORTAGE_EXCEEDS_OPERATION_INTENT',
        `Approved shortage exceeds immutable intent quantity ${intentLine.shortQty}`,
      );
    }
    // 안 집은 몫 = 배정 − 그 줄·로케이션의 줄 귀속 보관(reconcileAllocation 과 같은 집합). 배정 감소는 이 이벤트 뒤다.
    const [attributed] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, input.sessionId),
          eq(wmsTables.batchInventorySessionBalances.shipmentLineId, shipmentLineId),
          eq(wmsTables.batchInventorySessionBalances.sourceLocationId, sourceLocationId),
          inArray(wmsTables.batchInventorySessionBalances.custodyType, [...LINE_ATTRIBUTED_CUSTODY] as BatchInventoryCustodyType[]),
        ),
      );
    const unpicked = allocation.qty - Number(attributed?.qty ?? 0);
    if (input.quantity > unpicked) {
      throw this.conflict(
        'SESSION_SHORTAGE_EXCEEDS_ALLOCATION',
        `Shortage ${input.quantity} exceeds the unpicked share ${unpicked} of allocation ${allocationId}`,
      );
    }
  }
```

   `LINE_ATTRIBUTED_CUSTODY` 는 `./line-attributed-custody` 에서 import 한다. 이 파일은 `BatchInventoryCustodyType` 을 type-only 로 import 하므로 순환 참조가 생기지 않는다. `ReadonlySet<string>` 을 enum 배열로 좁히는 `as` 는 근거 주석을 단다: «집합의 원소는 `BatchInventoryCustodyType` 리터럴로만 만든다(line-attributed-custody.ts)». 원한다면 `line-attributed-custody.ts` 에 `export const LINE_ATTRIBUTED_CUSTODY_TYPES = LINE_ATTRIBUTED` 를 더해 캐스팅 없이 써도 된다 — 이쪽이 낫다.

- [ ] **Step 5: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- batch-inventory-session` 그리고 `npx jest apps/core/src/modules/fulfillment/services/batch-inventory-session.service.spec.ts`
Expected: PASS. `npm run type-check` 도 초록일 수 있다. 옛 `ShipmentShortPickService` 는 세션을 자기 파일의 포트 타입(`ShortPickSessionPort`)으로 받으므로, 사라진 메서드가 컴파일 에러로 드러나지 않는다. 대신 옛 결품 통합 스펙(`shipment-short-pick.integration`, `outbound-v2-warehouse-scenarios` 시나리오 10)은 런타임에 실패한다. Task 6·7 이 바꿀 때까지의 **예상된 빨강**이다. 이 태스크에서 옛 결품 서비스를 임시로 고치지 않는다. 서브에이전트 실행이면 이 태스크의 리뷰는 대상 스펙 통과와 이 예상 목록으로 판정한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/batch-inventory-session.service.ts \
  apps/core/src/modules/fulfillment/services/line-attributed-custody.ts \
  apps/core/src/modules/fulfillment/services/__support__/short-pick-fixtures.ts \
  apps/core/src/modules/fulfillment/services/batch-inventory-session.integration.spec.ts \
  apps/core/src/modules/fulfillment/services/batch-inventory-session.service.spec.ts
git commit -m "feat(fulfillment): 부족 승인은 안 집은 몫에서 배정 신원을 싣고, 결품 반환 생산자를 없앤다 (#990)"
```

---

### Task 2: 세션 복구 — 새 부족 승인을 «배정마다 이벤트 합 = 배정»에 넣고, 옛 결품 이벤트는 옛 검사로 재생한다

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/batch-session-recovery.service.ts` (이벤트 재생의 `APPROVE_SHORTAGE` 면 검사, 결품 귀속 검사 갈래, `movedByAllocation`, 줄·로케이션 «보관 ≤ 배정»)
- Test: `apps/core/src/modules/fulfillment/services/batch-session-recovery.short-pick.integration.spec.ts` (신규)

**Interfaces:**
- Consumes: Task 1 의 `approveShortage`(payload `workItemId`·`allocationId`), `shortageIdempotencyKey`, `seedShortPickOperation`
- Produces: 복구 규칙(정한 것 9). 이벤트 payload 에 `allocationId` 가 있으면 «새 결품», 없으면 «옛 결품» 이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `batch-session-recovery.short-pick.integration.spec.ts`

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { shortageIdempotencyKey } from './batch-inventory-session.service';
import { inRollbackTx, makeDb } from './__support__';
import { seedShortPickOperation } from './__support__/short-pick-fixtures';
import { seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('세션 복구 — 새 부족 승인 (PR 4)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 첫 박스(2개)의 배정에서 1 을 부족 승인하고 배정도 1 줄인다 — BoxAllocationManager.approveShortages 가 하는 일. */
  async function approvedOne(tx: DbTx) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    const run = await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    const [allocation] = await tx
      .select()
      .from(wmsTables.pickingSourceAllocations)
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, first.workItemId));
    const operation = await seedShortPickOperation(tx, {
      shipmentId: first.shipmentId,
      workItemId: first.workItemId,
      sessionId: run.sessionId,
      actorId: first.actorId,
      lines: [{ shipmentLineId: first.shipmentLineId, sourceLocationId: first.locationId, shortQty: 1, allocationQty: 2 }],
    });
    await wiring.sessions.approveShortage(
      {
        sessionId: run.sessionId,
        idempotencyKey: shortageIdempotencyKey(operation.id, allocation.id),
        shortPickOperationId: operation.id,
        workItemId: first.workItemId,
        allocationId: allocation.id,
        shipmentLineId: first.shipmentLineId,
        quantity: 1,
        from: { skuId: first.skuId, sourceLocationId: first.locationId, custodyType: 'AT_SOURCE' },
        reasonCode: 'MISSING',
        reason: operation.reason,
        approverId: first.actorId,
      },
      tx,
    );
    await tx
      .update(wmsTables.pickingSourceAllocations)
      .set({ qty: 1 })
      .where(eq(wmsTables.pickingSourceAllocations.id, allocation.id));
    return { first, second, wiring, sessionId: run.sessionId, allocation };
  }

  it('인계 − 반납 − 바구니 − 새 부족 승인 = 배정이면 healthy', async () => {
    await inRollbackTx(db, async (tx) => {
      const { wiring, sessionId } = await approvedOne(tx);
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
    });
  });

  it('배정 행이 부족 승인만큼 줄지 않았으면 그 배정을 짚는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { wiring, sessionId, allocation } = await approvedOne(tx);
      await tx
        .update(wmsTables.pickingSourceAllocations)
        .set({ qty: 2 })
        .where(eq(wmsTables.pickingSourceAllocations.id, allocation.id));
      const result = await wiring.recovery.reconcile(sessionId, tx);
      expect(result.healthy).toBe(false);
      expect(result.issues.join('\n')).toContain(`allocation ${allocation.id} quantity 2 differs`);
    });
  });
});
```

`wiring.recovery.reconcile` 의 반환 모양(`healthy`·`issues`)은 PR 3 의 `batch-session-recovery.return-bin.integration.spec.ts` 가 쓰는 것과 같다. 다르면 그 스펙을 따른다.

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- batch-session-recovery.short-pick`
Expected: FAIL — 첫 케이스가 unhealthy(`allocation … quantity 1 differs from hand-in 2 − …`), 그리고 결품 귀속 검사의 `differs from immutable short-pick operation intent`(옛 규칙은 `intentLine.allocationQty === allocation.quantity` 를 요구한다).

- [ ] **Step 3: 복구를 고친다** — `batch-session-recovery.service.ts`

1. 이벤트 재생 루프의 `APPROVE_SHORTAGE` 갈래에서, payload 에 `allocationId` 가 있으면 from 이 `AT_SOURCE`·줄 없음이어야 한다:

```ts
      } else if (event.eventType === 'APPROVE_SHORTAGE') {
        if (!from || to) issues.push(`APPROVE_SHORTAGE event ${event.id} has invalid sides`);
        // 새 결품(PR 4, allocationId 있음)은 안 집은 몫에서만 — 정한 것 1.
        if (typeof payload.allocationId === 'string' && (from?.custodyType !== 'AT_SOURCE' || from.shipmentLineId !== null)) {
          issues.push(`APPROVE_SHORTAGE event ${event.id} does not come from unpicked AT_SOURCE custody`);
        }
        shortageQty += event.quantity;
      } else if (event.eventType === 'RETURN_TO_SOURCE') {
        // 생산자는 PR 4 에서 사라졌다 — 과거 세션의 옛 결품 반환만 재생한다.
```

2. 결품 귀속 검사 갈래(`event.eventType === 'APPROVE_SHORTAGE' || (RETURN_TO_SOURCE && shortPickOperationId)`)의 맨 앞을 새·옛 결품으로 가른다. 옛 갈래는 **지금 코드 그대로** private 메서드 `legacyShortPickIssues(...)` 로 옮긴다(동작 불변). 새 갈래:

```ts
          if (event.eventType === 'APPROVE_SHORTAGE' && typeof payload.allocationId === 'string') {
            const allocation = allocationById.get(payload.allocationId);
            const intent = operationOwner ? shortPickOperationIntentOf(operationOwner.snapshot) : null;
            const intentLine = intent?.lines.find(
              (line) => line.shipmentLineId === shipmentLineId && line.sourceLocationId === sourceLocationId,
            );
            const approvedForAllocation = events
              .filter(
                (candidate) =>
                  candidate.eventType === 'APPROVE_SHORTAGE' &&
                  payloadOf(candidate.payload).shortPickOperationId === shortPickOperationId &&
                  payloadOf(candidate.payload).allocationId === payload.allocationId,
              )
              .reduce((total, candidate) => total + candidate.quantity, 0);
            if (
              !allocation ||
              allocation.workItemId !== payload.workItemId ||
              allocation.shipmentLineId !== shipmentLineId ||
              allocation.sourceLocationId !== sourceLocationId ||
              allocation.skuId !== event.skuId ||
              !from ||
              from.custodyType !== 'AT_SOURCE' ||
              from.shipmentLineId !== null
            ) {
              issues.push(`APPROVE_SHORTAGE event ${event.id} has invalid allocation attribution`);
            }
            if (
              !operationOwner ||
              operationOwner.type !== 'short_pick' ||
              !['pending', 'completed'].includes(operationOwner.status) ||
              !intent ||
              intent.operationId !== shortPickOperationId ||
              intent.shipmentId !== operationOwner.memberShipmentId ||
              intent.sessionId !== event.sessionId ||
              intent.workItemId !== payload.workItemId ||
              intent.actorId !== payload.actorId ||
              intent.reason !== reason ||
              !intentLine ||
              approvedForAllocation !== intentLine.shortQty
            ) {
              issues.push(`APPROVE_SHORTAGE event ${event.id} differs from immutable short-pick operation intent`);
            }
            // (기존 그대로) reasonCode·approverId 검사
            const exactContext = {
              shortPickOperationId,
              workItemId: payload.workItemId,
              allocationId: payload.allocationId,
              shipmentLineId,
              sourceLocationId,
              reasonCode: payload.reasonCode,
              reason,
              approverId: payload.approverId,
            };
            if (canonicalBatchSessionRequestHash(persistedContext) !== canonicalBatchSessionRequestHash(exactContext)) {
              issues.push(`APPROVE_SHORTAGE event ${event.id} context is not exact`);
            }
            canonicalRequest.context = exactContext;
          } else {
            issues.push(...(await this.legacyShortPickIssues(/* 지금 갈래가 쓰는 값 그대로 */)));
          }
```

   `operationOwner` 조회(오퍼레이션·멤버·줄 조인)는 두 갈래가 같이 쓰므로 가르기 전에 한 번 한다. 새 갈래의 `approvedForAllocation` 이 한 줄에 여러 배정이 걸리는 경우 intent 의 `shortQty` 와 맞지 않을 수 있다고 걱정할 필요는 없다. 보고는 (줄, 로케이션)당 배정 행이 하나다(`uq_picking_source_allocations_work_item_grain`).

3. `movedByAllocation` 의 타입에 `'APPROVE_SHORTAGE'` 를 더하고 배정 규칙을 넓힌다(allocationId 가 없는 옛 결품 이벤트는 `payloadOf(...).allocationId` 가 달라 0 으로 센다):

```ts
      const shortage = movedByAllocation('APPROVE_SHORTAGE', allocation.id);
      if (handedIn - handedBack - removed - shortage !== allocation.quantity) {
        issues.push(
          `allocation ${allocation.id} quantity ${allocation.quantity} differs from ` +
            `hand-in ${handedIn} − hand-back ${handedBack} − removed ${removed} − shortage ${shortage}`,
        );
      }
```

4. 줄·로케이션 «보관 ≤ 배정» 루프의 `shortageQty` 합산에서 새 결품을 뺀다: `else if (event.eventType === 'APPROVE_SHORTAGE' && typeof payload.allocationId !== 'string') shortageQty += event.quantity;` 주석: `// 새 부족 승인은 이미 배정에서 빠졌다(정한 것 9) — 세면 두 번 뺀다.`

- [ ] **Step 4: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- batch-session-recovery`
Expected: PASS — 새 스펙 둘과 기존 `batch-session-recovery.*` 전부. 옛 결품 이벤트를 심는 기존 케이스가 있으면 옛 갈래로 그대로 통과해야 한다.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/batch-session-recovery.service.ts \
  apps/core/src/modules/fulfillment/services/batch-session-recovery.short-pick.integration.spec.ts
git commit -m "feat(fulfillment): 세션 복구가 새 부족 승인을 배정 규칙에 넣는다 — 옛 결품 이벤트는 옛 검사로 (#990)"
```

---

### Task 3: 불변식 — I3 공유 식이 제외된 작업 항목의 배정도 다시 센다(①)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.ts` (I3 공유 식)
- Test: `apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.spec.ts`

**Interfaces:**
- Produces: I3 공유 식 = 세션마다 (SKU, 원래 로케이션)의 `AT_SOURCE + BULK_CART` ≤ 그 배치의 **모든** 작업 항목 배정 − 줄 귀속 보관. 모든 나가기가 배정을 0 으로 남기므로(정한 것 10) `excluded` 작업 항목은 방을 보태지 않는다.

- [ ] **Step 1: 테스트를 뒤집는다** — `fulfillment-invariant.service.spec.ts` 의 `it('I3 — 제외된 작업 항목의 배정은 공유 보관의 방이 아니다(PR 3·4 경계: 결품 제외 뒤 떠도는 AT_SOURCE)', …)` 을 아래로 바꾼다.

```ts
  it('I3 — 공유 보관은 배치의 모든 작업 항목 배정과 견준다(PR 4: 나간 작업 항목의 배정은 0 이라 방을 보태지 않는다)', () => {
    const snapshot = validSnapshot();
    snapshot.workItems[0].status = 'excluded';
    snapshot.allocations[0].workItemStatus = 'excluded';
    snapshot.allocations[0].qty = 0; // 반납·되돌림·부족 승인이 모두 배정을 줄인다
    snapshot.sessionBalances = [
      {
        id: 'balance-2',
        sessionId: 'session-1',
        custodyType: 'AT_SOURCE',
        qty: 2,
        skuId: 'sku-1',
        sourceLocationId: 'loc-1',
        shipmentLineId: null,
      },
    ];
    snapshot.sessions[0] = { ...snapshot.sessions[0], handedInQty: 2, settledQty: 0, returnedQty: 0, shortageQty: 0 };
    expect(kinds(snapshot)).toContain('CUSTODY_EXCEEDS_ALLOCATION');
  });

  it('I3 — 제외된 작업 항목에 남은 배정도 방으로 센다(옛 결품 행 — 배포 전 SQL 이 열린 세션에 없음을 확인)', () => {
    const snapshot = validSnapshot();
    snapshot.workItems[0].status = 'excluded';
    snapshot.allocations[0].workItemStatus = 'excluded';
    snapshot.allocations[0].qty = 2;
    snapshot.sessionBalances = [
      {
        id: 'balance-2',
        sessionId: 'session-1',
        custodyType: 'AT_SOURCE',
        qty: 2,
        skuId: 'sku-1',
        sourceLocationId: 'loc-1',
        shipmentLineId: null,
      },
    ];
    snapshot.sessions[0] = { ...snapshot.sessions[0], handedInQty: 2, settledQty: 0, returnedQty: 0, shortageQty: 0 };
    expect(kinds(snapshot)).not.toContain('CUSTODY_EXCEEDS_ALLOCATION');
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.spec.ts`
Expected: FAIL — 둘째 케이스(필터가 있어 위반으로 잡힌다).

- [ ] **Step 3: 필터를 걷는다** — `fulfillment-invariant.service.ts` 의 I3 공유 식에서 `liveBatchAllocations` 를 지우고 `batchAllocations` 를 그대로 쓴다. PR 3·4 경계 주석은 이렇게 바꾼다:

```ts
    // 공유 보관은 배치의 모든 배정에서 줄 귀속 보관을 뺀 나머지와 견준다. PR 4 부터 모든 나가기(반납·되돌림·부족 승인)가 배정을
    // 0 으로 남기므로 나간 작업 항목은 방을 보태지 않는다(스펙 §13 PR 4 계획이 정함). PR 3 이 둔 excluded 필터는 걷었다.
```

   필터를 걷은 뒤 스냅샷의 `workItemStatus` 가 더 쓰이지 않으면 필드를 지운다: `grep -n "workItemStatus" apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.ts`. 스냅샷 적재 쿼리와 스펙 픽스처도 같이 지운다. I2 가 쓰면 그대로 둔다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/services/fulfillment-invariant`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.ts \
  apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.spec.ts
git commit -m "fix(fulfillment): I3 공유 식이 제외된 작업 항목의 배정도 다시 센다 — 결품이 배정을 줄이므로 PR 3·4 경계 필터를 걷는다 (#990)"
```

---

### Task 4: 배정 실행부 — 부족 승인, 재배정 계획, 재배정 적용

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/box-allocation.manager.ts` (신규 `approveShortages`·`planRefill`·`applyRefill`, private `loadReconcileState` 로 `handBackUnpicked` 와 적재 공통화)
- Test: `apps/core/src/modules/fulfillment/services/box-allocation.short-pick.integration.spec.ts` (신규)

**Interfaces:**
- Consumes: Task 1 `approveShortage`·`shortageIdempotencyKey`, `seedShortPickOperation`·`seedSpareStock`; PR 2 `reconcileAllocation`·`lockSkuCapacities`·`atSourceKey`
- Produces:
  ```ts
  export interface ShortageRequest { shipmentLineId: string; sourceLocationId: string; qty: number }
  export interface PlannedShortage {
    allocationId: string; shipmentLineId: string; skuId: string; sourceLocationId: string;
    allocationQty: number; // 보고 시점 배정(감소 전) — 결품 오퍼레이션 의도에 적는다
    qty: number;
  }
  export interface RefillView { shipmentLineId: string; skuId: string; sourceLocationId: string; locationCode: string; qty: number }

  /** 판정만 — 쓰지 않는다. 배정 행을 잠그고 요청 전부를 판정해 모자라면 전부 보고한다. */
  planShortages(input: {
    session: BatchInventorySessionRow; workItemId: string; shortages: ShortageRequest[];
  }, trx: DbTx): Promise<PlannedShortage[]>;

  /** 쓰기만 — planShortages 의 결과를 부족 승인 + 배정 −k 로 적용한다. 결품 오퍼레이션 행(정확한 의도)이 먼저 있어야 한다. */
  approveShortages(input: {
    session: BatchInventorySessionRow; workItemId: string; shortPickOperationId: string; actorId: string;
    reasonCode: ApprovedShortageReasonCode; reason: string; planned: PlannedShortage[];
  }, trx: DbTx): Promise<void>;

  planRefill(input: {
    session: BatchInventorySessionRow; warehouseId: string; workItemId: string;
    lines: Array<{ id: string; skuId: string; qty: number }>;
    excludedSources: ReadonlyArray<{ skuId: string; sourceLocationId: string }>;
  }, trx: DbTx): Promise<ReconcilePlan>;

  applyRefill(input: {
    session: BatchInventorySessionRow; batchId: string; actorId: string; operationId: string;
    plan: ReconcilePlan; lines: Array<{ id: string; skuId: string }>;
  }, trx: DbTx): Promise<RefillView[]>;
  ```
  거절:
  - `SHORT_PICK_ALLOCATION_MISMATCH`(요청한 (줄, 로케이션)에 이 작업 항목의 배정 행이 없음 — 기존 코드)
  - `SHORT_PICK_EXCEEDS_UNPICKED`(`errors: Array<{ shipmentLineId; sourceLocationId; requestedQty; unpickedQty }>` — 요청 전부를 판정하고 쓰기 전에 던진다)

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `box-allocation.short-pick.integration.spec.ts`

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { inRollbackTx, makeDb } from './__support__';
import { seedShortPickOperation, seedSpareStock } from './__support__/short-pick-fixtures';
import { seedPickableShipment } from './__support__/logistics-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('BoxAllocationManager — 결품 (스펙 §9, PR 4)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 박스 하나(A 3개, 픽스처 로케이션 L1 재고 3)를 시작하고 1개를 집는다. */
  async function startedWithOnePicked(tx: DbTx) {
    const box = await seedPickableShipment(tx, 3);
    const wiring = assembleOutbound(tx);
    const run = await wiring.picking.start(
      { batchId: box.batchId, actorId: box.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    await wiring.sessions.moveCustody(
      {
        sessionId: run.sessionId,
        idempotencyKey: `pick-${randomUUID()}`,
        actorId: box.actorId,
        quantity: 1,
        from: { skuId: box.skuId, sourceLocationId: box.locationId, custodyType: 'AT_SOURCE' },
        to: {
          skuId: box.skuId,
          sourceLocationId: box.locationId,
          custodyType: 'WORKER',
          custodyRef: box.actorId,
          shipmentLineId: box.shipmentLineId,
        },
      },
      tx,
    );
    const session = await wiring.boxes.lockOpenSession(box.batchId, tx);
    if (!session) throw new Error('session missing');
    const operation = await seedShortPickOperation(tx, {
      shipmentId: box.shipmentId,
      workItemId: box.workItemId,
      sessionId: session.id,
      actorId: box.actorId,
      lines: [{ shipmentLineId: box.shipmentLineId, sourceLocationId: box.locationId, shortQty: 2, allocationQty: 3 }],
    });
    const plan = (qty: number) =>
      wiring.boxes.planShortages(
        {
          session,
          workItemId: box.workItemId,
          shortages: [{ shipmentLineId: box.shipmentLineId, sourceLocationId: box.locationId, qty }],
        },
        tx,
      );
    const approve = async (qty: number) => {
      const planned = await plan(qty);
      await wiring.boxes.approveShortages(
        {
          session,
          workItemId: box.workItemId,
          shortPickOperationId: operation.id,
          actorId: box.actorId,
          reasonCode: 'MISSING',
          reason: operation.reason,
          planned,
        },
        tx,
      );
      return planned;
    };
    return { box, wiring, session, operation, plan, approve };
  }

  const allocationsOf = (tx: DbTx, workItemId: string) =>
    tx
      .select({ sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId, qty: wmsTables.pickingSourceAllocations.qty })
      .from(wmsTables.pickingSourceAllocations)
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, workItemId));

  it('안 집은 몫을 넘는 결품은 SHORT_PICK_EXCEEDS_UNPICKED — 판정 단계에서 전부 보고하고 아무것도 바꾸지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, plan } = await startedWithOnePicked(tx);
      const error = await plan(3).catch((e: unknown) => e);
      expect(error).toMatchObject({
        response: {
          code: 'SHORT_PICK_EXCEEDS_UNPICKED',
          errors: [{ shipmentLineId: box.shipmentLineId, sourceLocationId: box.locationId, requestedQty: 3, unpickedQty: 2 }],
        },
      });
      expect(await allocationsOf(tx, box.workItemId)).toEqual([{ sourceLocationId: box.locationId, qty: 3 }]);
    });
  });

  it('부족 승인은 배정을 같은 수만큼 줄이고, 재배정은 결품 로케이션을 빼고 다른 로케이션에서 채운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, session, operation, approve } = await startedWithOnePicked(tx);
      const spare = await seedSpareStock(tx, box, 5);
      const approved = await approve(2);
      expect(approved).toEqual([expect.objectContaining({ sourceLocationId: box.locationId, allocationQty: 3, qty: 2 })]);
      // 부족 승인 뒤 L1 에는 유령 재고 2 가 일반 가용으로 보인다 — 후보에서 빠져야 한다.
      const phantom = await new BatchControlledStockGuard().getAvailability(
        { skuId: box.skuId, warehouseId: box.warehouseId, sourceLocationId: box.locationId },
        tx,
      );
      expect(phantom.generallyAvailableQty).toBe(2);

      const plan = await wiring.boxes.planRefill(
        {
          session,
          warehouseId: box.warehouseId,
          workItemId: box.workItemId,
          lines: [{ id: box.shipmentLineId, skuId: box.skuId, qty: 3 }],
          excludedSources: [{ skuId: box.skuId, sourceLocationId: box.locationId }],
        },
        tx,
      );
      expect(plan.shortages).toEqual([]);
      expect(plan.handIns).toEqual([expect.objectContaining({ sourceLocationId: spare.locationId, qty: 2 })]);
      const refills = await wiring.boxes.applyRefill(
        {
          session,
          batchId: box.batchId,
          actorId: box.actorId,
          operationId: randomUUID(),
          plan,
          lines: [{ id: box.shipmentLineId, skuId: box.skuId }],
        },
        tx,
      );
      expect(refills).toEqual([
        { shipmentLineId: box.shipmentLineId, skuId: box.skuId, sourceLocationId: spare.locationId, locationCode: spare.code, qty: 2 },
      ]);
      expect(await allocationsOf(tx, box.workItemId)).toEqual(
        expect.arrayContaining([
          { sourceLocationId: box.locationId, qty: 1 },
          { sourceLocationId: spare.locationId, qty: 2 },
        ]),
      );
      await expect(wiring.recovery.reconcile(session.id, tx)).resolves.toMatchObject({ healthy: true });
      void operation;
    });
  });

  it('결품 로케이션 말고 재고가 없으면 채우지 못한다(STOCK_SHORT) — 유령 재고는 후보가 아니다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, session, approve } = await startedWithOnePicked(tx);
      await approve(2);
      const plan = await wiring.boxes.planRefill(
        {
          session,
          warehouseId: box.warehouseId,
          workItemId: box.workItemId,
          lines: [{ id: box.shipmentLineId, skuId: box.skuId, qty: 3 }],
          excludedSources: [{ skuId: box.skuId, sourceLocationId: box.locationId }],
        },
        tx,
      );
      expect(plan.handIns).toEqual([]);
      expect(plan.shortages).toEqual([
        expect.objectContaining({ shipmentLineId: box.shipmentLineId, shortQty: 2, reason: 'STOCK_SHORT' }),
      ]);
    });
  });

  it('이미 배정 행이 있는 로케이션으로 채우면 그 행을 늘린다(source_stock_version 그대로) — 복구 healthy', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 3);
      // 픽스처 L1 에 2 만 두고, L2 에 1 + 여분 → 시작이 L1 2 · L2 1 로 나눈다(E8: 한 곳 전량 불가 → 코드 순)
      await tx
        .update(wmsTables.stockLedgers)
        .set({ qty: 2 })
        .where(eq(wmsTables.stockLedgers.locationId, box.locationId));
      const spare = await seedSpareStock(tx, box, 3);
      const wiring = assembleOutbound(tx);
      await wiring.picking.start({ batchId: box.batchId, actorId: box.actorId, idempotencyKey: `s-${randomUUID()}` }, tx);
      const session = await wiring.boxes.lockOpenSession(box.batchId, tx);
      if (!session) throw new Error('session missing');
      const [spareRow] = (await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.sourceLocationId, spare.locationId)));
      const operation = await seedShortPickOperation(tx, {
        shipmentId: box.shipmentId,
        workItemId: box.workItemId,
        sessionId: session.id,
        actorId: box.actorId,
        lines: [{ shipmentLineId: box.shipmentLineId, sourceLocationId: box.locationId, shortQty: 2, allocationQty: 2 }],
      });
      const planned = await wiring.boxes.planShortages(
        {
          session,
          workItemId: box.workItemId,
          shortages: [{ shipmentLineId: box.shipmentLineId, sourceLocationId: box.locationId, qty: 2 }],
        },
        tx,
      );
      await wiring.boxes.approveShortages(
        {
          session,
          workItemId: box.workItemId,
          shortPickOperationId: operation.id,
          actorId: box.actorId,
          reasonCode: 'MISSING',
          reason: operation.reason,
          planned,
        },
        tx,
      );
      const plan = await wiring.boxes.planRefill(
        {
          session,
          warehouseId: box.warehouseId,
          workItemId: box.workItemId,
          lines: [{ id: box.shipmentLineId, skuId: box.skuId, qty: 3 }],
          excludedSources: [{ skuId: box.skuId, sourceLocationId: box.locationId }],
        },
        tx,
      );
      await wiring.boxes.applyRefill(
        { session, batchId: box.batchId, actorId: box.actorId, operationId: randomUUID(), plan,
          lines: [{ id: box.shipmentLineId, skuId: box.skuId }] },
        tx,
      );
      const [grown] = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.id, spareRow.id));
      expect(grown).toMatchObject({ qty: 3, sourceStockVersion: spareRow.sourceStockVersion });
      await expect(wiring.recovery.reconcile(session.id, tx)).resolves.toMatchObject({ healthy: true });
    });
  });
});
```

`generallyAvailableQty` 필드 이름은 `BatchControlledStockGuard.getAvailability` 의 반환 모양을 따른다(PR 2 `batch-withdraw.integration.spec.ts` 의 `general()` 이 같은 필드를 쓴다).

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- box-allocation.short-pick`
Expected: FAIL — `planShortages is not a function`

- [ ] **Step 3: 구현한다** — `box-allocation.manager.ts`

먼저 `handBackUnpicked` 의 배정·보관 적재를 private 헬퍼로 뺀다(동작 불변):

```ts
  /** reconcileAllocation 의 입력 — 이 작업 항목의 배정 행(로케이션 코드 포함)과 줄 귀속 보관, 세션 공유 AT_SOURCE. 보관 행은 lockOpenSession 이 잠갔다. */
  private async loadReconcileState(
    sessionId: string,
    workItemId: string,
    lineIds: ReadonlySet<string>,
    trx: DbTx,
  ): Promise<{ rows: ReconcileAllocationRow[]; atSource: Map<string, number> }> {
    // handBackUnpicked 의 rows·balances 두 쿼리와 attributed·atSource 집계를 그대로 옮긴다.
    // 단 rows 는 qty > 0 조건을 두지 않는다 — 재배정은 0 이 된 행도 «늘릴 행» 후보로 봐야 한다(reconcileAllocation 은 0 행을 무해하게 다룬다).
  }
```

`handBackUnpicked` 는 `loadReconcileState` 를 부르되, 반납 대상은 지금처럼 `qty > 0` 행만 넘긴다(`rows.filter((row) => row.qty > 0)`).

```ts
  /**
   * 결품 = 안 집은 몫(PR 4 계획이 정함 1). 판정만 한다 — 배정 행을 잠그고 요청 전부를 판정해, 모자라면 쓰기 전에 전부 보고한다.
   * 쓰기(approveShortages)와 나눈 이유: 세션의 부족 승인은 결품 오퍼레이션의 의도(보고 시점 배정 `allocationQty` 포함)를 읽는다 —
   * 호출자가 이 결과로 의도를 적은 오퍼레이션 행을 만든 뒤에 쓴다. 호출자가 구성요소·작업 항목·세션을 잠갔다.
   */
  async planShortages(
    input: { session: BatchInventorySessionRow; workItemId: string; shortages: ShortageRequest[] },
    trx: DbTx,
  ): Promise<PlannedShortage[]> {
    const rows = await trx
      .select({
        allocationId: wmsTables.pickingSourceAllocations.id,
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        skuId: wmsTables.shipmentLines.skuId,
        qty: wmsTables.pickingSourceAllocations.qty,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId))
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, input.workItemId))
      .orderBy(asc(wmsTables.pickingSourceAllocations.id))
      .for('update');
    const balances = await trx
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(and(eq(wmsTables.batchInventorySessionBalances.sessionId, input.session.id), gt(wmsTables.batchInventorySessionBalances.qty, 0)));
    const atSource = new Map<string, number>();
    const attributed = new Map<string, number>();
    for (const balance of balances) {
      if (!balance.sourceLocationId) continue;
      if (balance.custodyType === 'AT_SOURCE') {
        const key = atSourceKey(balance.skuId, balance.sourceLocationId);
        atSource.set(key, (atSource.get(key) ?? 0) + balance.qty);
      } else if (balance.shipmentLineId && LINE_ATTRIBUTED_CUSTODY.has(balance.custodyType)) {
        const key = `${balance.shipmentLineId}|${balance.sourceLocationId}`;
        attributed.set(key, (attributed.get(key) ?? 0) + balance.qty);
      }
    }
    const planned: Array<{ row: (typeof rows)[number]; qty: number }> = [];
    const errors: Array<{ shipmentLineId: string; sourceLocationId: string; requestedQty: number; unpickedQty: number }> = [];
    const takenAtSource = new Map<string, number>();
    for (const request of [...input.shortages].sort((l, r) => `${l.shipmentLineId}|${l.sourceLocationId}`.localeCompare(`${r.shipmentLineId}|${r.sourceLocationId}`))) {
      const row = rows.find((r) => r.shipmentLineId === request.shipmentLineId && r.sourceLocationId === request.sourceLocationId);
      if (!row) {
        throw new ConflictException({
          code: 'SHORT_PICK_ALLOCATION_MISMATCH',
          message: `No allocation for ${request.shipmentLineId}/${request.sourceLocationId} on work item ${input.workItemId}`,
        });
      }
      const key = atSourceKey(row.skuId, row.sourceLocationId);
      const unpicked = Math.min(
        row.qty - (attributed.get(`${row.shipmentLineId}|${row.sourceLocationId}`) ?? 0),
        (atSource.get(key) ?? 0) - (takenAtSource.get(key) ?? 0),
      );
      if (request.qty > unpicked) {
        errors.push({ shipmentLineId: request.shipmentLineId, sourceLocationId: request.sourceLocationId, requestedQty: request.qty, unpickedQty: Math.max(0, unpicked) });
        continue;
      }
      takenAtSource.set(key, (takenAtSource.get(key) ?? 0) + request.qty);
      planned.push({ row, qty: request.qty });
    }
    if (errors.length) {
      throw new ConflictException({
        code: 'SHORT_PICK_EXCEEDS_UNPICKED',
        message: 'Short quantity exceeds the unpicked share at the location',
        errors,
      });
    }
    return planned.map(({ row, qty }) => ({
      allocationId: row.allocationId,
      shipmentLineId: row.shipmentLineId,
      skuId: row.skuId,
      sourceLocationId: row.sourceLocationId,
      allocationQty: row.qty,
      qty,
    }));
  }

  /**
   * planShortages 의 결과를 적용한다 — 배정마다 AT_SOURCE 에서 부족 승인 + 배정 −k 를 같은 트랜잭션에서(복구 규칙 정한 것 9).
   * 배정 행·보관 행은 planShortages·lockOpenSession 이 잠갔다. 세션이 «안 집은 몫» 을 다시 검사한다(방어선).
   */
  async approveShortages(
    input: {
      session: BatchInventorySessionRow;
      workItemId: string;
      shortPickOperationId: string;
      actorId: string;
      reasonCode: ApprovedShortageReasonCode;
      reason: string;
      planned: PlannedShortage[];
    },
    trx: DbTx,
  ): Promise<void> {
    for (const shortage of input.planned) {
      await this.sessions.approveShortage(
        {
          sessionId: input.session.id,
          idempotencyKey: shortageIdempotencyKey(input.shortPickOperationId, shortage.allocationId),
          shortPickOperationId: input.shortPickOperationId,
          workItemId: input.workItemId,
          allocationId: shortage.allocationId,
          shipmentLineId: shortage.shipmentLineId,
          quantity: shortage.qty,
          from: { skuId: shortage.skuId, sourceLocationId: shortage.sourceLocationId, custodyType: 'AT_SOURCE' },
          reasonCode: input.reasonCode,
          reason: input.reason,
          approverId: input.actorId,
        },
        trx,
      );
      await this.decrementAllocation(shortage.allocationId, shortage.qty, trx);
    }
  }

  /**
   * 결품 뒤 목표(줄 수량)로 되돌리는 계획(스펙 §9-3, 정한 것 5). 쓰지 않는다. 후보에서 이번 결품의 (SKU, 로케이션)을 뺀다 —
   * 원장은 그대로라 그 로케이션에 유령 재고가 일반 가용으로 보인다(정한 것 2). 모자란 줄이 있는 SKU 만 가용 잠금을 잡는다.
   */
  async planRefill(
    input: {
      session: BatchInventorySessionRow;
      warehouseId: string;
      workItemId: string;
      lines: Array<{ id: string; skuId: string; qty: number }>;
      excludedSources: ReadonlyArray<{ skuId: string; sourceLocationId: string }>;
    },
    trx: DbTx,
  ): Promise<ReconcilePlan> {
    const { rows, atSource } = await this.loadReconcileState(input.session.id, input.workItemId, new Set(input.lines.map((l) => l.id)), trx);
    const allocated = new Map<string, number>();
    for (const row of rows) allocated.set(row.shipmentLineId, (allocated.get(row.shipmentLineId) ?? 0) + row.qty);
    const deficitSkus = input.lines.filter((line) => (allocated.get(line.id) ?? 0) < line.qty).map((line) => line.skuId);
    const excluded = new Set(input.excludedSources.map((source) => atSourceKey(source.skuId, source.sourceLocationId)));
    const { capacities, inboundPendingBySku } = deficitSkus.length
      ? await lockSkuCapacities(trx, this.controlledStock, input.warehouseId, deficitSkus)
      : { capacities: [], inboundPendingBySku: new Map<string, number>() };
    return reconcileAllocation({
      workItemId: input.workItemId,
      targets: input.lines.map((line) => ({ shipmentLineId: line.id, skuId: line.skuId, targetQty: line.qty })),
      allocations: rows,
      atSource,
      capacities: capacities.filter((capacity) => !excluded.has(atSourceKey(capacity.skuId, capacity.sourceLocationId))),
      inboundPendingBySku,
    });
  }

  /**
   * 재배정 계획을 적용한다 — 같은 (작업 항목, 줄, 로케이션) 행이 있으면 늘리고(원래 source_stock_version 유지 — 복구가 인계 이벤트와
   * 견준다), 없으면 만든다. 그리고 실행 중 세션에 인계한다(키 `hand-in:<명령 id>:<배정 id>`).
   */
  async applyRefill(
    input: {
      session: BatchInventorySessionRow;
      batchId: string;
      actorId: string;
      operationId: string;
      plan: ReconcilePlan;
      lines: Array<{ id: string; skuId: string }>;
    },
    trx: DbTx,
  ): Promise<RefillView[]> {
    const { plan } = input;
    if (plan.shortages.length || plan.handBacks.length || plan.cartSurplus.length || plan.excess.length || !plan.handIns.length) {
      throw new Error('applyRefill: a refill plan must be a non-empty pure hand-in');
    }
    const A = wmsTables.pickingSourceAllocations;
    const skuByLine = new Map(input.lines.map((line) => [line.id, line.skuId]));
    const allocations: SessionStartAllocation[] = [];
    for (const draft of plan.handIns) {
      const [grown] = await trx
        .update(A)
        .set({ qty: sql`${A.qty} + ${draft.qty}` })
        .where(and(eq(A.workItemId, draft.workItemId), eq(A.shipmentLineId, draft.shipmentLineId), eq(A.sourceLocationId, draft.sourceLocationId)))
        .returning();
      const row = grown ?? (await trx.insert(A).values(draft).returning())[0];
      allocations.push({
        id: row.id,
        // holds because every draft carries the refilled work item id (planRefill's workItemId).
        workItemId: row.workItemId!,
        shipmentLineId: row.shipmentLineId,
        // holds because plan.handIns came from input.lines' targets.
        skuId: skuByLine.get(row.shipmentLineId)!,
        sourceLocationId: row.sourceLocationId,
        quantity: draft.qty,
        sourceStockVersion: row.sourceStockVersion,
      });
    }
    await this.sessions.handIn(
      { sessionId: input.session.id, batchId: input.batchId, actorId: input.actorId, operationId: input.operationId, allocations },
      trx,
    );
    const codes = await trx
      .select({ id: wmsTables.locations.id, code: wmsTables.locations.code })
      .from(wmsTables.locations)
      .where(inArray(wmsTables.locations.id, [...new Set(plan.handIns.map((draft) => draft.sourceLocationId))]));
    const codeById = new Map(codes.map((row) => [row.id, row.code]));
    return plan.handIns.map((draft) => ({
      shipmentLineId: draft.shipmentLineId,
      skuId: skuByLine.get(draft.shipmentLineId)!,
      sourceLocationId: draft.sourceLocationId,
      locationCode: codeById.get(draft.sourceLocationId) ?? '',
      qty: draft.qty,
    }));
  }
```

import 를 더한다:
- `shortageIdempotencyKey`·`ApprovedShortageReasonCode`(`./batch-inventory-session.service`)
- `ReconcileAllocationRow`(`../picking/allocation/reconcile-allocation`)
- drizzle 의 `asc`·`inArray`

`!` 두 곳은 기존 `applyJoin` 과 같은 근거 주석을 단다.

- [ ] **Step 4: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "box-allocation.short-pick|batch-withdraw|batch-join"`
Expected: PASS — 새 스펙 넷, 그리고 `loadReconcileState` 추출이 PR 2·3 의 반납·합류를 깨지 않았는지.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/box-allocation.manager.ts \
  apps/core/src/modules/fulfillment/services/box-allocation.short-pick.integration.spec.ts
git commit -m "feat(fulfillment): 배정 실행부에 부족 승인·재배정 계획·적용을 더한다 — 결품 로케이션은 후보에서 뺀다 (#990)"
```

---

### Task 5: 결품 이탈의 마무리 — `ShortPickExitService`, 나가기·전체 취소 넘겨받기

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/short-pick-exit.service.ts`
- Modify: `apps/core/src/modules/fulfillment/services/box-withdrawal.service.ts`
  - 생성자
  - `exitIfDrained`
  - `escalate`
  - `canceledExitWaybill` 이름을 `exitWaybill` 로 바꾼다
- Modify: `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts` (`exitWaybill` 이름만)
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts` (provider)
- Modify: `apps/core/src/modules/fulfillment/services/__support__/simple-outbound-wiring.ts`, `__support__/box-withdrawal-wiring.ts`, 그리고 `new BoxWithdrawalService(` 를 부르는 모든 스펙(`grep -rln "new BoxWithdrawalService(" apps/core/src scripts`)
- Test: `apps/core/src/modules/fulfillment/services/short-pick-exit.integration.spec.ts` (신규)

**Interfaces:**
- Consumes: `ShipmentReservationService.invalidateForShortPick(lineId, qty, operationId, tx)`, `WaybillService.getActiveWaybill`·`void`, `shortPickOperationIntentOf`(세션 서비스)
- Produces:
  ```ts
  @Injectable() export class ShortPickExitService {
    pendingFor(workItem: { id: string; waitingOperationId: string | null }, trx: DbTx): Promise<ShortPickOperationIntentProof | null>;
    finish(intent: ShortPickOperationIntentProof, ctx: { actorId: string; operationId: string }, trx: DbTx): Promise<{ voidedWaybillId: string | null }>;
    supersede(intent: ShortPickOperationIntentProof, cancellationOperationId: string, trx: DbTx): Promise<void>;
  }
  ```
  - `BoxWithdrawalService` 생성자: `(invariant, boxes, totes, waybills, audit, shortPicks: ShortPickExitService)`
  - `exitWaybill(shipmentId, trx)` — 옛 `canceledExitWaybill`
  - `exitIfDrained`: 결품을 기다리던 작업 항목은 `finish` 한 뒤 `waitingOperationId: null` 로 나간다(커밋 뒤 재개 대상 아님)
  - `escalate`: 결품을 기다리던 작업 항목은 `supersede` 한 뒤 취소 오퍼레이션을 기다린다

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `short-pick-exit.integration.spec.ts`

결품 보고 명령은 Task 6 이 만든다. 이 스펙은 «보고 트랜잭션이 남기는 상태»를 손으로 만든다: 부족 승인 → 이탈 시작(`begin`, `waitingOperationId` = 결품 오퍼레이션). 그다음 나가기의 마무리를 본다.

```ts
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { assertFulfillmentInvariantsFor } from './__support__/logistics-assertions';
import { seedShortPickOperation } from './__support__/short-pick-fixtures';
import { seedPickableShipment } from './__support__/logistics-fixtures';
import { seedReturnBin } from './__support__/simple-outbound-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('결품 이탈의 마무리 (스펙 §9-5, PR 4)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 박스(A 3개)를 시작하고 picked 개를 집은 뒤, 2개 결품(못 채움) 상태로 이탈을 시작한다. */
  async function withdrawingForShortPick(tx: DbTx, picked: number) {
    const box = await seedPickableShipment(tx, 3);
    const wiring = assembleOutbound(tx);
    const run = await wiring.picking.start({ batchId: box.batchId, actorId: box.actorId, idempotencyKey: `s-${randomUUID()}` }, tx);
    if (picked) {
      await wiring.sessions.moveCustody(
        {
          sessionId: run.sessionId,
          idempotencyKey: `pick-${randomUUID()}`,
          actorId: box.actorId,
          quantity: picked,
          from: { skuId: box.skuId, sourceLocationId: box.locationId, custodyType: 'AT_SOURCE' },
          to: { skuId: box.skuId, sourceLocationId: box.locationId, custodyType: 'WORKER', custodyRef: box.actorId, shipmentLineId: box.shipmentLineId },
        },
        tx,
      );
    }
    const session = await wiring.boxes.lockOpenSession(box.batchId, tx);
    if (!session) throw new Error('session missing');
    const operation = await seedShortPickOperation(tx, {
      shipmentId: box.shipmentId,
      workItemId: box.workItemId,
      sessionId: session.id,
      actorId: box.actorId,
      lines: [{ shipmentLineId: box.shipmentLineId, sourceLocationId: box.locationId, shortQty: 2, allocationQty: 3 }],
    });
    const planned = await wiring.boxes.planShortages(
      { session, workItemId: box.workItemId,
        shortages: [{ shipmentLineId: box.shipmentLineId, sourceLocationId: box.locationId, qty: 2 }] },
      tx,
    );
    await wiring.boxes.approveShortages(
      { session, workItemId: box.workItemId, shortPickOperationId: operation.id, actorId: box.actorId,
        reasonCode: 'MISSING', reason: operation.reason, planned },
      tx,
    );
    const [workItem] = await tx.select().from(wmsTables.outboundBatchWorkItems).where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId)).for('update');
    const outcome = await wiring.withdrawals.begin(
      {
        batchId: box.batchId,
        shipmentId: box.shipmentId,
        shipmentStatus: 'planned',
        workItem,
        lines: [{ id: box.shipmentLineId, skuId: box.skuId }],
        exitTo: 'draft',
        reason: `short_pick:${operation.reason}`,
        waitingOperationId: operation.id,
        actorId: box.actorId,
        operationId: randomUUID(),
      },
      tx,
    );
    return { box, wiring, sessionId: run.sessionId, operation, outcome };
  }

  async function stateOf(tx: DbTx, box: { shipmentId: string; shipmentLineId: string; workItemId: string }, operationId: string) {
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
    const [workItem] = await tx.select().from(wmsTables.outboundBatchWorkItems).where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
    const waybills = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.shipmentId, box.shipmentId));
    const reservations = await tx.select().from(wmsTables.stockReservations).where(eq(wmsTables.stockReservations.shipmentLineId, box.shipmentLineId));
    const [operation] = await tx.select().from(wmsTables.shipmentOperations).where(eq(wmsTables.shipmentOperations.id, operationId));
    return { shipment, workItem, waybills, reservations, operation };
  }

  it('집은 게 없으면 그 트랜잭션에서 나가며 결품을 마무리한다 — 예약 −2, 송장 무효, 박스 draft, 오퍼레이션 completed', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, sessionId, operation, outcome } = await withdrawingForShortPick(tx, 0);
      expect(outcome.kind).toBe('exited');
      const state = await stateOf(tx, box, operation.id);
      expect(state.workItem).toMatchObject({ status: 'excluded', exitTo: 'draft', waitingOperationId: null });
      expect(state.shipment).toMatchObject({ status: 'draft', manifestVersion: 2, plannedAt: null, recoveryCode: null });
      expect(state.waybills.map((w) => w.status)).toEqual(['voided']);
      expect(state.reservations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'confirmed', quantity: 1 }),
          expect.objectContaining({ status: 'released', quantity: 2 }),
        ]),
      );
      expect(state.operation).toMatchObject({ status: 'completed' });
      expect(state.operation.afterManifestSnapshot).toMatchObject({ voidedWaybillId: box.waybillId });
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });

  it('집은 게 있으면 withdrawing 동안 박스·송장·예약이 그대로이고, 마지막 되돌림에서 마무리한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, sessionId, operation, outcome } = await withdrawingForShortPick(tx, 1);
      expect(outcome.kind).toBe('withdrawing');
      const during = await stateOf(tx, box, operation.id);
      expect(during.shipment).toMatchObject({ status: 'planned', manifestVersion: 1 });
      expect(during.waybills.map((w) => w.status)).toEqual(['registered']);
      expect(during.reservations).toEqual([expect.objectContaining({ status: 'confirmed', quantity: 3 })]);
      expect(during.operation.status).toBe('pending');
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);

      const bin = await seedReturnBin(tx, box.warehouseId, box.actorId);
      const removed = await wiring.returns.removeToReturnBin(
        box.shipmentId,
        { barcode: box.barcode, returnBinBarcode: bin.barcode, quantity: 1 },
        { id: box.actorId, roles: ['master'] },
        `rb-${randomUUID()}`,
        tx,
      );
      expect(removed).toMatchObject({ exited: true, exitTo: 'draft', waitingOperationId: null });
      const after = await stateOf(tx, box, operation.id);
      expect(after.shipment).toMatchObject({ status: 'draft', manifestVersion: 2 });
      expect(after.waybills.map((w) => w.status)).toEqual(['voided']);
      expect(after.operation.status).toBe('completed');
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });

  it('전체 취소가 결품으로 빼는 중인 박스를 넘겨받는다 — 결품 오퍼레이션은 닫히고 취소가 마지막 되돌림에서 완료된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, operation } = await withdrawingForShortPick(tx, 1);
      const [line] = await tx.select().from(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));
      const canceled = await wiring.planning.cancelOutstanding(
        box.shipmentId,
        { expectedManifestVersion: 1, lines: [{ shipmentLineId: line.id, expectedLineVersion: line.lineVersion, qty: 3 }], reason: '고객 취소' },
        `c-${randomUUID()}`,
        { id: box.actorId, roles: ['master'] },
        tx,
      );
      expect(canceled.operationStatus).toBe('pending');
      const [shortPick] = await tx.select().from(wmsTables.shipmentOperations).where(eq(wmsTables.shipmentOperations.id, operation.id));
      expect(shortPick.status).toBe('completed');
      expect(shortPick.afterManifestSnapshot).toMatchObject({ supersededByOperationId: canceled.operationId });
      const [workItem] = await tx.select().from(wmsTables.outboundBatchWorkItems).where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
      expect(workItem).toMatchObject({ status: 'withdrawing', exitTo: 'canceled', waitingOperationId: canceled.operationId });

      const bin = await seedReturnBin(tx, box.warehouseId, box.actorId);
      await wiring.returns.removeToReturnBin(
        box.shipmentId,
        { barcode: box.barcode, returnBinBarcode: bin.barcode, quantity: 1 },
        { id: box.actorId, roles: ['master'] },
        `rb-${randomUUID()}`,
        tx,
      );
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      expect(shipment.status).toBe('canceled');
      const confirmed = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(and(eq(wmsTables.stockReservations.shipmentLineId, box.shipmentLineId), eq(wmsTables.stockReservations.status, 'confirmed')));
      expect(confirmed).toEqual([]);
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });
});
```

`cancelOutstanding` 의 인자 모양(`CancelShipmentOutstandingDto`)은 PR 3 의 `batch-cancel-withdraw.integration.spec.ts` 가 부르는 모양을 그대로 따른다. `box.waybillId`·`box.barcode` 는 `PickableShipmentFixture` 에 있다.

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- short-pick-exit`
Expected: FAIL — 첫 케이스에서 박스가 `planned` 로 남는다(나가기가 결품을 모른다). 셋째 케이스는 `CANCELLATION_WORK_ITEM_ALREADY_WAITING`.

- [ ] **Step 3: `ShortPickExitService` 를 만든다** — `services/short-pick-exit.service.ts`

```ts
import { ConflictException, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { WaybillService } from '../waybill/waybill.service';
import { ShortPickOperationIntentProof, shortPickOperationIntentOf } from './batch-inventory-session.service';
import { ShipmentReservationService } from './shipment-reservation.service';

const OPS = wmsTables.shipmentOperations;

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

/**
 * 결품으로 빠지는 박스의 마무리(스펙 §9-5, PR 4 계획이 정함 3·7). 나가기(`BoxWithdrawalService.exitIfDrained`)와
 * 전체 취소의 넘겨받기(`escalate`)만 부른다. 호출자가 구성요소·작업 항목·세션을 이미 잡았고, 결품 오퍼레이션 행은 그 뒤에 잡는다.
 */
@Injectable()
export class ShortPickExitService {
  constructor(
    private readonly reservations: ShipmentReservationService,
    private readonly waybills: WaybillService,
    private readonly audit: AuditService,
  ) {}

  /** 작업 항목이 기다리는 오퍼레이션이 진행 중인 결품이면 그 의도(행을 잠근다). 아니면 null. */
  async pendingFor(
    workItem: { id: string; waitingOperationId: string | null },
    trx: DbTx,
  ): Promise<ShortPickOperationIntentProof | null> {
    if (!workItem.waitingOperationId) return null;
    const [operation] = await trx
      .select({ type: OPS.type, status: OPS.status, snapshot: OPS.beforeManifestSnapshot })
      .from(OPS)
      .where(eq(OPS.id, workItem.waitingOperationId))
      .limit(1)
      .for('update');
    if (operation?.type !== 'short_pick' || operation.status !== 'pending') return null;
    const intent = shortPickOperationIntentOf(operation.snapshot);
    if (!intent || intent.workItemId !== workItem.id) {
      throw new Error(`Short-pick operation ${workItem.waitingOperationId} does not belong to work item ${workItem.id}`);
    }
    return intent;
  }

  /** 부족분 예약 무효화 → 송장 로컬 무효화 → 박스 draft → 오퍼레이션 completed. 한 트랜잭션(호출자의 것). */
  async finish(
    intent: ShortPickOperationIntentProof,
    ctx: { actorId: string; operationId: string },
    trx: DbTx,
  ): Promise<{ voidedWaybillId: string | null }> {
    const shortByLine = new Map<string, number>();
    for (const line of intent.lines) {
      if (line.shortQty > 0) shortByLine.set(line.shipmentLineId, (shortByLine.get(line.shipmentLineId) ?? 0) + line.shortQty);
    }
    for (const [shipmentLineId, qty] of [...shortByLine].sort(([l], [r]) => l.localeCompare(r))) {
      await this.reservations.invalidateForShortPick(shipmentLineId, qty, intent.operationId, trx);
    }
    const active = await this.waybills.getActiveWaybill(intent.shipmentId, trx);
    if (active && active.status !== 'registered') {
      throw conflict(
        'WITHDRAWAL_WAYBILL_NOT_VOIDABLE',
        `Waybill ${active.id} is ${active.status}; resolve it before the short-picked box can leave its batch`,
      );
    }
    if (active) {
      await this.waybills.void(
        active.id,
        { reason: `short_pick:${intent.reason}` },
        `short-pick-exit:${intent.operationId}`,
        { id: ctx.actorId, roles: [] },
        trx,
      );
    }
    const [shipment] = await trx
      .select()
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, intent.shipmentId))
      .limit(1)
      .for('update');
    const [drafted] = shipment
      ? await trx
          .update(wmsTables.shipments)
          .set({ status: 'draft', recoveryCode: null, plannedAt: null, manifestVersion: shipment.manifestVersion + 1, lastUpdated: new Date() })
          .where(
            and(
              eq(wmsTables.shipments.id, shipment.id),
              eq(wmsTables.shipments.status, 'planned'),
              eq(wmsTables.shipments.manifestVersion, shipment.manifestVersion),
            ),
          )
          .returning()
      : [];
    if (!drafted) throw conflict('SHIPMENT_STALE_MANIFEST_VERSION', `Shipment ${intent.shipmentId} changed before short-pick exit`);
    await trx
      .update(wmsTables.shipmentLines)
      .set({ inspectedQty: 0, lineVersion: sql`${wmsTables.shipmentLines.lineVersion} + 1` })
      .where(eq(wmsTables.shipmentLines.shipmentId, intent.shipmentId));
    const after = { outcome: 'exited', shipment: drafted, retiredWorkItemId: intent.workItemId, voidedWaybillId: active?.id ?? null };
    await this.complete(intent, after, drafted.manifestVersion, trx);
    await this.audit.logUserActionRequired(
      'shipment.short_pick.completed',
      'fulfillment',
      `Short pick operation ${intent.operationId} returned shipment ${intent.shipmentId} to Draft`,
      { userId: ctx.actorId },
      { operationId: intent.operationId, commandId: ctx.operationId, after },
      trx,
    );
    return { voidedWaybillId: active?.id ?? null };
  }

  /** 전체 취소가 넘겨받는다 — 결품 오퍼레이션만 닫는다. 예약·송장·박스는 취소 완료가 정리한다(정한 것 7). */
  async supersede(intent: ShortPickOperationIntentProof, cancellationOperationId: string, trx: DbTx): Promise<void> {
    await this.complete(intent, { outcome: 'superseded', supersededByOperationId: cancellationOperationId }, null, trx);
  }

  private async complete(
    intent: ShortPickOperationIntentProof,
    after: Record<string, unknown>,
    afterManifestVersion: number | null,
    trx: DbTx,
  ): Promise<void> {
    await trx
      .update(wmsTables.shipmentOperationMembers)
      .set({ afterManifestVersion, afterManifestSnapshot: after })
      .where(
        and(
          eq(wmsTables.shipmentOperationMembers.operationId, intent.operationId),
          eq(wmsTables.shipmentOperationMembers.shipmentId, intent.shipmentId),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
        ),
      );
    const [done] = await trx
      .update(OPS)
      .set({ status: 'completed', afterManifestSnapshot: after, lastError: null, completedAt: new Date() })
      .where(and(eq(OPS.id, intent.operationId), eq(OPS.status, 'pending')))
      .returning({ id: OPS.id });
    if (!done) throw conflict('SHORT_PICK_OPERATION_STALE', `Short-pick operation ${intent.operationId} is no longer pending`);
  }
}
```

`shipmentOperationMembers.afterManifestVersion` 이 NOT NULL 이면 `supersede` 는 `afterManifestVersion` 을 건드리지 않게 `complete` 의 set 을 조건부로 만든다. 실행자가 스키마를 보고 맞춘다.

- [ ] **Step 4: 이탈 서비스에 잇는다** — `box-withdrawal.service.ts`

   1. 생성자 끝에 `private readonly shortPicks: ShortPickExitService` 를 더한다.
   2. `canceledExitWaybill` 의 이름을 `exitWaybill` 로 바꾸고 주석에 결품 마무리를 더한다(보고 때 판정, `ShipmentShortPickService`). `voidWaybillForCanceledExit` 와 `ShipmentPlanningService.withdrawalTarget` 의 호출도 바꾼다.
   3. `exitIfDrained` 를 고친다:

```ts
    if (Number(row?.qty ?? 0) > 0) return { exited: false, workItem };
    // 결품으로 빠지는 박스(PR 4 계획이 정함 3)는 이 트랜잭션에서 결품을 마무리한다 — 커밋 뒤 재개할 대기가 아니므로 비운다.
    const shortPick = workItem.exitTo === 'draft' ? await this.shortPicks.pendingFor(workItem, trx) : null;
    const [excluded] = await trx
      .update(WI)
      .set({
        status: 'excluded',
        leaseExpiresAt: null,
        leaseVersion: workItem.leaseVersion + 1,
        waitingOperationId: shortPick ? null : workItem.waitingOperationId,
        updatedAt: sql`now()`,
      })
      // …where·returning 그대로
    // …토트 해제 그대로
    if (excluded.exitTo === 'canceled') await this.voidWaybillForCanceledExit(excluded.shipmentId, ctx, trx);
    if (shortPick) await this.shortPicks.finish(shortPick, ctx, trx);
    // …감사 로그 그대로(payload 에 shortPickOperationId: shortPick?.operationId ?? null 을 더한다)
```

   4. `escalate` 를 고친다:

```ts
  /** 이미 빼는 중 — 전체 취소만 draft → canceled 로 올린다(정한 것 5). 결품을 기다리던 박스는 취소가 넘겨받는다(PR 4 계획이 정함 7). */
  private async escalate(input: BeginWithdrawalInput, trx: DbTx): Promise<BeginWithdrawalResult> {
    const item = input.workItem;
    if (input.exitTo !== 'canceled' || item.exitTo !== 'draft' || !input.waitingOperationId) {
      throw conflict('SHIPMENT_ALREADY_WITHDRAWING', `Shipment ${input.shipmentId} is already leaving batch ${item.batchId}`);
    }
    const shortPick = await this.shortPicks.pendingFor(item, trx);
    if (shortPick) await this.shortPicks.supersede(shortPick, input.waitingOperationId, trx);
    else this.assertWaitingSlot(item, input.waitingOperationId);
    // …update(exitTo: 'canceled', waitingOperationId: input.waitingOperationId) 그대로
  }
```

- [ ] **Step 5: 배선한다**
   - `fulfillment.module.ts` providers 에 `ShortPickExitService` 를 더한다.
   - `__support__/simple-outbound-wiring.ts`: `const shortPicks = new ShortPickExitService(shipmentReservations, waybills, audit);` 를 `withdrawals` 앞에 두고 `new BoxWithdrawalService(invariant, boxes, totes, waybills, audit, shortPicks)` 로 부른다.
   - `__support__/box-withdrawal-wiring.ts` 는 `ShipmentReservationService` 가 필요하다. `new ShipmentReservationService(dbService, new UnifiedReservationService(dbService, new ProductSellableQuantityService(dbService as never, outboxPublisherFor(INVENTORY_STREAM, dbService))), new FulfillmentProgressService(), new FulfillmentInvariantService())` 로 조립한다(simple-outbound-wiring 과 같은 모양 — import 도 그쪽에서 가져온다).
   - `grep -rln "new BoxWithdrawalService(" apps/core/src scripts` 로 나온 나머지 스펙은 끝 인자에 `{} as never` 를 더한다. 그 스펙들은 결품 경로에 닿지 않는다. 닿으면 실패로 드러나고, 그때는 진짜로 조립한다.

- [ ] **Step 6: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "short-pick-exit|batch-cancel-withdraw|batch-withdraw|return-bin-removal"` 그리고 `npx jest apps/core/src/modules/fulfillment --maxWorkers=2`
Expected: PASS — 새 스펙 셋과 PR 3 이탈·취소·되돌림 스펙 전부(`exitWaybill` 이름 변경·배선 인자 추가가 깨지 않았는지).

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/short-pick-exit.service.ts \
  apps/core/src/modules/fulfillment/services/box-withdrawal.service.ts \
  apps/core/src/modules/fulfillment/services/shipment-planning.service.ts \
  apps/core/src/modules/fulfillment/fulfillment.module.ts \
  apps/core/src/modules/fulfillment/services/__support__ \
  apps/core/src/modules/fulfillment/services/short-pick-exit.integration.spec.ts
git add -u apps/core/src scripts
git commit -m "feat(fulfillment): 결품으로 빠지는 박스는 나갈 때 예약·송장을 정리하고 초안으로 — 전체 취소가 넘겨받는다 (#990)"
```

---

### Task 6: 결품 보고 — 채우거나 빼거나(`ShipmentShortPickService.report` 재작성)

**Files:**
- Modify(대부분 다시 씀): `apps/core/src/modules/fulfillment/services/shipment-short-pick.service.ts`
- Modify: `apps/core/src/modules/fulfillment/dto/shipment-short-pick.dto.ts` (응답)
- Modify: `apps/core/src/modules/fulfillment/services/__support__/simple-outbound-wiring.ts` (`shortPick` 반환)
- Test(다시 씀): `apps/core/src/modules/fulfillment/services/shipment-short-pick.integration.spec.ts`, `apps/core/src/modules/fulfillment/services/shipment-short-pick.service.spec.ts`
- Test: `apps/core/src/modules/fulfillment/controllers/shipment-short-pick.controller.spec.ts` (응답 모양만 바뀌면 기대 갱신)

**Interfaces:**
- Consumes: Task 4 `approveShortages`·`planRefill`·`applyRefill`, Task 5 `BoxWithdrawalService.begin`·`exitWaybill`·`lockComponentsOf`, `describeStartBlockers`(`picking/allocation/allocation.locks`)
- Produces:
  ```ts
  // 생성자
  new ShipmentShortPickService(commands, authorization, audit, workflowGate, boxes: BoxAllocationManager, withdrawals: BoxWithdrawalService)
  // 응답
  export class ShortPickRefillDto { shipmentLineId: string; skuId: string; sourceLocationId: string; locationCode: string; qty: number }
  export class ShortPickShortageDto { shipmentLineId: string | null; skuId: string | null; skuCode: string | null; skuName: string | null;
    requiredQty: number | null; shortQty: number | null; reason: 'INBOUND_PENDING' | 'STOCK_SHORT' }
  export class ShipmentShortPickResponseDto {
    operationId: string; shipmentId: string; workItemId: string;
    operationStatus: 'pending' | 'completed';
    invoiceOperationId: null;
    outcome: 'refilled' | 'withdrawing' | 'exited';
    refills: ShortPickRefillDto[];
    shortages: ShortPickShortageDto[];
  }
  ```
  - 요청 DTO(`ReportShipmentShortPickDto`)는 바꾸지 않는다 — admin-web 계약.
  - `report(shipmentId, dto, idempotencyKey, actor, tx?)` — 끝에 선택 `tx`(테스트·바깥 트랜잭션용, 컨트롤러 호출 모양 불변)
  - 테스트 헬퍼(`services/__support__/short-pick-fixtures.ts`에 더한다 — Task 7·8 이 쓴다):
    ```ts
    export async function startedShortPickBox(tx: DbTx, picked = 0): Promise<{
      box: PickableShipmentFixture;               // A 3개, 픽스처 로케이션 L1 재고 3, 시작된 배치(개별 피킹)
      wiring: ReturnType<typeof assembleOutbound>;
      sessionId: string;
      report: (shortQty: number, key?: string) => Promise<ShipmentShortPickResponseDto>; // L1 결품, 최신 버전들을 읽어 보낸다
    }>;
    ```
  - 사라짐: `resumePending`, `markRecoveryRequired`, `quarantineWorkItem`, `reconcileAffectedCustody`, `assertNoPositiveCustody`, `currentResponse`, `lockAndValidatePhysical`

- [ ] **Step 1: 실패하는 통합 테스트를 쓴다** — `shipment-short-pick.integration.spec.ts` 를 **새로 쓴다**. 옛 케이스 넷은 옛 계약(즉시 제외·초안 복귀)을 단언하므로 지운다 — PR 본문의 «지우거나 바꾼 테스트»에 적는다.

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { assertFulfillmentInvariantsFor } from './__support__/logistics-assertions';
import { seedPickableShipment } from './__support__/logistics-fixtures';
import { seedSpareStock } from './__support__/short-pick-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('결품 보고 — 재배정 (스펙 §9, PR 4)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 박스(A 3개, L1 재고 3)를 시작하고 picked 개를 집는다. report(shortQty) 는 L1 결품을 보고한다. */
  async function started(tx: DbTx, picked = 0) {
    const box = await seedPickableShipment(tx, 3);
    const wiring = assembleOutbound(tx);
    const run = await wiring.picking.start({ batchId: box.batchId, actorId: box.actorId, idempotencyKey: `s-${randomUUID()}` }, tx);
    if (picked) {
      await wiring.sessions.moveCustody(
        {
          sessionId: run.sessionId,
          idempotencyKey: `pick-${randomUUID()}`,
          actorId: box.actorId,
          quantity: picked,
          from: { skuId: box.skuId, sourceLocationId: box.locationId, custodyType: 'AT_SOURCE' },
          to: { skuId: box.skuId, sourceLocationId: box.locationId, custodyType: 'WORKER', custodyRef: box.actorId, shipmentLineId: box.shipmentLineId },
        },
        tx,
      );
    }
    const report = async (shortQty: number, key = `sp-${randomUUID()}`) => {
      const [session] = await tx.select().from(wmsTables.batchInventorySessions).where(eq(wmsTables.batchInventorySessions.id, run.sessionId));
      const [workItem] = await tx.select().from(wmsTables.outboundBatchWorkItems).where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
      const [line] = await tx.select().from(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      return wiring.shortPick.report(
        box.shipmentId,
        {
          workItemId: box.workItemId,
          expectedWorkItemLeaseVersion: workItem.leaseVersion,
          sessionId: session.id,
          expectedSessionVersion: session.version,
          expectedManifestVersion: shipment.manifestVersion,
          lines: [{ shipmentLineId: line.id, sourceLocationId: box.locationId, expectedLineVersion: line.lineVersion, shortQty }],
          reason: 'inventory_shortage',
        },
        key,
        actor,
        tx,
      );
    };
    return { box, wiring, sessionId: run.sessionId, report };
  }

  it('다른 로케이션 재고로 채운다 — 박스·작업 항목·송장·예약은 그대로, 오퍼레이션 completed, 송장은 재출력 대상', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, sessionId, report } = await started(tx, 1);
      const spare = await seedSpareStock(tx, box, 5);
      const [before] = await tx.select().from(wmsTables.outboundBatchWorkItems).where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));

      const result = await report(2);

      expect(result).toMatchObject({
        outcome: 'refilled',
        operationStatus: 'completed',
        refills: [{ shipmentLineId: box.shipmentLineId, sourceLocationId: spare.locationId, locationCode: spare.code, qty: 2 }],
        shortages: [],
      });
      const [after] = await tx.select().from(wmsTables.outboundBatchWorkItems).where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
      expect(after).toMatchObject({ status: before.status, leaseVersion: before.leaseVersion, waitingOperationId: null });
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      expect(shipment).toMatchObject({ status: 'planned', manifestVersion: 1 });
      const [waybill] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.shipmentId, box.shipmentId));
      expect(waybill.status).toBe('registered'); // 송장 스캔의 reprint_required 는 Task 8 이 본다
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });

  it('집은 몫을 넘는 결품(3개 중 1개 집고 3개 결품)은 SHORT_PICK_EXCEEDS_UNPICKED — 오퍼레이션도 남지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, report } = await started(tx, 1);
      const error = await tx.transaction(() => report(3)).catch((e: unknown) => e);
      expect(error).toMatchObject({ response: { code: 'SHORT_PICK_EXCEEDS_UNPICKED' } });
      const operations = await tx
        .select()
        .from(wmsTables.shipmentOperationMembers)
        .where(eq(wmsTables.shipmentOperationMembers.shipmentId, box.shipmentId));
      expect(operations).toEqual([]);
    });
  });

  it('못 채우고 집은 것도 없으면 그 자리에서 빠진다 — outcome exited, shortages 에 STOCK_SHORT', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, sessionId, wiring, report } = await started(tx, 0);
      const result = await report(2);
      expect(result).toMatchObject({
        outcome: 'exited',
        operationStatus: 'completed',
        refills: [],
        shortages: [expect.objectContaining({ shipmentLineId: box.shipmentLineId, shortQty: 2, reason: 'STOCK_SHORT' })],
      });
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      expect(shipment.status).toBe('draft');
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });

  it('못 채우고 집은 게 있으면 withdrawing — 오퍼레이션 pending, 박스 planned·송장 유효', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, report } = await started(tx, 1);
      const result = await report(2);
      expect(result).toMatchObject({ outcome: 'withdrawing', operationStatus: 'pending' });
      const [workItem] = await tx.select().from(wmsTables.outboundBatchWorkItems).where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
      expect(workItem).toMatchObject({ status: 'withdrawing', exitTo: 'draft', waitingOperationId: result.operationId, exclusionReason: 'short_pick:inventory_shortage' });
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });

  it('같은 멱등 키는 같은 응답을 돌려준다(재배정을 두 번 하지 않는다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, report } = await started(tx, 0);
      await seedSpareStock(tx, box, 5);
      const key = `sp-${randomUUID()}`;
      const first = await report(2, key);
      const second = await report(2, key);
      expect(second).toEqual(first);
      const rows = await tx.select().from(wmsTables.pickingSourceAllocations).where(eq(wmsTables.pickingSourceAllocations.workItemId, box.workItemId));
      expect(rows.reduce((total, row) => total + row.qty, 0)).toBe(3);
    });
  });

  it('빼는 중인 박스는 SHIPMENT_WITHDRAWN, 세션이 recovery_required 면 PICKING_SESSION_NOT_ACTIVE', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, sessionId, report } = await started(tx, 1);
      await wiring.batches.excludeShipment(box.batchId, box.shipmentId, { reason: '급한 변경' }, `x-${randomUUID()}`, actor, tx);
      await expect(tx.transaction(() => report(1))).rejects.toMatchObject({ response: { code: 'SHIPMENT_WITHDRAWN' } });
      void sessionId;
    });
    await inRollbackTx(db, async (tx) => {
      const { sessionId, report } = await started(tx, 0);
      await tx.update(wmsTables.batchInventorySessions).set({ status: 'recovery_required' }).where(eq(wmsTables.batchInventorySessions.id, sessionId));
      await expect(tx.transaction(() => report(1))).rejects.toMatchObject({ response: { code: 'PICKING_SESSION_NOT_ACTIVE' } });
    });
  });
});
```

`wiring.shortPick` 은 Step 3 에서 더한다. `started()`·`report()` 헬퍼는 Task 7·8 도 쓰므로 `services/__support__/short-pick-fixtures.ts` 에 `startedShortPickBox(tx, picked)` 로 옮겨 export 한다(반환: `box`·`wiring`·`sessionId`·`report`).

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- shipment-short-pick.integration`
Expected: FAIL — `wiring.shortPick` 이 없거나, 옛 보고가 박스를 제외한다.

- [ ] **Step 3: 서비스를 다시 쓴다** — `shipment-short-pick.service.ts`

`report` 의 뼈대(검증·스코프·명령 실행)는 둔다. 트랜잭션 본문을 아래로 바꾸고, «사라짐» 목록의 메서드를 지운다. `lockAndValidateShipment` 는 남기되 할 일을 줄인다: 박스·줄 잠금·검증과 발송 시도 검사만 한다. 배정 행 잠금은 `approveShortages` 가 한다.

```ts
@Injectable()
export class ShipmentShortPickService {
  constructor(
    private readonly commands: FulfillmentCommandService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly boxes: BoxAllocationManager,
    private readonly withdrawals: BoxWithdrawalService,
  ) {}

  /**
   * 결품 보고(스펙 §9) — 한 트랜잭션. 안 집은 몫을 부족 승인하고 결품 로케이션을 뺀 곳에서 다시 채운다. 못 채우면 이탈(exit_to=draft)이
   * 결품 오퍼레이션을 기다리고, 나가기가 예약·송장·박스를 정리한다(PR 4 계획이 정함 1~6).
   * 잠금: 구성요소 → 박스·줄 → 작업 항목 → 세션·보관 → 배정(판정) → 오퍼레이션·멤버 INSERT → 부족 승인 → SKU 가용·원장.
   */
  async report(
    shipmentId: string,
    dto: ReportShipmentShortPickDto,
    idempotencyKey: string,
    actor: ShipmentShortPickActor,
    tx?: DbTx,
  ): Promise<ShipmentShortPickResponseDto> {
    this.workflowGate.assertV2MutationAllowed('shipment.short_pick.report');
    this.assertDto(dto);
    await this.requireScope(actor);
    return this.commands.execute<ShipmentShortPickResponseDto>(
      {
        commandType: 'shipment.short_pick.report',
        idempotencyKey,
        canonicalRequest: { shipmentId, actorId: actor.id, ...dto },
      },
      async (trx, commandRequestId, requestHash) => {
        await this.withdrawals.lockComponentsOf([shipmentId], trx);
        const { lines } = await this.lockAndValidateShipment(shipmentId, dto, trx);
        const workItem = await this.lockWorkItem(shipmentId, dto, trx);
        const [batch] = await trx
          .select({ warehouseId: wmsTables.outboundBatches.warehouseId })
          .from(wmsTables.outboundBatches)
          .where(eq(wmsTables.outboundBatches.id, workItem.batchId))
          .limit(1);
        if (!batch) throw new Error(`Outbound batch ${workItem.batchId} referenced by a work item is missing`);
        const session = await this.boxes.lockOpenSession(workItem.batchId, trx);
        if (!session || session.id !== dto.sessionId || session.version !== dto.expectedSessionVersion) {
          throw this.conflict('SHORT_PICK_SESSION_STALE', 'Inventory session identity/version is invalid');
        }
        if (session.status !== 'active') {
          throw this.conflict('PICKING_SESSION_NOT_ACTIVE', `Batch ${workItem.batchId} inventory session is ${session.status}`);
        }
        const { active: waybill } = await this.withdrawals.exitWaybill(shipmentId, trx);
        if (waybill?.status === 'used') throw this.conflict('SHORT_PICK_DISPATCH_EXISTS', 'A used waybill cannot be short-picked');

        // 판정 먼저(쓰지 않는다) — 모자라면 SHORT_PICK_EXCEEDS_UNPICKED 로 전부 보고하고 오퍼레이션도 남기지 않는다.
        const planned = await this.boxes.planShortages(
          {
            session,
            workItemId: workItem.id,
            shortages: dto.lines.map((line) => ({
              shipmentLineId: line.shipmentLineId,
              sourceLocationId: line.sourceLocationId,
              qty: line.shortQty,
            })),
          },
          trx,
        );
        const operationId = randomUUID();
        // 의도의 allocationQty 는 보고 시점 배정(감소 전). 세션의 부족 승인이 이 의도를 읽으므로 승인보다 먼저 적는다.
        const intent = {
          kind: 'short_pick' as const,
          operationId,
          shipmentId,
          workItemId: workItem.id,
          sessionId: session.id,
          reason: dto.reason,
          actorId: actor.id,
          lines: planned.map((row) => ({
            shipmentLineId: row.shipmentLineId,
            sourceLocationId: row.sourceLocationId,
            shortQty: row.qty,
            allocationQty: row.allocationQty,
          })),
        };
        await trx.insert(wmsTables.shipmentOperations).values({
          id: operationId, type: 'short_pick', status: 'pending', operatorId: actor.id, reason: dto.reason,
          csCaseId: dto.csCaseId ?? null, note: dto.note ?? null, idempotencyKey, requestHash,
          beforeManifestSnapshot: { intent },
        });
        await trx.insert(wmsTables.shipmentOperationMembers).values({
          operationId, shipmentId, role: 'source',
          beforeManifestVersion: dto.expectedManifestVersion,
          beforeManifestSnapshot: { expectedManifestVersion: dto.expectedManifestVersion },
        });
        await this.boxes.approveShortages(
          {
            session,
            workItemId: workItem.id,
            shortPickOperationId: operationId,
            actorId: actor.id,
            reasonCode: this.reasonCode(dto.reason),
            reason: dto.reason,
            planned,
          },
          trx,
        );
        const approved = planned;
        const allLines = lines.map((line) => ({ id: line.id, skuId: line.skuId, qty: line.qty }));
        const plan = await this.boxes.planRefill(
          { session, warehouseId: batch.warehouseId, workItemId: workItem.id, lines: allLines,
            excludedSources: approved.map((row) => ({ skuId: row.skuId, sourceLocationId: row.sourceLocationId })) },
          trx,
        );
        if (!plan.shortages.length) {
          const refills = await this.boxes.applyRefill(
            { session, batchId: workItem.batchId, actorId: actor.id, operationId: commandRequestId, plan, lines: allLines },
            trx,
          );
          await this.completeRefilled(operationId, shipmentId, dto.expectedManifestVersion, refills, trx);
          await this.audit.logUserActionRequired('shipment.short_pick.refilled', 'fulfillment',
            `Short pick operation ${operationId} refilled shipment ${shipmentId}`, { userId: actor.id },
            { operationId, shipmentId, workItemId: workItem.id, approved, refills }, trx);
          return this.done({ operationId, shipmentId, workItemId: workItem.id, operationStatus: 'completed', outcome: 'refilled', refills, shortages: [] });
        }
        // 못 채움 → 이탈. 나갈 때 송장을 무효화하므로 지금 무효화할 수 있어야 한다(정한 것 3).
        if (!(await this.withdrawals.exitWaybill(shipmentId, trx)).voidable) {
          throw this.conflict('SHORT_PICK_INVOICE_NOT_VOIDABLE', `Waybill ${waybill?.id} is ${waybill?.status}; resolve it before short-pick withdrawal`);
        }
        const shortages = await describeStartBlockers(
          trx,
          plan.shortages.map((shortage) => ({
            shipmentId, reason: shortage.reason, shipmentLineId: shortage.shipmentLineId, skuId: shortage.skuId,
            requiredQty: shortage.requiredQty, shortQty: shortage.shortQty, detail: null,
          })),
        );
        const outcome = await this.withdrawals.begin(
          { batchId: workItem.batchId, shipmentId, shipmentStatus: 'planned', workItem,
            lines: lines.map((line) => ({ id: line.id, skuId: line.skuId })),
            exitTo: 'draft', reason: `short_pick:${dto.reason}`, waitingOperationId: operationId,
            actorId: actor.id, operationId: commandRequestId },
          trx,
        );
        await this.audit.logUserActionRequired('shipment.short_pick.withdrawing', 'fulfillment',
          `Short pick operation ${operationId} could not refill shipment ${shipmentId}`, { userId: actor.id },
          { operationId, shipmentId, workItemId: workItem.id, approved, shortages, outcome: outcome.kind }, trx);
        return this.done({
          operationId, shipmentId, workItemId: workItem.id,
          operationStatus: outcome.kind === 'exited' ? 'completed' : 'pending',
          outcome: outcome.kind, refills: [], shortages: shortages.map(toShortageDto),
        });
      },
      tx,
    );
  }
```

- `done(response)` 는 `{ response, resourceType: 'shipment_operation', resourceId: response.operationId, operationId: response.operationId }` 를 만드는 private 헬퍼다(`commands.execute` 콜백의 반환 모양).
- `completeRefilled` 는 멤버·오퍼레이션을 `completed` 로 바꾸고 after 를 `{ outcome: 'refilled', refills }` 로 적는다. `ShortPickExitService.complete` 와 같은 모양이다. 공용화는 하지 않는다: 채움은 이 서비스만, 나감은 마무리 서비스만 쓴다.
- `toShortageDto` 는 `StartBlockerView` 에서 `ShortPickShortageDto` 필드만 고른다.

`lockWorkItem(shipmentId, dto, trx)` 는 작업 항목 하나를 `FOR UPDATE` 로 잠그고 이 순서로 검사한다:
1. `id = dto.workItemId`, 박스 일치 — 아니면 `SHORT_PICK_WORK_ITEM_MISMATCH`
2. `withdrawing` → `SHIPMENT_WITHDRAWN`
3. `queued`·`picking` 이 아니면 `SHORT_PICK_WORK_ITEM_STATE`
4. `leaseVersion` 불일치 → `SHORT_PICK_WORK_ITEM_STALE`
5. `waitingOperationId` 있음 → `SHORT_PICK_WORK_ITEM_WAITING`

`lockAndValidateShipment` 에서 배정 조회·`SHORT_PICK_ALLOCATION_MISMATCH` 는 `planShortages` 로 옮겨 가므로 지운다.

`simple-outbound-wiring.ts` 의 반환에 `shortPick: new ShipmentShortPickService(commands, { getScopesByRoles: () => Promise.resolve(new Set(['master'])) } as never, audit, workflowGate, boxes, withdrawals)` 를 더한다.

컨트롤러는 `report(shipmentId, dto, key, actor)` 그대로다(`tx` 는 선택 인자라 호출 모양이 바뀌지 않는다).

`dto/shipment-short-pick.dto.ts` 의 응답 클래스를 Interfaces 대로 바꾼다. `@ApiProperty` 는 중첩 DTO 를 별도 클래스로 둔다(CLAUDE.md — `{ type: 'object' }` 금지).

- [ ] **Step 4: 단위 스펙을 다시 쓴다** — `shipment-short-pick.service.spec.ts`

옛 스펙은 옛 의존성(`session`·`reservations`·`totes`)을 스텁한다. 새 생성자 인자(`commands, authorization, audit, workflowGate, boxes, withdrawals`)로 다시 쓰고, 명령 실행 전에 끝나는 판정만 남긴다(나머지는 통합 스펙이 본다):

```ts
describe('ShipmentShortPickService', () => {
  function makeService(scopes = new Set([FULFILLMENT_SCOPE.SHIPMENT_REOPEN])) {
    const commands = { execute: jest.fn() };
    const service = new ShipmentShortPickService(
      commands as never,
      { getScopesByRoles: jest.fn().mockResolvedValue(scopes) } as never,
      { logUserActionRequired: jest.fn() } as never,
      { assertV2MutationAllowed: jest.fn() } as never,
      {} as never,
      {} as never,
    );
    return { service, commands };
  }
  const dto = { /* 옛 스펙의 dto 그대로 */ } as ReportShipmentShortPickDto;

  it('지원하지 않는 사유는 400 — 명령을 실행하지 않는다', async () => {
    const { service, commands } = makeService();
    await expect(service.report('s', { ...dto, reason: 'nope' as never }, 'k', { id: 'a', roles: [] })).rejects.toBeInstanceOf(BadRequestException);
    expect(commands.execute).not.toHaveBeenCalled();
  });

  it('shipment.reopen 스코프가 없으면 403', async () => {
    const { service } = makeService(new Set());
    await expect(service.report('s', dto, 'k', { id: 'a', roles: [] })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

- [ ] **Step 5: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "shipment-short-pick|short-pick-exit|box-allocation.short-pick"`, `npx jest apps/core/src/modules/fulfillment --maxWorkers=2`, `npm run type-check`
Expected: 모두 PASS, type-check 0. `outbound-v2-warehouse-scenarios` 시나리오 10 은 Task 7 까지 빨갛다(예상).

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/shipment-short-pick.service.ts \
  apps/core/src/modules/fulfillment/dto/shipment-short-pick.dto.ts \
  apps/core/src/modules/fulfillment/services/__support__/simple-outbound-wiring.ts \
  apps/core/src/modules/fulfillment/services/shipment-short-pick.integration.spec.ts \
  apps/core/src/modules/fulfillment/services/shipment-short-pick.service.spec.ts
git add -u apps/core/src/modules/fulfillment/controllers
git commit -m "feat(fulfillment): 결품 보고가 그 자리에서 다시 채우고, 못 채우면 박스를 뺀다 — 격리·재개 경로 제거 (#990)"
```

---

### Task 7: 세 방식·넘겨받기·옛 시나리오

**Files:**
- Test: `apps/core/src/modules/fulfillment/services/short-pick-methods.integration.spec.ts` (신규)
- Modify(Test): `apps/core/src/modules/fulfillment/services/outbound-v2-warehouse-scenarios.integration.spec.ts` (시나리오 10 과 배선)
- Modify(Test): `short_pick_recovery` 를 픽스처로 심는 스펙 — 옛 행을 심는 것 자체는 유효하다(상태 값은 contract 까지 남는다). 그래서 **결품 보고가 그 상태를 만든다고 기대하는** 단언만 고친다: `grep -rn "short_pick_recovery\|SHORT_PICK_PENDING" apps/core/src --include=*.spec.ts`

**Interfaces:**
- Consumes: Task 6 `wiring.shortPick.report`, PR 3 토탈피킹 픽스처(`aggregate-cart-surplus.integration.spec.ts` 의 `cartLoaded` 모양), 바구니 피킹 배치(`pickingMethod: 'multi_order'`, `cartCapacity`)

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `short-pick-methods.integration.spec.ts`

케이스(모두 `inRollbackTx`, 끝에 `recovery.reconcile` healthy + `assertFulfillmentInvariantsFor`):

1. **토탈피킹(`total_picking` → `aggregate_then_sort`), 벌크 수집 전 결품 + 여분 로케이션** → `refilled`. 이어서 `bulkCartScan` 이 여분 로케이션에서 채운 몫을 받는다(`sourceLocationId: spare.locationId`, 수량 2). 원래 로케이션은 남은 몫만 받는다.
2. **토탈피킹, 카트에 다 실은 뒤 결품** → `SHORT_PICK_EXCEEDS_UNPICKED`(`AT_SOURCE` 0).
3. **바구니 피킹(`multi_order` → `pick_to_tote`, `cartCapacity: 24`), 여분 없음** → `exited`(집은 게 없으면) 또는 토트에 1개 담은 뒤 `withdrawing` → `wiring.returns.removeToReturnBin` 으로 `TOTE` 보관을 빼면 나가며 마무리.
4. **개별 피킹, 두 박스가 같은 로케이션을 나눠 가진 배치에서 한 박스만 결품** → 다른 박스의 배정·보관·지문이 그대로다(합류의 «다른 박스 불변»과 같은 단언). 픽스처는 `seedTwoBoxBatch(tx, 1, 3)` + `seedSpareStock`.

코드 모양은 Task 6 의 `startedShortPickBox()`(개별 피킹 — 케이스 4 는 이것에 두 번째 박스를 더한다)와 PR 3 의 `aggregate-cart-surplus.integration.spec.ts` 의 `cartLoaded()` 를 합친다. 토탈피킹·바구니 피킹 케이스는 `startedShortPickBox` 를 쓰지 않고 그 스펙의 모양대로 시작한 뒤, `wiring.shortPick.report` 를 `startedShortPickBox` 의 `report` 와 같은 인자로 부른다(최신 세션·작업 항목·줄·박스 버전을 읽어 보낸다). 토탈피킹 배치는 시작 전에 `outboundBatches.pickingMethod` 를 `total_picking` 으로 바꾸고 `startBatchPicking(wiring.startDeps, 'aggregate_then_sort', …)` 로 시작한다(테스트 배선의 전략 레지스트리는 discrete 만 안다). 바구니 피킹은 `pickingMethod: 'multi_order'`, `cartCapacity: 24` 에 `'pick_to_tote'` 다.

케이스 1 의 핵심 단언:

```ts
      const result = await report(2);
      expect(result.outcome).toBe('refilled');
      const atSource = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(and(eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId), eq(wmsTables.batchInventorySessionBalances.custodyType, 'AT_SOURCE')));
      expect(atSource).toEqual(expect.arrayContaining([expect.objectContaining({ sourceLocationId: spare.locationId, qty: 2 })]));
```

- [ ] **Step 2: 옛 시나리오 10 을 고친다** — `outbound-v2-warehouse-scenarios.integration.spec.ts`
   - `ShipmentShortPickService` 조립을 새 생성자 `(commands, authorization, audit, workflow, boxes, withdrawals)` 로 바꾼다. 이 스펙의 `makeServices` 에 `BoxAllocationManager`·`BoxWithdrawalService` 가 없으면 simple-outbound-wiring 과 같은 모양으로 조립한다.
   - `moduleRef` 의 `resumeTarget.shortPick` 스텁은 지운다. 결품은 더 이상 재개 대상이 아니다.
   - `it('10 short pick isolates one shipment …')` 의 이름을 `'10 short pick without spare stock withdraws one shipment and preserves its sibling reservation and active work'` 로 바꾼다.
   - 기대값: 이 세계(`seedWorld(tx, [5, 5], …)`)에 다른 로케이션 재고가 없음을 확인한다(없으면 여분 재고가 없는 것 — 있으면 `seedWorld` 가 만든 로케이션 목록을 보고 결품 로케이션만 있는지 확인). 그러면 `outcome: 'exited'` 이고, A 는 `draft`·`excluded`·`waitingOperationId: null`·송장 voided, 예약은 confirmed 4 + released 1, B 는 그대로다.
   - 세션 체크포인트는 `returnedQty: 0`·`handedBackQty: 4`·`shortageQty: 1` 이다(옛 값 `returnedQty: 4` 는 결품 반환이었다).
   - `expect(reported).toMatchObject({ … operationStatus: 'completed' … })` 에 `outcome: 'exited'` 를 더한다.

- [ ] **Step 3: 실패 → 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "short-pick-methods|outbound-v2-warehouse-scenarios"`
Expected: 처음엔 FAIL(새 파일), 고친 뒤 PASS. 케이스 1 이 실패하면 `bulkCartScan` 이 로케이션 목록을 `AT_SOURCE` 에서 읽는지 확인한다. 설계(스펙 S1 §4.4 «토탈피킹 합산 목록 = 위치별 `AT_SOURCE` 잔량»)와 다르면 멈추고 알린다.

- [ ] **Step 4: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/short-pick-methods.integration.spec.ts \
  apps/core/src/modules/fulfillment/services/outbound-v2-warehouse-scenarios.integration.spec.ts
git add -u apps/core/src
git commit -m "test(fulfillment): 결품 재배정을 세 피킹 방식과 옛 시나리오로 검증한다 (#990)"
```

---

### Task 8: 송장 스캔 — 결품으로 무효화된 송장도 `withdrawn`, 채운 박스는 `reprint_required`

**Files:**
- Modify: `apps/core/src/modules/fulfillment/reader/shipment-waybill.reader.ts` (`canceledWithdrawal` → `withdrawnByVoidedWaybill`)
- Test: `apps/core/src/modules/fulfillment/reader/by-waybill.short-pick.integration.spec.ts` (신규)

**Interfaces:**
- Produces: by-waybill 폴백 조건 — 그 번호의 최근 `voided` 송장 W 에 대해 둘 중 하나를 만족하면 `withdrawn` 이다.
  - (a) PR 3 그대로 — 박스 `canceled` + 마지막 작업 항목이 `excluded`·`exit_to = canceled` → `exitTo: 'canceled'`
  - (b) 신규 — `type = 'short_pick'`·`status = 'completed'` 이고 source 멤버가 W 의 박스이며 `after_manifest_snapshot->>'voidedWaybillId' = W.id` 인 오퍼레이션이 있다 → `exitTo: 'draft'`, `shipmentStatus` 는 박스의 현재 상태
- 나머지(`batchId`·`workItemId` null, `pickedQty` 0, `removals` [])는 (a) 와 같다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `by-waybill.short-pick.integration.spec.ts`

PR 3 의 `reader/by-waybill.withdrawal.integration.spec.ts` 와 같은 배선을 쓴다. 리더는 `new ShipmentWaybillReader(dbService, assembleLabels(dbService).states)` 로 만들고, 한진(앱이 그릴 수 있는) 송장은 `promoteToCarrierWaybill(tx, box)` 로 만든다. 그러지 않으면 `labelState` 가 `external` 이다. 출력 기록은 `labels.render.render` → `labels.confirm.confirm` 이다.

```ts
import { DbTx } from '../../inventory/schema/inventory.schema';
import { ShipmentWaybillReader } from './shipment-waybill.reader';
import { inRollbackTx, makeDb } from '../services/__support__';
import { seedSpareStock, startedShortPickBox } from '../services/__support__/short-pick-fixtures';
import { ambientDbService } from '../services/__support__/simple-outbound-wiring';
import { assembleLabels, promoteToCarrierWaybill } from '../waybill/__support__/label-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('송장 스캔 — 결품 (스펙 §10.5·§9, PR 4)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });
  const readerFor = (tx: DbTx) => {
    const dbService = ambientDbService(tx);
    return new ShipmentWaybillReader(dbService, assembleLabels(dbService).states);
  };

  it('결품으로 빠진 박스의 옛 송장을 스캔하면 withdrawn(exitTo draft)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, report } = await startedShortPickBox(tx, 0);
      const { trackingNo } = await promoteToCarrierWaybill(tx, box);
      await report(2);
      await expect(readerFor(tx).byTrackingNo(trackingNo)).resolves.toMatchObject({
        shipmentId: box.shipmentId,
        labelState: 'withdrawn',
        exitTo: 'draft',
        batchId: null,
        workItemId: null,
        shipmentStatus: 'draft',
      });
    });
  });

  it('채운 박스는 출력 기록이 있으면 reprint_required — 바뀐 줄에 새 로케이션', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, report } = await startedShortPickBox(tx, 0);
      const spare = await seedSpareStock(tx, box, 5);
      const { trackingNo } = await promoteToCarrierWaybill(tx, box);
      const labels = assembleLabels(ambientDbService(tx));
      const { fingerprint } = await labels.render.render(box.shipmentId, tx);
      await labels.confirm.confirm(box.shipmentId, fingerprint, { id: box.actorId }, tx);
      await report(2);
      const found = await readerFor(tx).byTrackingNo(trackingNo);
      expect(found.labelState).toBe('reprint_required');
      expect(found.labelChanges).toEqual(
        expect.arrayContaining([expect.objectContaining({ locationCode: spare.code, printedQty: 0, currentQty: 2 })]),
      );
    });
  });

  it('활성 송장으로 찾은 채운 박스는 결품 폴백을 타지 않는다(무효 송장만 본다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, report } = await startedShortPickBox(tx, 0);
      await seedSpareStock(tx, box, 5);
      const { trackingNo } = await promoteToCarrierWaybill(tx, box);
      await report(2);
      const found = await readerFor(tx).byTrackingNo(trackingNo);
      expect(found.labelState).toBe('never_printed');
      expect(found.workItemId).toBe(box.workItemId);
    });
  });
});
```

`labelChanges` 원소의 필드 이름(`locationCode`·`printedQty`·`currentQty`)은 PR 1 `diffLabelItems` 의 출력 모양을 따른다.

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- by-waybill.short-pick`
Expected: FAIL — 첫 케이스가 404(`Waybill not found for tracking number …`).

- [ ] **Step 3: 폴백을 넓힌다** — `shipment-waybill.reader.ts`

`canceledWithdrawal` 의 이름을 `withdrawnByVoidedWaybill` 로 바꾸고, 송장 조회에 `id` 를 더한다. 박스 조회·창고 검사 뒤를 이렇게 가른다:

```ts
    if (warehouseId !== undefined && warehouseId !== shipment.warehouseId) return null;
    const exitTo = shipment.status === 'canceled'
      ? await this.canceledExit(trx, waybill.shipmentId)
      : await this.shortPickExit(trx, waybill.shipmentId, waybill.id);
    if (!exitTo) return null;
    // …반환은 그대로, exitTo 만 변수로, shipmentStatus: shipment.status
  }

  /** PR 3 — 마지막 작업 항목이 취소로 나갔다. */
  private async canceledExit(trx: DbTx, shipmentId: string): Promise<'canceled' | null> {
    // 옛 canceledWithdrawal 의 마지막 작업 항목 검사 그대로
  }

  /** PR 4 — 이 송장을 결품 마무리가 무효화했다(ShortPickExitService.finish 가 after 스냅샷에 적는다). 박스가 다시 계획돼도 옛 번호는 그대로 빠진 박스다. */
  private async shortPickExit(trx: DbTx, shipmentId: string, waybillId: string): Promise<'draft' | null> {
    const [operation] = await trx
      .select({ id: wmsTables.shipmentOperations.id })
      .from(wmsTables.shipmentOperations)
      .innerJoin(
        wmsTables.shipmentOperationMembers,
        and(
          eq(wmsTables.shipmentOperationMembers.operationId, wmsTables.shipmentOperations.id),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
          eq(wmsTables.shipmentOperationMembers.shipmentId, shipmentId),
        ),
      )
      .where(
        and(
          eq(wmsTables.shipmentOperations.type, 'short_pick'),
          eq(wmsTables.shipmentOperations.status, 'completed'),
          sql`${wmsTables.shipmentOperations.afterManifestSnapshot}->>'voidedWaybillId' = ${waybillId}`,
        ),
      )
      .limit(1);
    return operation ? 'draft' : null;
  }
```

주석을 고친다: «전체 취소·결품으로 나간 박스는 송장이 무효라 활성 송장으로는 못 찾는다(정한 것 4).» 앱은 `withdrawn` 을 `exitTo` 와 무관하게 한 문구로 보인다(PR 3 `labelGate`). 앱 변경은 없다.

- [ ] **Step 4: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "by-waybill|shipment-waybill.reader"`
Expected: PASS — 새 둘과 PR 3 의 `by-waybill.withdrawal` 전부.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/reader/shipment-waybill.reader.ts \
  apps/core/src/modules/fulfillment/reader/by-waybill.short-pick.integration.spec.ts \
  apps/core/src/modules/fulfillment/services/__support__/simple-outbound-wiring.ts
git commit -m "feat(fulfillment): 결품으로 무효화된 송장도 스캔하면 빠진 박스로 보인다 (#990)"
```

---

### Task 9: admin-web — 결품 다이얼로그가 새 결과를 읽는다

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/fulfillment.ts` (`ShipmentShortPickOperation`)
- Create: `apps/admin-web/src/lib/services/orders/short-pick-outcome.ts`, `apps/admin-web/src/lib/services/orders/short-pick-outcome.spec.ts`
- Modify: `apps/admin-web/src/lib/services/orders/index.ts` (export)
- Modify: `apps/admin-web/src/features/order/picking-list/components/short-pick-dialog/index.tsx`

**Interfaces:**
- Consumes: Task 6 응답
- Produces:
  ```ts
  export interface ShortPickRefill { shipmentLineId: string; skuId: string; sourceLocationId: string; locationCode: string; qty: number }
  export interface ShortPickShortage { shipmentLineId: string | null; skuId: string | null; skuCode: string | null; skuName: string | null;
    requiredQty: number | null; shortQty: number | null; reason: 'INBOUND_PENDING' | 'STOCK_SHORT' }
  export interface ShipmentShortPickOperation {
    operationId: string; shipmentId: string; workItemId: string;
    operationStatus: 'pending' | 'recovery_required' | 'completed';
    invoiceOperationId: string | null;
    outcome?: 'refilled' | 'withdrawing' | 'exited'; // 옛 서버 응답(배포 겹침) 호환으로 선택
    refills?: ShortPickRefill[];
    shortages?: ShortPickShortage[];
  }
  export function shortPickOutcomeMessage(result: ShipmentShortPickOperation): { tone: 'success' | 'info'; text: string } | null;
  export function isShortPickSettled(result: ShipmentShortPickOperation): boolean; // outcome 이 있으면 true — 보존·재시도 대상 아님
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `short-pick-outcome.spec.ts`

```ts
import { isShortPickSettled, shortPickOutcomeMessage } from './short-pick-outcome';

const base = { operationId: 'op', shipmentId: 's', workItemId: 'w', invoiceOperationId: null } as const;

describe('결품 보고 결과 문구', () => {
  it('채움 — 새 로케이션과 재출력 안내', () => {
    expect(
      shortPickOutcomeMessage({
        ...base,
        operationStatus: 'completed',
        outcome: 'refilled',
        refills: [{ shipmentLineId: 'l', skuId: 'k', sourceLocationId: 'x', locationCode: 'B-02-01', qty: 2 }],
        shortages: [],
      }),
    ).toEqual({ tone: 'success', text: '다른 로케이션에서 채웠어요: [B-02-01] 2개. 송장을 다시 출력해야 작업을 이어갈 수 있어요.' });
  });

  it('빼는 중 — 현장에서 집은 상품을 되돌림 바구니로', () => {
    expect(
      shortPickOutcomeMessage({ ...base, operationStatus: 'pending', outcome: 'withdrawing', refills: [], shortages: [] }),
    ).toEqual({
      tone: 'info',
      text: '채울 재고가 없어 박스를 배치에서 빼는 중이에요. 현장에서 송장을 스캔해 집은 상품을 되돌림 바구니로 빼면 박스가 초안으로 돌아가요.',
    });
  });

  it('빠짐 — 초안 복귀', () => {
    expect(
      shortPickOutcomeMessage({ ...base, operationStatus: 'completed', outcome: 'exited', refills: [], shortages: [] }),
    ).toEqual({ tone: 'info', text: '채울 재고가 없어 박스를 배치에서 뺐어요. 박스는 초안으로 돌아갔고 송장은 무효가 됐어요.' });
  });

  it('outcome 이 없으면(옛 서버) null — 옛 처리 그대로, 있으면 보존·재시도 대상이 아니다', () => {
    expect(shortPickOutcomeMessage({ ...base, operationStatus: 'completed' })).toBeNull();
    expect(isShortPickSettled({ ...base, operationStatus: 'completed' })).toBe(false);
    expect(isShortPickSettled({ ...base, operationStatus: 'pending', outcome: 'withdrawing' })).toBe(true);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- short-pick-outcome`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다** — `short-pick-outcome.ts`

```ts
import type { ShipmentShortPickOperation } from '@/lib/types/dto/fulfillment';

/** 새 서버(PR 4)는 결품 보고를 한 번에 끝내고 결과(outcome)를 준다 — 그러면 보존·폴링할 대기가 아니다. */
export function isShortPickSettled(result: ShipmentShortPickOperation): boolean {
  return result.outcome !== undefined;
}

export function shortPickOutcomeMessage(
  result: ShipmentShortPickOperation,
): { tone: 'success' | 'info'; text: string } | null {
  if (result.outcome === 'refilled') {
    const where = (result.refills ?? []).map((refill) => `[${refill.locationCode}] ${refill.qty}개`).join(', ');
    return { tone: 'success', text: `다른 로케이션에서 채웠어요: ${where}. 송장을 다시 출력해야 작업을 이어갈 수 있어요.` };
  }
  if (result.outcome === 'withdrawing') {
    return {
      tone: 'info',
      text: '채울 재고가 없어 박스를 배치에서 빼는 중이에요. 현장에서 송장을 스캔해 집은 상품을 되돌림 바구니로 빼면 박스가 초안으로 돌아가요.',
    };
  }
  if (result.outcome === 'exited') {
    return { tone: 'info', text: '채울 재고가 없어 박스를 배치에서 뺐어요. 박스는 초안으로 돌아갔고 송장은 무효가 됐어요.' };
  }
  return null;
}
```

`lib/types/dto/fulfillment.ts` 의 `ShipmentShortPickOperation` 을 Interfaces 대로 바꾸고, `lib/services/orders/index.ts` 에서 두 함수를 export 한다.

다이얼로그(`short-pick-dialog/index.tsx`)는 세 곳을 고친다.
- `retainAfterResponse: (response) => !isShortPickSettled(response) && isRecoverableOperation(response.operationStatus)`
- 결과를 받으면 `const message = shortPickOutcomeMessage(result)` 를 부른다. 있으면 tone 에 맞춰 `toast.success`/`toast.info(message.text)` 를 띄우고 `onClose()` 한다. 없으면 옛 분기 그대로다.
- 제목 «Short-pick 보고» 를 «결품 보고» 로 바꾼다. 필드 «부족 수량» 아래에 안내 한 줄을 더한다: «아직 집지 않은 수량 중 로케이션에 없는 것만 적어요. 이미 집은 상품의 파손은 결품이 아니에요.»(정한 것 1)
- 403·409 의 공통 문구는 `getServerDenyMessage` 그대로다. `SHORT_PICK_EXCEEDS_UNPICKED` 는 서버 메시지가 붙어 나온다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test:admin-web -- short-pick-outcome` 그리고 `cd apps/admin-web && npx tsc --noEmit`
Expected: PASS, 에러 0

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/lib/types/dto/fulfillment.ts apps/admin-web/src/lib/services/orders/short-pick-outcome.ts \
  apps/admin-web/src/lib/services/orders/short-pick-outcome.spec.ts apps/admin-web/src/lib/services/orders/index.ts \
  apps/admin-web/src/features/order/picking-list/components/short-pick-dialog/index.tsx
git commit -m "feat(admin-web): 결품 다이얼로그가 채움·빼는 중·빠짐 결과를 보여 준다 (#990)"
```

---

### Task 10: 마무리 — 게이트, 남은 참조, 스펙 반영, 후속 이슈, PR

**Files:**
- Modify: `docs/superpowers/specs/2026-09-30-outbound-allocation-before-label-design.md` — **진행 상태는 적지 않는다**(스펙 §0). 구현하며 이 계획과 달라진 것만 «PR 4 구현이 정함» 으로 넣고, 계획이 정한 것(이미 반영)이 바뀌었으면 그 문장을 고친다.

- [ ] **Step 1: 전체 게이트**

```bash
npm run type-check
npx jest --maxWorkers=2
npx jest scripts/security
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local
npm run test:admin-web
(cd apps/admin-web && npx tsc --noEmit)
(cd native/warehouse-app && npx tsc -b && npx vitest run)
```

Expected: type-check 0, jest 실패 0, 통합 실패 0, admin-web·앱 전부 초록. develop 부터 붉던 통합 스위트가 있으면 develop 워크트리와 새 DB 에서 같은 명령으로 대조해 «이 PR 이 만든 것 아님» 목록을 PR 본문에 적는다. PR 3 본문의 목록(8 suites)이 기준이다.

- [ ] **Step 2: 남은 참조를 확인한다**

```bash
grep -rn "returnShortPickCustody\|returnToSource\|remainingShortPickAllocation\|resumePending(\|quarantineWorkItem\|reconcileAffectedCustody" apps/core/src --include=*.ts   # 결품 서비스 쪽 0건(합포장·취소의 resumePending* 은 다른 것)
grep -rn "'short_pick_recovery'" apps/core/src --include=*.ts | grep -v "\.spec\." # 읽는 곳만: schema·work-item-status·allocation.locks·box-withdrawal(blockerOf)
grep -rn "SHORT_PICK_PENDING" apps/core/src --include=*.ts | grep -v "\.spec\."    # 0건
grep -rn "canceledExitWaybill\|canceledWithdrawal" apps/core/src                   # 0건
grep -rn "liveBatchAllocations" apps/core/src                                        # 0건
```

- [ ] **Step 3: 스펙을 고친다** — 구현하며 정한 것이 있으면 §9·§10.5·§12·§13·§16 의 «PR 4 계획이 정함» 옆에 «PR 4 구현이 정함» 으로 적는다. 없으면 이 단계는 비운다.

- [ ] **Step 4: 후속 이슈를 연다**(사용자 결정 2026-10-01 — «원장 반영은 별도 이슈»). 본문에는 코드에서 도출되는 수치를 적지 않고, 좌표와 도출 방법을 적는다(CLAUDE.md):

```bash
gh issue create --repo LCNINE/almondyoung-server \
  --title "[재고] 결품 승인이 원장을 줄이지 않아 결품 로케이션에 유령 재고가 남는다" \
  --body "$(cat <<'EOF'
## 무엇
결품 승인(`APPROVE_SHORTAGE`, `BatchInventorySessionService.approveShortage`)은 세션 통제만 풀고 `stock_events` 를 쓰지 않는다. 결품 로케이션의 `ON_HAND` 가 그대로라, 없는 수량이 그 로케이션의 일반 가용(`BatchControlledStockGuard.getAvailability`)으로 되살아난다.

## 결과
- PR 4(#990)의 재배정은 그 로케이션을 후보에서 빼서 피한다(스펙 `2026-09-30-outbound-allocation-before-label-design.md` §9·E12 «PR 4 계획이 정함»)
- 다음 배치 시작·합류는 그 로케이션을 배정받을 수 있고, 거기서 결품이 또 난다
- 창고 가용·판매 가능 수량이 결품만큼 부풀어 있다

## 할 일(제안)
결품 승인 트랜잭션에서 그 로케이션 `ON_HAND` 를 차감(ADJUST_DOWN 또는 사유별 전이)하고, 판매 가능 수량 재계산·쇼핑몰 동기화 파급을 확인한다. 실사로 조정하는 기존 운영 절차와의 관계를 정한다.

트래킹: #986
EOF
)"
```

만든 이슈 번호를 스펙 §16 «결품의 원장 반영» 줄에 적는다. 이슈 번호는 도출 수치가 아니다. 그리고 트래킹 이슈 #986 에 sub-issue 로 엮는다(`gh api repos/:owner/:repo/issues/986/sub_issues -F sub_issue_id=<id>` — `<id>` 는 `gh api repos/:owner/:repo/issues/<번호> --jq .id`).

- [ ] **Step 5: 커밋 + PR**

```bash
git add docs
git commit -m "docs(fulfillment): PR 4 구현이 정한 결품 재배정 계약을 스펙에 반영 (#990)"
```

PR 본문(한국어)에 반드시 넣는다:
- `Closes #990`, 트래킹 #986
- **배포 순서:** PR 3 배포가 먼저다(확인: ECS 태스크 정의 `registeredAt`, 또는 `POST return-bins` 무인증 401). 마이그레이션이 없다. `sst deploy`(core + admin-web) 한 번이고, warehouse-app 릴리스는 필요 없다.
- **배포 전 확인(라이브, `sst shell` 에서 psql) — 네 값 모두 0 이어야 한다.**
  - 앞의 셋은 옛 결품 경로가 남긴 대기다. 새 코드는 그것을 재개하지 못한다(`resumePending` 제거).
  - 넷째는 I3 필터를 걷은 뒤 다시 가려질 옛 결품 제외 행이다(정한 것 10). 걷는 방향은 느슨해지는 쪽이라 막히지는 않지만 드러날 것을 가린다.
  - 0 이 아니면 옛 경로가 살아 있는 동안(PR 3 코드) 정리한다: 옛 결품 오퍼레이션을 재개하거나 운영자가 박스를 정리한다. 넷째는 그 배치를 끝내거나 복구한다.

```sql
SELECT
  (SELECT count(*) FROM outbound_batch_work_items WHERE status = 'short_pick_recovery') AS short_pick_recovery_items,
  (SELECT count(*) FROM shipment_operations WHERE type = 'short_pick' AND status IN ('pending', 'recovery_required')) AS open_short_pick_operations,
  (SELECT count(*) FROM shipments WHERE status = 'recovery_required' AND recovery_code = 'SHORT_PICK_PENDING') AS short_pick_pending_shipments,
  (SELECT count(*)
     FROM picking_source_allocations a
     JOIN outbound_batch_work_items wi ON wi.id = a.work_item_id AND wi.status = 'excluded'
     JOIN batch_inventory_sessions s ON s.batch_id = wi.batch_id AND s.status IN ('active', 'recovery_required')
    WHERE a.qty > 0) AS legacy_excluded_allocations_in_open_sessions;
```

- **되돌리기 위험:** 새 부족 승인(payload 에 `allocationId`)과 배정 감소가 있는 세션은 PR 4 이전 코드의 복구·결품 검사가 이해하지 못한다(옛 검사는 `allocationQty = 배정` 을 요구한다). 롤링 배포 중 옛·새 태스크가 겹치는 동안도 같다. 결품 보고는 admin-web 에서만 일어나므로, 배포 창 동안 결품 보고를 멈추면 겹침 위험이 사라진다.
- **새 거절 코드**(정한 것 14)와 **사라진 코드**. 새 코드가 나는 곳은 admin-web 결품 다이얼로그 하나이고, warehouse-app 은 결품 명령을 부르지 않는다: `grep -rn "short-picks" native/warehouse-app/src` 가 0건이다.
- **지우거나 바꾼 테스트(리뷰어 판정용):**
  - `shipment-short-pick.integration.spec.ts` 전면 교체(옛 네 케이스는 즉시 제외·초안 복귀를 단언)
  - `shipment-short-pick.service.spec.ts` 재작성
  - `batch-inventory-session.integration` 의 결품 케이스 교체, `returnToSource` 두 케이스를 되돌림 적치로
  - `batch-inventory-session.service.spec` 의 `remainingShortPickAllocation` 케이스 삭제
  - `fulfillment-invariant.service.spec` 의 I3 제외 필터 케이스 반전
  - `outbound-v2-warehouse-scenarios` 시나리오 10 의 기대(이탈·`handedBackQty`)
  - 생성자 인자만 더한 스펙 목록
- **알고 남기는 것:**
  - 결품은 원장을 줄이지 않는다 — 결품 로케이션의 유령 재고. 후속 이슈 #<번호>.
  - 이미 집은 뒤 발견한 파손은 결품으로 보고할 수 없다 — 박스 빼기로 처리한다.
  - 결품 보고는 admin-web 에만 있다(현장 앱 화면 없음).
  - 결품으로 빼는 중인 박스의 부분 취소는 `CANCELLATION_WORK_ITEM_ALREADY_WAITING`.
  - 채운 박스의 작업자는 다음 스캔에서 `LABEL_REPRINT_REQUIRED` 를 만나 재출력한다. 채우는 순간 현장에 알리는 장치는 없다(배치 카드 «재출력 필요 N» 이 늘어난다).
  - 주기 대조 게이지(`FulfillmentReconciliationService`)는 여전히 I1~I3 을 0 으로 보고한다(PR 2 부터).
- **로컬 E2E 사람 스모크 체크리스트**(브라우저·앱 로그인은 사람이 한다): `bootstrap:e2e:local` → `start:all:local` → `preflight:e2e:local`
  1. 시작된 배치의 박스(상품 A)를 앱에서 1개 스캔한다. A 를 다른 로케이션에도 둔다(재고 화면에서 확인).
  2. admin-web 피킹 작업대에서 그 박스·줄·로케이션으로 «결품 보고» 1개를 한다 → «다른 로케이션에서 채웠어요: [로케이션] 1개 …»
  3. 앱에서 그 박스의 다음 상품을 스캔한다 → 재출력 안내 → 송장 스캔 → «송장이 바뀌었어요» + 바뀐 줄 `[새 로케이션] 0개 → 1개` → 재출력 → 새 종이에 «2판»
  4. 다른 박스를 1개 스캔한 뒤, 여분이 없는 상품으로 결품을 보고한다 → «빼는 중 …». 앱의 배치 카드에 «빠지는 중 1»
  5. 그 박스 송장을 스캔한다 → «박스 빼기» 화면 → 상품 스캔 → «다 뺐어요 …». admin-web 에서 그 박스는 초안이고 송장은 무효다.
  6. 같은 송장을 다시 스캔한다 → «빠진 박스예요. 송장은 버려 주세요.»
  7. 아무것도 집지 않은 박스에 여분 없는 결품을 보고한다 → «박스를 배치에서 뺐어요 …», 배치 카드 박스 수 −1
  8. 1개 집은 줄에 2개 결품을 보고한다(줄 수량 2) → 거절(서버 메시지 `SHORT_PICK_EXCEEDS_UNPICKED`)
