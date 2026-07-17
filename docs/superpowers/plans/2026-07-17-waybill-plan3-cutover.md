# 운송장(waybill) 플랜 3 — 컷오버 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** InvoiceOrchestrator 기반 구 invoice 시스템의 모든 소비자를 플랜 2에서 만든 `WaybillService` seam으로 갈아끼우고, 구 invoice 코드·스키마·env를 삭제한다(contract phase).

**Architecture:** 플랜 2가 additive로 `waybills` 스키마 + `WaybillModule`(WaybillService export)을 이미 배선했다. 이 플랜은 (1) 모듈 순환을 `FulfillmentCommandModule` 추출로 해소해 `FulfillmentModule → WaybillModule` 방향을 열고, (2) recall 전용 `voidForRecall` seam을 추가하고, (3) 소비자 9개 파일을 rewire하고, (4) recall·short-pick의 구 async-saga를 동기 단일-tx로 붕괴시키고, (5) 구 invoice 코드/스키마/env를 삭제한다.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), Jest(ts-jest transpile-only), `@app/db`(DbService/TxFor/run), `@app/shared`(도메인 예외).

## Global Constraints

이 섹션은 모든 태스크에 암묵적으로 포함된다.

- **WaybillService seam API (플랜 2 구현 완료, 시그니처 확정)** — 소비자는 이 메서드만 부른다:
  - `issueForShipment(shipmentId, opts, idemKey, actor): Promise<WaybillView>` — carrier HTTP 포함, **tx? 없음**(호출자 tx 밖). *이 플랜의 소비자 rewire에서는 호출하지 않는다*(발급은 WaybillController 전용).
  - `issueBatch(shipmentIds[], {carrier}, idemKey, actor): Promise<BatchResultItem[]>` — 동상. *이 플랜에서 호출 안 함.*
  - `registerManual(shipmentId, {carrier, trackingNo, expectedManifestVersion, reason?}, idemKey, actor, tx?): Promise<WaybillView>`
  - `void(waybillId, {reason}, idemKey, actor, tx?): Promise<WaybillView>` — `registered`(발송 전)만 → `voided`. `used`/shipped면 `WAYBILL_ALREADY_DISPATCHED` 거부. **tx-local**(carrier HTTP 없음).
  - `voidForRecall(shipmentId, {reason}, idemKey, actor, tx): Promise<WaybillView>` — **Task 2에서 신설.** `used`→`voided` CAS(recall 스코프). tx-local.
  - `assertDispatchable(shipmentId, tx?): Promise<WaybillRow>` — 활성 waybill 1개 ∈ {registered,used} + carrier + trackingNo + manifest/recipient 일치. 불일치→`WAYBILL_STALE`. **manifest/recipient staleness를 내부에서 이미 검사한다.**
  - `markUsed(shipmentId, tx?): Promise<void>` — {registered,used}→used CAS. 멱등+엄격(affected!==1→throw). **staleness 재검 안 함.**
  - `getActiveWaybill(shipmentId, tx?): Promise<WaybillView | null>` — 종료3상태(voided/failed/abandoned) 제외 활성행.
- **seam 순서 계약(필수)**: 디스패치는 **한 tx 안에서 `assertDispatchable(shipmentId, tx)` 직후 `markUsed(shipmentId, tx)`**. markUsed가 staleness를 재검하지 않으므로 assertDispatchable을 선행 게이트로 반드시 둔다.
- **tx 규칙**: `registerManual`/`void`/`voidForRecall`/`assertDispatchable`/`markUsed`/`getActiveWaybill`는 tx-local이라 호출자 command tx에 전파한다. `issueForShipment`/`issueBatch`는 carrier HTTP라 tx 밖(이 플랜 소비자에선 호출 안 함).
- **에러 단언**: 소비자/테스트는 `@app/shared` 예외 메시지에 임베드된 `WAYBILL_*` 문자열(정규식)로 단언.
- **drizzle 0.44.7**: 제약명·SQLSTATE(23505)는 에러 `.cause` 체인(top-level 아님). unique-violation 감지·제약 단언 모두 `.cause`-walk(최대 5-deep).
- **검증 게이트(모든 태스크 공통)**: `npx tsc -p apps/core/tsconfig.app.json --noEmit` **exit 0**(ts-jest는 transpile-only라 tsc 게이트 필수; `**/*spec.ts`는 tsc exclude라 spec 타입에러는 jest 런타임에서만 드러남). 통합테스트: `npm run test:core:integration:local -- <pattern>`. 단위: `npm run test -- --testPathPattern=<pattern>`.
- **lint 스코프**: 변경/신규 파일의 신규 error만. 컨트롤러 spec의 jest-mock `unbound-method`는 repo 관례.
- **커밋 규율**: 각 태스크 끝에서 커밋. 메시지 prefix `refactor(waybill):` 또는 `feat(waybill):`. 브랜치 `feat/waybill-module-redesign`(미머지).
- **모든 경로**는 `apps/core/src/modules/fulfillment/` 기준(명시 없으면).

## 실측 기반 핵심 사실 (플랜 작성 시 확정)

- **어느 소비자도 `issueForShipment`를 호출하지 않는다.** dispatch(`:609`)·outbound-batch(`:965`)·picking 3전략은 모두 `this.invoices.assertDispatchableInvoice(shipmentId, tx)`(읽기 전용, tx 안전)만 부른다. 발급은 `WaybillController` 전용. → tx-경계 재배치 불필요.
- **short-pick은 무변경이 아니다.** 직접 invoice 읽기(`:197`,`:371`) + `this.invoices.void`(`:220`, `registered`=구 `issued` 대상) + async saga(report→resume, `:381` invoice-voided 게이트)를 갖는다. 신 `void`가 동기 tx-local이므로 recall과 동일하게 동기 붕괴 필요.
- **recall**은 `this.invoices.void`(`shipment-recall.service.ts:237`, `used` 대상, recall-only 예외)를 부르고 async saga(`resumePendingInTransaction`가 별도 tx에서 역전)를 갖는다. `voidForRecall` + 동기 붕괴 필요.
- **read 소비자**(invariant/consolidation/planning)는 InvoiceOrchestrator를 주입하지 않고 `wmsTables.invoices`를 직접 읽는다.
- **recall operation 레코드는 `shipmentOperations`/`shipmentOperationMembers`**(≠ 드롭 대상 `invoiceOperations`)에 있어 saga 껍데기는 생존.

---

### Task 1: `FulfillmentCommandModule` 추출 — 모듈 순환 해소

**Files:**
- Create: `apps/core/src/modules/fulfillment/fulfillment-command.module.ts`
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.module.ts`

**Interfaces:**
- Consumes: `FulfillmentCommandService`(생성자 의존 = global `DbService` 하나뿐), `WaybillModule`(exports `WaybillService`).
- Produces: `FulfillmentCommandModule`(providers/exports `FulfillmentCommandService`). 이후 `FulfillmentModule`이 `WaybillModule`을 import → fulfillment 서비스들이 `WaybillService`를 주입 가능(Task 3~8 전제).

- [ ] **Step 1: `FulfillmentCommandModule` 생성**

`apps/core/src/modules/fulfillment/fulfillment-command.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { FulfillmentCommandService } from './services/fulfillment-command.service';

// FulfillmentCommandService 의존성 = global DbService 하나뿐 → imports 불필요.
// FulfillmentModule·WaybillModule 양쪽이 이 소형 모듈만 공유해 순환을 예방한다(spec §12.1).
@Module({
  providers: [FulfillmentCommandService],
  exports: [FulfillmentCommandService],
})
export class FulfillmentCommandModule {}
```

- [ ] **Step 2: `FulfillmentModule` 재배선**

`fulfillment.module.ts`에서:
1. `providers` 배열에서 `FulfillmentCommandService` 제거(현 `:141`).
2. `exports` 배열에서 `FulfillmentCommandService` 제거(현 `:167`).
3. `imports` 배열에 `FulfillmentCommandModule`, `WaybillModule` 추가.
4. 상단 import 문 추가: `import { FulfillmentCommandModule } from './fulfillment-command.module';` 와 `import { WaybillModule } from './waybill/waybill.module';`.

(FulfillmentModule 내부 ~10개 소비자는 `FulfillmentCommandModule` import를 통해 `FulfillmentCommandService`를 계속 resolve — 무영향.)

- [ ] **Step 3: `WaybillModule` 재배선**

`waybill/waybill.module.ts`:
- `import { FulfillmentModule } from '../fulfillment.module';` → `import { FulfillmentCommandModule } from '../fulfillment-command.module';`
- `imports: [FulfillmentModule]` → `imports: [FulfillmentCommandModule]`
- 낡은 주석("플랜 3 에서 방향 반전 예정 …") 갱신: `// FulfillmentCommandService(WaybillManager 의존) 획득. 방향 반전 완료 — FulfillmentModule 이 WaybillModule 을 import(spec §12.1).`

