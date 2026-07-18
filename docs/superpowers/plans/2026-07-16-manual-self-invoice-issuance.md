# Manual (`self`) Invoice Issuance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a warehouse operator record an externally-obtained tracking number (e.g. a Hanjin waybill) directly onto a planned shipment as an `issued` `self` invoice, with a corrective manual void, so shipments can dispatch while goodsflow is externally unusable and the Hanjin API is unimplemented.

**Architecture:** Two new synchronous endpoints on the existing `ShipmentInvoiceController`, backed by two new methods on `InvoiceOrchestrator` (`issueManualInvoice`, `voidManualInvoice`). Both reuse the orchestrator's existing manifest-guard helpers and the `FulfillmentCommandService.execute` idempotency wrapper, but create **no** `invoiceOperations` row and never touch the `InvoiceRecoveryWorker` — `self` has no provider call. The one edit to shared code is relaxing `assertDispatchableInvoice` so a `self` invoice (which has no provider `externalServiceId`) can dispatch.

**Tech Stack:** NestJS, Drizzle ORM (postgres.js), class-validator DTOs, Jest.

## Global Constraints

- **Design spec:** `docs/superpowers/specs/2026-07-16-manual-self-invoice-issuance-design.md` — this plan implements it. No schema migration (`invoiceMethodEnum` already contains `'self'`).
- **Error style:** Match the existing file. Use the orchestrator's `this.conflict(code, message)` helper (returns `ConflictException`) and Nest `BadRequestException`/`NotFoundException`. Do **not** introduce `@app/shared` exceptions here.
- **Type safety:** No `any`/`as` without justification. The one allowed cast is the 23505 error narrowing `error as { code?: string; constraint_name?: string; constraint?: string }` — the established pattern at `outbound-batch-orchestrator.service.ts:1313`.
- **Tx type:** Use `DbTx` imported from `apps/core/src/modules/inventory/schema/inventory.schema`. Public methods take `tx?: DbTx` as the last param.
- **Idempotency:** `commands.execute` rejects an empty `idempotency-key` with `FULFILLMENT_IDEMPOTENCY_KEY_REQUIRED` (400). The `idempotency-key` header is therefore effectively required, same as the provider path.
- **Response snapshot safety:** `commands.execute` stores the handler's `response` as JSON and returns it verbatim on idempotent replay. Response DTOs must use ISO **string** timestamps (not `Date`) so first-call and replay shapes match.
- **Running integration tests:** the integration spec is DB-gated (`describeIfDb` on `process.env.DATABASE_URL`). Run it via the repo runner, not raw jest: `npm run test:core:integration:local -- <path-pattern>`. The runner starts compose postgres (idempotent — the local DB is always up), migrates core, then runs `jest --testPathPattern=<pattern> --runInBand` with `DATABASE_URL` set to the local core DB. It takes a **single** path-pattern arg and does **not** forward `-t`/other jest flags. Unit specs (`*.service.spec`, `*.controller.spec`) need no DB and run via plain `npx jest --testPathPattern=<pattern>`.
- **Commits:** Conventional Commits. End every commit message body with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Relax `assertDispatchableInvoice` for `self` invoices

