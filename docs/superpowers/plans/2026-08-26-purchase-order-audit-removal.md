# 발주 심사 워크플로 제거 구현 계획 (#724 항목 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 발주 심사(audit) 축을 코드에서 전량 제거한다 — API 3개, 게이트 2곳, 파생 표면 전부. DB 컬럼·enum 은 남긴다.

**Architecture:** L2 삭제 (파생 표면까지, 스키마 무변경). 단일 PR, 마이그레이션 0. core 를 먼저 정리하고 admin-web 을 마지막에 맞춘다 — 그 순서라야 **어느 중간 커밋에서도 UI 가 서버가 거부할 동작을 제안하지 않는다.**

**Tech Stack:** NestJS · Drizzle ORM · Jest (통합 스펙은 `describeIfDb` 가드) · Next.js(admin-web)

**Spec:** `docs/superpowers/specs/2026-08-26-purchase-order-audit-removal-design.md`

## Global Constraints

- **DB 를 건드리지 않는다.** `apps/core/src/modules/inventory/schema/inventory.schema.ts` 의 `poAuditStatusEnum`(`:101`)과 `purchaseOrders` 의 심사 컬럼 6개(`:1882-1887`)는 **그대로 둔다.** 마이그레이션 파일을 만들지 않는다.
- **검증 기준선은 0 이다** — `npm run type-check` 0, `npx jest --maxWorkers=2` 실패 0. `--maxWorkers` 를 빼면 OOM 이 난다.
- **admin-web 은 루트 `type-check` 밖이다.** 그쪽 검증은 `cd apps/admin-web && npx tsc --noEmit` 뿐이다 (컴포넌트 테스트 불가).
- **통합 스펙 실행:** `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <패턴>`. `COMPOSE_PROJECT_NAME` 을 빼면 워크트리에서 5432 포트 충돌로 죽는다.
- **통합 스펙 결과는 숫자로 읽지 않는다.** develop 부터 RED 인 suite 가 있다. `git stash -u` 로 기준선을 뜨고 **실패 항목명이 문자열까지 같은지** 대조한다.
- 커밋 메시지는 한국어, `Claude-Session:` 트레일러 포함.
- **줄번호는 전부 작업 시작 시점(`5fb3c49c9`) 기준이다.** 앞 태스크가 코드를 지우면 뒤 태스크의 좌표가 밀린다 — 줄번호는 길잡이로만 쓰고, 실제로는 **이름으로 찾는다**(메서드명·심볼명·주석 첫 문장).

---

### Task 1: core — 심사 게이트 2곳 제거

행동이 바뀌는 유일한 태스크다. 먼저 한다 — 나중에 admin-web 이 게이트를 안 보고 버튼을 열어도 서버가 이미 허용하는 상태가 된다.

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/services/purchase-order.service.ts:184-190` (게이트 ①), `:394-414` (게이트 ② + docstring)
- Test: `apps/core/src/modules/inventory/inbound/services/purchase-order-line-execution.integration.spec.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `lockPurchaseOrderForLineExecution(tx: DbTx, poId: string): Promise<void>` 가 `auditStatus` 를 더 이상 읽지 않는다. `updatePurchaseOrderStatus(poId, dto, userId, tx?)` 가 `confirmed` 전이에서 심사를 요구하지 않는다. 시그니처 변화 없음.

- [ ] **Step 1: 게이트 ②를 뒤집는 실패 테스트를 쓴다**

`purchase-order-line-execution.integration.spec.ts` 의 기존 케이스 `'심사를 통과하지 않은 발주는 라인 실행을 거부한다'`(`:281-297`)를 **아래로 통째 교체**한다. 검증하던 계약이 사라지므로 수정이 아니라 반전이다.

