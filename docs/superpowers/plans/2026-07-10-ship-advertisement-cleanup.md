# ship 광고 정리 + 데드 액션 3건 은퇴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 은퇴한 `POST /fulfillments/:id/ship` 광고와 서버가 애초에 없는 `assignShipment`·`split` 액션의 admin-web 데드 UI 를 전량 제거해 FE↔BE 계약을 정합화한다 (P2-11, WS-B 작업 7).

**Architecture:** 서버 `computeAdminAvailableActions` 에서 `ship` push 블록을 삭제(광고 중단)하고, admin-web 은 세 데드 액션을 **각각 수직 슬라이스**(UI 사용처 + 훅 + 배럴 재수출 + client 메서드 + DTO)로 제거한다. 각 슬라이스는 `tsc --noEmit` 이 GREEN 이 되도록 완결적으로 제거해 매 커밋이 컴파일 가능한 상태를 유지한다. 서버 `ship()` 서비스 메서드(direct-ship 내부 호출 라이브)와 shipment-tab 의 정보표시·deliver 섹션은 불가침.

**Tech Stack:** NestJS(core) · Jest · Drizzle(무변경) · Next.js(admin-web) · TypeScript · React Query(mutations)

## Global Constraints

- 스키마·마이그레이션 **무변경** — dev DB 의존 없음, 전 테스트 지금 실행 가능.
- 서버 `FulfillmentsService.ship()` (`fulfillments.service.ts:858`) **불가침** — `direct-ship.service.ts:330` 내부 호출 라이브. 제거 대상은 광고 블록(`computeAdminAvailableActions`)뿐.
- shipment-tab 의 섹션 A(송장/배송 정보) · 섹션 D(deliver) 및 그 공유 심볼(`AlertTriangle`/`PackageCheck`/`useDeliverFulfillment`/`extractErrorMessage`/`queryClient`) **존치**.
- admin-web 제거 완결성의 게이트 = `npm --prefix apps/admin-web run type-check` GREEN (dangling import/미사용 심볼 0).
- 커밋 메시지 prefix: 서버 `[fulfillment]`, admin-web `[admin-web]`, 현황판 `[docs]`.
- lint 검증은 **변경 파일 스코프**로만 (repo 전역 lint debt 무관).
- 커밋 시 표준 트레일러 부착:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FAeYiGWW6ALHsdTDc6Hg7n
  ```

---

### Task 1: 서버 — ship 광고 제거 + spec 갱신 (TDD)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts:1075-1077`
- Test: `apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts:1411-1414, 1478-1482`

**Interfaces:**
- Consumes: 없음 (스프린트 진입점)
- Produces: `computeAdminAvailableActions` 가 `ship` 을 어떤 status 에서도 반환하지 않음 — admin-web 슬라이스(Task 2~4)의 계약 전제.

- [ ] **Step 1: spec 을 "ship 미광고"로 먼저 갱신 (RED 준비)**

`fulfillments.service.spec.ts:1411-1413` — getOne 상세 단언에서 `'ship'` 제거:

```ts
    expect(detail?.adminAvailableActions).toEqual(
      expect.arrayContaining(['reserve', 'cancel']),
    );
    expect(detail?.adminAvailableActions).not.toContain('split');
```

`fulfillments.service.spec.ts:1478-1482` — `inspected → ship 허용` 테스트를 **라이브 status(`invoiced`) 기반 은퇴 회귀 가드**로 교체 (dead status `inspected` 대신 이전에 ship 을 광고하던 실사용 status 로 회귀 방지):

```ts
    it('invoiced 상태에서 ship이 더 이상 광고되지 않는다 (라우트 은퇴)', async () => {
      const { service, tx } = makeFoDetail('invoiced');
      const detail = await service.getOne('fo-action-test', tx);
      expect(detail?.adminAvailableActions).not.toContain('ship');
    });
```

