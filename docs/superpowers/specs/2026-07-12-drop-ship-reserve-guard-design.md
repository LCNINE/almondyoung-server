# 작업 11b — drop_ship 예약/이전 주입 가드 설계 (WS-D 후속 미니)

> 소속: 물류 백엔드 정상화 스프린트 현황판(2026-07) §5 WS-D 범위 결정(2026-07-12)의 ③.
> 성격: 라이브 + 코드만 + 소형 · 스키마 무변경 · 독립 미니 PR. 작업 11(좀비 예약 대사)의 부수 발견에서 신설.

## 1. 배경

작업 11(좀비 예약 대사)에서 발견: drop_ship FO의 불변식은 **"타사 재고라 자사 `confirmed` 예약을 갖지 않는다"** 인데, 그 불변식을 **생성 시점에 강제하는 가드가 없다**. `ship()`(`fulfillments.service.ts:908-917`)·`markDelivered()`(`:971-980`)가 terminal 도달 시 방어 sweep(`releaseLeftoverReservations`)으로 잔존 예약을 release 하고 warn 을 남기지만, 이는 **사후 청소**일 뿐이다. 생성 경로가 뚫려 있어 operator 가 그 sweep-warn 경로에 **도달 가능**하다.

## 2. 착수 재확인으로 확정한 사실 (2026-07-12, develop @ `2bf6c705f`)

### 2.1 서버 — 예약 생성 경로 3종에 drop_ship 가드 부재
- **`FulfillmentReservationsFacade.reserve`**(`fulfillment-reservations.facade.ts:33`) — FO 잠금 후 terminal/warehouseId 만 검사하고 `fulfillmentMode` 는 보지 않음. drop_ship FO 에 `confirmed` 예약을 그대로 생성.
- **`transferReservation`**(`:223`) + **`getTransferCandidates`**(`:429`) — 후보 쿼리(`:461-486`)가 `qty > reservedQty` 인 FOI 를 반환하는데, drop_ship FO 는 `reservedQty=0` 이라 **항상 후보로 노출**된다. 즉 operator 가 in_house FO 의 예약을 drop_ship FO 로 **이전 주입**할 수 있어 동일 불변식 위반.

### 2.2 광고 — `computeAdminAvailableActions`가 mode 무시
`fulfillments.service.ts:1083-1114` — non-terminal FO 이면 `fulfillmentMode` 와 무관하게 `reserve`/`unreserve`/`transferReservation` 를 광고(`:1095-1101`). drop_ship 도 예약 관리 액션이 노출됨.