```ts
  it('심사 축이 없으므로 draft 발주도 라인을 실행할 수 있다', async () => {
    await inRollbackTx(db, async (trx) => {
      // D1=(b) 로 심사 워크플로를 제거했다(#724 항목 3). 예전에는 이 자리에
      // "draft 면 BadRequestError" 를 고정하는 케이스가 있었다 — 그 계약은 없다.
      const fx = await seedPoWithThreeLines(trx, { auditStatus: 'draft' });
      const service = buildService(trx);

      await service.orderLine(fx.poId, fx.skuIds[0], { orderedQty: 6 }, ACTOR, trx);

      expect(await readLine(trx, fx.poId, fx.skuIds[0])).toMatchObject({ status: 'ordered', orderedQty: 6 });
      expect(await readPlans(trx, fx.poId)).toHaveLength(1);
    });
  });

  it('심사 축이 없으므로 draft 발주도 일괄 확정된다', async () => {
    await inRollbackTx(db, async (trx) => {
      // 게이트 ①(updatePurchaseOrderStatus 의 CONFIRMED 가드) 쪽 사본.
      const fx = await seedPoWithThreeLines(trx, { auditStatus: 'draft' });
      const service = buildService(trx);

      await service.updatePurchaseOrderStatus(fx.poId, { status: PurchaseOrderStatus.CONFIRMED }, ACTOR, trx);

      expect(await readLine(trx, fx.poId, fx.skuIds[0])).toMatchObject({ status: 'ordered' });
      expect(await readPlans(trx, fx.poId)).toHaveLength(1);
    });
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-line-execution
```

Expected: 새 케이스 2건이 **FAIL**. 메시지는 `BadRequestError: Cannot execute purchase order lines with auditStatus: draft` 와 `Cannot confirm PO with auditStatus: draft`.

DB 가 안 떠 있으면 스펙이 통째 skip 된다(`describeIfDb`). **skip 은 통과가 아니다** — skip 이 나오면 컴포즈부터 띄운다.

- [ ] **Step 3: 게이트 ①을 지운다**

`purchase-order.service.ts:184-190` 에서 아래 블록을 **주석 4줄까지 통째로** 삭제한다.

```ts
      // 심사 게이트 사본 ①. 다른 하나는 lockPurchaseOrderForLineExecution 에 있다
      // (라인별 실행 경로). 둘 다 필요하다 — 이쪽은 실행할 requested 라인이 하나도
      // 없어 아래 루프가 통째로 건너뛰어지는 확정까지 막고, 저쪽은 일괄 확정을 거치지
      // 않는 라인별 실행을 막는다. 심사 축을 없앨 땐 **둘을 같이** 지운다.
      if (updateDto.status === PurchaseOrderStatus.CONFIRMED && existingPO.auditStatus !== 'approved') {
        throw new BadRequestException(`Cannot confirm PO with auditStatus: ${existingPO.auditStatus}`);
      }
```

- [ ] **Step 4: 게이트 ②를 지운다**

`lockPurchaseOrderForLineExecution`(`:400` 부근)에서:

1. `select` 절의 `auditStatus:` 항목을 지워 `status` 만 남긴다.

```ts
    const [po] = await tx
      .select({ status: wmsTables.purchaseOrders.status })
      .from(wmsTables.purchaseOrders)
      .where(eq(wmsTables.purchaseOrders.id, poId))
      .limit(1)
      .for('update');
```

2. 아래 두 줄을 삭제한다.

```ts
    if (po.auditStatus !== 'approved') {
      throw new BadRequestError(`Cannot execute purchase order lines with auditStatus: ${po.auditStatus}`);
    }
```

3. docstring 의 심사 문단(`:395-401`, `심사 게이트 사본 ②.` 로 시작해 `(도메인 예외를 쓴다 — 저쪽의 Nest 예외는 이 파일에 남은 옛 코드다.)` 로 끝나는 7줄)을 삭제한다.