(`ready → not ship` 테스트 `:1484-1493` 는 그대로 둔다 — 여전히 참.)

- [ ] **Step 2: 테스트 실행 → 실패 확인 (RED)**

Run: `npx jest --testPathPattern=fulfillments.service.spec.ts -t "invoiced 상태에서 ship"`
Expected: FAIL — 서비스가 아직 `invoiced` 에서 `ship` 을 push 하므로 `not.toContain('ship')` 위반.

- [ ] **Step 3: 서비스에서 ship push 블록 삭제**

`fulfillments.service.ts:1075-1077` 의 아래 3줄 삭제:

```ts
    if (['invoiced', 'labeled', 'picked', 'inspecting', 'inspected'].includes(fo.status)) {
      actions.push('ship');
    }
```

(같은 파일 `ship()` 메서드 `:858` 는 건드리지 않는다.)

- [ ] **Step 4: 테스트 실행 → 통과 확인 (GREEN)**

Run: `npx jest --testPathPattern=fulfillments.service.spec.ts`
Expected: PASS — 전 케이스 GREEN (`invoiced → not ship`, getOne 상세, ready, drop_ship 등).

- [ ] **Step 5: arch 경계 회귀 + 빌드 + lint**

Run:
```bash
npx jest --testPathPattern=inventory-write-boundary.arch.spec
npx nest build core
npx eslint apps/core/src/modules/fulfillment/services/fulfillments.service.ts apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts
```
Expected: arch spec PASS · `nest build core` exit 0 · eslint 변경 2파일 신규 error 0.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/fulfillments.service.ts apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts
git commit -m "[fulfillment] computeAdminAvailableActions의 은퇴 ship 액션 광고 제거 (P2-11)

- ship push 블록 삭제 — POST /fulfillments/:id/ship 은 은퇴, 실제 출고는 스캔 경로
- spec: invoiced 상태 ship 미광고 회귀 가드로 교체, getOne 상세 단언에서 ship 제거
- ship() 서비스 메서드(direct-ship 내부 호출)는 불가침

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FAeYiGWW6ALHsdTDc6Hg7n"
```

---

### Task 2: admin-web — ship 슬라이스 제거

**Files:**
- Modify: `apps/admin-web/src/features/order/fulfillments/components/detail/index.tsx` (헤더 "출고" 버튼 + handleShip + shipMutation)
- Modify: `apps/admin-web/src/features/order/fulfillments/detail/shipment-tab.tsx` (섹션 C + handleShip + canShip)
- Modify: `apps/admin-web/src/lib/services/orders/mutations.ts` (`useShipFulfillment` 제거)
- Modify: `apps/admin-web/src/lib/services/orders/index.ts` (배럴 재수출 제거)
- Modify: `apps/admin-web/src/lib/api/domains/orders/fulfillments.client.ts` (`ship` 메서드 제거)

**Interfaces:**
- Consumes: Task 1 이 `ship` 을 미광고 → `canShip` 은 항상 false (제거 안전).
- Produces: `useShipFulfillment` · client `ship()` 심볼 소멸 (저장소 참조 0).

- [ ] **Step 1: 활성 부모의 헤더 ship 버튼 제거**

`components/detail/index.tsx`: 헤더 "출고" `ConfirmActionButton`(`:165-171`), `handleShip`(`:127-134`), `shipMutation = useShipFulfillment()`(`:97`), `useShipFulfillment` import(`:24`) 삭제. `TERMINAL_STATUSES` 등 cancel/reserve 공유 심볼은 존치.

- [ ] **Step 2: shipment-tab 섹션 C(ship) 제거**

`detail/shipment-tab.tsx`: "출고 완료 (ship)" 섹션(`:207-239`), `handleShip`(`:80-87`), `canShip`(`:49`), `ship = useShipFulfillment()`(`:57`), `useShipFulfillment` import(`:21`) 삭제. 섹션 A(정보)·B(assignShipment, Task 3 소유)·D(deliver) 및 공유 심볼 존치.

- [ ] **Step 3: 훅 · 배럴 · client 메서드 제거**

- `mutations.ts`: `useShipFulfillment`(`:874-886`) 삭제.
- `services/orders/index.ts`: `useShipFulfillment` 재수출(`:78`) 삭제.
- `fulfillments.client.ts`: `ship`(`:86-89`) 메서드 삭제.

- [ ] **Step 4: 타입체크 + lint**

Run:
```bash
npm --prefix apps/admin-web run type-check
npx eslint apps/admin-web/src/features/order/fulfillments/components/detail/index.tsx apps/admin-web/src/features/order/fulfillments/detail/shipment-tab.tsx apps/admin-web/src/lib/services/orders/mutations.ts apps/admin-web/src/lib/services/orders/index.ts apps/admin-web/src/lib/api/domains/orders/fulfillments.client.ts
```
Expected: `type-check` GREEN (dangling import 0) · eslint 변경 파일 신규 error 0.

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/order/fulfillments/components/detail/index.tsx apps/admin-web/src/features/order/fulfillments/detail/shipment-tab.tsx apps/admin-web/src/lib/services/orders/mutations.ts apps/admin-web/src/lib/services/orders/index.ts apps/admin-web/src/lib/api/domains/orders/fulfillments.client.ts
git commit -m "[admin-web] 은퇴 ship 액션 UI 전량 제거 (P2-11)

- 상세 헤더 출고 버튼 + shipment-tab 출고 섹션 제거 (둘 다 404 호출)
- useShipFulfillment 훅 · 배럴 재수출 · client ship() 제거

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FAeYiGWW6ALHsdTDc6Hg7n"
```

