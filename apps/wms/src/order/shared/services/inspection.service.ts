import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema } from '../../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import { and, eq, inArray, desc } from 'drizzle-orm';

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
  salesOrderId: string;
  salesOrderLineId: string;
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

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async startInspectionSession(request: {
    fulfillmentOrderId: string;
    type: 'individual' | 'batch';
    inspectorUserId: string;
  }): Promise<InspectionSession> {
    const { fulfillmentOrderId, type, inspectorUserId } = request;

    const fulfillmentOrder = await this.db.query.fulfillmentOrders.findFirst({
      where: eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId),
      with: {
        items: {
          with: {
            sku: true
          }
        }
      }
    });

    if (!fulfillmentOrder) {
      throw new NotFoundException(`Fulfillment order ${fulfillmentOrderId} not found`);
    }

    if (fulfillmentOrder.status !== 'picked') {
      throw new ConflictException(`Cannot start inspection for FO in status: ${fulfillmentOrder.status}`);
    }

    const sessionId = `INS-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const items: InspectionItem[] = fulfillmentOrder.items.map(item => ({
      foiId: item.id,
      salesOrderId: item.salesOrderId,
      salesOrderLineId: item.salesOrderLineId,
      skuId: item.skuId,
      skuName: item.sku.name,
      requiredQty: item.qty,
      pickedQty: item.pickedQty,
      inspectedQty: 0,
      approvedQty: 0,
      rejectedQty: 0,
      status: 'pending',
      issues: [],
      lastInspectedAt: undefined
    }));

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
      items
    };

    await this.db.update(wmsTables.fulfillmentOrders)
      .set({
        status: 'inspecting',
        inspectionStartedAt: new Date()
      })
      .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

    this.logger.log(`Started ${type} inspection session ${sessionId} for FO ${fulfillmentOrderId}`);
    return session;
  }

  async inspectItem(request: {
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
  }): Promise<InspectionItem> {
    const { sessionId, foiId, inspectedQty, approvedQty, rejectedQty = 0, issues = [], inspectorUserId } = request;

    if (inspectedQty !== approvedQty + rejectedQty) {
      throw new BadRequestException('Inspected quantity must equal approved + rejected quantities');
    }

    // TODO: In a real implementation, this would be stored in a separate inspection_sessions table
    // For now, we'll work directly with FOI data

    const foi = await this.db.query.fulfillmentOrderItems.findFirst({
      where: eq(wmsTables.fulfillmentOrderItems.id, foiId),
      with: {
        sku: true,
        fulfillmentOrder: true
      }
    });

    if (!foi) {
      throw new NotFoundException(`Fulfillment order item ${foiId} not found`);
    }

    if (foi.fulfillmentOrder.status !== 'inspecting') {
      throw new ConflictException(`Cannot inspect item for FO in status: ${foi.fulfillmentOrder.status}`);
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

    // Update FOI with inspection results
    await this.db.update(wmsTables.fulfillmentOrderItems)
      .set({
        // Add inspection fields to schema later
        updatedAt: new Date()
      })
      .where(eq(wmsTables.fulfillmentOrderItems.id, foiId));

    const inspectionIssues: InspectionIssue[] = issues.map(issue => ({
      id: `ISS-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      foiId,
      type: issue.type,
      severity: issue.severity,
      description: issue.description,
      qty: issue.qty,
      inspectorUserId,
      reportedAt: new Date(),
      photos: issue.photos
    }));

    this.logger.log(`Inspected FOI ${foiId}: ${approvedQty} approved, ${rejectedQty} rejected, ${inspectionIssues.length} issues`);

    return {
      foiId,
      salesOrderId: foi.salesOrderId,
      salesOrderLineId: foi.salesOrderLineId,
      skuId: foi.skuId,
      skuName: foi.sku.name,
      requiredQty: foi.qty,
      pickedQty: foi.pickedQty,
      inspectedQty,
      approvedQty,
      rejectedQty,
      status,
      issues: inspectionIssues,
      lastInspectedAt: new Date()
    };
  }

  async completeInspectionSession(sessionId: string, inspectorUserId: string): Promise<void> {
    // TODO: In a real implementation, validate that all items are inspected
    // For now, we'll assume the session is valid

    this.logger.log(`Completed inspection session ${sessionId} by ${inspectorUserId}`);
  }

  async forceShipment(request: ForceShipmentRequest): Promise<void> {
    const { foiId, reason, authorizedBy, forceQty, note } = request;

    const foi = await this.db.query.fulfillmentOrderItems.findFirst({
      where: eq(wmsTables.fulfillmentOrderItems.id, foiId),
      with: {
        fulfillmentOrder: true
      }
    });

    if (!foi) {
      throw new NotFoundException(`Fulfillment order item ${foiId} not found`);
    }

    if (foi.fulfillmentOrder.status !== 'inspecting') {
      throw new ConflictException(`Cannot force shipment for FO in status: ${foi.fulfillmentOrder.status}`);
    }

    if (forceQty > foi.qty) {
      throw new BadRequestException(`Force quantity ${forceQty} exceeds required quantity ${foi.qty}`);
    }

    await this.db.update(wmsTables.fulfillmentOrderItems)
      .set({
        shippedQty: forceQty,
        updatedAt: new Date()
      })
      .where(eq(wmsTables.fulfillmentOrderItems.id, foiId));

    this.logger.warn(
      `FORCED SHIPMENT: FOI ${foiId} - Qty: ${forceQty}, Reason: ${reason}, Authorized by: ${authorizedBy}` +
      (note ? `, Note: ${note}` : '')
    );
  }

  async resetInspection(foiId: string, inspectorUserId: string): Promise<void> {
    const foi = await this.db.query.fulfillmentOrderItems.findFirst({
      where: eq(wmsTables.fulfillmentOrderItems.id, foiId),
      with: {
        fulfillmentOrder: true
      }
    });

    if (!foi) {
      throw new NotFoundException(`Fulfillment order item ${foiId} not found`);
    }

    if (foi.fulfillmentOrder.status !== 'inspecting') {
      throw new ConflictException(`Cannot reset inspection for FO in status: ${foi.fulfillmentOrder.status}`);
    }

    // Reset inspection data
    await this.db.update(wmsTables.fulfillmentOrderItems)
      .set({
        updatedAt: new Date()
      })
      .where(eq(wmsTables.fulfillmentOrderItems.id, foiId));

    this.logger.log(`Reset inspection for FOI ${foiId} by ${inspectorUserId}`);
  }

  async getInspectionHistory(foiId: string): Promise<Array<{
    inspectorUserId: string;
    inspectedQty: number;
    approvedQty: number;
    rejectedQty: number;
    issues: number;
    timestamp: Date;
  }>> {
    // TODO: Implement inspection history tracking
    // For now, return empty array
    return [];
  }

  async getQualityMetrics(filters?: {
    warehouseId?: string;
    dateFrom?: Date;
    dateTo?: Date;
    inspectorUserId?: string;
  }): Promise<{
    totalInspections: number;
    approvalRate: number;
    rejectionRate: number;
    avgInspectionTime: number;
    commonIssues: Array<{
      type: string;
      count: number;
      percentage: number;
    }>;
    inspectorPerformance: Array<{
      inspectorUserId: string;
      inspections: number;
      approvalRate: number;
      avgTime: number;
    }>;
  }> {
    // TODO: Implement quality metrics calculation
    // For now, return mock data
    return {
      totalInspections: 0,
      approvalRate: 0,
      rejectionRate: 0,
      avgInspectionTime: 0,
      commonIssues: [],
      inspectorPerformance: []
    };
  }

  async bulkApprove(foiIds: string[], inspectorUserId: string): Promise<number> {
    const fois = await this.db.query.fulfillmentOrderItems.findMany({
      where: inArray(wmsTables.fulfillmentOrderItems.id, foiIds),
      with: {
        fulfillmentOrder: true
      }
    });

    const validFois = fois.filter(foi =>
      foi.fulfillmentOrder.status === 'inspecting' && foi.pickedQty > 0
    );

    if (validFois.length === 0) {
      throw new BadRequestException('No valid items found for bulk approval');
    }

    await this.db.transaction(async (tx) => {
      for (const foi of validFois) {
        await tx.update(wmsTables.fulfillmentOrderItems)
          .set({
            shippedQty: foi.pickedQty, // Approve all picked quantity
            updatedAt: new Date()
          })
          .where(eq(wmsTables.fulfillmentOrderItems.id, foi.id));
      }
    });

    this.logger.log(`Bulk approved ${validFois.length} items by ${inspectorUserId}`);
    return validFois.length;
  }

  async getInspectionSummary(fulfillmentOrderId: string): Promise<{
    totalItems: number;
    pendingItems: number;
    inspectedItems: number;
    approvedItems: number;
    rejectedItems: number;
    partialItems: number;
    totalIssues: number;
    canComplete: boolean;
  }> {
    const fulfillmentOrder = await this.db.query.fulfillmentOrders.findFirst({
      where: eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId),
      with: {
        items: true
      }
    });

    if (!fulfillmentOrder) {
      throw new NotFoundException(`Fulfillment order ${fulfillmentOrderId} not found`);
    }

    // TODO: Calculate actual inspection status from inspection data
    // For now, return basic counts
    const totalItems = fulfillmentOrder.items.length;
    const approvedItems = fulfillmentOrder.items.filter(item => item.shippedQty > 0).length;
    const pendingItems = totalItems - approvedItems;

    return {
      totalItems,
      pendingItems,
      inspectedItems: approvedItems,
      approvedItems,
      rejectedItems: 0,
      partialItems: 0,
      totalIssues: 0,
      canComplete: pendingItems === 0
    };
  }
}