**남기는 것:** 같은 메서드의 `.for('update')`(락 순서 불변식, #732)와 `if (po.status === 'received')` 가드, 그리고 그 위의 **락 순서 불변식 docstring**. 이것들은 심사와 무관하다.

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-line-execution
```

Expected: 새 케이스 2건 PASS. **`'이미 received 인 발주는 라인 실행을 거부한다'` 도 계속 PASS** — 이게 초록이어야 `received` 가드를 같이 지우지 않았다는 증거다.

- [ ] **Step 6: 스펙에서 심사 시딩을 걷어낸다**

같은 파일에서:

1. `SeedOptions` 의 `auditStatus` 필드와 그 주석(`:86-87`)을 삭제한다.
2. `seedPoWithThreeLines` 의 주석 `// auditStatus 는 approved 여야 라인을 실행할 수 있다(감사 워크플로).`(`:128`)와 `values` 의 `auditStatus: options.auditStatus ?? 'approved',`(`:135`)를 삭제한다.
3. 두 번째 시딩 지점(`:198` 주석 · `:205` 값)도 같이 삭제한다.
4. Step 1 에서 쓴 `{ auditStatus: 'draft' }` 인자 2곳을 `seedPoWithThreeLines(trx)` 로 바꾼다 (컬럼 기본값이 `'draft'` 라 의미가 같다).
5. `expect(response.auditStatus).toBe('approved');`(`:740`)를 삭제한다 — Task 3 에서 응답 필드가 사라지므로 지금 지운다.
6. `'이미 received 인 발주는 라인 실행을 거부한다'` 의 주석에서 `auditStatus 검사만으로는 이걸 못 막는다 — received 로 넘어간 뒤에도 auditStatus 는 여전히 approved 이므로` 부분을 `라인 실행 경로가 이걸 막지 않으면` 로 고친다. 없어진 축을 근거로 든 주석이 남으면 다음 사람이 헷갈린다.

- [ ] **Step 7: 전체 통합 스펙과 타입을 확인한다**

```bash
npm run type-check
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order
```

Expected: type-check 0. 통합은 `purchase-order-line-execution` · `purchase-order-single-plan` 둘 다 실패 0.

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/inventory/inbound/services/purchase-order.service.ts \
        apps/core/src/modules/inventory/inbound/services/purchase-order-line-execution.integration.spec.ts
git commit -m "$(cat <<'EOF'
refactor(inventory): 발주 심사 게이트 2곳 제거 (#724 항목 3)

D1=(b) 결정. updatePurchaseOrderStatus 의 CONFIRMED 가드와
lockPurchaseOrderForLineExecution 의 auditStatus 검사를 함께 지운다 —
후자의 docstring 이 "지울 땐 같이 지운다" 고 예고한 그 쌍이다.

락 순서 불변식(FOR UPDATE)과 received 가드는 남는다.

Claude-Session: https://claude.ai/code/session_01WovGgrH4KMgQCsbo1anCud
EOF
)"
```

---

### Task 2: core — 심사 라우트 3개와 서비스 메서드 3개 제거

**Files:**
- Delete: `apps/core/src/modules/inventory/inbound/dto/purchase-order/audit-po.dto.ts`
- Modify: `apps/core/src/modules/inventory/inbound/controllers/purchase-order.controller.ts:302-355`
- Modify: `apps/core/src/modules/inventory/inbound/services/purchase-order.service.ts` (`submitForAudit` `:1067` · `approvePo` `:1114` · `rejectPo` `:1158`)
- Test: `apps/core/src/platform/auth/inventory-scope-coverage.spec.ts:136,138,140`

**Interfaces:**
- Consumes: Task 1 의 결과 (게이트 없는 서비스)
- Produces: `PurchaseOrderController` 의 라우트가 17개 → **14개**. `SubmitForAuditDto` · `ApprovePoDto` · `RejectPoDto` 와 응답 3종이 더 이상 존재하지 않는다.

- [ ] **Step 1: 배정표에서 심사 라우트 3행을 지워 스펙을 빨갛게 만든다**

`inventory-scope-coverage.spec.ts` 에서 아래 3줄을 삭제한다.

```ts
  'PUT /purchase-orders/:id/approve':                          S.MANAGE,
  'PUT /purchase-orders/:id/reject':                           S.MANAGE,
  'PUT /purchase-orders/:id/submit-for-audit':                 S.MANAGE,
```

- [ ] **Step 2: 스펙이 실패하는지 확인한다**

```bash
npx jest --maxWorkers=2 inventory-scope-coverage
```

Expected: `'표와 코드의 라우트 집합이 정확히 일치한다'` 가 **FAIL** 하고 `missingFromTable` 에 그 3개가 나온다. 이 스펙이 이번 삭제의 자동 체크리스트다 — 라우트를 하나라도 남기면 초록이 되지 않는다.

- [ ] **Step 3: 컨트롤러에서 심사 라우트 3개를 지운다**

`purchase-order.controller.ts` 의 `:302-355` 구간, 즉 `@Put(':id/submit-for-audit')` · `@Put(':id/approve')` · `@Put(':id/reject')` 세 핸들러를 **각자의 `@RequireScopes` · Swagger 데코레이터 · 메서드 본문까지 통째로** 삭제한다. 파일 상단의 `SubmitForAuditDto` · `ApprovePoDto` · `RejectPoDto` · 응답 DTO 3종 import 도 함께 지운다.

- [ ] **Step 4: 서비스에서 심사 메서드 3개를 지운다**

`purchase-order.service.ts` 에서 `submitForAudit`(`:1067`) · `approvePo`(`:1114`) · `rejectPo`(`:1158`) 를 각자의 docstring 포함해 삭제하고, 같은 DTO import 도 지운다.

- [ ] **Step 5: DTO 파일을 삭제한다**

```bash
git rm apps/core/src/modules/inventory/inbound/dto/purchase-order/audit-po.dto.ts
```

배럴 파일(`dto/purchase-order/index.ts` 등)이 이 모듈을 재수출하고 있으면 그 줄도 지운다. 확인:

```bash
grep -rn "audit-po" apps/core/src
```

Expected: 출력 0줄.

- [ ] **Step 6: 스펙이 통과하는지 확인한다**

```bash
npx jest --maxWorkers=2 inventory-scope-coverage
npm run type-check
```

Expected: 스펙 4건 전부 PASS(`missingFromTable`·`staleInTable` 둘 다 빈 배열), type-check 0.

- [ ] **Step 7: 커밋**

```bash
git add -A apps/core/src/modules/inventory/inbound apps/core/src/platform/auth/inventory-scope-coverage.spec.ts
git commit -m "$(cat <<'EOF'
refactor(inventory): 발주 심사 API 3개 제거 (#724 항목 3)

submit-for-audit / approve / reject 라우트와 서비스 메서드,
audit-po.dto.ts 를 지운다. 발주 라우트 17 → 14.

scope 배정표도 같이 줄인다 — 그 스펙이 라우트 집합의 정확 일치를
단언하므로 삭제 누락은 자동으로 빨개진다.

Claude-Session: https://claude.ai/code/session_01WovGgrH4KMgQCsbo1anCud
EOF
)"
```

---

### Task 3: core — 응답 필드·타입·파생 표면 제거

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/dto/purchase-order/purchase-order-response.dto.ts:5,49`
- Modify: `apps/core/src/modules/inventory/inbound/services/purchase-order.service.ts:647,746`
- Modify: `apps/core/src/modules/inventory/schema/enum-values.ts:93-94`
- Modify: `apps/core/src/modules/inventory/inbound/services/purchase-order-single-plan.integration.spec.ts:109,116`
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound-plan-port-invariant.integration.spec.ts:71`
- Modify: `apps/core/src/modules/inventory/stock-projection/services/inbound-pipeline.integration.spec.ts:123,202`
- Modify: `scripts/local/seed-dev-core/inbound.ts:33,71`

**Interfaces:**
- Consumes: Task 2 의 결과
- Produces: `PurchaseOrderResponse` 에 `auditStatus` 가 없다. 타입 `PurchaseOrderAuditStatus` 와 `PoAuditStatusEnum`/`poAuditStatusValues` 가 존재하지 않는다. **이 태스크가 끝나면 admin-web 의 `tsc` 는 빨갛다** — 그게 Task 4 의 작업 목록이다.

- [ ] **Step 1: 응답 DTO 에서 필드와 타입 별칭을 지운다**

`purchase-order-response.dto.ts` 에서:

```ts
export type PurchaseOrderAuditStatus = 'draft' | 'pending_audit' | 'approved' | 'rejected';   // :5 — 삭제
```

```ts
  auditStatus: PurchaseOrderAuditStatus;                                                       // :49 — 삭제
```

`@ApiProperty` 데코레이터가 붙어 있으면 그것도 같이 지운다.

- [ ] **Step 2: 매핑 2곳을 지운다**

`purchase-order.service.ts` 의 응답 조립부 `:647` 과 `:746` 에서 `auditStatus: po.auditStatus,` 줄을 삭제한다.

- [ ] **Step 3: enum-values 에서 파생 타입을 지운다**

`schema/enum-values.ts` 에서:

```ts
export const poAuditStatusValues = poAuditStatusEnum.enumValues;      // :93 — 삭제
export type PoAuditStatusEnum = (typeof poAuditStatusValues)[number]; // :94 — 삭제
```

상단 import 목록의 `poAuditStatusEnum`(`:19`)도 지운다. **`inventory.schema.ts` 의 `poAuditStatusEnum` 정의 자체는 남긴다** — 컬럼이 그것을 참조하므로 지우면 스키마가 깨진다.

- [ ] **Step 4: 타입 체크로 남은 참조를 찾는다**

```bash
rm -f tsconfig.tsbuildinfo
npm run type-check
```

Expected: 0. 에러가 나오면 그 위치가 미처 못 지운 참조다 — 지우고 다시 돌린다.

- [ ] **Step 5: 나머지 통합 스펙 3개의 시딩을 지운다**

세 파일에서 `auditStatus: 'approved',` 줄과, 그것을 설명하는 주석을 삭제한다:

- `purchase-order-single-plan.integration.spec.ts` — `:109` 주석 `// auditStatus 는 approved 여야 confirmed 로 전이할 수 있다(감사 워크플로).` 와 `:116` 값
- `inbound-plan-port-invariant.integration.spec.ts` — `:71` 값
- `inbound-pipeline.integration.spec.ts` — `:123` · `:202` 값

컬럼 기본값이 `'draft'` 이고 게이트가 사라졌으므로 동작은 같다.

- [ ] **Step 6: 개발 시드에서 지운다**

`scripts/local/seed-dev-core/inbound.ts` 의 `:33` · `:71` 에서 `auditStatus: 'approved',` 를 삭제한다. 컬럼이 남아 타입은 통과하지만, 없는 워크플로를 암시하는 잔재다.

- [ ] **Step 7: 백엔드 게이트 전량 확인**

```bash
npm run type-check
npx jest --maxWorkers=2
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "purchase-order|inbound-plan-port|inbound-pipeline"
```

Expected: type-check 0 · jest 실패 0 · 통합 스펙 실패 0.

`grep -rn "auditStatus\|poAuditStatus" apps/core/src scripts` 로 마무리 확인 — 남아야 하는 건 `inventory.schema.ts` 의 enum 정의와 컬럼 6개뿐이다.

- [ ] **Step 8: 커밋**

```bash
git add -A apps/core/src scripts/local/seed-dev-core/inbound.ts
git commit -m "$(cat <<'EOF'
refactor(inventory): 발주 응답에서 auditStatus 파생 표면 제거 (#724 항목 3)

응답 DTO 필드·타입 별칭·enum-values 파생 타입·통합 스펙 시딩·개발 시드.
DB 컬럼과 poAuditStatusEnum 정의는 남긴다(L2 범위).

이 커밋 이후 admin-web tsc 는 빨갛다 — 다음 커밋이 맞춘다.

Claude-Session: https://claude.ai/code/session_01WovGgrH4KMgQCsbo1anCud
EOF
)"
```

---

### Task 4: admin-web — 심사 표면 제거와 상태 드롭다운 조정

**Files:**
- Delete: `apps/admin-web/src/features/inventory/purchase-orders/components/audit-action-bar/` (디렉터리)
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts:1401,1419,1483-1493`
- Modify: `apps/admin-web/src/lib/api/domains/inventory/purchase-orders.client.ts` (`submitForAudit` · `approve` · `reject`)
- Modify: `apps/admin-web/src/lib/services/inventory/mutations.ts:60-62,654-687`
- Modify: `apps/admin-web/src/hooks/table/columns/use-purchase-orders-table-columns.tsx:63`
- Modify: `apps/admin-web/src/features/inventory/purchase-orders/components/purchase-order-detail-drawer/index.tsx:63,88-92,100-130`
- Modify: `apps/admin-web/src/features/inventory/inbound/components/plan-create-tab/index.tsx:21-23,41-43`

**Interfaces:**
- Consumes: Task 3 의 결과 (응답에 `auditStatus` 없음)
- Produces: `PurchaseOrderDto` 에 `auditStatus` 없음. `useSubmitForAudit`/`useApprovePo`/`useRejectPo` 훅 없음. 상세 드로어의 상태 드롭다운은 **항상 표시**되고 선택지는 `created`·`confirmed` 둘.

- [ ] **Step 1: 타입에서 축을 먼저 지워 작업 목록을 만든다**

`lib/types/dto/inventory.ts` 에서 네 곳을 삭제한다.

```ts
export type PurchaseOrderAuditStatus = 'draft' | 'pending_audit' | 'approved';   // :1401
```
```ts
  auditStatus: PurchaseOrderAuditStatus;                                          // :1419
```
```ts
export interface SubmitForAuditRequest { notes?: string; }                        // :1483
export interface ApprovePoRequest { approvalNotes?: string; }                     // :1487
export interface RejectPoRequest { rejectionReason: string; }                     // :1491
```

- [ ] **Step 2: 컴파일러에게 남은 참조를 물어본다**

```bash
cd apps/admin-web && npx tsc --noEmit
```

Expected: **FAIL.** 에러 목록이 그대로 이 태스크의 작업 목록이다 — 드로어(`:63`, `:88-92`), 목록 컬럼(`:63`), 계획생성 필터(`:41-43`), 클라이언트 3메서드, mutations import·훅.

admin-web 은 컴포넌트 테스트가 불가하므로 **이 명령이 유일한 검증 수단**이다.

- [ ] **Step 3: 심사 액션 바를 삭제한다**

```bash
git rm -r apps/admin-web/src/features/inventory/purchase-orders/components/audit-action-bar
```

- [ ] **Step 4: 클라이언트·훅·DTO 참조를 지운다**

- `purchase-orders.client.ts` — `submitForAudit` · `approve` · `reject` 3메서드와 상단 import 3개
- `mutations.ts` — import `:60-62`, 훅 `useSubmitForAudit`(`:654`) · `useApprovePo`(`:666`) · `useRejectPo`(`:678`)

- [ ] **Step 5: 목록 컬럼을 지운다**

`use-purchase-orders-table-columns.tsx:63` 의 `columnHelper.accessor('auditStatus', {...})` 블록을 통째 삭제한다.

- [ ] **Step 6: 상세 드로어를 고친다**

세 가지를 한다.

1. `const canChangeStatus = po.auditStatus === 'approved';`(`:63`) 삭제
2. 「심사 상태」 배지 블록(`:88-92`)과 「심사」 섹션(`AuditActionBar` 를 렌더하는 `<section>` 통째)과 그 import 삭제
3. 상태 변경 섹션의 조건부 래핑을 없애고 **항상 렌더**하되 `received` 선택지를 뺀다:

```tsx
            <Separator />
            <section>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">운영 상태 변경</p>
              <Select
                value={po.status}
                onValueChange={(v) => handleStatusChange(v as PurchaseOrderStatus)}
                disabled={updateStatusMutation.isPending}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* received 는 입고 경로가 소유한 종결 상태다. 수동으로 걸면 그 발주는
                      라인 실행이 막히고(Cannot execute … status: received) 되돌릴 방법이
                      화면에 없다. 확정(confirmed)은 남은 requested 라인을 전부 실행하는
                      일괄 경로라 정당하다. */}
                  <SelectItem value="created">생성됨</SelectItem>
                  <SelectItem value="confirmed">확정됨</SelectItem>
                </SelectContent>
              </Select>
            </section>
