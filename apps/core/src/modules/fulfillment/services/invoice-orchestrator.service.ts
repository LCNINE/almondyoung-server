import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  InvoiceOperationResponseDto,
  IssueManualInvoiceDto,
  IssueShipmentInvoiceDto,
  ManualInvoiceResponseDto,
  ShipmentInvoiceActor,
  VoidManualInvoiceDto,
  VoidShipmentInvoiceDto,
} from '../dto/shipment-invoice.dto';
import { carrierEnum, DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import {
  DeliveryProvider,
  DeliveryProviderError,
  DeliveryResponse,
  ProviderOperationContext,
} from './delivery-provider.interface';
import { GoodsflowDeliveryProvider } from './goodsflow-delivery.provider';
import { HanjinDeliveryProvider } from './hanjin-delivery.provider';
import { FulfillmentCommandService, canonicalFulfillmentRequestHash } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentPlanningService } from './shipment-planning.service';
import { ConsolidationService } from './consolidation.service';
import { ShipmentShortPickService } from './shipment-short-pick.service';
import { ShipmentRecallService } from './shipment-recall.service';

const ACTIVE_INVOICE_STATUSES = ['issued', 'used', 'issuing', 'voiding', 'recovery_required'] as const;
const TRUSTED_CHANNELS = new Set(['medusa', 'naver', 'coupang']);
const MAX_ATTEMPTS = 8;
const LEASE_MS = 60_000;
const BASE_RETRY_MS = 5_000;
const MAX_RETRY_MS = 15 * 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ProviderName = 'goodsflow' | 'hanjin';
type InvoiceOperationRow = typeof wmsTables.invoiceOperations.$inferSelect;

type ManifestLine = {
  shipmentLineId: string;
  fulfillmentOrderId: string;
  fulfillmentOrderItemId: string;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  salesChannel: string | null;
  channelOrderId: string | null;
  channelOrderItemId: string | null;
  channelProductId: string | null;
  skuId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineVersion: number;
};

type LockedManifest = {
  shipment: typeof wmsTables.shipments.$inferSelect;
  profile: typeof wmsTables.deliveryProfiles.$inferSelect;
  lines: ManifestLine[];
  fulfillmentOrderIds: string[];
};

type StoredCommandContext = {
  actorId: string;
  reason: string;
  csCaseId: string | null;
  note: string | null;
};

type StoredIssueRequest = {
  kind: 'issue';
  provider: ProviderName;
  carrierCode: string;
  operationContext: ProviderOperationContext;
  commandContext: StoredCommandContext;
  shipment: {
    id: string;
    warehouseId: string;
    manifestVersion: number;
    shippingProfileId: string;
    recipientSnapshot: unknown;
  };
  profile: Record<string, unknown>;
  lines: ManifestLine[];
  deliveryRequest: {
    centerCode: string;
    recipientName: string;
    recipientAddress: string;
    recipientPhone: string;
    carrierCode: string;
    senderName?: string;
    senderPhone?: string;
    deliveryMessage?: string;
    items: Array<{ productName: string; quantity: number; price: number }>;
  };
};

type StoredVoidRequest = {
  kind: 'void';
  provider: ProviderName;
  operationContext: ProviderOperationContext;
  commandContext: StoredCommandContext;
  invoiceId: string;
  shipmentId: string;
  externalServiceId: string | null;
  trackingNo: string;
};

type StoredProviderRequest = StoredIssueRequest | StoredVoidRequest;

class StaleInvoiceOperationLeaseError extends Error {}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000);
}

export function canonicalShipmentRecipientHash(recipientSnapshot: unknown): string {
  return canonicalFulfillmentRequestHash(recipientSnapshot);
}