The linchpin. Currently `assertDispatchableInvoice` requires `externalServiceId` on every issued invoice; a `self` invoice has none, so all 5 dispatch call sites would reject it. Relax the service-ID requirement for `issueMethod === 'self'` only. Unit-tested, no DB.

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/invoice-orchestrator.service.ts:435-445`
- Test: `apps/core/src/modules/fulfillment/services/invoice-orchestrator.service.spec.ts` (append to existing `describe`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `assertDispatchableInvoice(shipmentId: string, tx?: DbTx)` — behavior change only; a `self` invoice with `carrier` + finalized `trackingNo` and matching manifest/recipient hash now resolves even when `externalServiceId` is null. Provider invoices unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `invoice-orchestrator.service.spec.ts`, inside the existing `describe('InvoiceOrchestrator provider crash recovery', ...)` block, just before its closing `});` (after the test at line 640-669). These mirror that test's mock shape.

```ts
  it('accepts dispatch for a self invoice without a provider service ID', async () => {
    const { service } = makeService();
    const recipientSnapshot = { recipientName: 'Recipient' };
    const shipment = { id: 'shipment-1', manifestVersion: 3, recipientSnapshot };
    const invoice = {
      id: 'invoice-1',
      shipmentId: 'shipment-1',
      status: 'issued',
      manifestVersion: 3,
      recipientHash: canonicalShipmentRecipientHash(recipientSnapshot),
      carrier: 'HANJIN',
      issueMethod: 'self',
      externalServiceId: null,
      trackingNo: 'H1234567890',
    };
    const select = jest
      .fn()
      .mockReturnValueOnce({
        from: jest.fn(() => ({
          where: jest.fn(() => ({ limit: jest.fn().mockResolvedValue([shipment]) })),
        })),
      })
      .mockReturnValueOnce({
        from: jest.fn(() => ({ where: jest.fn().mockResolvedValue([invoice]) })),
      });
    (service as any).dbService = { run: (fn: (tx: unknown) => unknown) => fn({ select }) };

    await expect(service.assertDispatchableInvoice('shipment-1')).resolves.toMatchObject({
      id: 'invoice-1',
      issueMethod: 'self',
    });
  });

  it('still rejects a provider invoice that lacks a provider service ID', async () => {
    const { service } = makeService();
    const recipientSnapshot = { recipientName: 'Recipient' };
    const shipment = { id: 'shipment-1', manifestVersion: 3, recipientSnapshot };
    const invoice = {
      id: 'invoice-1',
      shipmentId: 'shipment-1',
      status: 'issued',
      manifestVersion: 3,
      recipientHash: canonicalShipmentRecipientHash(recipientSnapshot),
      carrier: 'CJ',
      issueMethod: 'goodsflow',
      externalServiceId: null,
      trackingNo: 'tracking-1',
    };
    const select = jest
      .fn()
      .mockReturnValueOnce({
        from: jest.fn(() => ({
          where: jest.fn(() => ({ limit: jest.fn().mockResolvedValue([shipment]) })),
        })),
      })
      .mockReturnValueOnce({
        from: jest.fn(() => ({ where: jest.fn().mockResolvedValue([invoice]) })),
      });
    (service as any).dbService = { run: (fn: (tx: unknown) => unknown) => fn({ select }) };

    await expect(service.assertDispatchableInvoice('shipment-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SHIPMENT_INVOICE_NOT_READY' }),
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --testPathPattern=invoice-orchestrator.service.spec -t "self invoice"`
Expected: FAIL — the "accepts dispatch for a self invoice" test rejects with `SHIPMENT_INVOICE_NOT_READY` because the current guard still requires `externalServiceId`.

- [ ] **Step 3: Implement the relaxation**

In `invoice-orchestrator.service.ts`, replace the current guard (lines 435-445):

```ts
      if (
        !invoice.carrier ||
        !invoice.externalServiceId?.trim() ||
        !invoice.trackingNo.trim() ||
        invoice.trackingNo.startsWith('pending:')
      ) {
        throw this.conflict(
          'SHIPMENT_INVOICE_NOT_READY',
          'Issued invoice requires carrier, provider service ID, and finalized tracking number',
        );
      }
```

with:

```ts
      const requiresProviderServiceId = invoice.issueMethod !== 'self';
      if (
        !invoice.carrier ||
        (requiresProviderServiceId && !invoice.externalServiceId?.trim()) ||
        !invoice.trackingNo.trim() ||
        invoice.trackingNo.startsWith('pending:')
      ) {
        throw this.conflict(
          'SHIPMENT_INVOICE_NOT_READY',
          'Issued invoice requires a carrier and a finalized tracking number (provider invoices also require a service ID)',
        );
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest --testPathPattern=invoice-orchestrator.service.spec`
Expected: PASS — both new tests plus the pre-existing suite (including the line-640 "rejects dispatch when an issued invoice still lacks provider execution identity" test, which uses `carrier: null` and must still fail-closed).

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/fulfillment/services/invoice-orchestrator.service.ts \
        apps/core/src/modules/fulfillment/services/invoice-orchestrator.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(fulfillment): allow self invoices through the dispatch gate

assertDispatchableInvoice required externalServiceId on every issued
invoice; a manual (self) invoice has no provider service id. Relax the
service-id requirement for issueMethod==='self' only — carrier and a
finalized (non-pending) tracking number are still required, and provider
invoices are unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: DTOs, response mapper, and `issueManualInvoice`

Add the request/response DTOs and the synchronous issue method. Integration-tested against a real DB.

**Files:**
- Modify: `apps/core/src/modules/fulfillment/dto/shipment-invoice.dto.ts` (add `IssueManualInvoiceDto`, `ManualInvoiceResponseDto`)
- Modify: `apps/core/src/modules/fulfillment/services/invoice-orchestrator.service.ts` (add imports, `toManualInvoiceResponse`, `issueManualInvoice`)
- Test: `apps/core/src/modules/fulfillment/services/invoice-orchestrator.integration.spec.ts` (append tests)

**Interfaces:**
- Consumes: from Task 1, `assertDispatchableInvoice` now accepts `self`. Existing private helpers `lockManifest(shipmentId, trx): Promise<LockedManifest>`, `assertNoActiveInvoice(shipmentId, trx)`, `assertRecipientComplete(recipientSnapshot)`, `assertTrustedLineIdentity(lines)`, `conflict(code, message)`, module fn `canonicalShipmentRecipientHash(recipientSnapshot)`, `this.commands.execute<T>(input, handler, tx?)`, `this.audit.logUserActionRequired(action, domain, message, {userId}, details, tx)`, `this.workflowGate.assertV2MutationAllowed(kind)`.
- Produces:
  - `ManualInvoiceResponseDto = { invoiceId: string; shipmentId: string; trackingNo: string; carrier: string; issueMethod: string; status: string; issuedAt: string; voidedAt: string | null }`
  - `IssueManualInvoiceDto = { expectedManifestVersion: number; carrierCode: CarrierEnum; trackingNo: string; reason?: string; note?: string }`
  - `issueManualInvoice(shipmentId: string, dto: IssueManualInvoiceDto, idempotencyKey: string, actor: ShipmentInvoiceActor, tx?: DbTx): Promise<ManualInvoiceResponseDto>`
  - `private toManualInvoiceResponse(row: typeof wmsTables.invoices.$inferSelect): ManualInvoiceResponseDto`

- [ ] **Step 1: Add the DTOs**

In `dto/shipment-invoice.dto.ts`, add the import at the top and the two classes. Add to the existing `class-validator` import line the `IsIn` (already imported), `IsInt`, `Min`, `MaxLength`, `IsString`, `IsOptional`, `IsNotEmpty` — ensure `MaxLength` is added:

```ts
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { carrierValues, CarrierEnum } from '../../inventory/schema/enum-values';
```

Append these classes:

```ts
export class IssueManualInvoiceDto {
  @IsInt()
  @Min(1)
  expectedManifestVersion: number;

  @IsIn(carrierValues)
  carrierCode: CarrierEnum;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  trackingNo: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  note?: string;
}

export class ManualInvoiceResponseDto {
  @ApiProperty()
  invoiceId: string;

  @ApiProperty()
  shipmentId: string;

  @ApiProperty()
  trackingNo: string;

  @ApiProperty()
  carrier: string;

  @ApiProperty({ enum: ['goodsflow', 'self', 'hanjin'] })
  issueMethod: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  issuedAt: string;

  @ApiPropertyOptional({ nullable: true })
  voidedAt: string | null;
}
```

- [ ] **Step 2: Write the failing integration tests**

In `invoice-orchestrator.integration.spec.ts`, add these imports if missing (`IssueManualInvoiceDto` is not needed — pass a plain object) and append inside the main `describeIfDb` block (near the other `it(...)` tests). They use the existing `inRollbackTx`, `plannedFixture`, `services`, and `actor` helpers.

```ts
  it('issues a self invoice synchronously and makes the shipment dispatchable', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await plannedFixture(tx);
      const { orchestrator } = services();
      const response = await orchestrator.issueManualInvoice(
        fixture.shipment.shipmentId,
        {
          expectedManifestVersion: fixture.shipment.manifestVersion,
          carrierCode: 'HANJIN',
          trackingNo: `H-${randomUUID()}`,
        },
        `manual-issue-${randomUUID()}`,
        actor,
        tx,
      );

      expect(response).toMatchObject({
        shipmentId: fixture.shipment.shipmentId,
        carrier: 'HANJIN',
        issueMethod: 'self',
        status: 'issued',
      });
      const [invoice] = await tx
        .select()
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.id, response.invoiceId));
      expect(invoice).toMatchObject({ issueMethod: 'self', status: 'issued', externalServiceId: null });

      const operations = await tx
        .select({ id: wmsTables.invoiceOperations.id })
        .from(wmsTables.invoiceOperations)
        .where(eq(wmsTables.invoiceOperations.invoiceId, response.invoiceId));
      expect(operations).toHaveLength(0);

      await expect(
        orchestrator.assertDispatchableInvoice(fixture.shipment.shipmentId, tx),
      ).resolves.toMatchObject({ id: response.invoiceId });
    });
  });

  it('rejects a duplicate tracking number', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixtureA = await plannedFixture(tx);
      const fixtureB = await plannedFixture(tx);
      const { orchestrator } = services();
      const trackingNo = `DUP-${randomUUID()}`;
      await orchestrator.issueManualInvoice(
        fixtureA.shipment.shipmentId,
        { expectedManifestVersion: fixtureA.shipment.manifestVersion, carrierCode: 'CJ', trackingNo },
        `manual-issue-${randomUUID()}`,
        actor,
        tx,
      );
      await expect(
        orchestrator.issueManualInvoice(
          fixtureB.shipment.shipmentId,
          { expectedManifestVersion: fixtureB.shipment.manifestVersion, carrierCode: 'CJ', trackingNo },
          `manual-issue-${randomUUID()}`,
          actor,
          tx,
        ),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVOICE_TRACKING_ALREADY_EXISTS' }) });
    });
  });

  it('rejects a manual issue against a non-planned shipment', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await plannedFixture(tx);
      const { orchestrator } = services();
      await expect(
        orchestrator.issueManualInvoice(
          fixture.shipment.shipmentId,
          { expectedManifestVersion: fixture.shipment.manifestVersion + 1, carrierCode: 'CJ', trackingNo: `S-${randomUUID()}` },
          `manual-issue-${randomUUID()}`,
          actor,
          tx,
        ),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'SHIPMENT_STALE_MANIFEST_VERSION' }) });
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test:core:integration:local -- invoice-orchestrator.integration`
Expected: FAIL (compile error — `orchestrator.issueManualInvoice` does not exist).

- [ ] **Step 4: Implement `issueManualInvoice` and the mapper**

In `invoice-orchestrator.service.ts`, add `ManualInvoiceResponseDto` and `IssueManualInvoiceDto` to the DTO import block (lines 6-11):

```ts
import {
  InvoiceOperationResponseDto,
  IssueManualInvoiceDto,
  IssueShipmentInvoiceDto,
  ManualInvoiceResponseDto,
  ShipmentInvoiceActor,
  VoidShipmentInvoiceDto,
} from '../dto/shipment-invoice.dto';
```

Add these two methods to the `InvoiceOrchestrator` class (place `issueManualInvoice` right after `issueForShipment`, and `toManualInvoiceResponse` next to the other private helpers):

```ts
  async issueManualInvoice(
    shipmentId: string,
    dto: IssueManualInvoiceDto,
    idempotencyKey: string,
    actor: ShipmentInvoiceActor,
    tx?: DbTx,
  ): Promise<ManualInvoiceResponseDto> {
    this.workflowGate.assertV2MutationAllowed('shipment.invoice.issue');
    const trackingNo = dto.trackingNo.trim();
    if (!trackingNo) throw new BadRequestException('trackingNo is required');

    return this.commands.execute<ManualInvoiceResponseDto>(
      {
        commandType: 'shipment.invoice.issue.manual',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, shipmentId, ...dto, trackingNo },
      },
      async (trx) => {
        const manifest = await this.lockManifest(shipmentId, trx);
        if (manifest.shipment.status !== 'planned') {
          throw this.conflict('SHIPMENT_NOT_PLANNED', 'Only a Planned shipment can receive an invoice');
        }
        if (manifest.shipment.manifestVersion !== dto.expectedManifestVersion) {
          throw this.conflict('SHIPMENT_STALE_MANIFEST_VERSION', 'Shipment manifest has changed');
        }
        await this.assertNoActiveInvoice(shipmentId, trx);
        this.assertRecipientComplete(manifest.shipment.recipientSnapshot);
        this.assertTrustedLineIdentity(manifest.lines);
        // assertProfileComplete is intentionally NOT called: it requires carrierAccountRef
        // (the goodsflow center code). A self invoice uses no carrier API, and requiring the
        // now-dead goodsflow account would block the manual stopgap.

        const recipientHash = canonicalShipmentRecipientHash(manifest.shipment.recipientSnapshot);
        let invoice: typeof wmsTables.invoices.$inferSelect;
        try {
          [invoice] = await trx
            .insert(wmsTables.invoices)
            .values({
              trackingNo,
              carrier: dto.carrierCode,
              issueMethod: 'self',
              externalServiceId: null,
              issuedForFulfillmentOrderId: manifest.fulfillmentOrderIds[0],
              shipmentId,
              manifestVersion: manifest.shipment.manifestVersion,
              recipientHash,
              status: 'issued',
            })
            .returning();
        } catch (error) {
          const row = error as { code?: string; constraint_name?: string; constraint?: string };
          if (
            row?.code === '23505' &&
            (row.constraint_name === 'invoices_tracking_no_unique' || row.constraint === 'invoices_tracking_no_unique')
          ) {
            throw this.conflict('INVOICE_TRACKING_ALREADY_EXISTS', `Tracking number ${trackingNo} already exists`);
          }
          throw error;
        }

        const response = this.toManualInvoiceResponse(invoice);
        await this.audit.logUserActionRequired(
          'shipment.invoice.issue.manual',
          'fulfillment',
          `Manual invoice ${invoice.id} issued for shipment ${shipmentId}`,
          { userId: actor.id },
          { invoiceId: invoice.id, shipmentId, carrier: dto.carrierCode, trackingNo, reason: dto.reason ?? null },
          trx,
        );
        return { response, resourceType: 'invoice', resourceId: invoice.id };
      },
      tx,
    );
  }

  private toManualInvoiceResponse(row: typeof wmsTables.invoices.$inferSelect): ManualInvoiceResponseDto {
    return {
      invoiceId: row.id,
      shipmentId: row.shipmentId,
      trackingNo: row.trackingNo,
      carrier: row.carrier ?? '',
      issueMethod: row.issueMethod,
      status: row.status,
      issuedAt: row.issuedAt.toISOString(),
      voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    };
  }