---

### Task 3: admin-web — assignShipment 슬라이스 제거

**Files:**
- Modify: `apps/admin-web/src/features/order/fulfillments/detail/shipment-tab.tsx` (섹션 B 폼 + 관련 state/const/import)
- Modify: `apps/admin-web/src/lib/services/orders/mutations.ts` (`useAssignFulfillmentShipment` 제거)
- Modify: `apps/admin-web/src/lib/services/orders/index.ts` (배럴 재수출 제거)
- Modify: `apps/admin-web/src/lib/api/domains/orders/fulfillments.client.ts` (`assignShipment` 메서드 제거)
- Modify: `apps/admin-web/src/lib/types/dto/fulfillment.ts` (`AssignShipmentRequest` 인터페이스 제거)

**Interfaces:**
- Consumes: 서버가 `assignShipment` 미광고 → `canAssign` 항상 false.
- Produces: `useAssignFulfillmentShipment` · client `assignShipment()` · `AssignShipmentRequest` 소멸.

> Task 2 가 shipment-tab 섹션 C 를 이미 지웠으므로 아래 line 번호는 이동했을 수 있다 — **심볼/섹션 헤더로 위치를 잡는다**.

- [ ] **Step 1: shipment-tab 섹션 B(assignShipment) 제거**

`detail/shipment-tab.tsx`: "운송장 등록" 폼 섹션(원 `:147-205`), `handleAssignShipment`(`:60-78`), `canAssign`(`:48`), `assignShipment = useAssignFulfillmentShipment()`(`:56`), state `trackingNo`/`carrier`/`eta`(`:52-54`), `CARRIER_LABELS` const(`:27-34`), 타입 import `AssignShipmentRequest`(`:25`), 폼 전용 import `Input`(`:7`)·`Label`(`:8`)·`Select…` 블록(`:11-17`)·icon `Truck`(`:18`), 훅 import `useAssignFulfillmentShipment`(`:20`) 삭제. `useState` 가 잔존 사용처 없으면 import(`:3`)도 삭제(type-check 로 확정). `AlertTriangle`(deliver 사용)·`PackageCheck` 존치.