@Injectable()
export class InvoiceOrchestrator {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly commands: FulfillmentCommandService,
    private readonly invariant: FulfillmentInvariantService,
    private readonly audit: AuditService,
    private readonly goodsflow: GoodsflowDeliveryProvider,
    private readonly hanjin: HanjinDeliveryProvider,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly moduleRef: ModuleRef,
  ) {}

  async issueForShipment(
    shipmentId: string,
    dto: IssueShipmentInvoiceDto,
    idempotencyKey: string,
    actor: ShipmentInvoiceActor,
    tx?: DbTx,
  ): Promise<InvoiceOperationResponseDto> {
    this.workflowGate.assertV2MutationAllowed('shipment.invoice.issue');
    this.assertReason(dto.reason);
    this.assertCarrier(dto.provider, dto.carrierCode);
    const accepted = await this.commands.execute<{ operationId: string }>(
      {
        commandType: 'shipment.invoice.issue',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, shipmentId, ...dto },
      },
      async (trx, _commandRequestId, requestHash) => {
        const manifest = await this.lockManifest(shipmentId, trx);
        if (manifest.shipment.status !== 'planned') {
          throw this.conflict('SHIPMENT_NOT_PLANNED', 'Only a Planned shipment can receive an invoice');
        }
        if (manifest.shipment.manifestVersion !== dto.expectedManifestVersion) {
          throw this.conflict('SHIPMENT_STALE_MANIFEST_VERSION', 'Shipment manifest has changed');
        }
        await this.assertNoActiveInvoice(shipmentId, trx);
        this.assertRecipientComplete(manifest.shipment.recipientSnapshot);
        this.assertProfileComplete(manifest.profile);
        this.assertTrustedLineIdentity(manifest.lines);

        const operationId = randomUUID();
        const invoiceId = randomUUID();
        const recipientHash = canonicalShipmentRecipientHash(manifest.shipment.recipientSnapshot);
        const operationContext = { operationId, idempotencyKey: operationId };
        const providerRequest = this.buildIssueRequest(manifest, dto, actor, operationContext);
        const compatibilityFoId = manifest.fulfillmentOrderIds[0];
        await trx.insert(wmsTables.invoices).values({
          id: invoiceId,
          trackingNo: `pending:${operationId}`,
          carrier: dto.provider === 'hanjin' ? 'HANJIN' : (dto.carrierCode as never),
          issueMethod: dto.provider,
          issuedForFulfillmentOrderId: compatibilityFoId,
          shipmentId,
          manifestVersion: manifest.shipment.manifestVersion,
          recipientHash,
          status: 'issuing',
        });
        await trx.insert(wmsTables.invoiceOperations).values({
          id: operationId,
          shipmentId,
          invoiceId,
          operation: 'issue',
          idempotencyKey,
          requestHash: canonicalFulfillmentRequestHash(providerRequest),
          manifestVersion: manifest.shipment.manifestVersion,
          recipientHash,
          providerRequest,
          status: 'pending',
        });
        await this.audit.logUserActionRequired(
          'shipment.invoice.issue.requested',
          'fulfillment',
          `Invoice issue operation ${operationId} requested`,
          { userId: actor.id },
          {
            operationId,
            invoiceId,
            shipmentId,
            reason: dto.reason,
            provider: dto.provider,
            manifestVersion: manifest.shipment.manifestVersion,
            recipientHash,
            commandRequestHash: requestHash,
          },
          trx,
        );
        return {
          response: { operationId },
          resourceType: 'invoice_operation',
          resourceId: operationId,
          operationId,
        };
      },
      tx,
    );
    return this.getOperation(accepted.operationId, tx);
  }

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
          // drizzle-orm wraps the driver error in DrizzleQueryError and puts the real
          // postgres.js PostgresError (code, constraint_name) on `.cause`; check both shapes.
          const row = error as {
            code?: string;
            constraint_name?: string;
            constraint?: string;
            cause?: { code?: string; constraint_name?: string; constraint?: string };
          };
          const code = row.code ?? row.cause?.code;
          const constraintName =
            row.constraint_name ?? row.constraint ?? row.cause?.constraint_name ?? row.cause?.constraint;
          if (code === '23505' && constraintName === 'invoices_tracking_no_unique') {
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
          {
            invoiceId: invoice.id,
            shipmentId,
            carrier: dto.carrierCode,
            trackingNo,
            reason: dto.reason ?? null,
            note: dto.note ?? null,
          },
          trx,
        );
        return { response, resourceType: 'invoice', resourceId: invoice.id };
      },
      tx,
    );
  }

  async void(
    invoiceId: string,
    dto: VoidShipmentInvoiceDto,
    idempotencyKey: string,
    actor: ShipmentInvoiceActor,
    tx?: DbTx,
  ): Promise<InvoiceOperationResponseDto> {
    this.workflowGate.assertV2MutationAllowed('shipment.invoice.void');
    this.assertReason(dto.reason);
    const accepted = await this.commands.execute<{ operationId: string }>(
      {
        commandType: 'shipment.invoice.void',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, invoiceId, ...dto },
      },
      async (trx) => {
        const [optimistic] = await trx
          .select({ shipmentId: wmsTables.invoices.shipmentId })
          .from(wmsTables.invoices)
          .where(eq(wmsTables.invoices.id, invoiceId))
          .limit(1);
        if (!optimistic?.shipmentId) throw new NotFoundException(`Shipment-owned invoice ${invoiceId} not found`);
        if (dto.resumeOperationId) {
          await this.lockRecoveryResumeOwnerIfApplicable(dto.resumeOperationId, optimistic.shipmentId, trx);
        }
        const manifest = await this.lockManifest(optimistic.shipmentId, trx, [invoiceId]);
        const [invoice] = await trx
          .select()
          .from(wmsTables.invoices)
          .where(eq(wmsTables.invoices.id, invoiceId))
          .limit(1)
          .for('update');
        if (!invoice || invoice.shipmentId !== manifest.shipment.id) {
          throw new NotFoundException(`Invoice ${invoiceId} not found on shipment ${manifest.shipment.id}`);
        }
        if (invoice.status === 'voided') throw this.conflict('INVOICE_ALREADY_VOIDED', 'Invoice is already voided');
        const durableRecoveryInvoice =
          invoice.status === 'recovery_required' &&
          !!invoice.externalServiceId &&
          !invoice.trackingNo.startsWith('pending:') &&
          (await this.hasRecoverableStaleIssue(invoice.id, invoice.externalServiceId, invoice.trackingNo, trx));
        if ((!['issued', 'used'].includes(invoice.status) && !durableRecoveryInvoice) || !invoice.externalServiceId) {
          throw this.conflict(
            'INVOICE_NOT_READY_TO_VOID',
            'Only a finalized provider invoice with a known service ID can enter void',
          );
        }
        if (invoice.issueMethod !== 'goodsflow' && invoice.issueMethod !== 'hanjin') {
          throw new BadRequestException(
            'Manually-issued (self) invoices must be voided through POST /invoices/:id/void-manual',
          );
        }
        const resumeType = dto.resumeOperationId
          ? await this.assertResumeOperation(dto.resumeOperationId, manifest.shipment.id, trx)
          : null;
        if (invoice.status === 'used' || ['shipped', 'in_transit', 'delivered'].includes(manifest.shipment.status)) {
          if (resumeType !== 'recall') {
            throw this.conflict(
              'INVOICE_RECALL_OPERATION_REQUIRED',
              'A dispatched or used invoice can only be voided by its exact recall operation',
            );
          }
        }

        const operationId = randomUUID();
        const operationContext = { operationId, idempotencyKey: operationId };
        const providerRequest: StoredVoidRequest = {
          kind: 'void',
          provider: invoice.issueMethod,
          operationContext,
          commandContext: this.commandContext(actor, dto),
          invoiceId,
          shipmentId: manifest.shipment.id,
          externalServiceId: invoice.externalServiceId,
          trackingNo: invoice.trackingNo,
        };
        await trx.insert(wmsTables.invoiceOperations).values({
          id: operationId,
          shipmentId: manifest.shipment.id,
          invoiceId,
          resumeOperationId: dto.resumeOperationId ?? null,
          operation: 'void',
          idempotencyKey,
          requestHash: canonicalFulfillmentRequestHash(providerRequest),
          manifestVersion: invoice.manifestVersion ?? manifest.shipment.manifestVersion,
          recipientHash: invoice.recipientHash ?? canonicalShipmentRecipientHash(manifest.shipment.recipientSnapshot),
          providerRequest,
          status: 'pending',
        });
        await trx.update(wmsTables.invoices).set({ status: 'voiding' }).where(eq(wmsTables.invoices.id, invoiceId));
        await this.audit.logUserActionRequired(
          'shipment.invoice.void.requested',
          'fulfillment',
          `Invoice void operation ${operationId} requested`,
          { userId: actor.id },
          {
            operationId,
            invoiceId,
            shipmentId: manifest.shipment.id,
            resumeOperationId: dto.resumeOperationId ?? null,
            reason: dto.reason,
          },
          trx,
        );
        return {
          response: { operationId },
          resourceType: 'invoice_operation',
          resourceId: operationId,
          operationId,
        };
      },
      tx,
    );
    return this.getOperation(accepted.operationId, tx);
  }

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
          throw this.conflict(
            'INVOICE_NOT_VOIDABLE',
            `Invoice ${invoiceId} is ${invoice.status} and cannot be manually voided`,
          );
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
          { invoiceId, shipmentId: invoice.shipmentId, reason: dto.reason ?? null, note: dto.note ?? null },
          trx,
        );
        return { response, resourceType: 'invoice', resourceId: invoiceId };
      },
      tx,
    );
  }

  async getOperation(operationId: string, tx?: DbTx): Promise<InvoiceOperationResponseDto> {
    return this.dbService.run(async (trx) => {
      const [operation] = await trx
        .select()
        .from(wmsTables.invoiceOperations)
        .where(eq(wmsTables.invoiceOperations.id, operationId))
        .limit(1);
      if (!operation) throw new NotFoundException(`Invoice operation ${operationId} not found`);
      return this.operationResponse(operation);
    }, tx);
  }

  async leaseDueOperations(limit = 20): Promise<string[]> {
    if (!this.workflowGate.shouldRunInvoiceRecovery()) return [];
    return this.dbService.run(async (tx) => {
      const rows = await tx.execute<{ id: string }>(sql`
        SELECT id
          FROM invoice_operations
         WHERE (status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= NOW()))
            OR (status = 'recovery_required' AND next_retry_at IS NOT NULL AND next_retry_at <= NOW())
            OR (status = 'in_progress' AND next_retry_at IS NOT NULL AND next_retry_at <= NOW())
         ORDER BY created_at, id
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      `);
      const ids = (rows as unknown as Array<{ id: string }>).map((row) => row.id);
      if (!ids.length) return [];
      await tx
        .update(wmsTables.invoiceOperations)
        .set({
          status: 'in_progress',
          attempts: sql`${wmsTables.invoiceOperations.attempts} + 1`,
          nextRetryAt: new Date(Date.now() + LEASE_MS),
          updatedAt: new Date(),
        })
        .where(inArray(wmsTables.invoiceOperations.id, ids));
      return ids;
    });
  }

  async processOperation(operationId: string): Promise<InvoiceOperationResponseDto> {
    const claimed = await this.claimOperation(operationId);
    if (claimed) await this.processLeasedOperation(operationId);
    return this.getOperation(operationId);
  }

  async processLeasedOperation(operationId: string): Promise<void> {
    const operation = await this.loadLeasedOperation(operationId);
    if (!operation) return;
    const request = operation.providerRequest as StoredProviderRequest;
    const provider = this.provider(request.provider);
    try {
      if (operation.providerResponse) {
        await this.finalizeProviderSuccess(operation.id);
        return;
      }
      if (request.kind === 'issue') {
        const response = await this.executeIssue(operation, request, provider);
        await this.persistProviderResponse(operation.id, operation.attempts, response);
      } else {
        await this.executeVoid(operation, request, provider);
        await this.persistProviderResponse(operation.id, operation.attempts, {
          voided: true,
          serviceId: request.externalServiceId,
        });
      }
      await this.finalizeProviderSuccess(operation.id);
    } catch (error) {
      if (error instanceof StaleInvoiceOperationLeaseError) return;
      await this.recordFailure(operation, error);
    }
  }

  async assertDispatchableInvoice(shipmentId: string, tx?: DbTx) {
    return this.dbService.run(async (trx) => {
      const [shipment] = await trx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, shipmentId))
        .limit(1);
      if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} not found`);
      const invoices = await trx
        .select()
        .from(wmsTables.invoices)
        .where(
          and(
            eq(wmsTables.invoices.shipmentId, shipmentId),
            inArray(wmsTables.invoices.status, [...ACTIVE_INVOICE_STATUSES]),
          ),
        );
      if (invoices.length !== 1 || !['issued', 'used'].includes(invoices[0].status)) {
        throw this.conflict('SHIPMENT_INVOICE_NOT_READY', 'Shipment requires exactly one issued invoice');
      }
      const invoice = invoices[0];
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
      const recipientHash = canonicalShipmentRecipientHash(shipment.recipientSnapshot);
      if (invoice.manifestVersion !== shipment.manifestVersion || invoice.recipientHash !== recipientHash) {
        throw this.conflict('SHIPMENT_INVOICE_STALE', 'Invoice manifest or recipient does not match shipment');
      }
      return invoice;
    }, tx);
  }

  private async executeIssue(
    operation: InvoiceOperationRow,
    request: StoredIssueRequest,
    provider: DeliveryProvider,
  ): Promise<DeliveryResponse> {
    if (!provider.capabilities.issue.safeToRepeat && !provider.capabilities.issue.lookupByIdempotencyKey) {
      throw new DeliveryProviderError(
        'Provider does not expose a crash-safe issue idempotency or recovery contract',
        'unsupported',
      );
    }
    this.assertProviderCallFitsLease(provider);
    if (operation.attempts > 1) {
      if (provider.capabilities.issue.lookupByIdempotencyKey) {
        const queried = await provider.queryInvoice(
          { idempotencyKey: request.operationContext.idempotencyKey },
          request.operationContext,
        );
        if (queried.status === 'found') {
          return {
            serviceId: queried.serviceId,
            invoiceNumber: queried.invoiceNumber,
            carrierCode: request.carrierCode,
          };
        }
        return provider.issueInvoice(request.deliveryRequest, request.operationContext);
      }
      if (!provider.capabilities.issue.safeToRepeat) {
        throw new DeliveryProviderError(
          'Provider cannot safely recover an issue with an unknown outcome',
          'unsupported',
        );
      }
    }
    return provider.issueInvoice(request.deliveryRequest, request.operationContext);
  }

  private async executeVoid(
    operation: InvoiceOperationRow,
    request: StoredVoidRequest,
    provider: DeliveryProvider,
  ): Promise<void> {
    if (!request.externalServiceId) {
      throw new DeliveryProviderError('Provider service id is unavailable for void', 'unsupported');
    }
    this.assertProviderCallFitsLease(provider);
    if (operation.attempts > 1) {
      if (provider.capabilities.void.lookupByServiceId) {
        const queried = await provider.queryInvoice({ serviceId: request.externalServiceId }, request.operationContext);
        if (queried.status === 'found' && queried.tracking?.status === 'canceled') return;
        if (queried.status === 'found' && !provider.capabilities.void.safeToRepeat) {
          throw new DeliveryProviderError(
            'Provider label is still active and repeat void is not documented as safe',
            'unsupported',
          );
        }
        if (queried.status === 'not_found') {
          throw new DeliveryProviderError('Provider label cannot be found during void recovery', 'unknown_outcome');
        }
      } else if (!provider.capabilities.void.safeToRepeat) {
        throw new DeliveryProviderError('Provider cannot safely recover a void with an unknown outcome', 'unsupported');
      }
    }
    await provider.cancelInvoice(request.externalServiceId, request.operationContext);
  }

  private async persistProviderResponse(operationId: string, attempts: number, response: unknown): Promise<void> {
    await this.dbService.run(async (tx) => {
      const [operation] = await tx
        .select({ status: wmsTables.invoiceOperations.status })
        .from(wmsTables.invoiceOperations)
        .where(eq(wmsTables.invoiceOperations.id, operationId))
        .limit(1)
        .for('update');
      if (!operation || operation.status === 'succeeded') return;
      const updated = await tx
        .update(wmsTables.invoiceOperations)
        .set({ providerResponse: response as Record<string, unknown>, updatedAt: new Date() })
        .where(
          and(
            eq(wmsTables.invoiceOperations.id, operationId),
            eq(wmsTables.invoiceOperations.status, 'in_progress'),
            eq(wmsTables.invoiceOperations.attempts, attempts),
          ),
        )
        .returning({ id: wmsTables.invoiceOperations.id });
      if (!updated[0]) throw new StaleInvoiceOperationLeaseError(`Invoice operation ${operationId} lease changed`);
    });
  }

  private async finalizeProviderSuccess(operationId: string): Promise<void> {
    const optimistic = await this.dbService.run(async (tx) => {
      const [operation] = await tx
        .select()
        .from(wmsTables.invoiceOperations)
        .where(eq(wmsTables.invoiceOperations.id, operationId))
        .limit(1);
      return operation;
    });
    if (!optimistic || optimistic.status === 'succeeded') return;
    await this.dbService.run(async (tx) => {
      if (optimistic.resumeOperationId) {
        await this.lockRecoveryResumeOwnerIfApplicable(optimistic.resumeOperationId, optimistic.shipmentId, tx);
      }
      const manifest = await this.lockManifest(
        optimistic.shipmentId,
        tx,
        optimistic.invoiceId ? [optimistic.invoiceId] : [],
      );
      const [operation] = await tx
        .select()
        .from(wmsTables.invoiceOperations)
        .where(eq(wmsTables.invoiceOperations.id, operationId))
        .limit(1)
        .for('update');
      if (!operation || operation.status === 'succeeded') return;
      if (!operation.providerResponse || !operation.invoiceId) throw new Error('Provider response is not durable');
      const request = operation.providerRequest as StoredProviderRequest;
      const now = new Date();
      if (operation.operation === 'issue') {
        const response = operation.providerResponse as unknown as DeliveryResponse;
        if (!response.serviceId?.trim() || !response.invoiceNumber?.trim()) {
          throw new DeliveryProviderError('Provider returned an incomplete invoice', 'unknown_outcome');
        }
        const currentRecipientHash = canonicalShipmentRecipientHash(manifest.shipment.recipientSnapshot);
        const stale =
          operation.manifestVersion !== manifest.shipment.manifestVersion ||
          operation.recipientHash !== currentRecipientHash;
        await tx
          .update(wmsTables.invoices)
          .set({
            trackingNo: response.invoiceNumber,
            externalServiceId: response.serviceId,
            carrier: this.normalizedCarrier(response.carrierCode, request as StoredIssueRequest),
            status: stale ? 'recovery_required' : 'issued',
            issuedAt: now,
          })
          .where(eq(wmsTables.invoices.id, operation.invoiceId));
        if (stale) {
          await tx
            .update(wmsTables.invoiceOperations)
            .set({
              status: 'recovery_required',
              lastError: 'Shipment manifest or recipient changed while the provider issue was in flight',
              nextRetryAt: null,
              updatedAt: now,
            })
            .where(eq(wmsTables.invoiceOperations.id, operation.id));
          await this.auditOutcome(tx, request.commandContext, operation, 'recovery_required');
          return;
        }
      } else {
        await tx
          .update(wmsTables.invoices)
          .set({ status: 'voided', voidedAt: now })
          .where(eq(wmsTables.invoices.id, operation.invoiceId));
        if (operation.resumeOperationId) {
          await this.resumeWaitingOperation(operation.resumeOperationId, tx);
        }
      }
      await tx
        .update(wmsTables.invoiceOperations)
        .set({
          status: 'succeeded',
          lastError: null,
          nextRetryAt: null,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(wmsTables.invoiceOperations.id, operation.id));
      await this.auditOutcome(tx, request.commandContext, operation, 'succeeded');
      if (operation.operation === 'issue') {
        await this.invariant.assertFulfillmentOrders(manifest.fulfillmentOrderIds, tx);
      }
    });
  }

  private async recordFailure(operation: InvoiceOperationRow, error: unknown): Promise<void> {
    const normalized =
      error instanceof DeliveryProviderError
        ? error
        : new DeliveryProviderError(errorMessage(error), 'unknown_outcome', { cause: error });
    const provider = this.provider((operation.providerRequest as StoredProviderRequest).provider);
    await this.dbService.run(async (tx) => {
      const recoveryResume = operation.resumeOperationId
        ? await this.lockRecoveryResumeOwnerIfApplicable(operation.resumeOperationId, operation.shipmentId, tx)
        : null;
      if (operation.invoiceId) {
        await tx
          .select({ id: wmsTables.invoices.id })
          .from(wmsTables.invoices)
          .where(eq(wmsTables.invoices.id, operation.invoiceId))
          .limit(1)
          .for('update');
      }
      const [current] = await tx
        .select()
        .from(wmsTables.invoiceOperations)
        .where(eq(wmsTables.invoiceOperations.id, operation.id))
        .limit(1)
        .for('update');
      if (!current || current.status === 'succeeded') return;
      if (current.status !== 'in_progress' || current.attempts !== operation.attempts) return;
      const hasDurableProviderResponse = current.providerResponse !== null;
      const canRecoverExternalOutcome =
        current.operation === 'issue'
          ? provider.capabilities.issue.lookupByIdempotencyKey || provider.capabilities.issue.safeToRepeat
          : provider.capabilities.void.lookupByServiceId || provider.capabilities.void.safeToRepeat;
      const definitive = normalized.outcome === 'definitive_rejection' || normalized.outcome === 'not_found';
      const retryable =
        recoveryResume !== null ||
        (current.attempts < MAX_ATTEMPTS &&
          (hasDurableProviderResponse ||
            (!definitive && normalized.outcome !== 'unsupported' && canRecoverExternalOutcome)));
      const status =
        recoveryResume !== null
          ? 'recovery_required'
          : hasDurableProviderResponse
            ? 'recovery_required'
            : definitive || normalized.outcome === 'unsupported'
              ? 'failed'
              : 'recovery_required';
      const issueSideEffectImpossible =
        current.operation === 'issue' &&
        !hasDurableProviderResponse &&
        (definitive || normalized.outcome === 'unsupported');
      const nextRetryAt = retryable
        ? new Date(Date.now() + Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.max(0, current.attempts - 1)))
        : null;
      await tx
        .update(wmsTables.invoiceOperations)
        .set({ status, lastError: errorMessage(normalized), nextRetryAt, updatedAt: new Date() })
        .where(eq(wmsTables.invoiceOperations.id, operation.id));
      if (current.invoiceId) {
        await tx
          .update(wmsTables.invoices)
          .set({
            status: issueSideEffectImpossible ? 'voided' : 'recovery_required',
            ...(issueSideEffectImpossible ? { voidedAt: new Date() } : {}),
          })
          .where(eq(wmsTables.invoices.id, current.invoiceId));
      }
      await this.auditOutcome(
        tx,
        (current.providerRequest as StoredProviderRequest).commandContext,
        current,
        status,
        errorMessage(normalized),
      );
      if (recoveryResume === 'short_pick' && current.resumeOperationId) {
        await this.moduleRef
          .get(ShipmentShortPickService, { strict: false })
          .markInvoiceRecoveryRequired(current.resumeOperationId, normalized, tx);
      }
      if (recoveryResume === 'recall' && current.resumeOperationId) {
        await this.moduleRef
          .get(ShipmentRecallService, { strict: false })
          .markInvoiceRecoveryRequired(current.resumeOperationId, normalized, tx);
      }
    });
  }

  private async claimOperation(operationId: string): Promise<boolean> {
    return this.dbService.run(async (tx) => {
      const [operation] = await tx
        .select()
        .from(wmsTables.invoiceOperations)
        .where(eq(wmsTables.invoiceOperations.id, operationId))
        .limit(1)
        .for('update');
      if (!operation || ['succeeded', 'failed'].includes(operation.status)) return false;
      if (operation.status === 'in_progress' && operation.nextRetryAt && operation.nextRetryAt > new Date())
        return false;
      if (operation.status === 'recovery_required' && !operation.nextRetryAt) return false;
      await tx
        .update(wmsTables.invoiceOperations)
        .set({
          status: 'in_progress',
          attempts: operation.attempts + 1,
          nextRetryAt: new Date(Date.now() + LEASE_MS),
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.invoiceOperations.id, operationId));
      return true;
    });
  }

  private async loadLeasedOperation(operationId: string): Promise<InvoiceOperationRow | undefined> {
    return this.dbService.run(async (tx) => {
      const [operation] = await tx
        .select()
        .from(wmsTables.invoiceOperations)
        .where(
          and(eq(wmsTables.invoiceOperations.id, operationId), eq(wmsTables.invoiceOperations.status, 'in_progress')),
        )
        .limit(1);
      return operation;
    });
  }

  private async lockManifest(
    shipmentId: string,
    tx: DbTx,
    ignoredInvoiceIds: readonly string[] = [],
  ): Promise<LockedManifest> {
    const optimistic = await this.loadManifest(shipmentId, tx);
    await this.invariant.assertFulfillmentOrders(optimistic.fulfillmentOrderIds, tx, { ignoredInvoiceIds });
    await this.lockExecutionInputs(optimistic, tx);
    const locked = await this.loadManifest(shipmentId, tx);
    if (
      optimistic.lines.map((line) => `${line.shipmentLineId}:${line.lineVersion}`).join(',') !==
      locked.lines.map((line) => `${line.shipmentLineId}:${line.lineVersion}`).join(',')
    ) {
      throw this.conflict('SHIPMENT_COMPONENT_CHANGED_RETRY', 'Shipment manifest changed while acquiring locks');
    }
    return locked;
  }

  private async lockExecutionInputs(manifest: LockedManifest, tx: DbTx): Promise<void> {
    await tx
      .select({ id: wmsTables.deliveryProfiles.id })
      .from(wmsTables.deliveryProfiles)
      .where(eq(wmsTables.deliveryProfiles.id, manifest.profile.id))
      .limit(1)
      .for('update');

    const skuIds = uniqueSorted(manifest.lines.map((line) => line.skuId));
    if (skuIds.length) {
      await tx
        .select({ id: wmsTables.skus.id })
        .from(wmsTables.skus)
        .where(inArray(wmsTables.skus.id, skuIds))
        .orderBy(asc(wmsTables.skus.id))
        .for('update');
    }
    const salesOrderIds = uniqueSorted(
      manifest.lines.flatMap((line) =>
        line.salesOrderId && UUID_PATTERN.test(line.salesOrderId) ? [line.salesOrderId] : [],
      ),
    );
    if (salesOrderIds.length) {
      await tx
        .select({ id: wmsTables.salesOrders.id })
        .from(wmsTables.salesOrders)
        .where(inArray(wmsTables.salesOrders.id, salesOrderIds))
        .orderBy(asc(wmsTables.salesOrders.id))
        .for('update');
    }
    const salesOrderLineIds = uniqueSorted(
      manifest.lines.flatMap((line) =>
        line.salesOrderLineId && UUID_PATTERN.test(line.salesOrderLineId) ? [line.salesOrderLineId] : [],
      ),
    );
    if (salesOrderLineIds.length) {
      await tx
        .select({ id: wmsTables.salesOrderLines.id })
        .from(wmsTables.salesOrderLines)
        .where(inArray(wmsTables.salesOrderLines.id, salesOrderLineIds))
        .orderBy(asc(wmsTables.salesOrderLines.id))
        .for('update');
    }
  }

  private async loadManifest(shipmentId: string, tx: DbTx): Promise<LockedManifest> {
    const [shipment] = await tx
      .select()
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, shipmentId))
      .limit(1);
    if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} not found`);
    if (!shipment.shippingProfileId)
      throw this.conflict('SHIPMENT_PROFILE_REQUIRED', 'Shipment has no shipping profile');
    const [profile] = await tx
      .select()
      .from(wmsTables.deliveryProfiles)
      .where(eq(wmsTables.deliveryProfiles.id, shipment.shippingProfileId))
      .limit(1);
    if (!profile) throw new NotFoundException(`Shipping profile ${shipment.shippingProfileId} not found`);
    const rows = await tx
      .select({
        shipmentLineId: wmsTables.shipmentLines.id,
        fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
        fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId,
        salesOrderId: wmsTables.fulfillmentOrders.salesOrderId,
        salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
        salesChannel: wmsTables.salesOrders.salesChannel,
        channelOrderId: wmsTables.salesOrders.channelOrderId,
        channelOrderItemId: wmsTables.salesOrderLines.channelOrderItemId,
        channelProductId: wmsTables.salesOrderLines.channelProductId,
        skuId: wmsTables.shipmentLines.skuId,
        skuName: wmsTables.skus.name,
        productName: wmsTables.salesOrderLines.productName,
        quantity: wmsTables.shipmentLines.qty,
        unitPrice: wmsTables.salesOrderLines.unitPrice,
        lineVersion: wmsTables.shipmentLines.lineVersion,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
      .leftJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId))
      .leftJoin(
        wmsTables.salesOrderLines,
        sql`${wmsTables.salesOrderLines.id}::text = ${wmsTables.fulfillmentOrderItems.salesOrderLineId}`,
      )
      .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId))
      .orderBy(asc(wmsTables.shipmentLines.id));
    if (!rows.length) throw new NotFoundException(`Shipment ${shipmentId} has no lines`);
    const lines = rows.map((row) => ({
      shipmentLineId: row.shipmentLineId,
      fulfillmentOrderId: row.fulfillmentOrderId,
      fulfillmentOrderItemId: row.fulfillmentOrderItemId,
      salesOrderId: row.salesOrderId,
      salesOrderLineId: row.salesOrderLineId,
      salesChannel: row.salesChannel,
      channelOrderId: row.channelOrderId,
      channelOrderItemId: row.channelOrderItemId,
      channelProductId: row.channelProductId,
      skuId: row.skuId,
      productName: row.productName ?? row.skuName ?? '',
      quantity: row.quantity,
      unitPrice: row.unitPrice ?? 0,
      lineVersion: row.lineVersion,
    }));
    return {
      shipment,
      profile,
      lines,
      fulfillmentOrderIds: uniqueSorted(lines.map((line) => line.fulfillmentOrderId)),
    };
  }

  private buildIssueRequest(
    manifest: LockedManifest,
    dto: IssueShipmentInvoiceDto,
    actor: ShipmentInvoiceActor,
    operationContext: ProviderOperationContext,
  ): StoredIssueRequest {
    const recipient = manifest.shipment.recipientSnapshot as Record<string, string>;
    const sender = manifest.profile.senderSnapshot as Record<string, string>;
    return {
      kind: 'issue',
      provider: dto.provider,
      carrierCode: dto.provider === 'hanjin' ? 'HANJIN' : dto.carrierCode,
      operationContext,
      commandContext: this.commandContext(actor, dto),
      shipment: {
        id: manifest.shipment.id,
        warehouseId: manifest.shipment.warehouseId,
        manifestVersion: manifest.shipment.manifestVersion,
        shippingProfileId: manifest.shipment.shippingProfileId as string,
        recipientSnapshot: manifest.shipment.recipientSnapshot,
      },
      profile: {
        id: manifest.profile.id,
        sourceType: manifest.profile.sourceType,
        senderSnapshot: manifest.profile.senderSnapshot,
        originAddressSnapshot: manifest.profile.originAddressSnapshot,
        returnAddressSnapshot: manifest.profile.returnAddressSnapshot,
        carrierAccountRef: manifest.profile.carrierAccountRef,
        handlingFlags: manifest.profile.handlingFlags,
      },
      lines: manifest.lines,
      deliveryRequest: {
        centerCode: manifest.profile.carrierAccountRef ?? '',
        recipientName: recipient.recipientName,
        recipientAddress: [recipient.roadAddress, recipient.detailAddress].filter(Boolean).join(' '),
        recipientPhone: recipient.phone,
        carrierCode: dto.provider === 'hanjin' ? 'HANJIN' : dto.carrierCode,
        senderName: sender.name ?? sender.senderName,
        senderPhone: sender.phone ?? sender.senderPhone,
        deliveryMessage: recipient.deliveryNote,
        items: manifest.lines.map((line) => ({
          productName: line.productName,
          quantity: line.quantity,
          price: line.unitPrice,
        })),
      },
    };
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

  private commandContext(
    actor: ShipmentInvoiceActor,
    dto: { reason: string; csCaseId?: string; note?: string },
  ): StoredCommandContext {
    return {
      actorId: actor.id,
      reason: dto.reason,
      csCaseId: dto.csCaseId ?? null,
      note: dto.note ?? null,
    };
  }

  private async assertNoActiveInvoice(shipmentId: string, tx: DbTx): Promise<void> {
    const [invoice] = await tx
      .select({ id: wmsTables.invoices.id })
      .from(wmsTables.invoices)
      .where(
        and(
          eq(wmsTables.invoices.shipmentId, shipmentId),
          inArray(wmsTables.invoices.status, [...ACTIVE_INVOICE_STATUSES]),
        ),
      )
      .limit(1);
    if (invoice) throw this.conflict('SHIPMENT_ACTIVE_INVOICE', `Shipment already has active invoice ${invoice.id}`);
  }

  private async hasRecoverableStaleIssue(
    invoiceId: string,
    externalServiceId: string,
    trackingNo: string,
    tx: DbTx,
  ): Promise<boolean> {
    const rows = await tx
      .select({
        operation: wmsTables.invoiceOperations.operation,
        status: wmsTables.invoiceOperations.status,
        lastError: wmsTables.invoiceOperations.lastError,
        providerResponse: wmsTables.invoiceOperations.providerResponse,
      })
      .from(wmsTables.invoiceOperations)
      .where(eq(wmsTables.invoiceOperations.invoiceId, invoiceId))
      .orderBy(asc(wmsTables.invoiceOperations.createdAt));
    if (rows.some((row) => row.operation === 'void')) return false;
    return rows.some((row) => {
      const response = row.providerResponse as Partial<DeliveryResponse> | null;
      return (
        row.operation === 'issue' &&
        row.status === 'recovery_required' &&
        row.lastError === 'Shipment manifest or recipient changed while the provider issue was in flight' &&
        response?.serviceId === externalServiceId &&
        response.invoiceNumber === trackingNo
      );
    });
  }

  private async assertResumeOperation(
    operationId: string,
    shipmentId: string,
    tx: DbTx,
  ): Promise<(typeof wmsTables.shipmentOperations.type.enumValues)[number]> {
    const [row] = await tx
      .select({ type: wmsTables.shipmentOperations.type, status: wmsTables.shipmentOperations.status })
      .from(wmsTables.shipmentOperations)
      .innerJoin(
        wmsTables.shipmentOperationMembers,
        eq(wmsTables.shipmentOperationMembers.operationId, wmsTables.shipmentOperations.id),
      )
      .where(
        and(
          eq(wmsTables.shipmentOperations.id, operationId),
          eq(wmsTables.shipmentOperationMembers.shipmentId, shipmentId),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
        ),
      )
      .limit(1);
    if (!row || row.status !== 'pending') {
      throw this.conflict('INVOICE_RESUME_OPERATION_INVALID', 'Resume operation is not pending for this shipment');
    }
    if (!['cancel', 'consolidate', 'short_pick', 'recall'].includes(row.type)) {
      throw this.conflict(
        'INVOICE_RESUME_OPERATION_INVALID',
        `Invoice void resume handler for ${row.type} is not registered in this deployment`,
      );
    }
    return row.type;
  }

  /** Acquire recovery saga ownership before either saga takes its shipment graph locks. */
  private async lockRecoveryResumeOwnerIfApplicable(
    operationId: string,
    shipmentId: string,
    tx: DbTx,
  ): Promise<'short_pick' | 'recall' | null> {
    const [optimistic] = await tx
      .select({ type: wmsTables.shipmentOperations.type })
      .from(wmsTables.shipmentOperations)
      .where(eq(wmsTables.shipmentOperations.id, operationId))
      .limit(1);
    if (!optimistic || !['short_pick', 'recall'].includes(optimistic.type)) return null;

    const [operation] = await tx
      .select({ type: wmsTables.shipmentOperations.type })
      .from(wmsTables.shipmentOperations)
      .where(eq(wmsTables.shipmentOperations.id, operationId))
      .limit(1)
      .for('update');
    if (!operation || !['short_pick', 'recall'].includes(operation.type)) {
      throw this.conflict('INVOICE_RESUME_OPERATION_INVALID', 'Recovery resume operation changed while locking');
    }
    const [sourceMember] = await tx
      .select({ shipmentId: wmsTables.shipmentOperationMembers.shipmentId })
      .from(wmsTables.shipmentOperationMembers)
      .where(
        and(
          eq(wmsTables.shipmentOperationMembers.operationId, operationId),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
        ),
      )
      .limit(1)
      .for('update');
    if (!sourceMember || sourceMember.shipmentId !== shipmentId) {
      throw this.conflict('INVOICE_RESUME_OPERATION_INVALID', 'Recovery resume operation does not own this shipment');
    }
    return operation.type as 'short_pick' | 'recall';
  }

  private async resumeWaitingOperation(operationId: string, tx: DbTx): Promise<void> {
    const [operation] = await tx
      .select({ type: wmsTables.shipmentOperations.type, status: wmsTables.shipmentOperations.status })
      .from(wmsTables.shipmentOperations)
      .where(eq(wmsTables.shipmentOperations.id, operationId))
      .limit(1);
    if (!operation || operation.status === 'completed') return;
    if (operation.type === 'cancel') {
      await this.moduleRef.get(ShipmentPlanningService, { strict: false }).resumePendingCancellation(operationId, tx);
      return;
    }
    if (operation.type === 'consolidate') {
      await this.moduleRef.get(ConsolidationService, { strict: false }).resumePending(operationId, tx);
      return;
    }
    if (operation.type === 'short_pick') {
      await this.moduleRef.get(ShipmentShortPickService, { strict: false }).resumePending(operationId, tx);
      return;
    }
    if (operation.type === 'recall') {
      await this.moduleRef.get(ShipmentRecallService, { strict: false }).resumePending(operationId, tx);
      return;
    }
    throw new Error(`Unreachable invoice resume operation type ${operation.type}`);
  }

  private async auditOutcome(
    tx: DbTx,
    context: StoredCommandContext,
    operation: InvoiceOperationRow,
    status: string,
    error?: string,
  ): Promise<void> {
    await this.audit.logUserActionRequired(
      `shipment.invoice.${operation.operation}.${status}`,
      'fulfillment',
      `Invoice ${operation.operation} operation ${operation.id} ${status}`,
      { userId: context.actorId },
      {
        operationId: operation.id,
        invoiceId: operation.invoiceId,
        shipmentId: operation.shipmentId,
        resumeOperationId: operation.resumeOperationId,
        reason: context.reason,
        error: error ?? null,
      },
      tx,
    );
  }

  private provider(provider: ProviderName): DeliveryProvider {
    return provider === 'goodsflow' ? this.goodsflow : this.hanjin;
  }

  private operationResponse(operation: InvoiceOperationRow): InvoiceOperationResponseDto {
    return {
      operationId: operation.id,
      shipmentId: operation.shipmentId,
      invoiceId: operation.invoiceId,
      operation: operation.operation,
      status: operation.status,
      attempts: operation.attempts,
      resumeOperationId: operation.resumeOperationId,
      nextRetryAt: operation.nextRetryAt,
      lastError: operation.lastError,
    };
  }

  private assertTrustedLineIdentity(lines: ManifestLine[]): void {
    const invalid = lines.filter(
      (line) =>
        line.salesChannel &&
        TRUSTED_CHANNELS.has(line.salesChannel) &&
        (!line.channelOrderItemId || line.channelOrderItemId === line.channelProductId),
    );
    if (invalid.length) {
      throw this.conflict(
        'SHIPMENT_EXTERNAL_ITEM_IDENTITY_INVALID',
        `Trusted channel item identity is missing or fabricated for lines: ${invalid
          .map((line) => line.shipmentLineId)
          .join(',')}`,
      );
    }
  }

  private assertRecipientComplete(value: unknown): void {
    const recipient = (value ?? {}) as Record<string, unknown>;
    const missing = ['recipientName', 'phone', 'postalCode', 'roadAddress', 'detailAddress'].filter(
      (key) => typeof recipient[key] !== 'string' || !recipient[key].trim(),
    );
    if (missing.length) throw this.conflict('SHIPMENT_RECIPIENT_INCOMPLETE', `Missing: ${missing.join(',')}`);
  }

  private assertProfileComplete(profile: typeof wmsTables.deliveryProfiles.$inferSelect): void {
    const snapshots = [profile.senderSnapshot, profile.originAddressSnapshot, profile.returnAddressSnapshot];
    const sender = (profile.senderSnapshot ?? {}) as Record<string, unknown>;
    const senderName = sender.name ?? sender.senderName;
    const senderPhone = sender.phone ?? sender.senderPhone;
    if (
      snapshots.some(
        (snapshot) =>
          !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || Object.keys(snapshot).length === 0,
      ) ||
      typeof senderName !== 'string' ||
      !senderName.trim() ||
      typeof senderPhone !== 'string' ||
      !senderPhone.trim() ||
      !profile.carrierAccountRef?.trim()
    ) {
      throw this.conflict(
        'SHIPMENT_PROFILE_CONFIGURATION_INCOMPLETE',
        'Shipping profile execution snapshots and carrier account are required',
      );
    }
  }

  private assertCarrier(provider: ProviderName, carrierCode: string): void {
    if (provider === 'hanjin' && carrierCode !== 'HANJIN') {
      throw new BadRequestException('Hanjin invoice provider requires carrierCode=HANJIN');
    }
    if (!carrierEnum.enumValues.includes(carrierCode as never)) {
      throw new BadRequestException(`Unsupported carrierCode ${carrierCode}`);
    }
  }

  private normalizedCarrier(carrierCode: string, request: StoredIssueRequest): (typeof carrierEnum.enumValues)[number] {
    const providerCandidate = request.provider === 'hanjin' ? 'HANJIN' : carrierCode;
    if (carrierEnum.enumValues.includes(providerCandidate as never)) {
      return providerCandidate as (typeof carrierEnum.enumValues)[number];
    }
    if (carrierEnum.enumValues.includes(request.carrierCode as never)) {
      return request.carrierCode as (typeof carrierEnum.enumValues)[number];
    }
    throw new DeliveryProviderError('Provider and stored request returned an unsupported carrier', 'unknown_outcome');
  }

  private assertReason(reason: string): void {
    if (!reason?.trim()) throw new BadRequestException('reason is required');
  }

  private assertProviderCallFitsLease(provider: DeliveryProvider): void {
    if (
      !Number.isFinite(provider.maxRequestDurationMs) ||
      provider.maxRequestDurationMs <= 0 ||
      provider.maxRequestDurationMs >= LEASE_MS
    ) {
      throw new DeliveryProviderError(
        'Provider call timeout must be positive and shorter than the operation lease',
        'unsupported',
      );
    }
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
