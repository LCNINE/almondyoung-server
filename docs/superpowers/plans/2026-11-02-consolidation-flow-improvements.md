# 합포장 흐름 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 합칠 주문을 송장 전에 찾고, 합치는 중과 합친 뒤의 상태를 리스트와 상세에서 바로 알 수 있게 한다.

**Architecture:** 합치는 명령과 복구 흐름(`ConsolidationService`, 리컨실러 25번)은 건드리지 않는다. core 에 읽기 전용 판 조회와 리스트 표시 값만 더하고, admin-web 은 기존 `ConsolidationSheet`·`ConsolidationProgressPanel` 을 재사용해 화면을 바꾼다.

**Tech Stack:** NestJS, Drizzle, Next.js, React Query, Jest

**Spec:** 시안 https://claude.ai/artifact/XuEoEQvt4brSNBysB7uTkc , 결정 기록 `docs/outbound-consolidation-split-backorder-decision-record.md` §3·§4

**실행 방식:** 서브에이전트, 리뷰는 Codex. 구현 착수는 사용자 지시를 기다린다. 커밋 시점은 착수할 때 정한다.

## Global Constraints

- 합치기는 사람이 실행한다. 자동 합치기는 만들지 않는다(결정 기록 §3).
- 원본 상자 재사용 금지, 결과는 새 상자(결정 기록 §3). 기존 동작을 바꾸지 않는다.
- 묶는 기준은 `consolidationCustomerKey` + 메모를 뺀 `canonicalConsolidationRecipient`. 새 기준을 만들지 않는다.
- 새 라우트는 `@RequirePermission` 과 `@PiiResponse` 를 달고 `scripts/security/pii-routes.ts` 에 한 줄 더한다.
- Service 는 흐름만, 조회는 Reader. `any`·`as` 금지.
- 고객 화면 문구는 해요체, 특수 인용부호 금지, 설명 주석 금지.
- jest 는 `--maxWorkers=2`.

## Review Focus

- 한 상자에 주문이 3건 이상이면 파트너 주문번호를 전부 보여 준다(두 줄 쌍을 가정하지 않는다).
- 메모만 다른 주문은 같은 묶음이고, 합치기 판단은 수령인 변경 권한에 따른다.
- 고객 키가 없는 주문(`unknown_customer`)은 판에 안 나온다. 이름만 같은 다른 사람을 묶지 않는다.
- 송장이나 배치가 있는 상자는 바로 합치기로 보이면 안 된다(`needsUnwindSteps` 와 같은 판정).
- `recovery_required` 인데 합포장이 아닌 상자(`DISPATCH_RECALL_PENDING` 등)는 계속 복구필요로 보인다.

---

### Task 1: core 합칠 주문 판 조회

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/consolidation-board.reader.ts`
- Create: `apps/core/src/modules/fulfillment/services/consolidation-board.spec.ts`
- Modify: `services/consolidation-options.ts` (`withoutNote` 를 `recipientAddressKey` 로 export), `controllers/consolidation.controller.ts`, `dto/consolidation.dto.ts`, fulfillment 모듈 providers
- Modify: `scripts/security/pii-routes.ts`

**Interfaces:**
- Produces: `GET /shipments/consolidation-board?warehouseId=` → `{ groups: ConsolidationBoardGroupDto[] }`
- `ConsolidationBoardGroupDto = { key: string; recipientSnapshot; memoDiffers: boolean; shipments: ConsolidationOptionShipmentDto[] }`, `canMergeNow = shipments 전부 draft·배치 없음·송장 없음`
- `groupConsolidationBoard(rows: BoardRow[]): BoardGroup[]` 순수 함수

- [ ] **Step 1: `consolidation-board.spec.ts` 실패 테스트**: 같은 고객·주소 2건은 한 묶음, 메모만 달라도 한 묶음이고 `memoDiffers: true`, 주소가 다르면 분리, 고객 키 null 제외, 3건 묶음 유지, 상세주소 빈 값끼리 한 묶음
- [ ] **Step 2: `npx jest --maxWorkers=2 consolidation-board` 로 FAIL 확인**
- [ ] **Step 3: 순수 함수와 reader 구현**: 창고의 `OPTION_STATUSES` 상자·라인을 쿼리 한 번으로 읽고 `loadProgress` 와 같은 방식으로 배치·송장을 붙인다. in_house 아니거나 drop_shipped 라인이 있는 상자, supplierId 있는 상자는 뺀다. 묶음이 2상자 이상인 것만 돌려준다. `loadProgress`·`summary`·`loadLines` 는 `ConsolidationOptionsReader` 에서 공유 함수로 뺀다.
- [ ] **Step 4: 컨트롤러 라우트**: `consolidation-options` 의 `@PiiResponse` 를 `groups[].recipientSnapshot.*` 로 옮기고 subject 는 `groups[].shipments[].shipmentId`. `pii-routes.ts` 34·127행 옆에 추가.
- [ ] **Step 5: `npx jest --maxWorkers=2 consolidation-board pii-routes route-classification` PASS 확인**
- [ ] **Step 6: Commit**

### Task 2: core 출고주문 리스트에 합포장 표시 값

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/fo-consolidation-labels.ts`
- Create: `apps/core/src/modules/fulfillment/services/fo-consolidation-labels.spec.ts`
- Modify: `services/fulfillments.service.ts`, `dto/fulfillment-order-response.dto.ts`

