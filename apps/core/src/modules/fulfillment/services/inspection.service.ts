import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { DbService } from '@app/db';
import { and, eq, inArray } from 'drizzle-orm';

export interface InspectionSession {
  id: string;
  fulfillmentOrderId: string;
  type: 'individual' | 'batch';
  status: 'active' | 'completed' | 'paused';
  inspectorUserId: string;
  totalItems: number;
  inspectedItems: number;
  completedItems: number;
  issues: number;
  startedAt: Date;
  completedAt?: Date;
  items: InspectionItem[];
}

export interface InspectionItem {
  foiId: string;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  skuId: string;
  skuName: string;
  requiredQty: number;
  pickedQty: number;
  inspectedQty: number;
  approvedQty: number;
  rejectedQty: number;
  status: 'pending' | 'inspecting' | 'approved' | 'rejected' | 'partial';
  issues: InspectionIssue[];
  lastInspectedAt?: Date;
}

export interface InspectionIssue {
  id: string;
  foiId: string;
  type: 'quantity_mismatch' | 'quality_issue' | 'damage' | 'wrong_item' | 'other';
  severity: 'minor' | 'major' | 'critical';
  description: string;
  qty?: number;
  inspectorUserId: string;
  reportedAt: Date;
  resolvedAt?: Date;
  resolution?: string;
  photos?: string[];
}

export interface ForceShipmentRequest {
  foiId: string;
  reason: string;
  authorizedBy: string;
  forceQty: number;
  note?: string;
}

