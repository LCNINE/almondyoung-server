import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { DbService } from '@app/db';
import { and, eq, inArray, desc, sql, count, gt, SQL } from 'drizzle-orm';
import { BarcodeService } from '../../inventory/shared/services/barcode.service';

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
  sessionId: string;
  foiId: string;
  reason: string;
  authorizedBy: string;
  forceQty: number;
  note?: string;
}

type InspectIssueInput = {
  type: InspectionIssue['type'];
  severity: InspectionIssue['severity'];
  description: string;
  qty?: number;
  photos?: string[];
};

// approved/rejected 분포 → FOI/검수 아이템 상태
function deriveItemStatus(approvedQty: number, rejectedQty: number): InspectionItem['status'] {
  if (rejectedQty > 0) return approvedQty > 0 ? 'partial' : 'rejected';
  if (approvedQty > 0) return 'approved';
  return 'pending';
}

@Injectable()
export class InspectionService {
  private readonly logger = new Logger(InspectionService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly barcodeService: BarcodeService,
  ) {}

  // ───────────────────────────── 세션 시작 ─────────────────────────────

  async startInspectionSession(
    request: {
      fulfillmentOrderId: string;
      type: 'individual' | 'batch';
      inspectorUserId: string;
    },
    tx?: DbTx,
  ): Promise<InspectionSession> {
    const { fulfillmentOrderId, type, inspectorUserId } = request;

    return this.dbService.run(async (trx) => {
      const foRows = await trx
        .select({ id: wmsTables.fulfillmentOrders.id, status: wmsTables.fulfillmentOrders.status })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);

      const fo = foRows[0];
      if (!fo) {
        throw new NotFoundException(`Fulfillment order ${fulfillmentOrderId} not found`);
      }
      if (fo.status === 'inspecting') {
        const activeSessions = await trx
          .select({ id: wmsTables.inspectionSessions.id })
          .from(wmsTables.inspectionSessions)
          .where(
            and(
              eq(wmsTables.inspectionSessions.fulfillmentOrderId, fulfillmentOrderId),
              eq(wmsTables.inspectionSessions.status, 'active'),
            ),
          )
          .orderBy(desc(wmsTables.inspectionSessions.startedAt))
          .limit(1);
        if (!activeSessions[0]) {
          throw new ConflictException(`FO ${fulfillmentOrderId} is inspecting but has no active inspection session`);
        }
        return this.loadInspectionSession(activeSessions[0].id, trx);
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

      if (itemRows.length === 0) {
        throw new ConflictException(`Cannot start inspection without items for FO ${fulfillmentOrderId}`);
      }

      // 세션 영속화
      const [session] = await trx
        .insert(wmsTables.inspectionSessions)
        .values({
          fulfillmentOrderId,
          type,
          status: 'active',
          inspectorUserId,
          totalItems: itemRows.length,
          inspectedItems: 0,
          completedItems: 0,
          issues: 0,
        })
        .returning();

      // 검수 아이템 행 생성 (FOI 당 1행)
      if (itemRows.length > 0) {
        await trx.insert(wmsTables.inspectionItems).values(
          itemRows.map((row) => ({
            sessionId: session.id,
            foiId: row.id,
            inspectedQty: 0,
            approvedQty: 0,
            rejectedQty: 0,
            status: 'pending',
          })),
        );
      }

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'inspecting', updatedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

      this.logger.log(`Started ${type} inspection session ${session.id} for FO ${fulfillmentOrderId}`);

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

      return {
        id: session.id,
        fulfillmentOrderId,
        type,
        status: 'active',
        inspectorUserId,
        totalItems: items.length,
        inspectedItems: 0,
        completedItems: 0,
        issues: 0,
        startedAt: session.startedAt,
        items,
      };
    }, tx);
  }

  async getInspectionSession(sessionId: string, tx?: DbTx): Promise<InspectionSession> {
    return this.dbService.run((trx) => this.loadInspectionSession(sessionId, trx), tx);
  }

  // ───────────────────────────── 아이템 검수 ─────────────────────────────