- [ ] **Step 4: 빌드·무순환 검증**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: exit 0.

Run: `npx nest build core`
Expected: 성공(순환 의존 경고 없음). NestJS는 실제 순환이면 `Nest cannot create the module` 류로 실패하므로 성공 = 무순환의 1차 증거.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/fulfillment-command.module.ts \
        apps/core/src/modules/fulfillment/fulfillment.module.ts \
        apps/core/src/modules/fulfillment/waybill/waybill.module.ts
git commit -m "refactor(waybill): FulfillmentCommandModule 추출 — 모듈 순환 해소(FulfillmentModule→WaybillModule 방향)"
```

---

### Task 2: `voidForRecall` seam 신설 + `used` waybill 테스트 헬퍼

**Files:**
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.constants.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.repository.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.manager.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.service.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/__support__/waybill-fixtures.ts`
- Test: `apps/core/src/modules/fulfillment/waybill/waybill.manager.integration.spec.ts`

**Interfaces:**
- Consumes: `reader.getActiveWaybill(trx, shipmentId)`(TERMINAL 제외 활성행), `commands.execute`(idempotency), `WaybillRow`, `toView`.
- Produces:
  - `WaybillRepository.casUsedToVoided(trx: DbTx, shipmentId: string, voidedAt: Date): Promise<number>`
  - `WaybillManager.voidForRecall(shipmentId: string, dto: { reason: string }, idempotencyKey: string, actor: Actor, tx?: DbTx): Promise<WaybillRow>`
  - `WaybillService.voidForRecall(shipmentId: string, dto: { reason: string }, idemKey: string, actor: Actor, tx?: DbTx): Promise<WaybillView>`
  - 테스트 헬퍼 `seedUsedWaybillForShipment(tx, shipmentId, opts?): Promise<WaybillRow>` (Task 7 recall 테스트에서 재사용).

- [ ] **Step 1: 실패 테스트 작성 — `voidForRecall` 통합**

`waybill.manager.integration.spec.ts`에 추가(기존 `db.update(...).set({ status: 'used' })` 패턴은 `:212` 참조):
```ts
it('voidForRecall: used 운송장을 voided 로 전이한다', async () => {
  const seed = await seedPlannedShipmentForWaybill(db, makeSeedDeps(db));
  const wb = await mgr.registerManual(
    seed.shipmentId,
    { carrier: 'HANJIN', trackingNo: `M-${randomUUID().slice(0, 8)}`, expectedManifestVersion: seed.manifestVersion },
    `idem-${randomUUID()}`,
    actor,
  );
  await db.update(wmsTables.waybills).set({ status: 'used' }).where(eq(wmsTables.waybills.id, wb.id));

  const out = await mgr.voidForRecall(seed.shipmentId, { reason: 'recall_test' }, `idem-${randomUUID()}`, actor);

  expect(out.status).toBe('voided');
  const [row] = await db.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, wb.id));
  expect(row.status).toBe('voided');
  expect(row.voidedAt).not.toBeNull();
});

it('voidForRecall: 활성 used 운송장이 없으면 NOT_DISPATCHABLE 로 거부한다', async () => {
  const seed = await seedPlannedShipmentForWaybill(db, makeSeedDeps(db));
  // registered(발송 전) 상태만 존재 → used 아님
  await mgr.registerManual(
    seed.shipmentId,
    { carrier: 'HANJIN', trackingNo: `M-${randomUUID().slice(0, 8)}`, expectedManifestVersion: seed.manifestVersion },
    `idem-${randomUUID()}`,
    actor,
  );
  await expect(
    mgr.voidForRecall(seed.shipmentId, { reason: 'x' }, `idem-${randomUUID()}`, actor),
  ).rejects.toThrow(/WAYBILL_NOT_DISPATCHABLE/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:core:integration:local -- waybill.manager.integration`
Expected: FAIL — `mgr.voidForRecall is not a function`.

- [ ] **Step 3: repository CAS 추가 — `casUsedToVoided`**

`waybill.repository.ts`에 `casToVoided`(현 `:98-105`) 바로 아래 추가. `casToUsed`처럼 **count-return**(엄격 검증용), WHERE는 `shipmentId + status='used'`:
```ts
async casUsedToVoided(trx: DbTx, shipmentId: string, voidedAt: Date): Promise<number> {
  const rows = await trx
    .update(T)
    .set({ status: 'voided', voidedAt, updatedAt: new Date() })
    .where(and(eq(T.shipmentId, shipmentId), eq(T.status, 'used')))
    .returning({ id: T.id });
  return rows.length;
}
```
(`and`,`eq`는 `waybill.repository.ts:2`에서 이미 import됨.)

- [ ] **Step 4: manager `voidForRecall` 추가**

`waybill.manager.ts`에 `void`(현 `:217-253`) 다음, `markUsed`(현 `:314`) 근처에 추가. `void`의 `commands.execute` 골격 + `markUsed`의 엄격 CAS(`affected!==1→throw`)를 혼합:
```ts
// recall 전용: 발송된(used) 운송장을 voided 로 되돌린다. 일반 void 의 WAYBILL_ALREADY_DISPATCHED
// strict 가드를 recall 스코프에서만 우회한다(spec §9.1·§12.2). tx-local — carrier HTTP 없음.
async voidForRecall(
  shipmentId: string,
  dto: { reason: string },
  idempotencyKey: string,
  actor: Actor,
  tx?: DbTx,
): Promise<WaybillRow> {
  return this.commands.execute<WaybillRow>(
    {
      commandType: 'shipment.waybill.void-for-recall',
      idempotencyKey,
      canonicalRequest: { actorId: actor.id, shipmentId, ...dto },
    },
    async (trx) => {
      const active = await this.reader.getActiveWaybill(trx, shipmentId);
      if (!active) throw new NotFoundError(`${WAYBILL.ERROR.NOT_FOUND}: ${shipmentId}`);
      const affected = await this.repo.casUsedToVoided(trx, shipmentId, new Date());
      if (affected !== 1) {
        throw new ConflictError(
          `${WAYBILL.ERROR.NOT_DISPATCHABLE}: voidForRecall affected ${affected} rows for ${shipmentId}`,
        );
      }
      // 방금 voided 로 CAS 한 행은 getActiveWaybill(TERMINAL 제외)에 안 잡히므로 id 로 직접 재조회.
      const voided = await this.repo.findById(trx, active.id);
      if (!voided) throw new Error(`voidForRecall: waybill ${active.id} vanished after CAS`);
      return { response: voided as WaybillRow, resourceType: 'waybill', resourceId: active.id };
    },
    tx,
  );
}
```
(`this.reader`·`this.repo`·`this.commands`는 기존 주입 필드. `NotFoundError`/`ConflictError`는 `:3`에서 import됨. `findById`가 넓은 시그니처라 `as WaybillRow`로 좁힘 — 기존 `void`의 동일 패턴을 따른다.)

- [ ] **Step 5: service passthrough 추가**

`waybill.service.ts`에 `void`(현 `:40-48`) 아래 추가:
```ts
async voidForRecall(
  shipmentId: string,
  dto: { reason: string },
  idemKey: string,
  actor: Actor,
  tx?: DbTx,
): Promise<WaybillView> {
  return toView(await this.manager.voidForRecall(shipmentId, dto, idemKey, actor, tx));
}
```

- [ ] **Step 6: 테스트 헬퍼 `seedUsedWaybillForShipment` 추가**

`waybill/__support__/waybill-fixtures.ts` 하단에 추가(Task 7 recall 통합테스트가 재사용):
```ts
// planned shipment 에 대해 registered→used 운송장 1행을 직접 시드한다(발송 시뮬레이션).
export async function seedUsedWaybillForShipment(
  tx: PostgresJsDatabase<typeof wmsSchema>,
  shipmentId: string,
  manifestVersion: number,
  opts: { carrier?: 'HANJIN'; trackingNo?: string } = {},
): Promise<typeof wmsTables.waybills.$inferSelect> {
  const [row] = await tx
    .insert(wmsTables.waybills)
    .values({
      shipmentId,
      source: 'manual',
      carrier: opts.carrier ?? 'HANJIN',
      status: 'used',
      trackingNo: opts.trackingNo ?? `used-${randomUUID().slice(0, 8)}`,
      manifestVersion,
      recipientHash: canonicalFulfillmentRequestHash(WAYBILL_RECIPIENT),
    })
    .returning();
  return row;
}
```
주의: `recipientHash`는 `canonicalFulfillmentRequestHash(recipientSnapshot)`를 써야 `assertDispatchable`의 recipient 일치 검사를 통과한다(플랜 2 불변식). import 필요 시 waybill 모듈의 canonical 해시 유틸을 재사용 — 이 파일이 이미 참조하는 경로를 따른다(없으면 `seedPlannedShipmentForWaybill`가 쓰는 `recipientSnapshot` 소스를 확인해 동일 해시 함수 import). `WAYBILL_RECIPIENT`는 `waybill-fixtures.ts:22` 상수.

