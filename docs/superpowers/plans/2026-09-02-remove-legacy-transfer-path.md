# 옛 재고 이동 경로(A) 철거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `inventory/core` 의 옛 이동 경로 A(`/inventory/transfers`)를 코드에서 완전히 제거하고, 창고 내 이동은 `movement`(B), 창고 간 이동은 `warehouse-transfer`(C) 로 일원화한다.

**Architecture:** 순수 삭제다. 스키마 변경 0건, 마이그레이션 0건, 데이터 이관 0건 — 대상 테이블이 전부 0행이라 expand-contract 가 적용되지 않는다. core 는 라우트 6개와 그 뒤의 서비스·DTO·매퍼를 지우고, admin-web 은 화면과 데이터 계층을 지운다. **admin-web 에 `/inventory/movement` 화면이 이미 완비돼 있어** 창고 내 이동 기능은 재구현 없이 그쪽으로 흡수된다.

**Tech Stack:** NestJS 11 (core), Next.js (admin-web), Drizzle ORM, Jest, TanStack Query

**Spec:** 이 계획에 대응하는 별도 스펙 문서는 없다. 근거 문서 셋:
- `docs/adr/0032-procurement-inbound-transfer-boundaries.md` — C(`transfer_orders`)가 창고 간 이동의 정본이라는 결정
- `docs/superpowers/plans/2026-08-12-warehouse-transfer-custody.md:2449-2474` — **이 작업은 그 계획의 Task 10 중 연기된 Step 2·4·5 다**
- 「재고 모듈 정비 작업표」 아티팩트 항목 02

---

## Global Constraints

- **마이그레이션 0건.** 이 계획에서 `apps/core/drizzle/` 에 파일을 만들지 않는다. `movement_jobs` 등 테이블 DROP 은 **범위 밖**이며 별도 PR 이다(B 가 아직 `movement_jobs` 를 쓴다).
- **검증 게이트는 0 이 기준선이다** (CLAUDE.md):
  - `npm run type-check` — 루트. **admin-web 을 제외한다.**
  - `cd apps/admin-web && npx tsc --noEmit` — admin-web 타입 게이트는 이것뿐이다.
  - `npx jest --maxWorkers=2` — `--maxWorkers` 없이 돌리면 OOM 난다.