```

Note: the handler returns `{ response, resourceType: 'invoice', resourceId }` with **no** `operationId`, so `commands.execute`'s operation-existence check (`fulfillment-command.service.ts:79`) is skipped — no `invoiceOperations` row is needed.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:core:integration:local -- invoice-orchestrator.integration`
Expected: PASS — the three new tests plus the existing integration suite. Also run `npx nest build core` and expect a clean build (type check of the new insert/DTO).

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/fulfillment/dto/shipment-invoice.dto.ts \
        apps/core/src/modules/fulfillment/services/invoice-orchestrator.service.ts \
        apps/core/src/modules/fulfillment/services/invoice-orchestrator.integration.spec.ts
git commit -m "$(cat <<'EOF'
feat(fulfillment): synchronous manual (self) invoice issuance

issueManualInvoice records an externally-obtained tracking number as an
issued self invoice directly, reusing the manifest guards and the command
idempotency wrapper but creating no operation row and calling no provider.
Skips assertProfileComplete (carrierAccountRef is goodsflow-specific).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `voidManualInvoice` and provider-void guard message

Add the corrective synchronous void (pre-dispatch only) and point the provider `void()` guard at the manual endpoint.

**Files:**
- Modify: `apps/core/src/modules/fulfillment/dto/shipment-invoice.dto.ts` (add `VoidManualInvoiceDto`)
- Modify: `apps/core/src/modules/fulfillment/services/invoice-orchestrator.service.ts` (add `voidManualInvoice`; adjust `void()` guard message at line 274-276)
- Test: `apps/core/src/modules/fulfillment/services/invoice-orchestrator.integration.spec.ts` (append tests)