- [ ] **Step 2: 훅 · 배럴 · client · DTO 제거**

- `mutations.ts`: `useAssignFulfillmentShipment`(`:863`) + 미사용화되는 `AssignShipmentRequest` import(`:38`) 삭제.
- `services/orders/index.ts`: `useAssignFulfillmentShipment` 재수출(`:101`) 삭제.
- `fulfillments.client.ts`: `assignShipment`(`:81-84`) 메서드 + 미사용화되는 `AssignShipmentRequest` import(`:20`) 삭제.
- `lib/types/dto/fulfillment.ts`: `AssignShipmentRequest` 인터페이스(`:177`) 삭제.

- [ ] **Step 3: 타입체크 + lint + 참조 0 확인**

Run:
```bash
npm --prefix apps/admin-web run type-check
grep -rn "assignShipment\|AssignShipmentRequest\|useAssignFulfillmentShipment" apps/admin-web/src || echo "references: 0"
npx eslint apps/admin-web/src/features/order/fulfillments/detail/shipment-tab.tsx apps/admin-web/src/lib/services/orders/mutations.ts apps/admin-web/src/lib/services/orders/index.ts apps/admin-web/src/lib/api/domains/orders/fulfillments.client.ts apps/admin-web/src/lib/types/dto/fulfillment.ts
```
Expected: `type-check` GREEN · grep 참조 0 · eslint 신규 error 0.

- [ ] **Step 4: 커밋**

```bash
git add apps/admin-web/src/features/order/fulfillments/detail/shipment-tab.tsx apps/admin-web/src/lib/services/orders/mutations.ts apps/admin-web/src/lib/services/orders/index.ts apps/admin-web/src/lib/api/domains/orders/fulfillments.client.ts apps/admin-web/src/lib/types/dto/fulfillment.ts
git commit -m "[admin-web] 데드 assignShipment 액션 전량 제거 (P2-11)

- shipment-tab 운송장 등록 폼(영구 비활성) + 훅 + client + DTO 제거
- 서버 라우트 부재 · 서버 미광고로 canAssign 항상 false였음

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FAeYiGWW6ALHsdTDc6Hg7n"
```

---

### Task 4: admin-web — split 슬라이스 제거 (탭째 + 데드 부모 파일)

**Files:**
- Delete: `apps/admin-web/src/features/order/fulfillments/detail/split-tab.tsx`
- Delete: `apps/admin-web/src/features/order/fulfillments/detail/index.tsx` (데드 부모, 0 importer)
- Modify: `apps/admin-web/src/features/order/fulfillments/components/detail/index.tsx` (split 탭 등록 제거)
- Modify: `apps/admin-web/src/lib/services/orders/mutations.ts` (`useSplitFulfillmentOrder` 제거)
- Modify: `apps/admin-web/src/lib/services/orders/index.ts` (배럴 재수출 제거)
- Modify: `apps/admin-web/src/lib/api/domains/orders/fulfillments.client.ts` (`split` 메서드 제거)
- Modify: `apps/admin-web/src/lib/types/dto/fulfillment.ts` (`SplitFulfillmentOrderRequest` 인터페이스 제거)

**Interfaces:**
- Consumes: 서버가 `split` 미광고 → split-tab `blocked` 항상 true (차단 Alert 만 렌더).
- Produces: `split-tab` 컴포넌트 · `useSplitFulfillmentOrder` · client `split()` · `SplitFulfillmentOrderRequest` 소멸. FO 상세 탭 목록에서 split 사라짐.

- [ ] **Step 1: 데드 부모 파일 0 importer 재확인 후 삭제**

Run: `grep -rn "fulfillments/detail'" apps/admin-web/src; grep -rn "from './detail'" apps/admin-web/src/features/order/fulfillments`
Expected: `detail/index.tsx`(디렉토리 배럴이 아닌 파일 자체)의 `FulfillmentDetail` importer 0 확인.