  async inspectItem(
    request: {
      sessionId: string;
      foiId: string;
      inspectedQty: number;
      approvedQty: number;
      rejectedQty?: number;
      issues?: InspectIssueInput[];
      inspectorUserId: string;
    },
    tx?: DbTx,
  ): Promise<InspectionItem> {
    const { sessionId, foiId, inspectedQty, approvedQty, rejectedQty = 0, issues = [], inspectorUserId } = request;

    if (inspectedQty < 0 || approvedQty < 0 || rejectedQty < 0) {
      throw new BadRequestException('Inspection quantities cannot be negative');
    }
    if (inspectedQty !== approvedQty + rejectedQty) {
      throw new BadRequestException('Inspected quantity must equal approved + rejected quantities');
    }

    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select({
          id: wmsTables.fulfillmentOrderItems.id,
          fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
          sessionFulfillmentOrderId: wmsTables.inspectionSessions.fulfillmentOrderId,
          sessionStatus: wmsTables.inspectionSessions.status,
          salesOrderId: wmsTables.fulfillmentOrderItems.salesOrderId,
          salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
          skuId: wmsTables.fulfillmentOrderItems.skuId,
          skuName: wmsTables.skus.name,
          qty: wmsTables.fulfillmentOrderItems.qty,
          pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
          foStatus: wmsTables.fulfillmentOrders.status,
        })
        .from(wmsTables.inspectionItems)
        .innerJoin(
          wmsTables.inspectionSessions,
          eq(wmsTables.inspectionSessions.id, wmsTables.inspectionItems.sessionId),
        )
        .innerJoin(
          wmsTables.fulfillmentOrderItems,
          eq(wmsTables.fulfillmentOrderItems.id, wmsTables.inspectionItems.foiId),
        )
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
        )
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
        .where(and(eq(wmsTables.inspectionItems.sessionId, sessionId), eq(wmsTables.inspectionItems.foiId, foiId)))
        .limit(1);

      const foi = rows[0];
      if (!foi) {
        throw new NotFoundException(`FOI ${foiId} is not part of inspection session ${sessionId}`);
      }
      if (foi.sessionFulfillmentOrderId !== foi.fulfillmentOrderId) {
        throw new ConflictException(`Inspection session ${sessionId} does not belong to FOI ${foiId}`);
      }
      if (foi.sessionStatus !== 'active') {
        throw new ConflictException(`Cannot inspect item for session in status: ${foi.sessionStatus}`);
      }
      if (foi.foStatus !== 'inspecting') {
        throw new ConflictException(`Cannot inspect item for FO in status: ${foi.foStatus}`);
      }
      if (inspectedQty > foi.pickedQty) {
        throw new BadRequestException(`Cannot inspect more than picked quantity: ${foi.pickedQty}`);
      }

      const status = deriveItemStatus(approvedQty, rejectedQty);
      const now = new Date();

      await trx
        .update(wmsTables.inspectionItems)
        .set({ inspectedQty, approvedQty, rejectedQty, status, lastInspectedAt: now, updatedAt: now })
        .where(and(eq(wmsTables.inspectionItems.sessionId, sessionId), eq(wmsTables.inspectionItems.foiId, foiId)));

      // 이슈 영속화
      const inspectionIssues: InspectionIssue[] = [];
      if (issues.length > 0) {
        const inserted = await trx
          .insert(wmsTables.inspectionIssues)
          .values(
            issues.map((issue) => ({
              foiId,
              sessionId,
              type: issue.type,
              severity: issue.severity,
              description: issue.description,
              qty: issue.qty,
              inspectorUserId,
              photos: issue.photos,
            })),
          )
          .returning();
        for (const r of inserted) {
          inspectionIssues.push({
            id: r.id,
            foiId: r.foiId,
            type: r.type as InspectionIssue['type'],
            severity: r.severity as InspectionIssue['severity'],
            description: r.description,
            qty: r.qty ?? undefined,
            inspectorUserId: r.inspectorUserId ?? inspectorUserId,
            reportedAt: r.reportedAt,
            resolvedAt: r.resolvedAt ?? undefined,
            resolution: r.resolution ?? undefined,
            photos: r.photos ?? undefined,
          });
        }
      }