- **DB 통합 스펙은 이 작업에서 실행 대상이 아니다.** `describeIfDb` 가드로 기본 실행에서 skip 된다.
- **절대 지우지 말 것 (이름이 비슷해 헷갈린다):**
  - `apps/core/src/modules/inventory/core/services/transfer-ship-location.integration.spec.ts`
  - `apps/core/src/modules/inventory/core/services/transfer-receive.integration.spec.ts`
  - `InventoryCommandService.transferShip` / `.transferReceive`
  이 셋은 **C 의 구성요소**다(#629 Task 2·4). A 가 아니다.
- 커밋 메시지 말미에 `Claude-Session: https://claude.ai/code/session_01KtY3kxWhGgcZUNfSRjCHfh` 를 붙인다.

---

## File Structure

### 삭제 (core)
| 파일 | 책임 |
|---|---|
| `apps/core/src/modules/inventory/core/controllers/transfer.controller.ts` | A 의 라우트 6개 |
| `apps/core/src/modules/inventory/core/services/transfer.service.ts` | A 의 잡 생성·실행·`moveWithinWarehouse` |
| `apps/core/src/modules/inventory/core/services/transfer.service.spec.ts` | A 유닛 스펙 |
| `apps/core/src/modules/inventory/core/services/transfer.service.integration.spec.ts` | A 통합 스펙("Path B(inventory/transfers)" 라 적혀 있으나 A 를 가리킨다) |
| `apps/core/src/modules/inventory/core/dto/transfer/create-transfer.dto.ts` | A 요청 DTO |
| `apps/core/src/modules/inventory/core/dto/transfer/transfer-response.dto.ts` | A 응답 DTO |
| `apps/core/src/modules/inventory/core/mappers/transfer.mapper.ts` | A 전용 매퍼 (소비자는 A 컨트롤러 1곳) |

### 수정 (core)
| 파일 | 변경 |
|---|---|
| `apps/core/src/modules/inventory/core/inventory.module.ts:12,28,46,63,77` | `TransferController`·`TransferService` 의 import·controllers·providers·exports 제거 |
| `apps/core/src/modules/inventory/core/services/stock-event.service.ts:107-...` | `transferBetweenWarehouses` 제거 (유일한 호출자가 A 였다) |
| `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts` | 배정표에서 A 라우트 6개 제거 |

### 삭제 (admin-web)
| 파일 |
|---|
| `apps/admin-web/src/app/(admin)/inventory/transfers/page.tsx` |
| `apps/admin-web/src/features/inventory/transfers/` (5개 파일 전부) |
| `apps/admin-web/src/hooks/table/columns/use-transfer-jobs-table-columns.tsx` |
| `apps/admin-web/src/lib/api/domains/inventory/transfers.client.ts` |

### 수정 (admin-web)
| 파일 | 변경 |
|---|---|
| `src/lib/utils/menu.ts:290-294` | `inventory-transfers` 항목 제거, `inventory-movement` 제목을 `재고 이동` 으로 |
| `src/lib/api/domains/inventory/index.ts:102` | `transfersClient` re-export 제거 |
| `src/lib/services/inventory/queries.ts:15,29,410-432` | `useTransferJobs`·`useTransferJob`·`useTransferJobStatus` 및 import 제거 |
| `src/lib/services/inventory/mutations.ts:14,35,478-510` | `useCreateTransferJob`·`useExecuteTransferJob`·`useMoveWithinWarehouse` 및 import 제거 |
| `src/lib/services/inventory/query-keys.ts:7,114-116` | `transferJobs`·`transferJob`·`transferJobStatus` 및 `TransferJobQuery` import 제거 |
| `src/lib/types/dto/inventory.ts:1148-1242` | 「재고 이동 (Transfer Jobs)」 블록 전체 제거 |

### 보존 확인 (admin-web) — 재배선의 착지점
`/inventory/movement` 는 이미 완비돼 있다. 새로 만들 것이 없다.
- `src/app/(admin)/inventory/movement/page.tsx`
- `src/features/inventory/movement/{template,components/move-dialog,components/movement-history-table}`
- `useMoveImmediately` → `movementClient.moveImmediately` → `POST /movement/move`

**기능 비교 — B 의 다이얼로그가 A 의 것을 완전히 덮는다:**

| | A `move-within-warehouse-dialog` | B `move-dialog` |
|---|---|---|
| 라인 수 | 1개 고정 | N개 |
| 멱등키 | **없음** | `useIdempotentMutation` 이 생성 |
| 창고 소속 검증 | **없음** (`transfer.service.ts` 에 라인별 검사 부재) | 라인마다 (`movement.service.ts:51-53`) |
| 입력 방식 | UUID 자유 입력 | UUID 자유 입력 (동일) |
| 작업자·메모 | 메모만 | `actorId` + 메모 + 라인 메모 |

UX 회귀가 없다. B 가 상위집합이다.

---

### Task 1: core — A 라우트·서비스·DTO·매퍼 철거

**Files:**
- Delete: `apps/core/src/modules/inventory/core/controllers/transfer.controller.ts`
- Delete: `apps/core/src/modules/inventory/core/services/transfer.service.ts`
- Delete: `apps/core/src/modules/inventory/core/services/transfer.service.spec.ts`
- Delete: `apps/core/src/modules/inventory/core/services/transfer.service.integration.spec.ts`
- Delete: `apps/core/src/modules/inventory/core/dto/transfer/` (디렉터리째)
- Delete: `apps/core/src/modules/inventory/core/mappers/transfer.mapper.ts`
- Modify: `apps/core/src/modules/inventory/core/inventory.module.ts:12,28,46,63,77`
- Test: `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts:75-78,171-172`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `/inventory/transfers*` 라우트가 존재하지 않는 core. `StockEventService.transferBetweenWarehouses` 는 이 태스크 뒤 **호출자 0곳**이 된다 (Task 2 가 지운다).
- 부수 효과: 작업표 **항목 03(이동 잡이 창고 소속을 검증하지 않는다)이 여기서 소멸한다.** `lines[0]` 로 창고를 판정하던 코드가 `transfer.service.ts:144-176` 이었고 그 파일이 사라진다. B 는 라인마다 검증하므로 결함이 이어지지 않는다.

- [ ] **Step 1: 삭제 전 스코프 스펙이 초록인지 확인 (기준선 고정)**

```bash
npx jest --maxWorkers=2 --testPathPattern="inventory-scope-coverage"
```

Expected: PASS. 여기가 빨가면 이 작업과 무관한 선행 문제이므로 멈추고 보고한다.

- [ ] **Step 2: 파일 삭제**

```bash
cd /home/pauseb/workspace/almondyoung-server
git rm apps/core/src/modules/inventory/core/controllers/transfer.controller.ts \
       apps/core/src/modules/inventory/core/services/transfer.service.ts \
       apps/core/src/modules/inventory/core/services/transfer.service.spec.ts \
       apps/core/src/modules/inventory/core/services/transfer.service.integration.spec.ts \
       apps/core/src/modules/inventory/core/mappers/transfer.mapper.ts
git rm -r apps/core/src/modules/inventory/core/dto/transfer
```

- [ ] **Step 3: `inventory.module.ts` 에서 등록 제거**

다섯 줄을 지운다 — 12행 `import { TransferController } …`, 28행 `import { TransferService } …`, 46행 `controllers` 배열의 `TransferController,`, 63행 `providers` 의 `TransferService,`, 77행 `exports` 의 `TransferService,`. 배열에 빈 항목이나 이중 쉼표를 남기지 않는다.

- [ ] **Step 4: 스코프 배정표가 빨개지는 것을 확인 (red)**

```bash
npx jest --maxWorkers=2 --testPathPattern="inventory-scope-coverage"
```

Expected: FAIL — `staleInTable` 에 아래 6개가 잡힌다. 이 목록과 다르면 삭제 범위가 어긋난 것이다.

```
GET /inventory/transfers
GET /inventory/transfers/:id
GET /inventory/transfers/:id/status
POST /inventory/transfers
POST /inventory/transfers/move-within-warehouse
PATCH /inventory/transfers/:id/execute
```

- [ ] **Step 5: 배정표에서 6줄 제거 (green)**

`inventory-scope-coverage.spec.ts` 의 `ROUTE_SCOPES` 에서 위 6개 키의 줄을 지운다. 75-78행 구역에서 4줄, 171-172행 구역에서 2줄이다. **`'POST /movement/move'`(89행) 는 남긴다** — B 의 라우트다.

- [ ] **Step 6: 스코프 스펙 재실행 (green 확인)**

```bash
npx jest --maxWorkers=2 --testPathPattern="inventory-scope-coverage"
```

Expected: PASS (5개 테스트 전부).

- [ ] **Step 7: 타입 게이트**

```bash
npm run type-check
```

Expected: 에러 0. 남은 참조가 있으면 여기서 잡힌다.

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "$(cat <<'MSG'
refactor(inventory): 옛 이동 경로 A 철거 — 컨트롤러·서비스·DTO·매퍼

/inventory/transfers 라우트 6개와 그 뒤의 TransferService 를 제거한다.
창고 간 이동의 정본은 warehouse-transfer(ADR-0032), 창고 내 이동은
movement 이다. #629 Task 10 의 연기된 Step 2·4·5.

movement_jobs·movement_job_lines·movement_work_logs 라이브 0행이라
데이터 이관·마이그레이션 없이 코드만 사라진다.

Claude-Session: https://claude.ai/code/session_01KtY3kxWhGgcZUNfSRjCHfh
MSG
)"
```

---

### Task 2: core — `transferBetweenWarehouses` 제거

Task 1 이 유일한 호출자를 지웠으므로 이제 죽은 코드다. 이 메서드가 창고 간 ship+receive 를 **한 트랜잭션**에 묶던 지점이고, #629 가 없애려던 모델 그 자체다.

**Files:**
- Modify: `apps/core/src/modules/inventory/core/services/stock-event.service.ts:107-161`

**Interfaces:**
- Consumes: Task 1 의 결과 (호출자 0곳)
- Produces: `StockEventService` 에 창고 간 이동 진입점이 없다. `InventoryCommandService.transferShip`/`transferReceive` 는 **그대로 남는다** — `WarehouseTransferManager` 가 쓴다.

- [ ] **Step 1: 호출자가 정말 0곳인지 확인 (red 대신 사실 확인)**

```bash
grep -rn "transferBetweenWarehouses" apps/core/src apps/admin-web/src native --include=*.ts --include=*.tsx | grep -v node_modules
```

Expected: 출력 없음. 한 줄이라도 나오면 멈추고 보고한다.

- [ ] **Step 2: 메서드 삭제**

`stock-event.service.ts` 의 `async transferBetweenWarehouses(` (107행) 부터 그 메서드 닫는 중괄호까지 지운다. 메서드가 자기만 쓰던 import(`LocationService` 등)가 파일 안에서 완전히 미사용이 되면 그 import 도 지운다 — **다른 메서드가 쓰고 있으면 남긴다.** 판단은 `npm run type-check` 가 아니라 파일 내 grep 으로 한다:

```bash
grep -n "locationService\|getSystemLocationByRole" apps/core/src/modules/inventory/core/services/stock-event.service.ts
```

- [ ] **Step 3: 타입 게이트 + 유닛 테스트**

```bash
npm run type-check && npx jest --maxWorkers=2
```

Expected: type-check 에러 0, jest 실패 0.

- [ ] **Step 4: C 의 구성요소가 살아 있는지 확인**

```bash
grep -rn "transferShip\|transferReceive" apps/core/src/modules/inventory --include=*.ts | grep -v "\.spec\.ts" | grep -v node_modules
```

Expected: `inventory-command.service.ts`(정의)와 `warehouse-transfer/services/warehouse-transfer.manager.ts`(호출)가 보인다. 둘 중 하나라도 없으면 과잉 삭제다.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "$(cat <<'MSG'
refactor(inventory): stock-event 의 transferBetweenWarehouses 제거

ship 과 receive 를 한 dbService.run 에 묶어 "운송 중" 기간을 소멸시키던
경로다. 호출자는 방금 지운 TransferService 하나뿐이었다.

창고 간 이동은 warehouse-transfer 가 transferShip/transferReceive 를
분리된 트랜잭션에서 부른다 — 그 둘은 그대로 남는다.

Claude-Session: https://claude.ai/code/session_01KtY3kxWhGgcZUNfSRjCHfh
MSG
)"
```

---

### Task 3: admin-web — 화면·메뉴 철거 및 movement 재배선

데이터 계층보다 **화면을 먼저** 지운다. 그래야 각 커밋 시점에 타입 게이트가 초록이다(미사용 export 는 타입 에러가 아니지만, 사라진 client 를 import 하는 화면은 에러다).

**Files:**
- Delete: `apps/admin-web/src/app/(admin)/inventory/transfers/page.tsx`
- Delete: `apps/admin-web/src/features/inventory/transfers/` (5개 파일)
- Delete: `apps/admin-web/src/hooks/table/columns/use-transfer-jobs-table-columns.tsx`
- Modify: `apps/admin-web/src/lib/utils/menu.ts:290-299`

**Interfaces:**
- Consumes: Task 1 (백엔드 라우트가 이미 사라짐)
- Produces: 창고 내 이동의 유일한 admin-web 진입점이 `/inventory/movement` 다. `transfersClient`·transfer 훅은 이 태스크 뒤 **소비자 0곳**이 된다 (Task 4 가 지운다).

- [ ] **Step 1: admin-web 타입 게이트 기준선 확인**

```bash
cd apps/admin-web && npx tsc --noEmit
```

Expected: 에러 0. **루트 `npm run type-check` 는 admin-web 을 제외하므로 여기서 따로 돌려야 한다.** 의존성이 안 깔려 있으면 `npm ci` 를 `apps/admin-web` 에서 먼저 돌린다.

- [ ] **Step 2: 화면 삭제**

```bash
cd /home/pauseb/workspace/almondyoung-server
git rm -r "apps/admin-web/src/app/(admin)/inventory/transfers" \
          apps/admin-web/src/features/inventory/transfers
git rm apps/admin-web/src/hooks/table/columns/use-transfer-jobs-table-columns.tsx
```

- [ ] **Step 3: 메뉴 재배선**

`apps/admin-web/src/lib/utils/menu.ts` 에서 `inventory-transfers` 항목(290-294행)을 통째로 지우고, 바로 아래 `inventory-movement` 의 제목을 바꾼다. 남는 형태:

```typescript
      {
        id: 'inventory-movement',
        title: '재고 이동',
        path: '/inventory/movement',
      },
```

제목 변경 이유: `재고 이동(잡)` 이 사라지면 `재고 즉시 이동` 의 "즉시" 가 대비할 대상을 잃는다. 이제 창고 내 이동은 이 화면 하나뿐이다.

- [ ] **Step 4: 끊긴 참조가 없는지 확인**

두 개를 따로 본다. (a) 가 이 태스크의 게이트고, (b) 는 다음 태스크의 대상 목록 확인이다.

**(a) 삭제한 UI 를 아직 import 하는 곳 — 0건이어야 한다:**

```bash
grep -rn "features/inventory/transfers\|use-transfer-jobs-table-columns" apps/admin-web/src | grep -v node_modules
```

Expected: 출력 없음. 한 줄이라도 나오면 삭제가 덜 된 것이다.

**(b) `inventory/transfers` 문자열의 잔존 위치 — 데이터 계층에만 남아야 한다:**

```bash
grep -rln "inventory/transfers" apps/admin-web/src | grep -v node_modules | sort
```

Expected: 정확히 아래 셋. **이 단계에서 지우지 않는다 — Task 4 의 대상이다.** 이 목록 밖의 파일이 나오면 멈추고 보고한다.

```
apps/admin-web/src/lib/api/domains/inventory/transfers.client.ts
apps/admin-web/src/lib/services/inventory/mutations.ts
apps/admin-web/src/lib/services/inventory/queries.ts
```

> ⚠️ **이 grep 은 `query-keys.ts` 를 못 본다.** 거기서는 문자열이 URL 이 아니라 배열 원소로
> 쪼개져 있다 — `['inventory', 'transfers', query]`. `query-keys.ts:7,114-116` 은 여전히
> Task 4 의 정당한 대상이며, Task 4 는 파일 목록과 `TransferJobQuery` 를 잡는 자체 grep 으로
> 그것을 처리한다. **이 grep 의 결과를 Task 4 의 대상 목록으로 쓰지 말 것.**

- [ ] **Step 5: 타입 게이트**

```bash
cd apps/admin-web && npx tsc --noEmit
```

Expected: 에러 0.

- [ ] **Step 6: 커밋**

```bash
cd /home/pauseb/workspace/almondyoung-server
git add -A
git commit -m "$(cat <<'MSG'
refactor(admin-web): /inventory/transfers 화면 철거, 재고 이동을 movement 로 일원화

옛 경로 A 의 화면·메뉴를 지운다. 창고 내 이동은 이미 완비된
/inventory/movement 가 받는다 — 그쪽이 다중 라인·멱등키·라인별
창고 검증을 갖춘 상위집합이라 재구현이 없다.

메뉴 "재고 즉시 이동" → "재고 이동" (대비할 대상이 사라졌다).

Claude-Session: https://claude.ai/code/session_01KtY3kxWhGgcZUNfSRjCHfh
MSG
)"
```

---

### Task 4: admin-web — 데이터 계층 철거

**Files:**
- Delete: `apps/admin-web/src/lib/api/domains/inventory/transfers.client.ts`
- Modify: `apps/admin-web/src/lib/api/domains/inventory/index.ts:102`
- Modify: `apps/admin-web/src/lib/services/inventory/queries.ts:15,29,410-432`
- Modify: `apps/admin-web/src/lib/services/inventory/mutations.ts:14,35,478-510`
- Modify: `apps/admin-web/src/lib/services/inventory/query-keys.ts:7,114-116`
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts:1148-1242`

**Interfaces:**
- Consumes: Task 3 (소비자 0곳)
- Produces: `movementClient`·`useMoveImmediately`·`MoveBatchRequestDto` 계열만 남는다.

- [ ] **Step 1: 클라이언트 삭제 및 re-export 제거**

```bash
git rm apps/admin-web/src/lib/api/domains/inventory/transfers.client.ts
```

그리고 `apps/admin-web/src/lib/api/domains/inventory/index.ts` 102행 `export { transfersClient } from './transfers.client';` 을 지운다.

- [ ] **Step 2: 쿼리 훅 제거**

`queries.ts` 의 410행 주석 `// 재고 이동 관련 쿼리` 부터 432행까지(`useTransferJobs`·`useTransferJob`·`useTransferJobStatus` 세 훅) 를 지우고, 15행 `transfersClient` import 와 29행 `TransferJobQuery` 타입 import 도 지운다. **25행 `movementClient` import 는 남긴다.**

- [ ] **Step 3: 뮤테이션 훅 제거**

`mutations.ts` 의 478행 주석 `// 재고 이동 관련 mutations` 부터 510행까지(`useCreateTransferJob`·`useExecuteTransferJob`·`useMoveWithinWarehouse` 세 훅) 를 지우고, 14행 `transfersClient` import 와 35행 `CreateTransferJobDto` 타입 import 도 지운다. 511행 `// 재고 실사 관련 mutations` 는 남긴다. **920행 `useMoveImmediately` 와 24행 `movementClient` import 도 남긴다.**

- [ ] **Step 4: 쿼리 키 제거**

`query-keys.ts` 114-116행의 `transferJobs`·`transferJob`·`transferJobStatus` 세 줄과, 그 때문에 미사용이 된 7행 `TransferJobQuery` 타입 import 를 지운다.

- [ ] **Step 5: DTO 블록 제거**

`apps/admin-web/src/lib/types/dto/inventory.ts` 의 1148행 `// ===== 재고 이동 (Transfer Jobs) =====` 부터 1242행까지(1243행 `// ===== 재고 예약 (Reservations) =====` 직전) 를 통째로 지운다. 이 블록에 든 타입 13개:

```
TransferItemInputDto, CreateTransferJobDto, MoveWithinWarehouseDto,
TransferJobLineDto, BaseTransferJobDto, TransferJobWithLinesDto,
TransferJobWithLineCountDto, TransferJobListResponseDto, TransferJobStatusDto,
CreateTransferJobResponseDto, ExecuteTransferJobResponseDto,
MoveWithinWarehouseResponseDto, TransferJobQuery
```

**1678행 이후의 `MoveBatchLineDto`·`MoveBatchRequestDto`·`MovementJobWithLinesDto`·`MovementHistoryResponseDto` 는 다른 블록이다 — 건드리지 않는다.** 7행 `WithIdempotencyKey` 도 남긴다.

- [ ] **Step 6: 잔재 확인**

```bash
grep -rn "transfersClient\|TransferJob\|MoveWithinWarehouse\|useCreateTransferJob\|useExecuteTransferJob" apps/admin-web/src | grep -v node_modules
```

Expected: 출력 없음.

- [ ] **Step 7: 타입 게이트 + 테스트**

```bash
cd apps/admin-web && npx tsc --noEmit
npm run test:admin-web
```

Expected: 타입 에러 0, 테스트 실패 0.

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "$(cat <<'MSG'
refactor(admin-web): transfers 데이터 계층 철거

transfersClient, 쿼리/뮤테이션 훅 6개, 쿼리 키 3개, DTO 13개 제거.
소비자는 앞 커밋에서 이미 사라졌다.

movement 계열(movementClient, useMoveImmediately, MoveBatch*)은 보존.

Claude-Session: https://claude.ai/code/session_01KtY3kxWhGgcZUNfSRjCHfh
MSG
)"
```

---

### Task 5: 전체 게이트 + 문서 갱신

**Files:**
- Modify: `docs/superpowers/plans/2026-08-12-warehouse-transfer-custody.md:2449-2461` (Task 10 연기 상태 해소 기록)

**Interfaces:**
- Consumes: Task 1~4
- Produces: 배포 가능한 브랜치

- [ ] **Step 1: 전체 게이트 4종**

```bash
cd /home/pauseb/workspace/almondyoung-server
npm run type-check
npx jest --maxWorkers=2
cd apps/admin-web && npx tsc --noEmit
cd /home/pauseb/workspace/almondyoung-server && npm run test:admin-web
```

Expected: 넷 다 0. **실제 출력을 눈으로 확인한 뒤에만 초록이라고 말한다** — `tail` 로 자른 출력에 개수를 매기지 않는다.

- [ ] **Step 2: 경로가 둘이 아니라 하나인지 최종 확인**

```bash
grep -rn "@Controller('inventory/transfers')\|@Controller('movement')\|@Controller('inventory/warehouse-transfers')" apps/core/src
```

Expected: `movement` 와 `inventory/warehouse-transfers` 둘만 나온다.

- [ ] **Step 3: #629 계획서의 Task 10 연기 기록 갱신**

`docs/superpowers/plans/2026-08-12-warehouse-transfer-custody.md` 의 Task 10 머리 인용구(2451-2461행)에 아래를 덧붙인다. **기존 기록은 지우지 않는다** — 왜 연기됐는지가 이 문서의 값어치다.

```markdown
> **✅ 2026-09-02 해소.** 연기된 Step 2·4·5 를 `docs/superpowers/plans/2026-09-02-remove-legacy-transfer-path.md`
> 가 수행했다. 단 범위가 넓어졌다 — 창고간 분기만 제거하는 대신 **경로 A 를 통째로 철거**하고
> 창고 내 이동을 `movement` 로 일원화했다.
>
> 연기 사유였던 "admin-web 화면이 400 으로 깨진다" 는 2026-09-01 실측으로 소멸했다.
> 08-13 근거는 `stock_journals` 0건("실행 성공 이력 없음")이었으나, 09-01 측정은
> `movement_jobs` 자체가 **0행**임을 보였다 — 생성조차 0건이다. 깨질 화면에 쓴 사람이 없었다.
```

- [ ] **Step 4: 스코프 배정표의 섹션 헤더 개수 주석 교정**

> 이 스텝은 Task 1 리뷰에서 나온 Minor 지적을 여기로 합류시킨 것이다 (컨트롤러 Ruling 2).

`apps/core/src/platform/auth/inventory-scope-coverage.spec.ts` 의 두 섹션 헤더가 실제 항목 수와 어긋난다. 어떤 단언도 이 숫자를 검사하지 않으므로 게이트가 못 잡는다 — 그래서 틀린 채로 조용히 오도한다.

- 28행 `// ── inventory.operate (69) ──` → 실제 **67**. (변경 전에도 어긋나 있었다: 실제 71 / 선언 69.)
- 156행 `// ── inventory.adjust (17) ──` → 실제 **15**. (변경 전에는 정확했다: 실제 17 / 선언 17. Task 1 의 2줄 삭제가 깨뜨렸다.)