확인되면: `git rm apps/admin-web/src/features/order/fulfillments/detail/index.tsx apps/admin-web/src/features/order/fulfillments/detail/split-tab.tsx`

(만약 importer 가 발견되면 폴백: 파일 삭제 대신 해당 파일 내 split/shipment 참조만 제거 — §8 리스크 참조.)

- [ ] **Step 2: 활성 부모에서 split 탭 등록 제거**

`components/detail/index.tsx`: split `TabsTrigger value="split"`(`:288`), split `TabsContent`(`:298-300`), `SplitTab` import(`:30`) 삭제. **shipment 탭 등록(`:289,:301-303,:31`)은 존치.**

- [ ] **Step 3: 훅 · 배럴 · client · DTO 제거**

- `mutations.ts`: `useSplitFulfillmentOrder`(`:810`) + 미사용화되는 `SplitFulfillmentOrderRequest` import(`:34`) 삭제.
- `services/orders/index.ts`: `useSplitFulfillmentOrder` 재수출(`:96`) 삭제.
- `fulfillments.client.ts`: `split`(`:46-49`) 메서드 + 미사용화되는 `SplitFulfillmentOrderRequest` import(`:15`) 삭제.
- `lib/types/dto/fulfillment.ts`: `SplitFulfillmentOrderRequest` 인터페이스(`:140`) 삭제.

- [ ] **Step 4: 타입체크 + lint + 참조 0 확인**

Run:
```bash
npm --prefix apps/admin-web run type-check
grep -rn "split-tab\|SplitTab\|useSplitFulfillmentOrder\|SplitFulfillmentOrderRequest\|fulfillments.client.*split\b" apps/admin-web/src || echo "references: 0"
npx eslint apps/admin-web/src/features/order/fulfillments/components/detail/index.tsx apps/admin-web/src/lib/services/orders/mutations.ts apps/admin-web/src/lib/services/orders/index.ts apps/admin-web/src/lib/api/domains/orders/fulfillments.client.ts apps/admin-web/src/lib/types/dto/fulfillment.ts
```
Expected: `type-check` GREEN · grep 참조 0 (`.split(` 문자열 처리는 무관) · eslint 신규 error 0.

- [ ] **Step 5: 커밋**

```bash
git add -A apps/admin-web/src/features/order/fulfillments apps/admin-web/src/lib/services/orders apps/admin-web/src/lib/api/domains/orders/fulfillments.client.ts apps/admin-web/src/lib/types/dto/fulfillment.ts
git commit -m "[admin-web] 데드 split 탭 전량 제거 + 데드 부모 파일 정리 (P2-11)

- split-tab(항상 차단 Alert만 렌더하는 데드 탭) + 탭 등록 제거
- 0-importer 데드 부모 detail/index.tsx 삭제
- useSplitFulfillmentOrder 훅 + client split() + DTO 제거
- 합배송/송장분할(W5)은 착수 시 재스캐폴딩

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FAeYiGWW6ALHsdTDc6Hg7n"
```

---

### Task 5: 현황판 문서화 + 최종 검증

**Files:**
- Modify: `docs/logistics-backend-hardening-2026-07.md` (P2-11 상태 + WS-B 작업 7 완료 블록)

**Interfaces:**
- Consumes: Task 1~4 완료.
- Produces: 스프린트 현황판이 작업 7 완료 반영.

- [ ] **Step 1: 최종 통합 검증 (전 삭제 심볼 저장소 전역 참조 0)**

Run:
```bash
npx nest build core
grep -rn "useShipFulfillment\|useAssignFulfillmentShipment\|useSplitFulfillmentOrder" apps/admin-web/src || echo "hooks: 0"
grep -rn "/ship\b\|assign-shipment\|/split\b" apps/admin-web/src/lib/api/domains/orders/fulfillments.client.ts || echo "client routes: 0"
npx jest --testPathPattern="fulfillments.service.spec|inventory-write-boundary.arch.spec"
npm --prefix apps/admin-web run type-check
```
Expected: `nest build core` exit 0 · 훅 참조 0 · client 라우트 0 · 단위/arch spec PASS · admin-web type-check GREEN.