**Interfaces:**
- Produces: 응답 필드 `consolidation: { state: 'none' | 'mergeable' | 'merging' | 'merged'; partnerOrderNos: string[] } | null`
- `foConsolidationState(input): FoConsolidation` 순수 함수. 입력은 FO 의 열린 상자들(status, recoveryCode, 상자에 담긴 주문번호들)과 합칠 수 있는 주문번호 목록
- 우선순위: `merging`(`CONSOLIDATION_RECOVERY_CODE`) > `merged`(열린 상자에 주문 2건 이상) > `mergeable` > `none`

- [ ] **Step 1: 실패 테스트**: 위 우선순위, `DISPATCH_RECALL_PENDING` 은 `merging` 아님, superseded 상자는 무시, 파트너 3건 전부 표시
- [ ] **Step 2: FAIL 확인**
- [ ] **Step 3: 구현**: `withFoLabels` 뒤에 상세·리스트 모두 값을 붙인다. mergeable 은 줄마다 묻지 않고, 페이지 행의 FO 들을 Task 1 의 `groupConsolidationBoard` 로 한 번에 판정한다. 조회 횟수는 행 수와 무관해야 한다(테스트로 고정).
- [ ] **Step 4: PASS 확인 후 Commit**

### Task 3: admin 리스트 상자 칸과 합포장 중 표시

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/fulfillment.ts`, `hooks/table/columns/use-fulfillments-table-columns.tsx`, `components/table/table-cells/fulfillment/fo-status-cell.tsx`, `features/order/fulfillments/components/fo-status-badge/index.tsx`, `features/order/fulfillments/components/detail/index.tsx`
- Create: `components/table/table-cells/fulfillment/fo-consolidation-cell.tsx` + spec

**Interfaces:**
- Consumes: Task 2 의 `consolidation`
- Produces: `FoStatusCell({ value, consolidation })`, `FoConsolidationCell({ value })`

- [ ] **Step 1: 실패 테스트**: `merging` 이면 `합포장 중`(amber), 아니면 `복구필요` 유지. 상자 칸 문구 `#6322와 합칠 수 있어요`, `#6275와 한 상자`, 3건이면 `#6275 외 1건과 한 상자`
- [ ] **Step 2: FAIL 확인**
- [ ] **Step 3: 구현**: 상태 칸 다음에 상자 칸. 리스트 위 안내 `합칠 수 있는 주문이 N쌍 있어요` + `/order/consolidation` 링크
- [ ] **Step 4: `npm run test:admin-web -- fo-consolidation` PASS, Commit**

### Task 4: admin 합칠 주문 화면

**Files:**
- Modify: `apps/admin-web/src/features/order/consolidation/template/index.tsx`, `lib/api/domains/orders/consolidation.client.ts`, `lib/services/orders/queries.ts`, `query-keys.ts`, `lib/utils/menu.ts`, `lib/pii/pii-screens.ts`
- Create: `features/order/consolidation/board-model.ts` + spec

**Interfaces:**
- Consumes: Task 1 의 조회, 기존 `ConsolidationSheet({ shipmentId, open, onOpenChange, onRequested })`
- Produces: `boardRowAction(group): 'merge' | 'unwind_merge'`, `useConsolidationBoard(warehouseId)`