```

`{canChangeStatus && ( ... )}` 로 감싸던 `<>` 프래그먼트가 사라지므로 JSX 중괄호 짝을 확인한다.

- [ ] **Step 7: 계획 생성 탭의 필터를 지운다**

`plan-create-tab/index.tsx` 에서 낡은 주석(`:21-23`)과 필터(`:41-43`)를 지우고 목록을 그대로 쓴다.

```tsx
  const { data: poListData } = usePurchaseOrders({ status: 'confirmed', limit: 100, offset: 0 });
  const { data: warehouses } = useWarehouses();

  const eligiblePos = poListData?.data ?? [];
```

서버 질의가 이미 `status: 'confirmed'` 로 좁히므로 자격 판정이 사라지는 게 아니다. `PurchaseOrderDto` import 가 이 파일에서 더 쓰이지 않으면 그 import 도 지운다.

- [ ] **Step 8: 타입 체크가 통과하는지 확인한다**

```bash
cd apps/admin-web && npx tsc --noEmit
grep -rn "auditStatus\|AuditActionBar\|ForAudit\|ApprovePo\|RejectPo" apps/admin-web/src
```

Expected: tsc 에러 0, grep 출력 0줄.

- [ ] **Step 9: 커밋**

```bash
git add -A apps/admin-web/src
git commit -m "$(cat <<'EOF'
refactor(admin-web): 발주 심사 화면 제거 + 상태 드롭다운 정리 (#724 항목 3)

audit-action-bar / 심사 배지 / 목록 컬럼 / 계획생성 필터 / 클라이언트·훅·DTO.

드로어 상태 드롭다운은 심사 게이트 대신 항상 표시하되 received 를 뺀다 —
입고 경로가 소유한 종결 상태라 수동으로 걸면 라인 실행이 영구히 막힌다.

Claude-Session: https://claude.ai/code/session_01WovGgrH4KMgQCsbo1anCud
EOF
)"
```

---

### Task 5: 전체 검증과 PR

**Files:** 없음 (검증과 문서화)

**Interfaces:**
- Consumes: Task 1~4 전부
- Produces: PR 과 이슈 갱신

- [ ] **Step 1: 게이트 4종을 전부 돌린다**

```bash
rm -f tsconfig.tsbuildinfo
npm run type-check
npx jest --maxWorkers=2
npm run lint
cd apps/admin-web && npx tsc --noEmit && cd ../..
```

Expected: 전부 0. 삭제 규모에 비해 결과가 지나치게 깨끗하면 `tsbuildinfo` 를 지우고 다시 돌린다.

- [ ] **Step 2: 통합 스펙을 기준선과 대조한다**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local 2>&1 | tee /tmp/after.txt
git stash -u
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local 2>&1 | tee /tmp/before.txt
git stash pop
diff <(grep -E "✕|✓ .*(purchase|inbound)" /tmp/before.txt | sort) <(grep -E "✕|✓ .*(purchase|inbound)" /tmp/after.txt | sort)
```