**Interfaces:**
- Consumes: from Task 2, `ManualInvoiceResponseDto`, `toManualInvoiceResponse`, `issueManualInvoice`.
- Produces:
  - `VoidManualInvoiceDto = { reason?: string; note?: string }`
  - `voidManualInvoice(invoiceId: string, dto: VoidManualInvoiceDto, idempotencyKey: string, actor: ShipmentInvoiceActor, tx?: DbTx): Promise<ManualInvoiceResponseDto>`

- [ ] **Step 1: Add the DTO**

Append to `dto/shipment-invoice.dto.ts`:

```ts
export class VoidManualInvoiceDto {
  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  note?: string;
}
```

- [ ] **Step 2: Write the failing integration tests**

Append to `invoice-orchestrator.integration.spec.ts`:

```ts
  it('voids a self invoice and frees the shipment for re-issue', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await plannedFixture(tx);
      const { orchestrator } = services();
      const issued = await orchestrator.issueManualInvoice(
        fixture.shipment.shipmentId,
        { expectedManifestVersion: fixture.shipment.manifestVersion, carrierCode: 'HANJIN', trackingNo: `H-${randomUUID()}` },
        `manual-issue-${randomUUID()}`,
        actor,
        tx,
      );

      const voided = await orchestrator.voidManualInvoice(
        issued.invoiceId,
        { reason: 'typo' },
        `manual-void-${randomUUID()}`,
        actor,
        tx,
      );
      expect(voided).toMatchObject({ invoiceId: issued.invoiceId, status: 'voided' });
      expect(voided.voidedAt).not.toBeNull();

      // re-issue on the same shipment now succeeds (active-invoice unique index freed)
      const reissued = await orchestrator.issueManualInvoice(
        fixture.shipment.shipmentId,
        { expectedManifestVersion: fixture.shipment.manifestVersion, carrierCode: 'HANJIN', trackingNo: `H-${randomUUID()}` },
        `manual-issue-${randomUUID()}`,
        actor,
        tx,
      );
      expect(reissued.status).toBe('issued');
    });
  });

  it('refuses to manually void a provider-issued invoice', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await plannedFixture(tx);
      const { orchestrator } = services();
      const accepted = await orchestrator.issueForShipment(
        fixture.shipment.shipmentId,
        { expectedManifestVersion: fixture.shipment.manifestVersion, provider: 'goodsflow', carrierCode: 'CJ', reason: 'label' },
        `provider-issue-${randomUUID()}`,
        actor,
        tx,
      );
      await expect(
        orchestrator.voidManualInvoice(accepted.invoiceId as string, {}, `manual-void-${randomUUID()}`, actor, tx),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
```