- [ ] **Step 7: 통과 확인 + 전체 waybill 단위·통합 회귀**

Run: `npm run test:core:integration:local -- waybill.manager.integration`
Expected: PASS(신규 2건 포함).

Run: `npm run test -- --testPathPattern=waybill`
Expected: 기존 단위 50 + 신규 그린.

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: exit 0.

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/fulfillment/waybill/
git commit -m "feat(waybill): voidForRecall seam(used→voided, recall 전용) + casUsedToVoided + used 시드 헬퍼"
```

---

### Task 3: picking 3전략 rewire — `assertDispatchableInvoice` → `assertDispatchable`

**Files:**
- Modify: `apps/core/src/modules/fulfillment/picking/discrete-picking.strategy.ts`
- Modify: `apps/core/src/modules/fulfillment/picking/aggregate-then-sort.strategy.ts`
- Modify: `apps/core/src/modules/fulfillment/picking/pick-to-tote.strategy.ts`

**Interfaces:**
- Consumes: `WaybillService.assertDispatchable(shipmentId, tx)`(읽기 전용, tx 안전).
- Produces: 없음(내부 rewire).

세 파일 모두 `assertPlanningEligibility(...)` 루프 안에서 `await this.invoices.assertDispatchableInvoice(shipment.id, tx);`를 단 한 번 호출(반환값 미사용, 순수 assert). 호출부 라인: discrete `:1135`, aggregate-then-sort `:1331`, pick-to-tote `:1483`. 셋 다 command tx 안이지만 assertDispatchable도 읽기 전용이라 tx 안전 — **경계 재배치 불필요**.

- [ ] **Step 1: 실패 테스트 — picking이 waybill assert를 요구**

세 전략 중 대표로 discrete의 통합 spec에서, 활성 waybill이 없는 planned shipment로 plan 시도 시 `WAYBILL_*`(NotFoundError 계열, 예: `WAYBILL_ACTIVE_EXISTS` 부재→NotFound) 거부를 단언하도록 기존 invoice-부재 케이스를 waybill-부재로 전환. (기존 spec이 invoice 시드로 통과시키던 케이스 → waybill 시드로 교체; 시드는 Task 2 `seedUsedWaybillForShipment` 또는 `registerManual` 사용.) 정확한 spec 파일·케이스는 `discrete-picking`의 통합 spec을 grep해 `assertDispatchableInvoice`/`invoices` 시드 지점을 찾아 대응.

- [ ] **Step 2: 실패 확인**

Run: `npm run test:core:integration:local -- discrete-picking`
Expected: FAIL(아직 invoices 시드 기대 or InvoiceOrchestrator 경로).

- [ ] **Step 3: 세 전략 생성자·호출부 스왑**

각 파일에서:
1. `import { InvoiceOrchestrator } from '../invoice-orchestrator.service';` 제거, `import { WaybillService } from '../waybill/waybill.service';` 추가.
2. 생성자에서 `private readonly invoices: InvoiceOrchestrator,` → `private readonly waybills: WaybillService,` (discrete `:95`, aggregate-then-sort `:116`, pick-to-tote `:107`).
3. 호출부: `await this.invoices.assertDispatchableInvoice(shipment.id, tx);` → `await this.waybills.assertDispatchable(shipment.id, tx);` (discrete `:1135`, aggregate `:1331`, pick-to-tote `:1483`).

(반환값을 안 쓰므로 그 외 변경 없음. `canonicalShipmentRecipientHash`를 import하는 전략이 있으면 미사용 확인 후 제거.)

- [ ] **Step 4: 통과 확인 + tsc**

Run: `npm run test:core:integration:local -- "(discrete-picking|aggregate-then-sort|pick-to-tote)"`
Expected: PASS.

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: exit 0.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/picking/
git commit -m "refactor(waybill): picking 3전략 assertDispatchableInvoice→WaybillService.assertDispatchable"
```

---

### Task 4: outbound-batch rewire + `dispatch_attempts.waybill_id` expand + `isActiveWorkItemUniqueViolation` `.cause` fix

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts`
- Create: `apps/core/drizzle/<ts>_add-dispatch-attempts-waybill-id.sql` (generate)
- Modify: `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts`
- Test: `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.integration.spec.ts`

**Interfaces:**
- Consumes: `WaybillService.assertDispatchable(shipmentId, tx): Promise<WaybillRow>`(반환행에 `id`,`trackingNo`).
- Produces: `dispatchAttempts.waybillId`(신규 nullable FK → `waybills.id`, `onDelete:'restrict'`) — dispatch attempt이 "어느 운송장으로 발송됐는지" 기록. **이것이 구 `dispatch_attempts.invoice_id`(invoices FK)를 대체**한다(확정: 2026-07-17 사용자 결정 = waybillId 재지정). Task 5(dispatch write)·Task 7(recall read)·Task 12(invoice_id drop)이 이 컬럼에 의존.

> **결정 배경**: `dispatch_attempts.invoice_id`(nullable FK→invoices, CHECK 무관, onDelete restrict)가 invoices 드롭을 막는다. 사용자 결정으로 **`waybill_id`(FK→waybills)로 재지정**해 dispatch↔운송장 감사 연결을 보존한다. **expand-contract**: 이 태스크가 `waybill_id` 추가(expand, additive — 비대화식 generate), Task 12가 `invoice_id` 드롭(contract). 통합 러너(`test-core-integration-local.sh`)가 실행 전 `drizzle-kit migrate`를 자동 호출하므로 생성한 마이그레이션은 로컬 테스트 DB에 자동 적용된다(수동 적용 불필요).

- [ ] **Step 0: `dispatch_attempts.waybill_id` 컬럼 추가 (expand)**

`inventory.schema.ts`의 `dispatchAttempts` 정의에서 `invoiceId` 컬럼(약 `:2925`, `invoice_id uuid FK→invoices`) **바로 아래**에 신규 컬럼 추가(invoice_id는 아직 유지 — Task 12에서 드롭):
```ts
waybillId: uuid('waybill_id').references(() => waybills.id, { onDelete: 'restrict' }),
```
(`waybills`는 같은 파일 `:2492`에 이미 정의됨.)

- [ ] **Step 0b: 마이그레이션 생성 (additive, 비대화식)**

Run: `npm run db:generate:core -- --name add-dispatch-attempts-waybill-id`
생성 SQL이 `ALTER TABLE "dispatch_attempts" ADD COLUMN "waybill_id" uuid ... REFERENCES "waybills"("id") ...` 인지 확인(순수 additive — DROP 없음, 인터랙티브 rename 프롬프트 없음). Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit` (exit 0).

- [ ] **Step 1: `assertDispatchableInvoice` → `assertDispatchable` 스왑**

`outbound-batch-orchestrator.service.ts`:
1. import: `InvoiceOrchestrator` 제거, `WaybillService` 추가. 생성자 `:66` `private readonly invoices: InvoiceOrchestrator,` → `private readonly waybills: WaybillService,`.
2. 호출부 `:965`:
```ts
// before
const invoice = await this.invoices.assertDispatchableInvoice(shipment.id, tx);
return { invoiceId: invoice.id, trackingNo: invoice.trackingNo };
// after
const waybill = await this.waybills.assertDispatchable(shipment.id, tx);
return { waybillId: waybill.id, trackingNo: waybill.trackingNo ?? '' };
```
3. `assertEligible` 반환 타입(`:836`) `{ invoiceId: string; trackingNo: string }` → `{ waybillId: string; trackingNo: string }`. 호출처(`:166`,`:402`)에서 `invoiceId: eligible.invoiceId`를 소비하는 지점을 추적: 이는 `dispatch_attempts` insert의 `invoiceId` 필드로 흘러들어간다(dispatch_attempts만이 invoice_id FK를 갖는다). 이를 `waybillId: eligible.waybillId`로 바꿔 **Step 0에서 추가한 `dispatch_attempts.waybill_id`에 write**. `invoiceId` 필드 write는 제거(구 invoice_id 컬럼은 Task 12에서 드롭되나 이 시점엔 nullable로 남아 무해). 만약 `eligible.invoiceId`가 dispatch_attempts가 아닌 다른 곳으로 흐르면(예: 로깅) 그 지점도 waybillId로 정정하거나 미사용이면 제거. grep `\.invoiceId` 로 이 파일 내 모든 소비처를 훑어 누락 없이 전환.