Expected: 차이는 **이 PR 이 바꾼 케이스 이름**뿐 — Task 1 이 반전시킨 2건과 삭제한 1건. 그 밖의 실패 항목명이 늘면 회귀다. 숫자만 보고 판단하지 않는다.

- [ ] **Step 3: 라이브 실측 SQL 을 돌려 결과를 남긴다**

```sql
SELECT audit_status, status, count(*) FROM purchase_orders GROUP BY 1, 2 ORDER BY 1, 2;
```

게이트가 사라지면 `draft`/`pending_audit`/`rejected` 발주가 즉시 실행 가능해진다. 의도한 결과지만 `rejected` 가 유의미하게 있으면 **사람 확인이 필요**하다 — 반려된 발주가 되살아난다는 뜻이다. 결과는 PR 본문과 이슈에 붙인다 (컬럼 드롭 L3 판단의 유일한 근거이기도 하다).

- [ ] **Step 4: 화면 4건을 눈으로 확인한다**

`npm run start:main:dev` 와 `npm run start:admin-web:dev` 를 띄우고:

1. 발주 목록에 「심사 상태」 컬럼이 **없다**
2. 발주 상세에 「심사」 섹션이 없고, 상태 드롭다운이 **항상 보이며** 선택지가 `생성됨`·`확정됨` **둘뿐**이다
3. 입고 → 계획 생성 탭의 발주 선택 목록이 `confirmed` 발주를 **그대로** 보여준다 (심사와 무관하게)
4. `http://localhost:3000/api` (Swagger) 에서 발주 라우트가 **14개**이고 `submit-for-audit`/`approve`/`reject` 가 없다