Ensure `BadRequestException` is imported in the spec (from `@nestjs/common`); add it to the existing import if absent.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test:core:integration:local -- invoice-orchestrator.integration`
Expected: FAIL (compile error — `orchestrator.voidManualInvoice` does not exist).

- [ ] **Step 4: Implement `voidManualInvoice` and adjust the guard**

Add `VoidManualInvoiceDto` to the DTO import block in `invoice-orchestrator.service.ts`. Add this method (place after `voidForShipment`/`void`):

```ts
  async voidManualInvoice(
    invoiceId: string,
    dto: VoidManualInvoiceDto,
    idempotencyKey: string,
    actor: ShipmentInvoiceActor,
    tx?: DbTx,
  ): Promise<ManualInvoiceResponseDto> {
    this.workflowGate.assertV2MutationAllowed('shipment.invoice.void');

    return this.commands.execute<ManualInvoiceResponseDto>(
      {
        commandType: 'shipment.invoice.void.manual',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, invoiceId, ...dto },
      },
      async (trx) => {
        const [invoice] = await trx
          .select()
          .from(wmsTables.invoices)
          .where(eq(wmsTables.invoices.id, invoiceId))
          .limit(1)
          .for('update');
        if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);
        if (invoice.issueMethod !== 'self') {
          throw new BadRequestException('Provider-issued invoices must be voided through the durable void endpoint');
        }
        if (invoice.status !== 'issued') {
          throw this.conflict('INVOICE_NOT_VOIDABLE', `Invoice ${invoiceId} is ${invoice.status} and cannot be manually voided`);
        }
        const [shipment] = await trx
          .select({ status: wmsTables.shipments.status })
          .from(wmsTables.shipments)
          .where(eq(wmsTables.shipments.id, invoice.shipmentId))
          .limit(1);
        if (!shipment || ['shipped', 'in_transit', 'delivered'].includes(shipment.status)) {
          throw this.conflict('INVOICE_ALREADY_DISPATCHED', 'A dispatched manual invoice cannot be voided');
        }

        const [voided] = await trx
          .update(wmsTables.invoices)
          .set({ status: 'voided', voidedAt: new Date() })
          .where(eq(wmsTables.invoices.id, invoiceId))
          .returning();
        const response = this.toManualInvoiceResponse(voided);
        await this.audit.logUserActionRequired(
          'shipment.invoice.void.manual',
          'fulfillment',
          `Manual invoice ${invoiceId} voided`,
          { userId: actor.id },
          { invoiceId, shipmentId: invoice.shipmentId, reason: dto.reason ?? null },
          trx,
        );
        return { response, resourceType: 'invoice', resourceId: invoiceId };
      },
      tx,
    );
  }
