# 작업 9 — dead 예약/할당 표면 소거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 죽어 있거나 코어를 우회하는 예약/할당 표면(직행 `POST /inventory/reservations`, `AllocationStrategyService`, dead 예약 메서드 5종, MOVEMENT_TASK 잔재)을 삭제해 작업 10이 방어할 예약 진입점을 미리 줄인다.

**Architecture:** 순수 삭제. 신규 로직·스키마·마이그레이션 없음. 예약 코어(`UnifiedReservationService.reserveStock`)와 FO 자동경로(`tryReserveItems`·facade·retry worker)는 불가침. 3개 리뷰 단위(서비스 메서드 / 할당 서브시스템 / 직행+타입)로 분할 후 통합 검증.

**Tech Stack:** NestJS(core app), Drizzle ORM, Jest, ESLint. 빌드 `nest build core`, 테스트 `jest`.

## Global Constraints

- **스키마·마이그레이션 무변경.** `stockReservations.targetType` 은 varchar 유지(narrowing 은 TS·주석만). dev DB 의존 ⏸ 항목 없음.
- **동명이인 오삭제 금지** — 파일 경로로 엄격 구분:
  - `reserveStock`: `UnifiedReservationService`(코어·존치) vs `StockEventService`(deprecated 래퍼·삭제).
  - `transferReservation`: `FulfillmentReservationsFacade`(라이브·존치) vs `UnifiedReservationService`(dead·삭제).
  - `ReserveStockDto`: `unified-reservation.service.ts:7` 서비스 인터페이스(존치·narrowing만) vs `dto/reservation/reserve-stock.dto.ts` 컨트롤러 클래스(삭제).
- **회귀 가드 불변**: arch 경계 spec `apps/core/src/modules/inventory/inventory-write-boundary.arch.spec.ts` 항상 GREEN, fulfillment 단위 spec GREEN.
- **검증 게이트(모든 task 공통)**: `npx nest build core` exit 0 · 삭제 심볼 저장소 전역 참조 0 · 변경 파일 신규 eslint error 0. (repo 전역 lint 는 기존부터 대량 debt 상태 — **변경 파일 신규 error 만** 스코프.)

---

## Task 1: dead 예약 메서드 5종 삭제 (서비스 레이어)

라우트·DTO 무변경. 순수 메서드 삭제.

**Files:**
- Modify: `apps/core/src/modules/inventory/core/services/stock-event.service.ts` (`reserveStock` deprecated 래퍼 삭제)
- Modify: `apps/core/src/modules/inventory/shared/services/unified-reservation.service.ts` (`transferReservation` 삭제)
- Modify: `apps/core/src/modules/inventory/shared/services/reservation-lifecycle.service.ts` (`adjustReservationOnQuantityChange` + `handleMovementTaskStatusChange` + `releaseMovementTaskReservations` 삭제)
- Test: 신규 테스트 없음(삭제). 회귀는 `inventory-write-boundary.arch.spec.ts` + fulfillment 단위 spec.

**Interfaces:**
- Consumes: 없음.
- Produces: 아래 심볼이 저장소에서 사라짐 — `StockEventService.reserveStock`, `UnifiedReservationService.transferReservation`, `ReservationLifecycleService.adjustReservationOnQuantityChange`, `ReservationLifecycleService.handleMovementTaskStatusChange`, `ReservationLifecycleService.releaseMovementTaskReservations`.
- **불가침(삭제 금지)**: `UnifiedReservationService.reserveStock`, `FulfillmentReservationsFacade.transferReservation`, `ReservationLifecycleService.handleFulfillmentOrderStatusChange`, `ReservationLifecycleService.consumeFulfillmentOrderReservations`.

- [ ] **Step 1: 삭제 전 dead 재확인 (호출자 0)**