admin-web 은 컴포넌트 테스트가 불가하므로 **이 4건이 UI 회귀의 유일한 방어선**이다. 건너뛰지 않는다.

- [ ] **Step 5: PR 을 연다**

```bash
git push -u origin HEAD
gh pr create --base develop --title "refactor(inventory): 발주 심사 워크플로 제거 (#724 항목 3)" --body "$(cat <<'EOF'
D1=(b) 결정에 따라 발주 심사 축을 L2 범위로 제거한다.
스펙: `docs/superpowers/specs/2026-08-26-purchase-order-audit-removal-design.md`

## 무엇을 지웠나
- 심사 API 3개 (발주 라우트 17 → 14)
- 게이트 사본 2곳 — `updatePurchaseOrderStatus` 의 CONFIRMED 가드와 `lockPurchaseOrderForLineExecution` 의 `auditStatus` 검사
- 파생 표면: 응답 DTO 필드·타입 별칭·enum-values·목록 컬럼·계획생성 필터·심사 화면

## 무엇을 남겼나
DB 컬럼 6개와 `po_audit_status` enum. 마이그레이션 **0**. 컬럼 드롭(L3)은 별도 판단.

## 행동 변화
- 발주 생성 직후 바로 확정·라인 실행 가능
- 상세 드로어의 상태 드롭다운이 항상 보이되 `received` 선택지가 빠졌다 (입고 경로가 소유한 종결 상태)

## 🔴 배포 순서: admin-web → core
역순이면 `auditStatus` 를 읽는 admin-web 화면 2개가 깨진다 — 계획 생성 탭의 발주 목록이 전량 공백, 상세 드로어 드롭다운이 영구 비활성.

## 검증
(Step 1·2 결과를 여기에 붙인다)

## 배포 전 실측
(Step 3 SQL 결과를 여기에 붙인다)

https://claude.ai/code/session_01WovGgrH4KMgQCsbo1anCud
EOF
)"
```

- [ ] **Step 6: 이슈 #724 를 갱신한다**

현황판에서 항목 3 을 🟩 로, 항목 10-b 를 **소멸**로 바꾸고 PR 번호와 계획서 링크를 채운다. 코멘트로 Step 3 의 실측 결과를 남긴다. **엄브렐러이므로 이슈는 닫지 않는다.**

---

## 남은 것 (이 계획의 범위 밖)

- **항목 9 의 3단계 (contract phase)** — 헤더 `expected_arrival` 격하와 `PUT /:id/status` 계약 정리. 2단계가 그 경로를 "컬럼 쓰기" 에서 "일괄 라인 실행" 으로 바꿔 전제가 달라졌으므로 무엇을 차단할지부터 다시 판단해야 한다. 이 PR 은 API 로 `received` 를 수동 설정하는 경로를 **막지 않는다** (UI 에서만 제거).
- **컬럼 드롭 (L3)** — expand-contract 상 PR 2개와 그 사이 배포 1회.
- **항목 12 (admin-web 라인 실행 UI)** — 다음 차례.