      // 양품 부분배송 정책: approved 수량만 shippedQty 로 (rejected 는 보류). FOI status 기록
      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ shippedQty: approvedQty, status, updatedAt: now })
        .where(eq(wmsTables.fulfillmentOrderItems.id, foiId));

      await this.refreshSessionCounters(sessionId, trx);

      this.logger.log(
        `Inspected FOI ${foiId} (session ${sessionId}): ${approvedQty} approved, ${rejectedQty} rejected, ${inspectionIssues.length} new issues`,
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
        lastInspectedAt: now,
      };
    }, tx);
  }

  // 세션 카운터 재계산 (검수 아이템/이슈 집계)
  private async refreshSessionCounters(sessionId: string, trx: DbTx): Promise<void> {
    const [agg] = await trx
      .select({
        inspectedItems: sql<number>`count(*) filter (where ${wmsTables.inspectionItems.inspectedQty} > 0)`,
        completedItems: sql<number>`count(*) filter (
          where ${wmsTables.inspectionItems.inspectedQty} >= ${wmsTables.fulfillmentOrderItems.pickedQty}
        )`,
      })
      .from(wmsTables.inspectionItems)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.inspectionItems.foiId),
      )
      .where(eq(wmsTables.inspectionItems.sessionId, sessionId));

    const [issueAgg] = await trx
      .select({ value: count() })
      .from(wmsTables.inspectionIssues)
      .where(eq(wmsTables.inspectionIssues.sessionId, sessionId));

    await trx
      .update(wmsTables.inspectionSessions)
      .set({
        inspectedItems: Number(agg?.inspectedItems ?? 0),
        completedItems: Number(agg?.completedItems ?? 0),
        issues: Number(issueAgg?.value ?? 0),
        updatedAt: new Date(),
      })
      .where(eq(wmsTables.inspectionSessions.id, sessionId));
  }

  // ───────────────────────────── 세션 완료 ─────────────────────────────

  async completeInspectionSession(sessionId: string, inspectorUserId: string, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      const sessionRows = await trx
        .select({
          id: wmsTables.inspectionSessions.id,
          fulfillmentOrderId: wmsTables.inspectionSessions.fulfillmentOrderId,
          status: wmsTables.inspectionSessions.status,
          foStatus: wmsTables.fulfillmentOrders.status,
        })
        .from(wmsTables.inspectionSessions)
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.inspectionSessions.fulfillmentOrderId),
        )
        .where(eq(wmsTables.inspectionSessions.id, sessionId))
        .limit(1);

      const session = sessionRows[0];
      if (!session) {
        throw new NotFoundException(`Inspection session ${sessionId} not found`);
      }
      if (session.status !== 'active') {
        throw new ConflictException(`Cannot complete inspection session in status: ${session.status}`);
      }
      if (session.foStatus !== 'inspecting') {
        throw new ConflictException(`Cannot complete inspection for FO in status: ${session.foStatus}`);
      }

      const itemRows = await trx
        .select({
          inspectedQty: wmsTables.inspectionItems.inspectedQty,
          pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
        })
        .from(wmsTables.inspectionItems)
        .innerJoin(
          wmsTables.fulfillmentOrderItems,
          eq(wmsTables.fulfillmentOrderItems.id, wmsTables.inspectionItems.foiId),
        )
        .where(eq(wmsTables.inspectionItems.sessionId, sessionId));

      if (itemRows.length === 0) {
        throw new ConflictException(`Inspection session ${sessionId} has no items`);
      }
      const incompleteItems = itemRows.filter((item) => item.inspectedQty < item.pickedQty);
      if (incompleteItems.length > 0) {
        throw new ConflictException(`Cannot complete inspection with ${incompleteItems.length} incomplete items`);
      }

      const now = new Date();
      await this.refreshSessionCounters(sessionId, trx);
      await trx
        .update(wmsTables.inspectionSessions)
        .set({ status: 'completed', completedAt: now, updatedAt: now })
        .where(eq(wmsTables.inspectionSessions.id, sessionId));

      // FO inspecting → inspected (검수 완료 상태 전이, §4 1안)
      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'inspected', updatedAt: now })
        .where(
          and(
            eq(wmsTables.fulfillmentOrders.id, session.fulfillmentOrderId),
            eq(wmsTables.fulfillmentOrders.status, 'inspecting'),
          ),
        );

      this.logger.log(
        `Completed inspection session ${sessionId} by ${inspectorUserId} → FO ${session.fulfillmentOrderId} inspected`,
      );
    }, tx);
  }

  // ───────────────────────────── 강제 출고 ─────────────────────────────

  async forceShipment(request: ForceShipmentRequest, tx?: DbTx): Promise<void> {
    const { sessionId, foiId, reason, authorizedBy, forceQty, note } = request;

    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select({
          pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
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
      if (forceQty > foi.pickedQty) {
        throw new BadRequestException(`Force quantity ${forceQty} exceeds picked quantity ${foi.pickedQty}`);
      }

      const activeItems = await trx
        .select({ sessionId: wmsTables.inspectionItems.sessionId })
        .from(wmsTables.inspectionItems)
        .innerJoin(
          wmsTables.inspectionSessions,
          eq(wmsTables.inspectionSessions.id, wmsTables.inspectionItems.sessionId),
        )
        .where(
          and(
            eq(wmsTables.inspectionItems.sessionId, sessionId),
            eq(wmsTables.inspectionItems.foiId, foiId),
            eq(wmsTables.inspectionSessions.status, 'active'),
          ),
        );
      if (activeItems.length === 0) {
        throw new ConflictException(`No active inspection session found for FOI ${foiId}`);
      }

      const now = new Date();
      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ shippedQty: forceQty, status: 'approved', updatedAt: now })
        .where(eq(wmsTables.fulfillmentOrderItems.id, foiId));

      await trx
        .update(wmsTables.inspectionItems)
        .set({
          inspectedQty: forceQty,
          approvedQty: forceQty,
          rejectedQty: 0,
          status: 'approved',
          lastInspectedAt: now,
          updatedAt: now,
        })
        .where(and(eq(wmsTables.inspectionItems.foiId, foiId), eq(wmsTables.inspectionItems.sessionId, sessionId)));
      await this.refreshSessionCounters(sessionId, trx);

      this.logger.warn(
        `FORCED SHIPMENT: FOI ${foiId} - Qty: ${forceQty}, Reason: ${reason}, Authorized by: ${authorizedBy}` +
          (note ? `, Note: ${note}` : ''),
      );
    }, tx);
  }

  // ───────────────────────────── 검수 초기화 ─────────────────────────────

  async resetInspection(foiId: string, inspectorUserId: string, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
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

      const now = new Date();
      const activeItems = await trx
        .select({ sessionId: wmsTables.inspectionItems.sessionId })
        .from(wmsTables.inspectionItems)
        .innerJoin(
          wmsTables.inspectionSessions,
          eq(wmsTables.inspectionSessions.id, wmsTables.inspectionItems.sessionId),
        )
        .where(and(eq(wmsTables.inspectionItems.foiId, foiId), eq(wmsTables.inspectionSessions.status, 'active')));
      if (activeItems.length === 0) {
        throw new ConflictException(`No active inspection session found for FOI ${foiId}`);
      }

      const sessionIds = activeItems.map((item) => item.sessionId);
      await trx
        .update(wmsTables.inspectionItems)
        .set({
          inspectedQty: 0,
          approvedQty: 0,
          rejectedQty: 0,
          status: 'pending',
          lastInspectedAt: null,
          updatedAt: now,
        })
        .where(
          and(eq(wmsTables.inspectionItems.foiId, foiId), inArray(wmsTables.inspectionItems.sessionId, sessionIds)),
        );

      // FOI 검수 결과 롤백 (approved 분 shippedQty 환원)
      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ shippedQty: 0, status: 'pending', updatedAt: now })
        .where(eq(wmsTables.fulfillmentOrderItems.id, foiId));

      for (const sessionId of new Set(sessionIds)) {
        await this.refreshSessionCounters(sessionId, trx);
      }

      this.logger.log(`Reset inspection for FOI ${foiId} by ${inspectorUserId}`);
    }, tx);
  }

  // ───────────────────────────── 이력 / 메트릭 ─────────────────────────────

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
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select({
          sessionId: wmsTables.inspectionItems.sessionId,
          inspectorUserId: wmsTables.inspectionSessions.inspectorUserId,
          inspectedQty: wmsTables.inspectionItems.inspectedQty,
          approvedQty: wmsTables.inspectionItems.approvedQty,
          rejectedQty: wmsTables.inspectionItems.rejectedQty,
          lastInspectedAt: wmsTables.inspectionItems.lastInspectedAt,
          updatedAt: wmsTables.inspectionItems.updatedAt,
        })
        .from(wmsTables.inspectionItems)
        .innerJoin(
          wmsTables.inspectionSessions,
          eq(wmsTables.inspectionSessions.id, wmsTables.inspectionItems.sessionId),
        )
        .where(and(eq(wmsTables.inspectionItems.foiId, foiId), gt(wmsTables.inspectionItems.inspectedQty, 0)))
        .orderBy(desc(wmsTables.inspectionItems.lastInspectedAt));

      if (rows.length === 0) return [];

      const issueRows = await trx
        .select({ sessionId: wmsTables.inspectionIssues.sessionId, value: count() })
        .from(wmsTables.inspectionIssues)
        .where(eq(wmsTables.inspectionIssues.foiId, foiId))
        .groupBy(wmsTables.inspectionIssues.sessionId);
      const issueCounts = new Map(issueRows.map((row) => [row.sessionId, Number(row.value)]));

      return rows.map((r) => ({
        inspectorUserId: r.inspectorUserId ?? '',
        inspectedQty: r.inspectedQty,
        approvedQty: r.approvedQty,
        rejectedQty: r.rejectedQty,
        issues: issueCounts.get(r.sessionId) ?? 0,
        timestamp: r.lastInspectedAt ?? r.updatedAt,
      }));
    }, tx);
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
    return this.dbService.run(async (trx) => {
      const sessionConditions: SQL[] = [];
      if (filters?.inspectorUserId) {
        sessionConditions.push(eq(wmsTables.inspectionSessions.inspectorUserId, filters.inspectorUserId));
      }
      if (filters?.warehouseId) {
        sessionConditions.push(eq(wmsTables.fulfillmentOrders.warehouseId, filters.warehouseId));
      }
      if (filters?.dateFrom) {
        sessionConditions.push(sql`${wmsTables.inspectionSessions.startedAt} >= ${filters.dateFrom}`);
      }
      if (filters?.dateTo) {
        sessionConditions.push(sql`${wmsTables.inspectionSessions.startedAt} <= ${filters.dateTo}`);
      }
      const itemWhereClause = and(gt(wmsTables.inspectionItems.inspectedQty, 0), ...sessionConditions);
      const sessionWhereClause = sessionConditions.length > 0 ? and(...sessionConditions) : undefined;

      const [totals] = await trx
        .select({
          totalInspections: count(),
          sumInspected: sql<number>`coalesce(sum(${wmsTables.inspectionItems.inspectedQty}), 0)`,
          sumApproved: sql<number>`coalesce(sum(${wmsTables.inspectionItems.approvedQty}), 0)`,
          sumRejected: sql<number>`coalesce(sum(${wmsTables.inspectionItems.rejectedQty}), 0)`,
        })
        .from(wmsTables.inspectionItems)
        .innerJoin(
          wmsTables.inspectionSessions,
          eq(wmsTables.inspectionSessions.id, wmsTables.inspectionItems.sessionId),
        )
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.inspectionSessions.fulfillmentOrderId),
        )
        .where(itemWhereClause);

      const sumInspected = Number(totals?.sumInspected ?? 0);
      const sumApproved = Number(totals?.sumApproved ?? 0);
      const sumRejected = Number(totals?.sumRejected ?? 0);

      const issueGroups = await trx
        .select({ type: wmsTables.inspectionIssues.type, value: count() })
        .from(wmsTables.inspectionIssues)
        .innerJoin(
          wmsTables.inspectionSessions,
          eq(wmsTables.inspectionSessions.id, wmsTables.inspectionIssues.sessionId),
        )
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.inspectionSessions.fulfillmentOrderId),
        )
        .where(sessionWhereClause)
        .groupBy(wmsTables.inspectionIssues.type);
      const totalIssues = issueGroups.reduce((sum, g) => sum + Number(g.value), 0);

      const perfGroups = await trx
        .select({
          inspectorUserId: wmsTables.inspectionSessions.inspectorUserId,
          inspections: count(),
          sumInspected: sql<number>`coalesce(sum(${wmsTables.inspectionItems.inspectedQty}), 0)`,
          sumApproved: sql<number>`coalesce(sum(${wmsTables.inspectionItems.approvedQty}), 0)`,
        })
        .from(wmsTables.inspectionItems)
        .innerJoin(
          wmsTables.inspectionSessions,
          eq(wmsTables.inspectionSessions.id, wmsTables.inspectionItems.sessionId),
        )
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.inspectionSessions.fulfillmentOrderId),
        )
        .where(itemWhereClause)
        .groupBy(wmsTables.inspectionSessions.inspectorUserId);

      return {
        totalInspections: Number(totals?.totalInspections ?? 0),
        approvalRate: sumInspected > 0 ? sumApproved / sumInspected : 0,
        rejectionRate: sumInspected > 0 ? sumRejected / sumInspected : 0,
        avgInspectionTime: 0, // 타이밍 데이터 미수집
        commonIssues: issueGroups.map((g) => ({
          type: g.type,
          count: Number(g.value),
          percentage: totalIssues > 0 ? Number(g.value) / totalIssues : 0,
        })),
        inspectorPerformance: perfGroups.map((g) => {
          const si = Number(g.sumInspected);
          return {
            inspectorUserId: g.inspectorUserId ?? '',
            inspections: Number(g.inspections),
            approvalRate: si > 0 ? Number(g.sumApproved) / si : 0,
            avgTime: 0,
          };
        }),
      };
    }, tx);
  }

  // ───────────────────────────── 일괄 승인 ─────────────────────────────

  async bulkApprove(sessionId: string, foiIds: string[], inspectorUserId: string, tx?: DbTx): Promise<number> {
    return this.dbService.run(async (trx) => {
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

      const validFoiIds = validFois.map((foi) => foi.id);
      const activeItems = await trx
        .select({
          foiId: wmsTables.inspectionItems.foiId,
          sessionId: wmsTables.inspectionItems.sessionId,
        })
        .from(wmsTables.inspectionItems)
        .innerJoin(
          wmsTables.inspectionSessions,
          eq(wmsTables.inspectionSessions.id, wmsTables.inspectionItems.sessionId),
        )
        .where(
          and(
            eq(wmsTables.inspectionItems.sessionId, sessionId),
            inArray(wmsTables.inspectionItems.foiId, validFoiIds),
            eq(wmsTables.inspectionSessions.status, 'active'),
          ),
        );
      const activeByFoi = new Map(activeItems.map((item) => [item.foiId, item.sessionId]));
      const approvableFois = validFois.filter((foi) => activeByFoi.has(foi.id));
      if (approvableFois.length === 0) {
        throw new BadRequestException('No items belong to an active inspection session');
      }

      const now = new Date();
      const affectedSessionIds = new Set<string>();
      for (const foi of approvableFois) {
        const sessionId = activeByFoi.get(foi.id)!;
        affectedSessionIds.add(sessionId);
        await trx
          .update(wmsTables.fulfillmentOrderItems)
          .set({ shippedQty: foi.pickedQty, status: 'approved', updatedAt: now })
          .where(eq(wmsTables.fulfillmentOrderItems.id, foi.id));

        // 활성 세션 검수 아이템도 전량 승인 반영
        await trx
          .update(wmsTables.inspectionItems)
          .set({
            inspectedQty: foi.pickedQty,
            approvedQty: foi.pickedQty,
            rejectedQty: 0,
            status: 'approved',
            lastInspectedAt: now,
            updatedAt: now,
          })
          .where(and(eq(wmsTables.inspectionItems.sessionId, sessionId), eq(wmsTables.inspectionItems.foiId, foi.id)));
      }
      for (const sessionId of affectedSessionIds) {
        await this.refreshSessionCounters(sessionId, trx);
      }

      this.logger.log(`Bulk approved ${approvableFois.length} items by ${inspectorUserId}`);
      return approvableFois.length;
    }, tx);
  }

  // ───────────────────────────── 요약 ─────────────────────────────

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
    return this.dbService.run(async (trx) => {
      const foRows = await trx
        .select({ id: wmsTables.fulfillmentOrders.id })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);

      const fo = foRows[0];
      if (!fo) {
        throw new NotFoundException(`Fulfillment order ${fulfillmentOrderId} not found`);
      }

      const foiRows = await trx
        .select({ id: wmsTables.fulfillmentOrderItems.id })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));
      const totalItems = foiRows.length;

      // 최신 세션
      const sessionRows = await trx
        .select({ id: wmsTables.inspectionSessions.id })
        .from(wmsTables.inspectionSessions)
        .where(eq(wmsTables.inspectionSessions.fulfillmentOrderId, fulfillmentOrderId))
        .orderBy(desc(wmsTables.inspectionSessions.startedAt))
        .limit(1);
      const session = sessionRows[0];

      if (!session) {
        return {
          totalItems,
          pendingItems: totalItems,
          inspectedItems: 0,
          approvedItems: 0,
          rejectedItems: 0,
          partialItems: 0,
          totalIssues: 0,
          canComplete: false,
        };
      }

      const itemRows = await trx
        .select({
          status: wmsTables.inspectionItems.status,
          inspectedQty: wmsTables.inspectionItems.inspectedQty,
          pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
        })
        .from(wmsTables.inspectionItems)
        .innerJoin(
          wmsTables.fulfillmentOrderItems,
          eq(wmsTables.fulfillmentOrderItems.id, wmsTables.inspectionItems.foiId),
        )
        .where(eq(wmsTables.inspectionItems.sessionId, session.id));

      const approvedItems = itemRows.filter((r) => r.status === 'approved').length;
      const rejectedItems = itemRows.filter((r) => r.status === 'rejected').length;
      const partialItems = itemRows.filter((r) => r.status === 'partial').length;
      const pendingItems = itemRows.filter((r) => r.inspectedQty < r.pickedQty).length;
      const inspectedItems = itemRows.filter((r) => r.inspectedQty > 0).length;

      const [issueAgg] = await trx
        .select({ value: count() })
        .from(wmsTables.inspectionIssues)
        .where(eq(wmsTables.inspectionIssues.sessionId, session.id));

      return {
        totalItems,
        pendingItems,
        inspectedItems,
        approvedItems,
        rejectedItems,
        partialItems,
        totalIssues: Number(issueAgg?.value ?? 0),
        canComplete: totalItems > 0 && itemRows.length === totalItems && pendingItems === 0,
      };
    }, tx);
  }

  // ───────────────────────────── 바코드 스캔 (3-C) ─────────────────────────────

  // 바코드 → 검수 대상 FOI 식별/조회
  async scanBarcode(
    barcode: string,
    context: { sessionId: string; fulfillmentOrderId?: string },
    tx?: DbTx,
  ): Promise<{ type: string; foiId: string; data: InspectionItem }> {
    return this.dbService.run(async (trx) => {
      await this.assertActiveSession(context.sessionId, trx, context.fulfillmentOrderId);
      const foiId = await this.resolveFoiFromBarcode(barcode, context.sessionId, trx);
      const item = await this.loadInspectionItem(context.sessionId, foiId, trx);
      return { type: 'inspect_ready', foiId, data: item };
    }, tx);
  }

  // 바코드(+수량, 기본 1) → approved 누적 검수
  async inspectByScan(
    request: { barcode: string; sessionId: string; inspectorUserId: string; quantity?: number },
    tx?: DbTx,
  ): Promise<InspectionItem> {
    const { barcode, sessionId, inspectorUserId, quantity = 1 } = request;
    if (quantity <= 0) {
      throw new BadRequestException('Scan quantity must be positive');
    }

    return this.dbService.run(async (trx) => {
      await this.assertActiveSession(sessionId, trx);
      const foiId = await this.resolveFoiFromBarcode(barcode, sessionId, trx);

      const [current] = await trx
        .select({
          inspectedQty: wmsTables.inspectionItems.inspectedQty,
          approvedQty: wmsTables.inspectionItems.approvedQty,
          rejectedQty: wmsTables.inspectionItems.rejectedQty,
        })
        .from(wmsTables.inspectionItems)
        .where(and(eq(wmsTables.inspectionItems.sessionId, sessionId), eq(wmsTables.inspectionItems.foiId, foiId)))
        .limit(1);

      const curApproved = current?.approvedQty ?? 0;
      const curRejected = current?.rejectedQty ?? 0;

      // 스캔 1회 = approved +quantity 누적
      return this.inspectItem(
        {
          sessionId,
          foiId,
          inspectedQty: curApproved + curRejected + quantity,
          approvedQty: curApproved + quantity,
          rejectedQty: curRejected,
          inspectorUserId,
        },
        trx,
      );
    }, tx);
  }

  private async assertActiveSession(sessionId: string, trx: DbTx, expectedFulfillmentOrderId?: string): Promise<void> {
    const rows = await trx
      .select({
        fulfillmentOrderId: wmsTables.inspectionSessions.fulfillmentOrderId,
        status: wmsTables.inspectionSessions.status,
      })
      .from(wmsTables.inspectionSessions)
      .where(eq(wmsTables.inspectionSessions.id, sessionId))
      .limit(1);
    const session = rows[0];
    if (!session) {
      throw new NotFoundException(`Inspection session ${sessionId} not found`);
    }
    if (session.status !== 'active') {
      throw new ConflictException(`Cannot scan inspection session in status: ${session.status}`);
    }
    if (expectedFulfillmentOrderId && session.fulfillmentOrderId !== expectedFulfillmentOrderId) {
      throw new ConflictException(
        `Inspection session ${sessionId} does not belong to fulfillment order ${expectedFulfillmentOrderId}`,
      );
    }
  }

  // 바코드(SKU-/FOI-) → 세션 내 검수 대상 FOI 식별
  private async resolveFoiFromBarcode(barcode: string, sessionId: string, trx: DbTx): Promise<string> {
    const parsed = this.barcodeService.parseBarcode(barcode);

    if (parsed.type === 'fulfillment_order_item') {
      const rows = await trx
        .select({ foiId: wmsTables.inspectionItems.foiId })
        .from(wmsTables.inspectionItems)
        .where(and(eq(wmsTables.inspectionItems.sessionId, sessionId), eq(wmsTables.inspectionItems.foiId, parsed.id)))
        .limit(1);
      if (!rows[0]) {
        throw new NotFoundException(`FOI ${parsed.id} is not part of inspection session ${sessionId}`);
      }
      return rows[0].foiId;
    }

    if (parsed.type === 'sku') {
      // 세션 내 해당 SKU 의 미완료(검수 여지 있는) FOI 우선
      const rows = await trx
        .select({
          foiId: wmsTables.inspectionItems.foiId,
          pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
          inspectedQty: wmsTables.inspectionItems.inspectedQty,
        })
        .from(wmsTables.inspectionItems)
        .innerJoin(
          wmsTables.fulfillmentOrderItems,
          eq(wmsTables.fulfillmentOrderItems.id, wmsTables.inspectionItems.foiId),
        )
        .where(
          and(eq(wmsTables.inspectionItems.sessionId, sessionId), eq(wmsTables.fulfillmentOrderItems.skuId, parsed.id)),
        );
      const target = rows.find((r) => r.inspectedQty < r.pickedQty) ?? rows[0];
      if (!target) {
        throw new NotFoundException(`SKU ${parsed.id} is not part of inspection session ${sessionId}`);
      }
      return target.foiId;
    }

    if (parsed.type === 'unknown') {
      // skuCode(예: P00008) 또는 외부 바코드 — 세션 내 매칭 FOI 탐색 (피킹 pickByBarcodeScan 과 동일한 폴백)
      const rows = await trx
        .select({
          foiId: wmsTables.inspectionItems.foiId,
          pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
          inspectedQty: wmsTables.inspectionItems.inspectedQty,
        })
        .from(wmsTables.inspectionItems)
        .innerJoin(
          wmsTables.fulfillmentOrderItems,
          eq(wmsTables.fulfillmentOrderItems.id, wmsTables.inspectionItems.foiId),
        )
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
        .where(and(eq(wmsTables.inspectionItems.sessionId, sessionId), eq(wmsTables.skus.code, parsed.id)));
      const target = rows.find((r) => r.inspectedQty < r.pickedQty) ?? rows[0];
      if (!target) {
        throw new NotFoundException(`Barcode ${barcode} does not match any item in inspection session ${sessionId}`);
      }
      return target.foiId;
    }

    throw new BadRequestException(`Unsupported barcode for inspection: ${barcode}`);
  }

  // 검수 아이템 단건 조회 (FOI 메타 + 검수 상태 + 이슈)
  private async loadInspectionItem(sessionId: string, foiId: string, trx: DbTx): Promise<InspectionItem> {
    const rows = await trx
      .select({
        foiId: wmsTables.fulfillmentOrderItems.id,
        salesOrderId: wmsTables.fulfillmentOrderItems.salesOrderId,
        salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
        skuId: wmsTables.fulfillmentOrderItems.skuId,
        skuName: wmsTables.skus.name,
        requiredQty: wmsTables.fulfillmentOrderItems.qty,
        pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
        inspectedQty: wmsTables.inspectionItems.inspectedQty,
        approvedQty: wmsTables.inspectionItems.approvedQty,
        rejectedQty: wmsTables.inspectionItems.rejectedQty,
        status: wmsTables.inspectionItems.status,
        lastInspectedAt: wmsTables.inspectionItems.lastInspectedAt,
      })
      .from(wmsTables.inspectionItems)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.inspectionItems.foiId),
      )
      .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
      .where(and(eq(wmsTables.inspectionItems.sessionId, sessionId), eq(wmsTables.inspectionItems.foiId, foiId)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`Inspection item not found for FOI ${foiId} in session ${sessionId}`);
    }

    const issueRows = await trx
      .select()
      .from(wmsTables.inspectionIssues)
      .where(and(eq(wmsTables.inspectionIssues.sessionId, sessionId), eq(wmsTables.inspectionIssues.foiId, foiId)));

    return {
      foiId: row.foiId,
      salesOrderId: row.salesOrderId,
      salesOrderLineId: row.salesOrderLineId,
      skuId: row.skuId,
      skuName: row.skuName ?? '',
      requiredQty: row.requiredQty,
      pickedQty: row.pickedQty,
      inspectedQty: row.inspectedQty,
      approvedQty: row.approvedQty,
      rejectedQty: row.rejectedQty,
      status: row.status as InspectionItem['status'],
      issues: issueRows.map((r) => ({
        id: r.id,
        foiId: r.foiId,
        type: r.type as InspectionIssue['type'],
        severity: r.severity as InspectionIssue['severity'],
        description: r.description,
        qty: r.qty ?? undefined,
        inspectorUserId: r.inspectorUserId ?? '',
        reportedAt: r.reportedAt,
        resolvedAt: r.resolvedAt ?? undefined,
        resolution: r.resolution ?? undefined,
        photos: r.photos ?? undefined,
      })),
      lastInspectedAt: row.lastInspectedAt ?? undefined,
    };
  }

  private async loadInspectionSession(sessionId: string, trx: DbTx): Promise<InspectionSession> {
    const sessionRows = await trx
      .select()
      .from(wmsTables.inspectionSessions)
      .where(eq(wmsTables.inspectionSessions.id, sessionId))
      .limit(1);
    const session = sessionRows[0];
    if (!session) {
      throw new NotFoundException(`Inspection session ${sessionId} not found`);
    }

    const itemRows = await trx
      .select({
        foiId: wmsTables.fulfillmentOrderItems.id,
        salesOrderId: wmsTables.fulfillmentOrderItems.salesOrderId,
        salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
        skuId: wmsTables.fulfillmentOrderItems.skuId,
        skuName: wmsTables.skus.name,
        requiredQty: wmsTables.fulfillmentOrderItems.qty,
        pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
        inspectedQty: wmsTables.inspectionItems.inspectedQty,
        approvedQty: wmsTables.inspectionItems.approvedQty,
        rejectedQty: wmsTables.inspectionItems.rejectedQty,
        status: wmsTables.inspectionItems.status,
        lastInspectedAt: wmsTables.inspectionItems.lastInspectedAt,
      })
      .from(wmsTables.inspectionItems)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.inspectionItems.foiId),
      )
      .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
      .where(eq(wmsTables.inspectionItems.sessionId, sessionId));

    const issueRows = await trx
      .select()
      .from(wmsTables.inspectionIssues)
      .where(eq(wmsTables.inspectionIssues.sessionId, sessionId));
    const issuesByFoi = new Map<string, InspectionIssue[]>();
    for (const issue of issueRows) {
      const current = issuesByFoi.get(issue.foiId) ?? [];
      current.push({
        id: issue.id,
        foiId: issue.foiId,
        type: issue.type as InspectionIssue['type'],
        severity: issue.severity as InspectionIssue['severity'],
        description: issue.description,
        qty: issue.qty ?? undefined,
        inspectorUserId: issue.inspectorUserId ?? '',
        reportedAt: issue.reportedAt,
        resolvedAt: issue.resolvedAt ?? undefined,
        resolution: issue.resolution ?? undefined,
        photos: issue.photos ?? undefined,
      });
      issuesByFoi.set(issue.foiId, current);
    }

    return {
      id: session.id,
      fulfillmentOrderId: session.fulfillmentOrderId,
      type: session.type as InspectionSession['type'],
      status: session.status as InspectionSession['status'],
      inspectorUserId: session.inspectorUserId ?? '',
      totalItems: session.totalItems,
      inspectedItems: session.inspectedItems,
      completedItems: session.completedItems,
      issues: session.issues,
      startedAt: session.startedAt,
      completedAt: session.completedAt ?? undefined,
      items: itemRows.map((item) => ({
        foiId: item.foiId,
        salesOrderId: item.salesOrderId,
        salesOrderLineId: item.salesOrderLineId,
        skuId: item.skuId,
        skuName: item.skuName ?? '',
        requiredQty: item.requiredQty,
        pickedQty: item.pickedQty,
        inspectedQty: item.inspectedQty,
        approvedQty: item.approvedQty,
        rejectedQty: item.rejectedQty,
        status: item.status as InspectionItem['status'],
        issues: issuesByFoi.get(item.foiId) ?? [],
        lastInspectedAt: item.lastInspectedAt ?? undefined,
      })),
    };
  }
}