Run:
```bash
cd /home/pauseb/workspace/almondyoung-server
grep -rn "\.reserveStock(" apps/core/src --include="*.ts" | grep -v "unifiedReservation\.\|unified\.reserveStock\|this\.reserveStock\|\.spec\.ts"
grep -rn "\.transferReservation(" apps/core/src --include="*.ts" | grep -v "facade\.\|\.spec\.ts"
grep -rn "adjustReservationOnQuantityChange\|handleMovementTaskStatusChange\|releaseMovementTaskReservations" apps/core/src --include="*.ts" | grep -v "reservation-lifecycle.service.ts"
```
Expected: 세 grep 모두 **출력 없음**(정의 라인 제외 = 0 호출자). 하나라도 호출자가 나오면 중단하고 재검토.

- [ ] **Step 2: `StockEventService.reserveStock` 삭제**

`apps/core/src/modules/inventory/core/services/stock-event.service.ts` 에서 `@deprecated` JSDoc 블록(약 `:88`)과 `async reserveStock(...)` 메서드(약 `:90`부터 끝 `}`까지, `this.unifiedReservation.reserveStock` 위임 본문 포함) 전체 삭제. 메서드 시그니처:
```typescript
/**
 * @deprecated Use UnifiedReservationService.reserveStock() directly
 */
async reserveStock(
  targetType: 'FULFILLMENT_ORDER' | 'MOVEMENT_TASK',
  ...
) { ... }
```
`allocationStrategy` 주입(:22)은 **Task 2 소유** — 여기서 건드리지 않는다.

- [ ] **Step 3: `UnifiedReservationService.transferReservation` 삭제**

`apps/core/src/modules/inventory/shared/services/unified-reservation.service.ts` 에서 `async transferReservation(...)` 메서드(약 `:116`~, 내부 `this.reserveStock(...)` 호출 포함) 전체 삭제. `ReserveStockDto`/`Reservation` 인터페이스(:7,:19)와 `reserveStock` 메서드(:56)는 **존치**.

- [ ] **Step 4: `ReservationLifecycleService` 3메서드 삭제**

`apps/core/src/modules/inventory/shared/services/reservation-lifecycle.service.ts` 에서:
- `private async releaseMovementTaskReservations(...)` (약 `:115`)
- `async adjustReservationOnQuantityChange(...)` (약 `:130`, 끝까지)
- `async handleMovementTaskStatusChange(...)` (약 `:45`, `releaseMovementTaskReservations` 호출하는 `MOVEMENT_TASK` 분기 포함) — 메서드 전체 삭제

**존치**: `handleFulfillmentOrderStatusChange`(:25) · `consumeFulfillmentOrderReservations`(:77) · `releaseFulfillmentOrderReservations`(:81) · `recalculateSellableQuantityForReservationSku`(:18). 삭제 후 미사용 import(예: `MOVEMENT_TASK` 관련 없음, 대부분 공유)만 정리.

- [ ] **Step 5: 빌드 + 회귀 spec GREEN**

Run:
```bash
npx nest build core
npx jest --testPathPattern='inventory-write-boundary'
npx jest --testPathPattern='modules/fulfillment'
```
Expected: build exit 0 · arch spec PASS · fulfillment suite PASS (라이브 `reserveStock`/`transferReservation` 목업은 unified 코어·facade 가리키므로 무영향).

- [ ] **Step 6: 삭제 심볼 전역 참조 0 재확인**

Run:
```bash
grep -rn "StockEventService.*reserveStock\|\.transferReservation\b" apps/core/src --include="*.ts" | grep -v "facade\|unifiedReservation\|\.spec\.ts"
grep -rn "adjustReservationOnQuantityChange\|handleMovementTaskStatusChange\|releaseMovementTaskReservations" apps/core/src --include="*.ts"
```
Expected: 출력 없음.

- [ ] **Step 7: eslint 변경 파일 + 커밋**