@Injectable()
export class InspectionService {
  private readonly logger = new Logger(InspectionService.name);

  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async startInspectionSession(
    request: {
      fulfillmentOrderId: string;
      type: 'individual' | 'batch';
      inspectorUserId: string;
    },
    tx?: DbTx,
  ): Promise<InspectionSession> {
    const { fulfillmentOrderId, type, inspectorUserId } = request;

    return this.inTx(async (trx) => {
      const foRows = await trx
        .select({
          id: wmsTables.fulfillmentOrders.id,
          status: wmsTables.fulfillmentOrders.status,
        })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);

      const fo = foRows[0];
      if (!fo) {
        throw new NotFoundException(`Fulfillment order ${fulfillmentOrderId} not found`);
      }

      if (fo.status !== 'picked') {
        throw new ConflictException(`Cannot start inspection for FO in status: ${fo.status}`);
      }

      const itemRows = await trx
        .select({
          id: wmsTables.fulfillmentOrderItems.id,
          salesOrderId: wmsTables.fulfillmentOrderItems.salesOrderId,
          salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
          skuId: wmsTables.fulfillmentOrderItems.skuId,
          skuName: wmsTables.skus.name,
          qty: wmsTables.fulfillmentOrderItems.qty,
          pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));

      const items: InspectionItem[] = itemRows.map((row) => ({
        foiId: row.id,
        salesOrderId: row.salesOrderId,
        salesOrderLineId: row.salesOrderLineId,
        skuId: row.skuId,
        skuName: row.skuName ?? '',
        requiredQty: row.qty,
        pickedQty: row.pickedQty,
        inspectedQty: 0,
        approvedQty: 0,
        rejectedQty: 0,
        status: 'pending',
        issues: [],
        lastInspectedAt: undefined,
      }));

      const sessionId = `INS-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const session: InspectionSession = {
        id: sessionId,
        fulfillmentOrderId,
        type,
        status: 'active',
        inspectorUserId,
        totalItems: items.length,
        inspectedItems: 0,
        completedItems: 0,
        issues: 0,
        startedAt: new Date(),
        items,
      };

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({
          status: 'inspecting',
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

      this.logger.log(`Started ${type} inspection session ${sessionId} for FO ${fulfillmentOrderId}`);
      return session;
    }, tx);
  }

  async inspectItem(
    request: {
      sessionId: string;
      foiId: string;
      inspectedQty: number;
      approvedQty: number;
      rejectedQty?: number;
      issues?: Array<{
        type: InspectionIssue['type'];
        severity: InspectionIssue['severity'];
        description: string;
        qty?: number;
        photos?: string[];
      }>;
      inspectorUserId: string;
    },
    tx?: DbTx,
  ): Promise<InspectionItem> {
    const { foiId, inspectedQty, approvedQty, rejectedQty = 0, issues = [], inspectorUserId } = request;

    if (inspectedQty !== approvedQty + rejectedQty) {
      throw new BadRequestException('Inspected quantity must equal approved + rejected quantities');
    }

    return this.inTx(async (trx) => {
      const rows = await trx
        .select({
          id: wmsTables.fulfillmentOrderItems.id,
          salesOrderId: wmsTables.fulfillmentOrderItems.salesOrderId,
          salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
          skuId: wmsTables.fulfillmentOrderItems.skuId,
          skuName: wmsTables.skus.name,
          qty: wmsTables.fulfillmentOrderItems.qty,
          pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
          foStatus: wmsTables.fulfillmentOrders.status,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
        )
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
        .where(eq(wmsTables.fulfillmentOrderItems.id, foiId))
        .limit(1);

      const foi = rows[0];
      if (!foi) {
        throw new NotFoundException(`Fulfillment order item ${foiId} not found`);
      }

      if (foi.foStatus !== 'inspecting') {
        throw new ConflictException(`Cannot inspect item for FO in status: ${foi.foStatus}`);
      }

      if (inspectedQty > foi.pickedQty) {
        throw new BadRequestException(`Cannot inspect more than picked quantity: ${foi.pickedQty}`);
      }

      let status: InspectionItem['status'];
      if (rejectedQty > 0) {
        status = approvedQty > 0 ? 'partial' : 'rejected';
      } else {
        status = 'approved';
      }

      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrderItems.id, foiId));

      const inspectionIssues: InspectionIssue[] = issues.map((issue) => ({
        id: `ISS-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        foiId,
        type: issue.type,
        severity: issue.severity,
        description: issue.description,
        qty: issue.qty,
        inspectorUserId,
        reportedAt: new Date(),
        photos: issue.photos,
      }));

      this.logger.log(
        `Inspected FOI ${foiId}: ${approvedQty} approved, ${rejectedQty} rejected, ${inspectionIssues.length} issues`,
      );

      return {
        foiId,
        salesOrderId: foi.salesOrderId,
        salesOrderLineId: foi.salesOrderLineId,
        skuId: foi.skuId,
        skuName: foi.skuName ?? '',
        requiredQty: foi.qty,
        pickedQty: foi.pickedQty,
        inspectedQty,
        approvedQty,
        rejectedQty,
        status,
        issues: inspectionIssues,
        lastInspectedAt: new Date(),
      };
    }, tx);
  }

  async completeInspectionSession(sessionId: string, inspectorUserId: string, tx?: DbTx): Promise<void> {
    this.logger.log(`Completed inspection session ${sessionId} by ${inspectorUserId}`);
  }

  async forceShipment(request: ForceShipmentRequest, tx?: DbTx): Promise<void> {
    const { foiId, reason, authorizedBy, forceQty, note } = request;

    return this.inTx(async (trx) => {
      const rows = await trx
        .select({
          qty: wmsTables.fulfillmentOrderItems.qty,
          foStatus: wmsTables.fulfillmentOrders.status,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
        )
        .where(eq(wmsTables.fulfillmentOrderItems.id, foiId))
        .limit(1);

      const foi = rows[0];
      if (!foi) {
        throw new NotFoundException(`Fulfillment order item ${foiId} not found`);
      }

      if (foi.foStatus !== 'inspecting') {
        throw new ConflictException(`Cannot force shipment for FO in status: ${foi.foStatus}`);
      }

      if (forceQty > foi.qty) {
        throw new BadRequestException(`Force quantity ${forceQty} exceeds required quantity ${foi.qty}`);
      }

      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({
          shippedQty: forceQty,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.fulfillmentOrderItems.id, foiId));

      this.logger.warn(
        `FORCED SHIPMENT: FOI ${foiId} - Qty: ${forceQty}, Reason: ${reason}, Authorized by: ${authorizedBy}` +
          (note ? `, Note: ${note}` : ''),
      );
    }, tx);
  }

  async resetInspection(foiId: string, inspectorUserId: string, tx?: DbTx): Promise<void> {
    return this.inTx(async (trx) => {
      const rows = await trx
        .select({ foStatus: wmsTables.fulfillmentOrders.status })
        .from(wmsTables.fulfillmentOrderItems)
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
        )
        .where(eq(wmsTables.fulfillmentOrderItems.id, foiId))
        .limit(1);

      const foi = rows[0];
      if (!foi) {
        throw new NotFoundException(`Fulfillment order item ${foiId} not found`);
      }

      if (foi.foStatus !== 'inspecting') {
        throw new ConflictException(`Cannot reset inspection for FO in status: ${foi.foStatus}`);
      }

      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrderItems.id, foiId));

      this.logger.log(`Reset inspection for FOI ${foiId} by ${inspectorUserId}`);
    }, tx);
  }

  async getInspectionHistory(
    foiId: string,
    tx?: DbTx,
  ): Promise<
    Array<{
      inspectorUserId: string;
      inspectedQty: number;
      approvedQty: number;
      rejectedQty: number;
      issues: number;
      timestamp: Date;
    }>
  > {
    return [];
  }

  async getQualityMetrics(
    filters?: {
      warehouseId?: string;
      dateFrom?: Date;
      dateTo?: Date;
      inspectorUserId?: string;
    },
    tx?: DbTx,
  ): Promise<{
    totalInspections: number;
    approvalRate: number;
    rejectionRate: number;
    avgInspectionTime: number;
    commonIssues: Array<{ type: string; count: number; percentage: number }>;
    inspectorPerformance: Array<{
      inspectorUserId: string;
      inspections: number;
      approvalRate: number;
      avgTime: number;
    }>;
  }> {
    return {
      totalInspections: 0,
      approvalRate: 0,
      rejectionRate: 0,
      avgInspectionTime: 0,
      commonIssues: [],
      inspectorPerformance: [],
    };
  }

  async bulkApprove(foiIds: string[], inspectorUserId: string, tx?: DbTx): Promise<number> {
    return this.inTx(async (trx) => {
      const rows = await trx
        .select({
          id: wmsTables.fulfillmentOrderItems.id,
          pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
          foStatus: wmsTables.fulfillmentOrders.status,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
        )
        .where(inArray(wmsTables.fulfillmentOrderItems.id, foiIds));

      const validFois = rows.filter((r) => r.foStatus === 'inspecting' && r.pickedQty > 0);

      if (validFois.length === 0) {
        throw new BadRequestException('No valid items found for bulk approval');
      }

      for (const foi of validFois) {
        await trx
          .update(wmsTables.fulfillmentOrderItems)
          .set({
            shippedQty: foi.pickedQty,
            updatedAt: new Date(),
          })
          .where(eq(wmsTables.fulfillmentOrderItems.id, foi.id));
      }

      this.logger.log(`Bulk approved ${validFois.length} items by ${inspectorUserId}`);
      return validFois.length;
    }, tx);
  }

  async getInspectionSummary(
    fulfillmentOrderId: string,
    tx?: DbTx,
  ): Promise<{
    totalItems: number;
    pendingItems: number;
    inspectedItems: number;
    approvedItems: number;
    rejectedItems: number;
    partialItems: number;
    totalIssues: number;
    canComplete: boolean;
  }> {
    return this.inTx(async (trx) => {
      const foRows = await trx
        .select({ id: wmsTables.fulfillmentOrders.id })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);

      const fo = foRows[0];
      if (!fo) {
        throw new NotFoundException(`Fulfillment order ${fulfillmentOrderId} not found`);
      }

      const itemRows = await trx
        .select({ shippedQty: wmsTables.fulfillmentOrderItems.shippedQty })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));

      const totalItems = itemRows.length;
      const approvedItems = itemRows.filter((r) => (r.shippedQty ?? 0) > 0).length;
      const pendingItems = totalItems - approvedItems;

      return {
        totalItems,
        pendingItems,
        inspectedItems: approvedItems,
        approvedItems,
        rejectedItems: 0,
        partialItems: 0,
        totalIssues: 0,
        canComplete: pendingItems === 0,
      };
    }, tx);
  }
}