- [ ] **Step 2: `isActiveWorkItemUniqueViolation` `.cause` walker로 교체**

현 `:1312-1319`(top-level `.code`만 검사 → drizzle 0.44.7에서 미검출 버그)를 `.cause` 5-deep walk로:
```ts
private isActiveWorkItemUniqueViolation(error: unknown): boolean {
  // drizzle 0.44.x 는 driver 에러를 DrizzleQueryError 로 감싼다 — code/constraint_name 은 .cause 체인에 있다.
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    const row = current as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown };
    if (
      row.code === '23505' &&
      (row.constraint_name === 'uq_outbound_work_item_active_shipment' ||
        row.constraint === 'uq_outbound_work_item_active_shipment')
    ) {
      return true;
    }
    current = row.cause;
  }
  return false;
}
```

- [ ] **Step 3: 통합 spec을 waybill 시드로 전환**

`outbound-batch-orchestrator.integration.spec.ts`의 `eligibleFixture`(`:127-234`) 중 `invoices` insert(`:198-211`)를 waybill 시드로 교체:
```ts
// before: wmsTables.invoices insert (status:'issued', issueMethod:'self', externalServiceId, ...)
// after: registered waybill 시드(dispatchable). Task 2 헬퍼 또는 직접 insert.
const [waybill] = await tx.insert(wmsTables.waybills).values({
  shipmentId: shipment.id,
  source: 'manual',
  carrier: 'HANJIN',
  status: 'registered',
  trackingNo: `batch-tracking-${randomUUID()}`,
  manifestVersion: shipment.manifestVersion,
  recipientHash: canonicalFulfillmentRequestHash(shipment.recipientSnapshot),
}).returning();
```
`canonicalShipmentRecipientHash`(구, `./invoice-orchestrator.service`) → waybill의 canonical 해시(`canonicalFulfillmentRequestHash`)로 교체. 반환 fixture가 `invoice`를 노출했다면 `waybill`로 이름 변경 + 소비처 정정.

- [ ] **Step 4: 통과 확인 + tsc**

Run: `npm run test:core:integration:local -- outbound-batch-orchestrator.integration`
Expected: PASS.

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: exit 0.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts \
        apps/core/drizzle/ \
        apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts \
        apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.integration.spec.ts
git commit -m "refactor(waybill): outbound-batch assertDispatchable 전환 + dispatch_attempts.waybill_id expand + isActiveWorkItemUniqueViolation .cause 5-deep fix"
```

---

### Task 5: shipment-dispatch rewire — assertDispatchable + markUsed

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/shipment-dispatch.service.ts`
- Test: `apps/core/src/modules/fulfillment/services/shipment-dispatch.integration.spec.ts`

**Interfaces:**
- Consumes: `WaybillService.assertDispatchable(shipmentId, tx): Promise<WaybillRow>`, `WaybillService.markUsed(shipmentId, tx): Promise<void>`, `WaybillService.getActiveWaybill(shipmentId, tx)`. `dispatchAttempts.waybillId`(Task 4 신설 컬럼).
- Produces: dispatch attempt 생성 시 `dispatch_attempts.waybill_id`에 `aggregate.waybill.id` write(구 `invoice_id` write 대체). Task 7(recall)이 이 값을 발송증거로 읽는다.

**배경(실측):** dispatch의 InvoiceOrchestrator 결합은 **단 한 호출** `assertDispatchableInvoice`(`:609`). 추가로 (a) `lockAggregate`의 직접 invoice 읽기(`:357-369`, `aggregate.invoice` 구성), (b) `invoices.status='used'` 직접 갱신(`:782-785`), (c) staleness 재검(`:613-618`, `canonicalShipmentRecipientHash` import `:32`), (d) `invoice.id !== aggregate.invoice.id` 가드(`:610`), (e) dispatch attempt insert 시 `invoiceId: invoice.id` write(`:701`,`:852`) → `waybillId: aggregate.waybill.id`로 치환(Step 5b).

**타깃 종단 상태:** `assertDispatchable`이 staleness·활성-1개·carrier·trackingNo를 모두 내부 검사하므로, dispatch는 (a) lockAggregate에서 invoice 읽기를 waybill 읽기로 바꾸거나 제거하고, (b) `status='used'` 직접갱신을 `markUsed(shipmentId, tx)`로 치환하며(assertDispatchable 직후 같은 tx — seam 순서 계약), (c) 중복 staleness 재검(613-618)과 (d) invoice.id 비교(610)를 제거(assertDispatchable이 대체).

- [ ] **Step 1: 실패 테스트 — dispatch가 waybill 경로로 동작**

`shipment-dispatch.integration.spec.ts`의 invoice 시드(`:276-289`, `canonicalShipmentRecipientHash` 사용, `status:'issued'`)를 **registered waybill 시드**로 교체(Task 4 Step 3 패턴 동일). 디스패치 성공 후 waybill이 `used`로 전이됐는지 단언 추가:
```ts
const [wb] = await db.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.shipmentId, shipmentId));
expect(wb.status).toBe('used');
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:core:integration:local -- shipment-dispatch.integration`
Expected: FAIL.

- [ ] **Step 3: 생성자·import 스왑**

- import `:32` `import { InvoiceOrchestrator, canonicalShipmentRecipientHash } from './invoice-orchestrator.service';` 제거.
- 생성자 `:159` `private readonly invoices: InvoiceOrchestrator,` → `private readonly waybills: WaybillService,` (+ `import { WaybillService } from '../waybill/waybill.service';`).

- [ ] **Step 4: `lockAggregate` invoice 읽기 → waybill 읽기**

`:357-369` 직접 invoice select(FOR UPDATE, 활성 1개 assert)를 활성 waybill 읽기로 치환. `aggregate.invoice`(타입 `InvoiceRow`, `:73`,`:79`,`:469`)를 `aggregate.waybill`(타입 `WaybillRow`)로 전환. WaybillRow는 `id`·`manifestVersion`·`recipientHash`·`trackingNo`·`status`를 갖는다. 잠금이 필요하면 waybill 행도 `.for('update')`로 읽는다(`wmsTables.waybills`, `shipmentId + status NOT IN (voided,failed,abandoned)`, 정확히 1행 아니면 `SHIPMENT_INVOICE_NOT_READY` 계승 코드 유지).

- [ ] **Step 5: `dispatchLocked` 게이트·markUsed 치환**

`:609-618` 블록을 다음으로 치환:
```ts
// assertDispatchable 이 활성-1개·carrier·trackingNo·manifest/recipient staleness 를 모두 검사한다.
// 구 invoice.id 비교(:610)와 중복 staleness 재검(:613-618)은 불필요 — 제거.
await this.waybills.assertDispatchable(aggregate.shipment.id, tx);
```
그리고 `:782-785` 직접 `invoices.status='used'` 갱신을 제거하고 **assertDispatchable 직후 같은 tx**에서 markUsed 호출(seam 순서). `:786-789` shipments `status='shipped'` 갱신은 유지. 즉:
```ts
// before (:782-785)
await tx.update(wmsTables.invoices).set({ status: 'used' }).where(...);
// after
await this.waybills.markUsed(aggregate.shipment.id, tx);
```
`assertDispatchable`과 `markUsed`가 한 tx 안 연속이 되도록 배치(assertDispatchable → … → markUsed). 둘 사이에 재고/아이템 증분이 있어도 무방하나, markUsed 전에 assertDispatchable이 반드시 선행돼야 한다.

- [ ] **Step 5b: dispatch attempt의 `waybill_id` write**

dispatch attempt(`dispatch_attempts`) insert 시 `invoiceId: invoice.id`를 기록하던 지점(`:701`, `:852` — grep `invoiceId: invoice.id` / `invoiceId:`로 이 파일 내 전 dispatch_attempts insert 확인)을 `waybillId: aggregate.waybill.id`로 치환. 구 `invoiceId` 필드 write는 제거(invoice_id 컬럼은 Task 12에서 드롭되나 지금은 nullable로 무해). Step 1의 통합테스트에 `dispatch_attempts.waybill_id`가 발송된 waybill.id와 일치하는지 단언 추가:
```ts
const [att] = await db.select().from(wmsTables.dispatchAttempts).where(eq(wmsTables.dispatchAttempts.shipmentId, shipmentId));
expect(att.waybillId).toBe(wb.id);
```