두 숫자를 실제값으로 고친다. 대시 장식(`──────`)의 길이는 원래 형태를 유지한다.

고친 뒤 실제 항목 수를 직접 세어 검증한다:

```bash
grep -n "── inventory\." apps/core/src/platform/auth/inventory-scope-coverage.spec.ts
```

그 출력이 알려주는 각 섹션의 시작·끝 줄 사이에서 라우트 항목을 센다 (헤더 다음 줄부터 다음 헤더 직전까지):

```bash
sed -n '<operate시작+1>,<manage시작-1>p' apps/core/src/platform/auth/inventory-scope-coverage.spec.ts | grep -cE "^ +'(GET|POST|PATCH|PUT|DELETE) "
sed -n '<adjust시작+1>,<warehouse시작-1>p' apps/core/src/platform/auth/inventory-scope-coverage.spec.ts | grep -cE "^ +'(GET|POST|PATCH|PUT|DELETE) "
```

Expected: 각각 `67`, `15` — 그리고 그 값이 방금 적은 주석의 숫자와 같아야 한다.

- [ ] **Step 5: 스코프 스펙이 여전히 초록인지 확인**

```bash
npx jest --maxWorkers=2 --testPathPattern="inventory-scope-coverage"
```

Expected: PASS (5개 테스트). 주석만 고쳤으므로 당연히 초록이어야 하고, 빨개지면 주석이 아닌 것을 건드린 것이다.

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "$(cat <<'MSG'
docs(inventory): #629 Task 10 연기 해소 기록 + 스코프 배정표 개수 주석 교정

operate 69→67 (선행 부채), adjust 17→15 (경로 A 철거가 깨뜨린 것).
어떤 단언도 이 숫자에 의존하지 않아 게이트가 못 잡는 자리다.

Claude-Session: https://claude.ai/code/session_01KtY3kxWhGgcZUNfSRjCHfh
MSG
)"
```

---

## 배포 메모

- **마이그레이션 0건.** `migrate → deploy` / `deploy → migrate` 순서 문제가 없다.
- **SST 는 한 스택이라 앱별 배포 순서를 강제할 수 없다** (`docs/adr` 및 메모리 `sst-single-stack-no-deploy-order`). core 와 admin-web 이 한 번의 `sst deploy` 로 함께 롤린다. 롤링 중 옛 admin-web 이 사라진 `/inventory/transfers` 를 부를 수 있으나, **그 화면을 쓴 사람이 0명**(테이블 0행)이라 실질 영향이 없다.
- **범위 밖(별도 PR 후보):** `movement_jobs`·`movement_job_lines`·`movement_work_logs` 테이블 DROP. B 가 아직 이 테이블들을 쓰므로 DROP 대상이 아니라 **A 전용 컬럼이 있는지부터 조사**하는 게 먼저다.