```

Then update the provider `void()` guard message (line 274-276) to point operators at the manual endpoint:

```ts
        if (invoice.issueMethod !== 'goodsflow' && invoice.issueMethod !== 'hanjin') {
          throw new BadRequestException('Manually-issued (self) invoices must be voided through POST /invoices/:id/void-manual');
        }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:core:integration:local -- invoice-orchestrator.integration`
Expected: PASS (full integration suite). Also `npx nest build core` clean.

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/fulfillment/dto/shipment-invoice.dto.ts \
        apps/core/src/modules/fulfillment/services/invoice-orchestrator.service.ts \
        apps/core/src/modules/fulfillment/services/invoice-orchestrator.integration.spec.ts
git commit -m "$(cat <<'EOF'
feat(fulfillment): synchronous manual (self) invoice void

voidManualInvoice voids a pre-dispatch self invoice (issued + shipment
not shipped/used), freeing the active-invoice unique slot for a corrected
re-issue. Refuses provider invoices (they use the durable void saga) and
dispatched labels. Provider void() guard now points at the manual route.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Controller routes + controller spec

Expose both methods as HTTP endpoints and lock in wiring/scopes with a controller unit spec (mocked orchestrator, no DB).

**Files:**
- Modify: `apps/core/src/modules/fulfillment/controllers/shipment-invoice.controller.ts`
- Create: `apps/core/src/modules/fulfillment/controllers/shipment-invoice.controller.spec.ts`

**Interfaces:**
- Consumes: `issueManualInvoice`, `voidManualInvoice` (Tasks 2-3); `IssueManualInvoiceDto`, `VoidManualInvoiceDto`, `ManualInvoiceResponseDto`.
- Produces: `POST /shipments/:shipmentId/invoices/manual` (201) and `POST /invoices/:invoiceId/void-manual` (200).

- [ ] **Step 1: Write the failing controller spec**

Create `shipment-invoice.controller.spec.ts`:

```ts
import { ShipmentInvoiceController } from './shipment-invoice.controller';