- [ ] **Step 6: 잔여 참조 정리**

`canonicalShipmentRecipientHash`·`InvoiceRow`·`ACTIVE_INVOICE_STATUSES`(`:36`) 미사용 확인 후 제거. `SHIPMENT_INVOICE_STALE`/`SHIPMENT_INVOICE_CHANGED`/`SHIPMENT_INVOICE_NOT_READY` 코드 문자열은 운영 의미 보존을 위해 유지하되(spec §13), 발생 지점이 assertDispatchable 내부(`WAYBILL_STALE`)로 옮겨졌으면 spec/테스트 단언을 그에 맞춘다.

- [ ] **Step 7: 통과 확인 + tsc**

Run: `npm run test:core:integration:local -- shipment-dispatch.integration`
Expected: PASS(waybill used 전이 단언 포함).

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: exit 0.

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/shipment-dispatch.service.ts \
        apps/core/src/modules/fulfillment/services/shipment-dispatch.integration.spec.ts
git commit -m "refactor(waybill): shipment-dispatch → assertDispatchable+markUsed(seam 순서), invoice 직접갱신·중복 staleness 제거"
```

---

### Task 6: shipment-short-pick rewire — 동기 void 붕괴(registered 대상)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/shipment-short-pick.service.ts`
- Test: `apps/core/src/modules/fulfillment/services/shipment-short-pick.integration.spec.ts`

**Interfaces:**
- Consumes: `WaybillService.void(waybillId, {reason}, idemKey, actor, tx)`(registered→voided, tx-local 동기), `WaybillService.getActiveWaybill(shipmentId, tx)`.
- Produces: 없음.

**배경(실측):** short-pick은 planned(발송 전) shipment만 다루며, 직접 invoice 읽기(`:197-208`, `:371-379`)로 활성행을 찾아 `used`면 거부(`SHORT_PICK_DISPATCH_EXISTS`), `issued`(=waybill `registered`)면 `this.invoices.void(invoice.id, ...)`(`:220`) 호출한다. 구 void가 async라 report→resume saga(`:381` invoice-voided 게이트)를 갖지만, 신 `void`는 동기 tx-local이므로 **void가 report tx 안에서 즉시 완료** → resume 게이트 로직 단순화.

- [ ] **Step 1: 실패 테스트 — short-pick이 registered waybill을 void**

`shipment-short-pick.integration.spec.ts`의 invoice 시드(`issued`)를 **registered waybill 시드**로 교체. short-pick report 후 waybill이 `voided`인지, `used` waybill이면 `SHORT_PICK_DISPATCH_EXISTS`로 거부되는지 단언.

- [ ] **Step 2: 실패 확인**

Run: `npm run test:core:integration:local -- shipment-short-pick.integration`
Expected: FAIL.

- [ ] **Step 3: 생성자·import 스왑**

- import `:26` `InvoiceOrchestrator` 제거, `WaybillService` 추가.
- 생성자 `:114` `@Inject(forwardRef(() => InvoiceOrchestrator)) private readonly invoices: InvoiceOrchestrator,` → `private readonly waybills: WaybillService,`. **forwardRef 제거**(WaybillService는 다른 모듈 export라 순환 아님 — Task 1로 방향 정리됨). `forwardRef` import(`:6`)가 다른 곳에서 안 쓰이면 제거.

- [ ] **Step 4: 활성행 읽기 → 활성 waybill 읽기 + void 치환**

`:197-232` 블록:
- 직접 `wmsTables.invoices` 읽기(`:197-208`)를 `getActiveWaybill(shipmentId, tx)` 또는 `wmsTables.waybills` 직접 읽기(활성, TERMINAL 제외)로 치환.
- status 분기: waybill `used` → `SHORT_PICK_DISPATCH_EXISTS`(계승); waybill `registered` → `await this.waybills.void(activeWaybill.id, { reason: \`short_pick:${dto.reason}\` }, \`${idempotencyKey}:waybill-void\`, actor, tx);` (동기 완료, invoiceOperation 반환 없음). 그 외 활성 상태 → `SHORT_PICK_INVOICE_NOT_VOIDABLE`(계승; 문자열 유지하되 필요시 `SHORT_PICK_WAYBILL_NOT_VOIDABLE`로 개명 — 클라이언트 영향 확인).
- void가 동기이므로 `invoiceOperationId` 추적(`:232` 등)·resume 게이트(`:371-381` `SHORT_PICK_INVOICE_NOT_VOIDED`)를 단순화: 활성 waybill이 남지 않았음(voided)을 직접 확인하거나 게이트 자체 제거. `markInvoiceRecoveryRequired`(`:484`)가 async void 실패 복구용이었다면 동기 경로에선 tx 롤백으로 대체 — 데드 코드면 제거(Task 11 정합).

- [ ] **Step 5: 통과 확인 + tsc**

Run: `npm run test:core:integration:local -- shipment-short-pick.integration`
Expected: PASS.

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: exit 0.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/shipment-short-pick.service.ts \
        apps/core/src/modules/fulfillment/services/shipment-short-pick.integration.spec.ts
git commit -m "refactor(waybill): short-pick → WaybillService.void(동기), invoice 읽기·async saga 게이트 붕괴"
```

---

### Task 7: shipment-recall rewire — voidForRecall + 동기 붕괴

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/shipment-recall.service.ts`
- Test: `apps/core/src/modules/fulfillment/services/shipment-recall.integration.spec.ts`

**Interfaces:**
- Consumes: `WaybillService.voidForRecall(shipmentId, {reason}, idemKey, actor, tx)`(used→voided, 동기 tx-local), `getActiveWaybill`. Task 2 헬퍼 `seedUsedWaybillForShipment`. `dispatchAttempts.waybillId`(Task 4 신설, Task 5가 write) — 발송증거 read.
- Produces: 없음.
- **Task 2 Minor(t2-m1) 해소**: 이 태스크가 `seedUsedWaybillForShipment`를 실사용해야 한다(Step 1) — 헬퍼의 정확성(recipientHash·제약 충족)이 여기서 처음 검증된다.

**배경(실측):** recall `report`(`:102`)는 `shipment=shipped`+`attempt=dispatched`+invoice=`used`일 때만 진행, `this.invoices.void(invoice.id, {reason, resumeOperationId, csCaseId, note}, idemKey, actor, tx)`(`:237-248`)를 부른다. 구 void가 async라 recovery worker가 나중에 `resumePendingInTransaction`(`:304`, 재고/예약 역전)을 트리거. recall operation 레코드는 `shipmentOperations`/`shipmentOperationMembers`(생존). `physicalRecoveryConfirmed`는 report 시점 필수(`:702`) → 2단계는 순수 async 부산물.

**타깃 종단 상태:** report가 한 command tx 안에서 `voidForRecall(shipmentId, tx)`(used→voided) **직후** `resumePendingInTransaction(operationId, tx)`(재고 역전)를 인라인 호출 → 동기 완료. `invoiceOperationId` 추적·async 트리거·`invoice.status='used'/'voided'` 직접 읽기·`SHIPMENT_RECALL_INVOICE_NOT_USED`/`NOT_VOIDED` 게이트(`:213-218`,`:378-380`)를 waybill 기준으로 재작성 또는 제거. `resumePendingInTransaction`의 역전 로직(재고·예약·shippedQty·attempt=recalled·shipment=draft)은 **그대로 재사용**.

- [ ] **Step 1: 실패 테스트 — recall이 waybill을 voided로 되돌리고 재고 역전**

`shipment-recall.integration.spec.ts`: invoice 시드(`used`/`voided`, `:236-250`,`:556`,`:650`)를 `seedUsedWaybillForShipment`로 교체. recall report 후 (a) waybill `voided`, (b) shipment `draft` 복귀, (c) attempt `recalled`, (d) 재고 역전을 단언. report 반환 operation이 즉시 완료(`done`)임을 단언(구 pending→).

- [ ] **Step 2: 실패 확인**

Run: `npm run test:core:integration:local -- shipment-recall.integration`
Expected: FAIL.

- [ ] **Step 3: 생성자·import 스왑**

- import: `InvoiceOrchestrator` 제거, `WaybillService` 추가.
- 생성자 `:92` 영역 `@Inject(forwardRef(() => InvoiceOrchestrator)) ... invoices` → `private readonly waybills: WaybillService,`. forwardRef 제거(순환 아님).

- [ ] **Step 4: report의 void → voidForRecall + 인라인 역전**