Run:
```bash
npx eslint apps/core/src/modules/inventory/core/services/stock-event.service.ts apps/core/src/modules/inventory/shared/services/unified-reservation.service.ts apps/core/src/modules/inventory/shared/services/reservation-lifecycle.service.ts
git add -A
git commit -m "[inventory] dead 예약 메서드 5종 삭제 (작업 9)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
Expected: 변경 파일 신규 eslint error 0.

---

## Task 2: `AllocationStrategyService` 절제 (P2-9) — allocate/available 라우트 동반 은퇴

**Files:**
- Delete: `apps/core/src/modules/inventory/core/services/allocation-strategy.service.ts`
- Modify: `apps/core/src/modules/inventory/core/inventory.module.ts` (import :23 · provider :59 · export :77 제거)
- Modify: `apps/core/src/modules/inventory/core/services/stock-event.service.ts` (import :11 · 생성자 주입 :22 제거)
- Modify: `apps/core/src/modules/inventory/core/controllers/reservation.controller.ts` (`POST allocate` + `GET available/:skuId` 핸들러, `AllocationStrategyService` import/주입 제거)
- Modify: `apps/core/src/modules/inventory/core/dto/reservation/reserve-stock.dto.ts` (`AllocateStockDto` 삭제)
- Modify: `apps/core/src/modules/inventory/core/dto/reservation/reservation-response.dto.ts` (`AllocationResultDto`+`AllocationLocationDto`, `AvailableStockResponseDto`+`AvailableQuantityDto` 삭제)
- Modify: `apps/core/src/modules/inventory/core/services/fifo-allocate.ts` · `location-resolution.strategy.ts` (dangling 주석 rephrase)
- Test: 신규 없음. 회귀는 arch spec + build.

**Interfaces:**
- Consumes: Task 1 완료 상태(무관하지만 순서 유지).
- Produces: `AllocationStrategyService` 및 라우트 `POST /inventory/reservations/allocate`·`GET /inventory/reservations/available/:skuId` 소멸. DTO `AllocateStockDto`·`AllocationResultDto`·`AllocationLocationDto`·`AvailableStockResponseDto`·`AvailableQuantityDto` 소멸.
- **불가침**: `reservation.controller` 유지 라우트(`POST /`(Task 3 소유)·`DELETE :id`·`GET by-target`·`GET by-sku/:skuId`·`GET summary/:warehouseId`·`POST expire-stale`), DTO `ReservationDto`·`ReservationSummaryDto`·`ReservationSummaryTargetDto`·`ReleaseReservationDto`.

- [ ] **Step 1: 삭제 전 사용처 재확인 (컨트롤러 2라우트 + dead 주입뿐)**

Run:
```bash
grep -rn "AllocationStrategyService\|\.allocateStock(\|\.getTotalAvailableQuantity(\|\.getAvailableQuantityByWarehouse(\|\.getAvailableLocations(" apps/core/src --include="*.ts" | grep -v "\.spec\.ts"
```
Expected: `allocation-strategy.service.ts`(정의) · `inventory.module.ts`(배선) · `reservation.controller.ts`(allocate/available 2라우트) · `stock-event.service.ts:11,22`(dead 주입) · `fifo-allocate.ts`/`location-resolution.strategy.ts`(주석) 만. 그 외 사용처가 나오면 중단.

- [ ] **Step 2: 컨트롤러에서 allocate/available 핸들러 + 주입 제거**

`reservation.controller.ts`:
- `@Post('allocate') async allocateStock(...)` 블록(약 `:206`~`:238`) 삭제
- `@Get('available/:skuId') async getAvailableQuantity(...)` 블록(약 `:243`~`:294`) 삭제
- 생성자에서 `private readonly allocationStrategy: AllocationStrategyService,`(:31) 제거
- import 정리: `AllocationStrategyService`(:17) 제거, `AllocateStockDto`(:18) 제거, `AllocationResultDto`·`AvailableStockResponseDto`(:21,:23) 제거. **유지**: `ReserveStockDto`(Task 3에서 제거)·`ReleaseReservationDto`·`ReservationDto`·`ReservationSummaryDto`.

- [ ] **Step 3: 모듈·stock-event 배선 제거**

- `inventory.module.ts`: `AllocationStrategyService` import(:23)·providers 항목(:59)·exports 항목(:77) 삭제. `ReservationController`(:45)는 유지.
- `stock-event.service.ts`: import(:11) `import { AllocationStrategyService } from './allocation-strategy.service';` 삭제, 생성자 주입(:22) `private readonly allocationStrategy: AllocationStrategyService,` 삭제.

- [ ] **Step 4: 서비스 파일 + dead DTO 삭제**

- `rm apps/core/src/modules/inventory/core/services/allocation-strategy.service.ts`
- `reserve-stock.dto.ts`: `export class AllocateStockDto {...}`(:79~끝 전 `ReleaseReservationDto` 앞까지) 삭제. `ReleaseReservationDto`(:138) **존치**.
- `reservation-response.dto.ts`: `AllocationResultDto`(:110)·전용 nested `AllocationLocationDto`(:82)·`AvailableStockResponseDto`(:210)·전용 nested `AvailableQuantityDto`(:190) 삭제. **존치**: `ReservationDto`(:3)·`ReservationSummaryTargetDto`(:144)·`ReservationSummaryDto`(:164).

- [ ] **Step 5: dangling 주석 rephrase (계약 근거 보존)**

- `fifo-allocate.ts:9`: 삭제된 클래스명 제거하되 취지 보존 →
```
 * available(=on_hand−reserved) 기반으로 할당하면 예약 동시 소진 경로에서 이중 차감된다.