- [ ] **Step 2: P2-11 행 상태 갱신**

`docs/logistics-backend-hardening-2026-07.md` §2 P2-11 행: 상태 `⬜` → `🟩`, 말미에 완료 근거 추가:
```
**✅ 작업 7 완료(2026-07-10)**: 서버 광고 블록 삭제 + admin-web ship(헤더+탭)·assignShipment·split(탭째) 3건 전량 제거. 서버 ship() 메서드(direct-ship 내부 호출) 존치.
```

- [ ] **Step 3: §5 WS-B 에 작업 7 완료 블록 추가**

WS-B 작업 6 완료 블록 뒤에 작업 5·6 형식으로 추가:
```
> **✅ 작업 7 (ship 광고 정리, P2-11) 완료 — 2026-07-10:** 은퇴한 `POST /fulfillments/:id/ship` 광고와 서버 미광고 데드 액션(assignShipment/split)의 admin-web UI 를 전량 제거. FE↔BE 계약 정합화. 스키마 무변경.
> - **서버**: `computeAdminAvailableActions` 의 ship push 블록 삭제(`fulfillments.service.ts:1075-1077`). `ship()` 메서드(`:858`, direct-ship 내부 호출 라이브) 불가침. spec: invoiced 상태 ship 미광고 회귀 가드로 교체.
> - **admin-web (수직 슬라이스 3)**: ship(상세 헤더 버튼 + shipment-tab 섹션, 둘 다 404 호출) · assignShipment(영구 비활성 폼) · split(항상 차단 Alert 뜨는 데드 탭 — 탭째 제거) 각각 UI+훅+배럴+client+DTO 완결 제거. 0-importer 데드 부모 `detail/index.tsx` 동반 삭제.
> - **부수 발견**: ship 호출자가 상세 헤더에도 존재(2곳)했음. shipment-tab 은 정보표시·deliver 섹션 존치로 탭 유지.
> - 브랜치 `feat/ship-advertisement-cleanup` → develop 스쿼시 머지 예정.
> - 설계 `docs/superpowers/specs/2026-07-10-ship-advertisement-cleanup-design.md` · 계획 `docs/superpowers/plans/2026-07-10-ship-advertisement-cleanup.md`.
> - 검증: `nest build core` exit 0 · fulfillment 단위/arch 경계 spec PASS · admin-web `type-check` GREEN · 삭제 심볼 저장소 전역 참조 0. 스키마 무변경이라 dev DB 의존 ⏸ 없음.
> - **WS-B 잔여**: 작업 8(P3-4·P3-5 스키마 contract, expand-contract)뿐.
```

`§5 권장 착수 순서` 줄의 "WS-B 잔여 작업 7·8" 을 "작업 8" 로 갱신.

- [ ] **Step 4: 커밋**

```bash
git add docs/logistics-backend-hardening-2026-07.md
git commit -m "[docs] WS-B 작업 7(ship 광고 정리, P2-11) 완료 반영

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FAeYiGWW6ALHsdTDc6Hg7n"
```

---

## 완료 기준 (전 Task 후)

- `computeAdminAvailableActions` 가 ship/assignShipment/split 미반환 (spec 단언).
- admin-web 에 세 데드 액션의 UI·훅·client·DTO 참조 0.
- `nest build core` exit 0 · admin-web `type-check` GREEN · fulfillment 단위/arch spec PASS · 변경 파일 신규 eslint error 0.
- 서버 `ship()` 메서드 · shipment-tab 정보/deliver 섹션 존치.
- 현황판 P2-11 🟩, WS-B 잔여 = 작업 8 뿐.