`:207-291` `report`의 `commands.execute` 핸들러에서:
- **발송증거 검사(`:186`)**: `if (!attempt.invoiceId || !attempt.stockJournalId || !attempt.dispatchedAt)` → `if (!attempt.waybillId || !attempt.stockJournalId || !attempt.dispatchedAt)` (Task 4 신설 `dispatch_attempts.waybill_id`, Task 5가 write). attempt select에 `waybillId` 컬럼 포함되게 조정.
- invoice 상태 확인(`:209-218` `wmsTables.invoices` 읽기 + `SHIPMENT_RECALL_INVOICE_NOT_USED`)을 활성 waybill 읽기(`used` 확인)로 치환. `used`가 아니면 계승 코드로 거부. **구 `attempt.invoiceId`로 invoice를 로드(`:210`)하던 것은 제거** — voidForRecall(shipmentId)가 waybill을 shipmentId로 찾으므로 attempt.invoiceId로 조회 불필요.
- `:237-248` `this.invoices.void(invoice.id, {...}, tx)` → `await this.waybills.voidForRecall(shipmentId, { reason: \`shipment_recall:${dto.reason}\` }, \`${idempotencyKey}:waybill-void\`, actor, tx);`
- voidForRecall이 동기 완료(waybill=voided)이므로, **같은 tx에서** 역전을 인라인 실행: `await this.resumePendingInTransaction(operationId, tx);`(현재 worker가 부르던 것을 report가 직접 호출). `resumePendingInTransaction`의 시작부 게이트 `invoice.status !== 'voided'`(`:378-380`)는 waybill=voided 확인으로 바꾸거나(방금 voidForRecall 성공했으므로) 제거.
- `RecallIntent.invoiceId`(`:39`,`:220`,`:274`,`:375`,`:564`,`:694`) 추적 제거 — recall은 이제 shipmentId로 동작하므로 intent에 invoiceId 불필요. `:375`가 intent.invoiceId로 invoice voided 게이트를 재확인하던 것도 제거(voidForRecall이 이미 voided 보장).
- `invoiceOperationId`(`:241`,`:275`,`:286`) 추적 제거. `shipmentOperations` 레코드 업데이트(`:223-233`, pending→완료)는 유지하되 동기 완료 상태로 마감.

- [ ] **Step 5: async 트리거 잔재 제거**

`resumePending`의 외부(worker) 트리거 경로는 Task 11에서 worker 삭제로 사라진다. 이 태스크에선 `report`가 자급 완료하므로, `resumePending`의 public 진입점은 남겨도(멱등 재구동용) 무방하나 `resumeWaitingOperation` 의존이 있으면 제거. `markRecoveryRequired`(`:299`,`:857`)가 async void 실패 복구용이었다면 동기 경로(tx 롤백)에선 불필요 — 데드면 제거(Task 11 정합).

- [ ] **Step 6: 통과 확인 + tsc**

Run: `npm run test:core:integration:local -- shipment-recall.integration`
Expected: PASS(waybill voided + 재고 역전 + 동기 완료).

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: exit 0.

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/shipment-recall.service.ts \
        apps/core/src/modules/fulfillment/services/shipment-recall.integration.spec.ts
git commit -m "refactor(waybill): recall → voidForRecall + resumePending 인라인(동기 붕괴), invoice 읽기·async 트리거 제거"
```

---

### Task 8: read 소비자 rewire — invoices 직접읽기 → waybill 읽기

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.ts`
- Modify: `apps/core/src/modules/fulfillment/services/consolidation.service.ts`
- Modify: `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts`
- Test: 각 서비스의 통합 spec(`consolidation.integration.spec.ts` 등)

**Interfaces:**
- Consumes: `wmsTables.waybills`(활성 = status NOT IN voided/failed/abandoned). 이 서비스들은 InvoiceOrchestrator를 주입하지 않으므로 **직접 read만 치환**(주입 변경 없음). 존재-체크는 활성 waybill 존재로, 상세 조회는 waybill 행으로.

각 read는 "활성 invoice(status ∈ ACTIVE_INVOICE_STATUSES)"를 "활성 waybill(status NOT IN TERMINAL)"로 의미 보존 치환. `manifestVersion`은 waybill 행에도 있다.

- [ ] **Step 1: `fulfillment-invariant.service.ts`**

`:443-455` `wmsTables.invoices` 읽기(id/shipmentId/manifestVersion/status, FOR UPDATE)를 `wmsTables.waybills` 읽기로 치환. 소비처 `collectFulfillmentInvariantViolations`(`:543-549`, `invoices` 필드 + `ignoredInvoiceIds`)의 입력 타입(`:58`)·순수함수(`:183`)를 waybill 기준으로 개명·조정(`ignoredInvoiceIds` → `ignoredWaybillIds` 등). manifest 정합 불변식 로직은 동일 컬럼(`manifestVersion`)이라 그대로.

- [ ] **Step 2: `consolidation.service.ts`**

`:992-1001` 활성 invoice 존재-체크(`ACTIVE_INVOICE_STATUSES`, LIMIT 1) → 활성 waybill 존재-체크(TERMINAL 제외). 블로커 코드 `'ACTIVE_INVOICE'`(`:1046`)는 운영 의미 보존 위해 문자열 유지 또는 `'ACTIVE_WAYBILL'`로 개명(클라이언트 영향 확인). `ACTIVE_INVOICE_STATUSES`(`:21`) 미사용화되면 제거.

- [ ] **Step 3: `shipment-planning.service.ts` (3곳)**

- `getShipmentDetail`(`:861-865`, 전체 invoice 목록 → 상세 DTO `:923` `invoices,`): waybill 목록 읽기로 치환, DTO 필드 `invoices`→`waybills`(admin-web 영향 확인 — Task 9 클라이언트 확인과 함께).
- `assertNoActiveInvoice`(`:1317-1328`, 활성 invoice면 `SHIPMENT_ACTIVE_INVOICE`): 활성 waybill 존재로 치환(메서드명 `assertNoActiveWaybill`, 코드 문자열 보존/개명).
- `requiresDurableReplan`(`:1546-1555`, 존재-체크 boolean): 활성 waybill 존재로 치환.
- `ACTIVE_INVOICE_STATUSES`(`:29`) 미사용화 시 제거.

- [ ] **Step 4: 통합 spec 전환 + 통과 확인 + tsc**

각 서비스 통합 spec의 invoice 시드를 waybill 시드로 교체.

Run: `npm run test:core:integration:local -- "(consolidation|shipment-planning|fulfillment-invariant)"`
Expected: PASS.

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: exit 0.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.ts \
        apps/core/src/modules/fulfillment/services/consolidation.service.ts \
        apps/core/src/modules/fulfillment/services/shipment-planning.service.ts \
        apps/core/src/modules/fulfillment/services/*.integration.spec.ts
git commit -m "refactor(waybill): invariant·consolidation·planning invoices 직접읽기 → 활성 waybill 읽기"
```

---

### Task 9: 남은 invoice-시드 통합 spec 일괄 전환 (삭제 전 그린 고정)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/outbound-v2-scenarios.integration.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/services/outbound-v2-recovery-scenarios.integration.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/services/outbound-v2-warehouse-scenarios.integration.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/services/outbound-v2-concurrency.integration.spec.ts`
- (그 외 `grep -rl "wmsTables.invoices" apps/core/src/modules/fulfillment/**/*.spec.ts` 결과 전부)

**Interfaces:**
- Consumes: waybill 시드 헬퍼. Produces: 없음(테스트만).

Task 11(스키마 드롭) 전에 **어떤 spec도 `wmsTables.invoices`를 시드/참조하지 않도록** 만든다. 안 그러면 드롭 후 컴파일/런타임 실패.

- [ ] **Step 1: 잔여 invoice 참조 spec 목록화**

Run: `grep -rln "wmsTables.invoices\|invoice-orchestrator\|InvoiceOrchestrator\|canonicalShipmentRecipientHash" apps/core/src/modules/fulfillment --include=*.spec.ts`
Expected: outbound-v2-* 등 목록. 이미 Task 3~8에서 전환된 파일은 제외.

- [ ] **Step 2: 각 spec의 invoice 시드 → waybill 시드**

`eligibleFixture`류 헬퍼를 재사용하도록 통일(Task 4에서 waybill화된 fixture가 있으면 import). `status:'issued'`→`registered`, `used`→`used`(seedUsedWaybillForShipment), `voided`→직접 voided waybill insert. `canonicalShipmentRecipientHash`→waybill canonical 해시.

- [ ] **Step 3: 구 invoice-path 전용 spec 삭제**

`invoice-orchestrator.integration.spec.ts`, `invoice-orchestrator.*.spec.ts`, delivery-provider spec 등 **구 시스템만 검증하던 spec**은 재작성 대상 아님 → `git rm`. (흐름 spec은 Step 2로 rewire, 순수 invoice-단위 spec은 삭제.)

Run: `grep -rln "wmsTables.invoices\|InvoiceOrchestrator" apps/core/src/modules/fulfillment --include=*.spec.ts`
Expected: **빈 결과**(모두 전환/삭제됨).

- [ ] **Step 4: 전체 fulfillment 통합 그린**

Run: `npm run test:core:integration:local -- fulfillment`
Expected: 전량 PASS(구 invoice 없이).

- [ ] **Step 5: 커밋**

```bash
git add -A apps/core/src/modules/fulfillment
git commit -m "test(waybill): 잔여 outbound 통합 spec invoice→waybill 시드 전환, 구 invoice-only spec 삭제"
```

---

### Task 10: 구 controller 삭제 — `shipment-invoice.controller`

**Files:**
- Delete: `apps/core/src/modules/fulfillment/controllers/shipment-invoice.controller.ts` (+ `.spec.ts`)
- Delete: `apps/core/src/modules/fulfillment/dto/shipment-invoice.dto.ts`
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts`