- [ ] **Step 1: 실패 테스트**: `needsUnwindSteps` 하나라도 참이면 `unwind_merge`, 메모 다름 표시, 판 비었을 때 빈 문구
- [ ] **Step 2: FAIL 확인**
- [ ] **Step 3: 구현**: 시안 화면 1 표. 창고 기본값 부천. 버튼은 `ConsolidationSheet` 를 연다. 옛 후보 선택 UI 제거. 메뉴명은 `합칠 수 있는 주문`.
- [ ] **Step 4: 선택 항목 합치기**: 체크박스는 `boardRowAction === 'merge'` 이고 메모가 같은 묶음에만 켠다. 버튼은 고른 묶음마다 기존 `consolidations` POST 를 순서대로 부르고, 묶음별 성공과 실패를 결과로 보여 준다. 하나가 실패해도 나머지는 계속한다. 작업 사유는 기본값 `동일 수령인 합포장` 을 쓴다. 테스트: 송장 있는 묶음·메모 다른 묶음은 선택 불가, 일부 실패 시 결과 표시
- [ ] **Step 5: 게이트 스펙(`screen-access`, `mutation-guard`, `pii-screens`, `medusa-coverage`) PASS, Commit**

### Task 5: admin 송장 발급 전 경고

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/planned-shipments.reader.ts` + spec
- Modify: `apps/core/src/modules/fulfillment/controllers/consolidation.controller.ts`
- Modify: `apps/admin-web/src/features/order/waybill-issue/template/WaybillIssueTemplate.tsx`
- Create: `features/order/waybill-issue/merge-warning.tsx` + spec

**Interfaces:**
- Consumes: Task 1 의 `GET /shipments/consolidation-board`, 기존 `POST waybills:batch`, `ConsolidationSheet`
- Produces: `GET /shipments/planned?warehouseId=` → `{ shipmentId, orderNos, totalQty }[]` (수령인 없음, `fulfillment.shipment.read`), `MergeWarning({ pairs, onMerge, onDismiss })`

시안대로 주문 드롭다운을 없애고 창고의 발급 대기 상자를 체크박스로 여러 건 고른다. 합치기는 새 상자가 계획 확정을 거쳐야 하므로 자동 발급하지 않는다. 시안의 합치고 발급 버튼 이름은 합치기로 쓴다.

- [ ] **Step 1: 실패 테스트**: 고른 상자가 같은 판 묶음이면 경고, `따로 발급` 후 숨김, 한쪽만 고르면 미경고, 조회 실패는 발급을 막지 않음, 발급 전 건수 확인 창
- [ ] **Step 2: FAIL 확인**
- [ ] **Step 3: 구현**: 조회 라우트와 체크박스 표, 주문번호 검색. 경고가 떠 있어도 발급 버튼은 막지 않는다. `waybills:batch` 의 개수 상한을 확인해 화면에서도 같은 상한을 건다
- [ ] **Step 4: 게이트 스펙 포함 PASS 확인 후 Commit**

### Task 6: admin 상세 합치는 중과 합친 뒤

**Files:**
- Modify: `apps/admin-web/src/features/order/fulfillments/detail/shipment-tab.tsx`, `consolidation-progress-panel.tsx`, `lib/services/orders/*` 해당 조회
- Modify: `consolidation-progress-panel.spec.tsx`, `shipment-tab.render.spec.tsx`

**Interfaces:**
- Consumes: Task 2 의 `consolidation`, 기존 합포장 진행 응답
- Produces: `orderShipments(shipments): { active, retired }`

- [ ] **Step 1: 실패 테스트**: superseded 상자는 뒤로 가고 접힘, 기본 선택은 열린 상자, 진행 패널 제목이 주문번호를 말함(`#6314와 #6275를 합치는 중이에요`), 지금 할 일이 어느 주문의 어느 송장인지 말함, 합친 뒤 새 상자로 가기 없이 다음 할 일 3단계 표시
- [ ] **Step 2: FAIL 확인**
- [ ] **Step 3: 구현**: 합친 뒤 안내는 현재 초록 카드를 새 상자 쪽 맨 위로 옮긴다. 재고 수량 표시는 상자 전체 기준으로 맞춘다.
- [ ] **Step 4: `npm run test:admin-web`, `npm run type-check`, `npx jest --maxWorkers=2 apps/core/src/modules/fulfillment` PASS 확인**
- [ ] **Step 5: Commit**