```
- `location-resolution.strategy.ts:23`: `AllocationStrategyService.getAvailableLocations` 참조 문장을, 삭제된 심볼 언급 없이 "available 차감 조회를 쓰지 않는다" 취지로 rephrase.

- [ ] **Step 6: 빌드 + 회귀 spec GREEN + 참조 0**

Run:
```bash
npx nest build core
npx jest --testPathPattern='inventory-write-boundary'
grep -rn "AllocationStrategyService\|AllocateStockDto\|AllocationResultDto\|AllocationLocationDto\|AvailableStockResponseDto\|AvailableQuantityDto" apps/core/src --include="*.ts" | grep -v "\.spec\.ts"
```
Expected: build exit 0 · arch PASS · grep 출력 없음.

- [ ] **Step 7: eslint 변경 파일 + 커밋**

Run:
```bash
npx eslint apps/core/src/modules/inventory/core/controllers/reservation.controller.ts apps/core/src/modules/inventory/core/inventory.module.ts apps/core/src/modules/inventory/core/services/stock-event.service.ts apps/core/src/modules/inventory/core/services/fifo-allocate.ts apps/core/src/modules/inventory/core/services/location-resolution.strategy.ts apps/core/src/modules/inventory/core/dto/reservation/reserve-stock.dto.ts apps/core/src/modules/inventory/core/dto/reservation/reservation-response.dto.ts
git add -A
git commit -m "[inventory] AllocationStrategyService 절제 + allocate/available 라우트 은퇴 (작업 9, P2-9)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
Expected: 신규 eslint error 0.

---

## Task 3: 직행 예약 은퇴 + MOVEMENT_TASK 타입 narrowing