**Interfaces:**
- WaybillController(`waybill/waybill.controller.ts`, 플랜 2)가 발급/void/조회 라우트를 이미 제공. 구 컨트롤러는 순수 제거.

- [ ] **Step 1: 라우트 경로 변경 클라이언트 영향 확인**

Run: `grep -rn "shipments/.*/invoice\|/invoices" apps/admin-web/src 2>/dev/null | head`
구 라우트를 호출하는 admin-web 클라이언트가 있으면 신 `/shipments/:id/waybills*` 경로로 갱신 필요 목록화(별도 admin-web 태스크 or 후속 티켓). 백엔드 삭제 자체는 진행.

- [ ] **Step 2: 파일 삭제 + 모듈에서 제거**

```bash
git rm apps/core/src/modules/fulfillment/controllers/shipment-invoice.controller.ts \
       apps/core/src/modules/fulfillment/controllers/shipment-invoice.controller.spec.ts \
       apps/core/src/modules/fulfillment/dto/shipment-invoice.dto.ts
```
`fulfillment.module.ts` `controllers` 배열(`:96-113`)에서 `ShipmentInvoiceController` 제거 + 상단 import 제거.

- [ ] **Step 3: 빌드·tsc**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit && npx nest build core`
Expected: exit 0 / 성공.

- [ ] **Step 4: 커밋**

```bash
git add -A apps/core/src/modules/fulfillment
git commit -m "refactor(waybill): 구 shipment-invoice 컨트롤러·DTO 삭제(WaybillController 대체)"
```

---

### Task 11: 구 invoice 코드 삭제 (contract phase — 코드)

**Files:**
- Delete: `services/invoice-orchestrator.service.ts` (+ spec들)
- Delete: `services/invoice-recovery.worker.ts` (+ spec)
- Delete: `services/delivery-provider.interface.ts`
- Delete: `services/goodsflow-delivery.provider.ts` (+ spec)
- Delete: `services/hanjin-delivery.provider.ts` (+ spec)
- Modify: `fulfillment.module.ts`

**Interfaces:**
- 이 시점에 어떤 프로덕션 코드도 InvoiceOrchestrator/provider를 참조하지 않아야 한다(Task 3~8 완료 전제).

- [ ] **Step 1: 참조 없음 확인**

Run: `grep -rn "InvoiceOrchestrator\|invoice-recovery\|delivery-provider\|GoodsflowDeliveryProvider\|HanjinDeliveryProvider\|canonicalShipmentRecipientHash" apps/core/src --include=*.ts | grep -v "\.spec\.ts"`
Expected: **빈 결과**. 남으면 해당 소비자 태스크로 돌아가 정리.

- [ ] **Step 2: 파일 삭제 + 모듈 provider 제거**

```bash
git rm apps/core/src/modules/fulfillment/services/invoice-orchestrator.service.ts \
       apps/core/src/modules/fulfillment/services/invoice-recovery.worker.ts \
       apps/core/src/modules/fulfillment/services/delivery-provider.interface.ts \
       apps/core/src/modules/fulfillment/services/goodsflow-delivery.provider.ts \
       apps/core/src/modules/fulfillment/services/hanjin-delivery.provider.ts