describe('ShipmentInvoiceController manual routes', () => {
  function make() {
    const invoices = {
      issueManualInvoice: jest.fn().mockResolvedValue({ invoiceId: 'inv-1', status: 'issued' }),
      voidManualInvoice: jest.fn().mockResolvedValue({ invoiceId: 'inv-1', status: 'voided' }),
    };
    const controller = new ShipmentInvoiceController(invoices as never);
    return { controller, invoices };
  }

  it('delegates manual issue with the resolved actor and idempotency key', async () => {
    const { controller, invoices } = make();
    const dto = { expectedManifestVersion: 1, carrierCode: 'HANJIN', trackingNo: 'H1' } as never;
    const result = await controller.issueManual('ship-1', dto, 'key-1', { userId: 'u-1', roles: ['master'] });
    expect(result).toMatchObject({ invoiceId: 'inv-1', status: 'issued' });
    expect(invoices.issueManualInvoice).toHaveBeenCalledWith('ship-1', dto, 'key-1', { id: 'u-1', roles: ['master'] });
  });

  it('defaults a missing idempotency key to empty string on void', async () => {
    const { controller, invoices } = make();
    await controller.voidManual('inv-1', {} as never, undefined, { userId: 'u-1', roles: [] });
    expect(invoices.voidManualInvoice).toHaveBeenCalledWith('inv-1', {}, '', { id: 'u-1', roles: [] });
  });

  it('rejects an unauthenticated actor', () => {
    const { controller } = make();
    expect(() => controller.issueManual('ship-1', {} as never, 'key-1', {})).toThrow();
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `npx jest --testPathPattern=shipment-invoice.controller.spec`
Expected: FAIL — `controller.issueManual` / `controller.voidManual` do not exist.

- [ ] **Step 3: Add the routes**

In `shipment-invoice.controller.ts`, extend the swagger import and DTO import, then add two handlers.

Update imports:

```ts
import { ApiAcceptedResponse, ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import {
  InvoiceOperationResponseDto,
  IssueManualInvoiceDto,
  IssueShipmentInvoiceDto,
  ManualInvoiceResponseDto,
  ShipmentInvoiceActor,
  VoidManualInvoiceDto,
  VoidShipmentInvoiceDto,
} from '../dto/shipment-invoice.dto';
```

Add these handlers inside the controller class (after the existing `issue`/`void`/`operation` methods):

```ts
  @Post('shipments/:shipmentId/invoices/manual')
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiCreatedResponse({ type: ManualInvoiceResponseDto })
  issueManual(
    @Param('shipmentId') shipmentId: string,
    @Body() dto: IssueManualInvoiceDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.invoices.issueManualInvoice(shipmentId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @Post('invoices/:invoiceId/void-manual')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(FULFILLMENT_SCOPE.SHIPMENT_REOPEN)
  @ApiOkResponse({ type: ManualInvoiceResponseDto })
  voidManual(
    @Param('invoiceId') invoiceId: string,
    @Body() dto: VoidManualInvoiceDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.invoices.voidManualInvoice(invoiceId, dto, idempotencyKey ?? '', this.actor(user));
  }
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `npx jest --testPathPattern=shipment-invoice.controller.spec`
Expected: PASS. Also `npx nest build core` clean.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/fulfillment/controllers/shipment-invoice.controller.ts \
        apps/core/src/modules/fulfillment/controllers/shipment-invoice.controller.spec.ts
git commit -m "$(cat <<'EOF'
feat(fulfillment): expose manual invoice issue/void endpoints

POST /shipments/:id/invoices/manual (201, WAREHOUSE_OPERATE) and
POST /invoices/:id/void-manual (200, SHIPMENT_REOPEN), delegating to the
synchronous orchestrator methods with the resolved actor + idempotency key.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Full-path verification

No new code — prove the feature end-to-end and the suite is green.

- [ ] **Step 1: Type-check / build**

Run: `npx nest build core`
Expected: clean (no type errors).

- [ ] **Step 2: Run all touched specs**

Run the unit/controller specs (no DB): `npx jest --testPathPattern="invoice-orchestrator.service.spec|shipment-invoice.controller.spec"`
Then the integration spec (runner): `npm run test:core:integration:local -- invoice-orchestrator.integration`
Expected: both PASS.

- [ ] **Step 3: Lint the changed files only**

Run: `npx eslint apps/core/src/modules/fulfillment/dto/shipment-invoice.dto.ts apps/core/src/modules/fulfillment/services/invoice-orchestrator.service.ts apps/core/src/modules/fulfillment/controllers/shipment-invoice.controller.ts`
Expected: no **new** errors on these files (repo-wide lint debt is pre-existing; scope to changed files).

- [ ] **Step 4: Confirm scope of change**

Run: `git diff --stat develop...HEAD`
Expected: the two docs (spec + plan) plus exactly these code files — `dto/shipment-invoice.dto.ts`, `services/invoice-orchestrator.service.ts`, `controllers/shipment-invoice.controller.ts`, `services/invoice-orchestrator.service.spec.ts`, `services/invoice-orchestrator.integration.spec.ts`, `controllers/shipment-invoice.controller.spec.ts`. No schema/migration files, no unrelated changes.