**Files:**
- Modify: `apps/core/src/modules/inventory/core/controllers/reservation.controller.ts` (`POST /` `reserveStock` 핸들러 + `ReserveStockDto` import 제거)
- Modify: `apps/core/src/modules/inventory/core/dto/reservation/reserve-stock.dto.ts` (`ReserveStockDto` 클래스 + `ReservationTargetType` enum 삭제, `ReleaseReservationDto` 존치)
- Modify: `apps/core/src/modules/inventory/shared/services/unified-reservation.service.ts` (`ReserveStockDto` 인터페이스 `targetType` narrowing)
- Modify: `apps/core/src/modules/inventory/core/dto/reservation/reservation-response.dto.ts` (`ReservationDto.targetType` narrowing)
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:1327` (`target_type` varchar 주석 갱신)
- Test: 신규 없음. 회귀는 arch spec + fulfillment spec + build.

**Interfaces:**
- Consumes: Task 1(`transferReservation`/`stock-event.reserveStock` 삭제로 MOVEMENT_TASK 타입을 쓰던 dead 시그니처 소멸 완료 — narrowing 이 컴파일 깨뜨리지 않도록 **Task 1 선행 필수**).
- Produces: 라우트 `POST /inventory/reservations` 소멸. `ReserveStockDto`(컨트롤러 클래스)·`ReservationTargetType` enum 소멸. `targetType` 타입 = `'FULFILLMENT_ORDER'` 단일.
- **불가침**: `UnifiedReservationService.reserveStock`(코어)·서비스 인터페이스 `ReserveStockDto`(narrowing만)·`ReleaseReservationDto`·유지 조회 라우트. **손대지 않음(작업 11 소유)**: `POST expire-stale`·`timeoutAt` 컬럼·10분 만료 크론.

- [ ] **Step 1: 직행 POST FE 미사용 재확인**

Run:
```bash
grep -rn "inventory/reservations\"" apps/admin-web/src 2>/dev/null; grep -rn "reserveStock\|/inventory/reservations'" apps/admin-web/src 2>/dev/null
```
Expected: admin-web 에 직행 `POST /inventory/reservations` 호출 없음(by-target/by-sku/summary/DELETE/expire-stale 만). 있으면 중단.

- [ ] **Step 2: 컨트롤러 `reserveStock` 핸들러 제거**

`reservation.controller.ts`: `@Post() async reserveStock(@Body() dto: ReserveStockDto)` 블록(약 `:37`~`:78`) 삭제. import 에서 `ReserveStockDto` 제거(Task 2 후 남은 유일 삭제 대상). 컨트롤러는 `DELETE :id`·조회 3라우트·`expire-stale` 로 유지.

- [ ] **Step 3: 컨트롤러 DTO 클래스 + enum 삭제**

`reserve-stock.dto.ts`: `export class ReserveStockDto {...}`(:9~:78) 삭제, `export enum ReservationTargetType {...}`(:4~:8) 삭제. `ReleaseReservationDto` **존치**. (`AllocateStockDto` 는 Task 2에서 이미 삭제됨.) 파일에 `ReleaseReservationDto` 만 남고 미사용 import 정리.

- [ ] **Step 4: 타입 narrowing (TS·주석만)**

- `unified-reservation.service.ts:8`: `targetType: 'FULFILLMENT_ORDER' | 'MOVEMENT_TASK';` → `targetType: 'FULFILLMENT_ORDER';`
- `reservation-response.dto.ts` `ReservationDto.targetType`(:12): swagger `enum: ['FULFILLMENT_ORDER', 'MOVEMENT_TASK']` → `enum: ['FULFILLMENT_ORDER']`, TS 타입도 `'FULFILLMENT_ORDER'` 단일.
- `inventory.schema.ts:1327`: 주석 `// 'FULFILLMENT_ORDER' | 'MOVEMENT_TASK'` → `// 'FULFILLMENT_ORDER' 만 사용 (구 이동작업 예약 타입 제거)`. 인접 `targetId` 주석(:1328) `// FO ID 또는 Movement Task ID` → `// FO ID`. **컬럼 정의(varchar) 무변경.** 주의: 대체 문구에 `MOVEMENT_TASK` 리터럴을 넣지 말 것(Step 5 grep 과 모순).
- 주의: `getReservationsByTarget(targetType: string)` 등 `string` 시그니처는 무변경.

- [ ] **Step 5: 빌드 + 회귀 spec GREEN + 참조 0**

Run:
```bash
npx nest build core
npx jest --testPathPattern='inventory-write-boundary'
npx jest --testPathPattern='modules/fulfillment'
grep -rn "ReservationTargetType\|MOVEMENT_TASK" apps/core/src --include="*.ts" | grep -v "\.spec\.ts"
```
Expected: build exit 0 · arch PASS · fulfillment PASS · `MOVEMENT_TASK`/`ReservationTargetType` grep 출력 없음(narrowing 후 잔재 0).

- [ ] **Step 6: admin-web type-check (유지 라우트 무변경 확인)**