### 2.3 admin-web — 예약 표면 2곳 (라이브 상세 페이지)
`src/app/(admin)/order/fulfillments/[id]/page.tsx` → `FulfillmentDetail`(`components/detail/index.tsx`, 라이브)이 둘 다 렌더:
- **surface #1**: 인라인 per-item "예약" 버튼(`components/detail/index.tsx:220`) — `canReserve = remaining>0 && !isTerminal`, **mode-blind**. `useReserveFulfillmentItem` 경유.
- **surface #2**: `<InventoryTab>`(`detail/inventory-tab.tsx:30`) — `adminAvailableActions.includes('reserve')` **서버 계약 기반**. `reserve-dialog.tsx` 경유.
- 둘 다 동일 엔드포인트 `POST /fulfillments/:id/reserve` → facade. (착수 노트는 surface #2 만 언급했으나 현장에서 surface #1 확인.)

### 2.4 잔존 데이터 사각지대
작업 11 대사잡 `FulfillmentReservationReconciliationService` 는 `TERMINAL_FO_STATUSES`(`shipped`/`completed`/`canceled`)만 heal(`fulfillment-reservation-reconciliation.service.ts:44,77`). **non-terminal** drop_ship FO 에 이미 걸린 confirmed 예약은 대사 사각지대 — 해당 FO 가 terminal 로 갈 때 sweep 이 처리할 때까지 잔존.

## 3. 결정 (브레인스토밍, 2026-07-12)

### 3.1 잔존 데이터 = 방치 (terminal heal)
배포 전 이미 non-terminal drop_ship FO 에 걸린 confirmed 예약은 **일회 정리·대사잡 확장 없이 방치**한다. 근거: 신규 유입은 본 가드가 차단하고, 기존 잔존은 해당 FO 가 `ship()`/`markDelivered()` 에 도달하면 기존 sweep 이 release 한다. dev DB 부재·스키마 무변경 원칙에 부합. (작업 12·구 8b 판례 — 근거 명기 후 의도적 비목표.)

### 3.2 가드 범위 = reserve + transfer(주입) 차단, unreserve 유지
- `reserve`·`transferReservation`(drop_ship = source 또는 target)은 **facade 에서 THROW** — 불변식을 모든 생성 경로에서 airtight 하게.
- `unreserve` 는 **가드하지 않음** — 예약을 줄이는 방향이라 불변식과 정합. 방치 정책 하에서 잔존 예약을 operator 가 **수동 정리할 escape hatch** 로 남긴다.

### 3.3 광고 = reserve+transfer 제외, unreserve 유지
`computeAdminAvailableActions` 에서 drop_ship non-terminal FO 는 `reserve`·`transferReservation` 를 광고하지 않고, `unreserve` 는 유지(3.2 escape hatch 와 정합). `cancel`·`forwardDropShip`·`completeDropShip`·`deliver` 는 불변.

### 3.4 FE = 서버 계약 단일 소스 (작업 7 판례)
surface #2 는 이미 `adminAvailableActions` 기반이라 무수정 자동 반영. surface #1 을 `remaining>0 && adminAvailableActions.includes('reserve')` 로 전환해 mode 판정을 서버로 일원화(작업 7 "서버 광고 → FE 게이트" 판례).

### 3.5 예외 타입·컨벤션
facade 는 이미 Nest `ConflictException`/`BadRequestException` 을 쓴다(P3-1 구세대 영역). 본 PR 은 그 관행을 따라 `ConflictException` 사용 — `@app/shared` 도메인 에러 이관은 P3-1 별건이라 손대지 않는다("주변 코드처럼").

## 4. 스코프 — 변경 사항

### A. facade 가드 (`fulfillment-reservations.facade.ts`)
- **`reserve`**: FO 잠금 직후(terminal 체크 `:68` 뒤, warehouseId 체크 근처), `unified.reserveStock` 전에
  `if (fo.fulfillmentMode === 'drop_ship') throw new ConflictException(...타사 재고...)`. `fo` 는 `select()` 전체 컬럼이라 `fulfillmentMode` 보유.
- **`transferReservation`**: fromFo/toFo 잠금 직후(`:278-286`), status-allowed 체크 앞에
  `if (fromFo.fulfillmentMode === 'drop_ship' || toFo.fulfillmentMode === 'drop_ship') throw new ConflictException(...)`.
- **`getTransferCandidates`**: 후보 WHERE(`:476-484`)에 drop_ship 제외 — `fulfillmentMode` 가 nullable(=in_house 기본)이므로 **NULL-safe** 로: `or(isNull(fulfillmentOrders.fulfillmentMode), ne(fulfillmentOrders.fulfillmentMode, 'drop_ship'))`. (단순 `ne` 는 null-mode 행을 잘못 제외 — in_house 후보 유실.) drizzle import 에 `isNull`, `or` 추가.
- 각 가드에 **W6 참조 주석** — 이 불변식이 W6(직배 별도 엔티티 추출) 착수 전까지의 방어선임을 명기.

### B. 광고 (`fulfillments.service.ts` · `computeAdminAvailableActions`)
```ts
const isDropShip = fo.fulfillmentMode === 'drop_ship';
if (!isTerminal) {
  if (!isDropShip) actions.push('reserve');           // W6: drop_ship 은 타사 재고 — 자사 예약 없음
  if (!hasShippedItems) {
    actions.push('unreserve');                        // drop_ship 도 유지: 잔존 예약 수동 해제 escape hatch
    if (!isDropShip && TRANSFER_ALLOWED_STATUSES.has(fo.status)) {
      actions.push('transferReservation');
    }
  }
  actions.push('cancel');
}
```
`fo` 시그니처(`:1084`)에 이미 `fulfillmentMode: string | null` 존재.

### C. admin-web (`components/detail/index.tsx`, surface #1)
`:220` `const canReserve = remaining > 0 && !isTerminal;`
→ `const canReserve = remaining > 0 && fo.adminAvailableActions.includes('reserve');`
`fo` 는 `FulfillmentOrderDetail`(adminAvailableActions 보유). drop_ship 에서 서버가 reserve 미광고 → 자동 숨김. surface #2·unreserve/transfer 섹션은 무수정 자동 반영.

## 5. 불가침 (라이브 — 회귀 가드)
- `reserve`/`transferReservation` 의 **비-drop_ship(in_house·null-mode)** 정상 경로 — 기존 동작 유지.
- `unreserve` 는 drop_ship 포함 전 mode 에서 계속 동작(facade 무가드).
- `ship()`/`markDelivered()` 의 기존 sweep — 방치 정책의 heal 기전, 손대지 않음.
- `UnifiedReservationService.reserveStock`(코어)·facade 의 FO→FOI 잠금 순서·over-reserve 불변식(`:84-90`).

## 6. 테스트 (전부 유닛 · 스키마 무변경)
`fulfillment-reservations.facade.spec.ts` (`makeFacade` 에 `foFulfillmentMode`, 후보용 `toFoFulfillmentMode` 옵션 추가):
- reserve on drop_ship FO → `ConflictException`.
- transferReservation 에서 fromFo drop_ship → throw / toFo drop_ship → throw.
- getTransferCandidates: drop_ship 후보 제외 **+ null-mode(in_house) 후보 보존**(NULL-safe 회귀).
- 비-drop_ship reserve 정상 경로 회귀(기존 케이스 유지).

`fulfillments.service.spec.ts` (private 은 `service['computeAdminAvailableActions'](fo, items)` bracket 접근):
- drop_ship non-terminal → `reserve`·`transferReservation` 없음, `unreserve`·`cancel`·`forwardDropShip` 존재.
- **null-mode(in_house 기본) → `reserve` 존재**(회귀).
- in_house 명시(`'in_house'`) → `reserve`·`transferReservation`(status 허용 시) 존재(회귀).

## 7. 비목표 / 후속
- 잔존 데이터 일회 정리·대사잡 non-terminal 확장 — **비목표**(§3.1 방치 확정).
- `@app/shared` 도메인 에러 이관 — P3-1 별건.
- W6(직배 별도 엔티티 추출) 본작업 — 별도 워크스트림. 본 가드는 그 전까지의 방어선.
- admin-web MOVEMENT_TASK 필터 잔재(작업 9 잔여 (b)) — 무관, FE 후속 티켓 유지.

## 8. 검증 게이트 (공통 규약)
`nest build core` exit 0 · arch 경계 spec(`inventory-write-boundary.arch.spec.ts`) PASS · fulfillment 유닛 spec PASS · 삭제/신규 심볼 정합 · 변경 파일 **신규** eslint error 0(repo 전역 lint 는 상시 debt — 전역 판정 금지) · admin-web `type-check` 신규 0. 통합 spec 없음. 스키마 무변경이라 dev DB 의존 ⏸ 없음.

브랜치 `feat/drop-ship-reserve-guard` → 이 spec + plan → develop **스쿼시 머지** → 현황판 §5 WS-D 갱신(작업 11b 완료 블록 + §2 관련 행).