# 남은 관련 spec 도 함께
git rm apps/core/src/modules/fulfillment/services/invoice-orchestrator*.spec.ts \
       apps/core/src/modules/fulfillment/services/*delivery*.spec.ts 2>/dev/null || true
```
`fulfillment.module.ts` `providers`(`:116-160`)에서 `InvoiceOrchestrator`·`InvoiceRecoveryWorker`·`GoodsflowDeliveryProvider`·`HanjinDeliveryProvider`(및 provider 토큰) 제거 + import 제거. `EventsModule.forRoot` 스트림 중 오직 invoice 경로만 쓰던 것이 있으면 확인(대개 공유라 유지).

- [ ] **Step 3: 빌드·tsc·전체 fulfillment 테스트**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit && npx nest build core`
Expected: exit 0 / 성공.

Run: `npm run test:core:integration:local -- fulfillment`
Expected: PASS.

- [ ] **Step 4: 커밋**

```bash
git add -A apps/core/src/modules/fulfillment
git commit -m "refactor(waybill): InvoiceOrchestrator·recovery worker·delivery provider 삭제(contract phase)"
```

---

### Task 12: 스키마 드롭 (contract phase — DB)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-command.service.ts`, `shipment-planning.service.ts`, `shipment-short-pick.service.ts`, `outbound-batch-orchestrator.service.ts` (+ 해당 spec) — 잔여 dead read 제거(Step 0)
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts`
- Modify: `wmsTables` 등록부(schema barrel; `grep -rn "invoices" apps/core/src/modules/inventory/schema`)
- Create: `apps/core/drizzle/<timestamp>_drop-invoices.sql` (generate)

**Interfaces:**
- `invoices`·`invoiceOperations` 테이블 + `invoiceStatusEnum`/`invoiceMethodEnum`/`invoiceOperationTypeEnum`/`invoiceOperationStatusEnum` + `invoicesRelations`/`invoiceOperationsRelations` 제거. `wmsTables`에서 등록 해제.
- **+ `dispatch_attempts.invoice_id` 컬럼 드롭(contract)**: Task 4가 `waybill_id`(expand)를 추가했고 Task 5가 그리로 write 전환했으므로, 이 시점에 구 `invoice_id`는 write 0·read 0. `dispatchAttempts`에서 `invoiceId` 컬럼 정의 제거. **이게 invoices 테이블 드롭의 전제**(FK `onDelete:'restrict'` 잔존 시 DROP TABLE invoices 실패).

- [ ] **Step 0: 잔여 dead 프로덕션 read 제거 (스키마 드롭 전제)**

Task 11이 남긴 4개 프로덕션 read가 아직 `wmsTables.invoices`/`invoiceOperations`를 읽는다 — 테이블 드롭 시 컴파일 파손하므로 **먼저 제거**. 각 read는 이제 **항상 빈/null 결과**를 내므로, 읽기를 그 상수로 치환(동작 불변):
- `fulfillment-command.service.ts:~81` — `resourceType: 'invoice_operation'` 분기(도달불가 dead ternary): 분기 자체 제거.
- `shipment-planning.service.ts:~1007` — `invoiceOperations` fallback SELECT(항상 miss): 읽기 제거, fallthrough 유지.
- `shipment-short-pick.service.ts:~891` — `invoiceOperations` SELECT id → `invoiceOperationId` 응답 필드 산출(항상 null): 읽기 제거하고 `invoiceOperationId: null` 리터럴로 치환(**admin-web 호환 위해 DTO 필드는 유지**). 아울러 t11-low: spec-only caller만 남은 public `markInvoiceRecoveryRequired`(+ 그 spec 케이스)를 grep 재확인 후 제거(프로덕션 caller 0이면).
- `outbound-batch-orchestrator.service.ts:~1060` — cancel-guard의 `invoices` SELECT(항상 empty=no-op): 그 guard leg 제거(cancel-resume가 invoice state로 블록되지 않음 — sync waybill-void 붕괴로 이미 무의미).

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit` (exit 0) + 영향 spec 그린 확인(`test:core:integration:local -- "(shipment-short-pick|shipment-planning|outbound-batch)"`). 이후 `grep -rn "wmsTables.invoices\|wmsTables.invoiceOperations" apps/core/src/modules/fulfillment --include=*.ts | grep -v spec` = **빈 결과**여야 Step 1 진행.

- [ ] **Step 1: 스키마에서 invoice 정의 제거**

`inventory.schema.ts`에서 `invoices`·`invoiceOperations` `pgTable`, 4개 enum, 2개 relations를 삭제. `dispatchAttempts`에서 `invoiceId: uuid('invoice_id').references(() => invoices.id, ...)` 컬럼도 제거(`waybill_id`는 유지). `wmsTables`(schema 객체)에서 `invoices`/`invoiceOperations` 키 제거. 잔여 참조(`typeof wmsTables.invoices.$inferSelect`, `dispatchAttempts.invoiceId` 등)가 남지 않았는지 확인(Task 5~9에서 제거됨).

- [ ] **Step 2: 마이그레이션 생성**

Run: `npm run db:generate:core -- --name drop-invoices`
생성된 `apps/core/drizzle/<ts>_drop-invoices.sql` 검토: `ALTER TABLE dispatch_attempts DROP COLUMN invoice_id; DROP TABLE invoice_operations; DROP TABLE invoices; DROP TYPE ...;` 형태 확인(컬럼 드롭이 테이블 드롭보다 먼저 — FK 해제). FK 순서(invoiceOperations→invoices, dispatch_attempts→invoices) 주의. 잘못됐으면 `git rm` 후 schema 고치고 재생성(적용된 적 없으므로 안전).

- [ ] **Step 3: tsc·빌드**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit && npx nest build core`
Expected: exit 0 / 성공.

- [ ] **Step 4: 커밋 (schema + migration + meta 단일 커밋)**

```bash
# Step 0(잔여 read 제거) + Step 1~2(스키마/마이그레이션)를 한 커밋으로 — 코드 정리가 드롭의 전제라 결합.
git add apps/core/src/modules/inventory/schema/inventory.schema.ts \
        apps/core/drizzle/ \
        apps/core/src/modules/fulfillment/services/fulfillment-command.service.ts \
        apps/core/src/modules/fulfillment/services/shipment-planning.service.ts \
        apps/core/src/modules/fulfillment/services/shipment-short-pick.service.ts \
        apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts \
        apps/core/src/modules/fulfillment/services/*.spec.ts
git commit -m "feat(waybill)!: invoices·invoiceOperations 테이블/enum 드롭 + 잔여 dead read 제거(contract phase)

배포 순서: sst deploy(구 task 종료) → db:migrate. autodeploy 없음 — 운영자 규율."
```
(주의: `services/*.spec.ts` 글롭이 의도한 spec만 잡는지 `git status`로 확인 — 무관 spec이 딸려오면 명시 경로로 좁힌다.)

> **배포 노트(운영자):** destructive contract phase다. 실 데이터 없으나 순서 규율 준수 — **`sst deploy` 완료 후 `db:migrate`**. 옛 task가 destructive migration을 먼저 만나면 사고.

---

### Task 13: env 죽은 키 정리

**Files:**
- Modify: `apps/core/src/config/env.validation.ts`

**Interfaces:**
- **제거(delivery-provider era, 죽음)**: `HANJIN_API_URL`, `HANJIN_CUSTOMER_CODE`, `HANJIN_SENDER_CODE`, `HANJIN_PICKUP_SITE_CODE`, `HANJIN_SENDER_PHONE` + 구 goodsflow 키 전부.
- **유지(신 loadHanjinConfig 재사용)**: `HANJIN_API_KEY`, `HANJIN_TIMEOUT_MS`, `HANJIN_SENDER_NAME`.
- **유지(신 키)**: `HANJIN_CLIENT_ID`/`SECRET_KEY`/`CONTRACT_NO`/`ORDER_BASE_URL`/`PRINT_BASE_URL`/`SENDER_ZIP`/`SENDER_BASE_ADDR`/`SENDER_DTL_ADDR`/`SENDER_TEL`/`BOX_TYPE`/`PAY_TYPE`.

- [ ] **Step 1: 신 config 재사용 키 재확인(오삭제 방지)**

Run: `grep -rn "HANJIN_API_KEY\|HANJIN_TIMEOUT_MS\|HANJIN_SENDER_NAME\|GOODSFLOW" apps/core/src/modules/fulfillment/waybill apps/core/src/config`
Expected: 유지 키는 `loadHanjinConfig`/factory에서 참조됨을 확인. goodsflow는 참조 0.

- [ ] **Step 2: 죽은 키 제거**

`env.validation.ts`에서 위 제거 목록의 검증 스키마 항목 삭제. 유지 목록은 절대 건드리지 않음.

- [ ] **Step 3: tsc·부팅 스모크**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: exit 0.

- [ ] **Step 4: 커밋**

```bash
git add apps/core/src/config/env.validation.ts
git commit -m "chore(waybill): delivery-provider era 죽은 HANJIN_*·goodsflow env 키 제거(신 config 키는 유지)"
```

---

### Task 14: 최종 검증 — 전체 스위트 + app-boot DI 무순환

**Files:** 없음(검증 전용).

- [ ] **Step 1: 전체 타입 게이트**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: exit 0.

- [ ] **Step 2: 빌드**

Run: `npx nest build core`
Expected: 성공.

- [ ] **Step 3: 전체 fulfillment + waybill 테스트**

Run: `npm run test -- --testPathPattern=waybill`
Run: `npm run test:core:integration:local -- fulfillment`
Expected: 전량 PASS.

- [ ] **Step 4: 실 app-boot DI smoke (Kafka broker 환경)**

플랜 2에서 skip했던 실부팅 검증. Kafka broker 있는 dev 환경에서 core를 부팅해 `WaybillService` DI 해결 + `FulfillmentModule ↔ WaybillModule` 무순환 확인:
Run: `npm run start:main:dev` (부팅 로그에서 `Nest application successfully started` + 순환/미해결 provider 에러 없음 확인, 후 종료).
Expected: 정상 부팅. (환경 미비 시 최소 `nest build` + 정적 트레이스로 대체하고 후속 티켓 명시.)

- [ ] **Step 5: 잔재 없음 최종 확인**

Run: `grep -rn "InvoiceOrchestrator\|wmsTables.invoices\|invoiceOperations\|delivery-provider\|canonicalShipmentRecipientHash" apps/core/src --include=*.ts`
Expected: **빈 결과**(테스트 포함 전량 제거).

- [ ] **Step 6: 무회귀 요약 커밋(선택) / 핸드오프 갱신**

`.superpowers/sdd/progress.md`·auto-memory `waybill-module-redesign`를 "플랜 3 컷오버 완료"로 갱신. develop 머지 준비(`superpowers:finishing-a-development-branch`).

---

## Self-Review (작성자 체크)

**Spec coverage(§12 대비):**
- §12.1 모듈 순환 → Task 1 ✓
- §12.2 recall 동기 붕괴 → Task 2(voidForRecall)+Task 7 ✓
- §12.3 소비자별: dispatch→Task 5, short-pick→Task 6, batch→Task 4, picking→Task 3, controller→Task 10, read 치환→Task 8 ✓
- §12.4 삭제/env/배포순서/테스트 → Task 9(테스트)·10·11·12·13 ✓
- §9.1 void vs voidForRecall → Task 2 ✓ / §11 라이프사이클 → Task 2·7 ✓

**Placeholder scan:** dispatch(Task 5)·short-pick(Task 6)·recall(Task 7)은 실코드 라인 참조 + 종단 상태 + 치환 스니펫을 제공하되, `aggregate.invoice`→`aggregate.waybill` 등 주변 코드 파급은 실행 subagent가 TDD(실패 테스트)로 정확 형태를 확정한다 — 이는 대규모 rewrite의 불가피한 재량 지점으로, 각 스텝이 정확한 라인·seam 호출·테스트 단언을 지정해 방향 모호성은 없다.

**Type consistency:** seam 시그니처는 Global Constraints에 단일 출처. `voidForRecall`(Task 2 정의) = Task 7 소비 시그니처 일치. `casUsedToVoided` count-return = manager `affected!==1` 일치. `assertDispatchable`은 `WaybillRow` 반환(WaybillView 아님) — Task 3·4·5에서 반환 사용/미사용 각각 반영.

**주의 사항(실행 시):**
- Task 5(dispatch)·6(short-pick)·7(recall)는 async saga/aggregate 구조 파급이 있어 **가장 리뷰가 중요**. 각 태스크 후 별도 리뷰 게이트 권장.
- Task 12(스키마 드롭)는 **Task 3~11 완료 후에만** — 어떤 spec/코드도 invoices 미참조 확인이 선행.