Run:
```bash
npm run build:admin-web >/dev/null 2>&1 && echo OK || npx tsc -p apps/admin-web/tsconfig.json --noEmit
```
Expected: 신규 TS 에러 0 (은퇴 라우트는 FE 0, 유지 라우트 client 무변경 — repo 기존 TS7006 debt 는 무관).

- [ ] **Step 7: eslint 변경 파일 + 커밋**

Run:
```bash
npx eslint apps/core/src/modules/inventory/core/controllers/reservation.controller.ts apps/core/src/modules/inventory/core/dto/reservation/reserve-stock.dto.ts apps/core/src/modules/inventory/shared/services/unified-reservation.service.ts apps/core/src/modules/inventory/core/dto/reservation/reservation-response.dto.ts apps/core/src/modules/inventory/schema/inventory.schema.ts
git add -A
git commit -m "[inventory] 직행 POST /inventory/reservations 은퇴 + MOVEMENT_TASK 타입 narrowing (작업 9)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
Expected: 신규 eslint error 0.

---

## Task 4: 통합 검증 + 현황판 완료 기록

**Files:**
- Modify: `docs/logistics-backend-hardening-2026-07.md` (P2-9 상태 🟩, WS-C 작업 9 완료 블록 추가)
- Test: 전체 게이트 재실행.

**Interfaces:**
- Consumes: Task 1~3 완료.
- Produces: 작업 9 종결 기록.

- [ ] **Step 1: 전체 검증 게이트 재실행**

Run:
```bash
npx nest build core
npx jest --testPathPattern='inventory-write-boundary'
npx jest --testPathPattern='modules/fulfillment'
grep -rn "AllocationStrategyService\|adjustReservationOnQuantityChange\|handleMovementTaskStatusChange\|releaseMovementTaskReservations\|ReservationTargetType\|MOVEMENT_TASK\|AllocateStockDto\|AllocationResultDto\|AvailableStockResponseDto" apps/core/src --include="*.ts" | grep -v "\.spec\.ts"
```
Expected: build exit 0 · arch PASS · fulfillment PASS · grep 출력 없음.

- [ ] **Step 2: 현황판 갱신**

`docs/logistics-backend-hardening-2026-07.md`:
- P2-9 행 상태 ⬜ → 🟩, 완료 요지(“allocation-strategy dead 절제 — allocate/available 라우트 동반 은퇴”) 추가.
- WS-C 섹션에 “✅ 작업 9 완료 — 2026-07-11” 블록 추가: 삭제 범위(직행 은퇴·AllocationStrategyService·dead 메서드 5종·MOVEMENT_TASK 타입 narrowing), 브랜치 `feat/dead-reservation-surface-sweep`, 검증 결과, 스키마 무변경(dev DB 의존 없음), 문서 정정 2건(available/:skuId 동반·dead 메서드 실제 5종).
- **주의**: 세션 시작 시 이 파일에 uncommitted 수정이 이미 있었음. 그 내용을 덮어쓰지 말고 append/1셀 수정으로만 반영하거나, 충돌 시 사용자에게 확인.

- [ ] **Step 3: 문서 커밋**

Run:
```bash
git add docs/logistics-backend-hardening-2026-07.md
git commit -m "docs(core): 작업 9 완료 기록 — dead 예약/할당 표면 소거 (WS-C, P2-9)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: 최종 상태 요약**

`git log --oneline develop..HEAD` 로 4커밋(또는 3코드+1문서) 확인. PR/머지 여부는 사용자 결정(`finishing-a-development-branch`).

---

## 실행 노트

- **순서 강제**: Task 1 → Task 3 (narrowing 이 dead 메서드 삭제에 의존). Task 2 는 Task 1/3 과 파일 겹침이 있으나(reservation.controller, DTO 파일) 서로 다른 export 를 건드리므로 순차 실행 시 안전. 권장 순서 1→2→3→4.
- **동명이인**: 매 삭제 전 Global Constraints 의 파일 경로 구분표를 확인.
- **비목표 재확인**: `timeoutAt` 컬럼·`expire-stale` 라우트·만료 크론·`reserveStock` 잠금은 이 계획에서 **손대지 않는다**(작업 10/11 소유).
