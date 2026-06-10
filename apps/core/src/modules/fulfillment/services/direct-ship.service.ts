import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { DbService } from '@app/db';
import { and, eq, inArray, desc, isNull, or, sql } from 'drizzle-orm';
import * as ExcelJS from 'exceljs';
import { FulfillmentsService } from './fulfillments.service';

export interface DirectShipCustomerInfo {
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  shippingAddress: unknown;
}

export interface DirectShipOrder {
  fulfillmentOrderId: string;
  salesOrderId: string | null;
  companyName: string;
  supplierCode?: string;
  status: 'pending' | 'forwarded' | 'completed' | 'canceled';
  priority: 'normal' | 'high' | 'urgent';
  totalItems: number;
  totalQty: number;
  createdAt: Date;
  forwardedAt?: Date;
  completedAt?: Date;
  customerInfo?: DirectShipCustomerInfo;
  items: Array<{
    foiId: string;
    salesOrderLineId: string | null;
    skuId: string;
    skuName: string;
    qty: number;
    supplierSku?: string;
  }>;
}

export interface DirectShipExportData {
  companyName: string;
  orders: Array<{
    salesOrderId: string | null;
    salesOrderLineId: string | null;
    productName: string;
    quantity: number;
    supplierSku?: string;
    customerInfo?: unknown;
  }>;
  totalOrders: number;
  totalItems: number;
  exportedAt: Date;
}

export interface DirectShipDashboard {
  pendingOrders: number;
  forwardedOrders: number;
  completedOrders: number;
  totalOrders: number;
  companySummary: Array<{
    companyName: string;
    pendingCount: number;
    forwardedCount: number;
    completedCount: number;
  }>;
  recentActivity: Array<{
    fulfillmentOrderId: string;
    salesOrderId: string | null;
    companyName: string;
    action: 'created' | 'forwarded' | 'completed';
    timestamp: Date;
  }>;
}

@Injectable()
export class DirectShipService {
  private readonly logger = new Logger(DirectShipService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly fulfillmentsService: FulfillmentsService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async lookupHolderByName(companyName: string): Promise<string> {
    const rows = await this.db
      .select({ id: wmsTables.holders.id })
      .from(wmsTables.holders)
      .where(eq(wmsTables.holders.name, companyName))
      .limit(1);
    if (!rows[0]) {
      throw new BadRequestException(`Unknown company (holder not found): ${companyName}`);
    }
    return rows[0].id;
  }

  async getDirectShipOrders(filters?: {
    companyName?: string;
    status?: 'pending' | 'forwarded' | 'completed' | 'canceled';
    warehouseId?: string;
  }): Promise<DirectShipOrder[]> {
    const whereConditions = [eq(wmsTables.fulfillmentOrders.fulfillmentMode, 'drop_ship')];

    if (filters?.companyName) {
      const holderId = await this.lookupHolderByName(filters.companyName).catch(() => null);
      if (holderId) {
        whereConditions.push(eq(wmsTables.fulfillmentOrders.ownerId, holderId));
      } else {
        return [];
      }
    }
    if (filters?.status) {
      // directShipStatus가 null인 레코드는 'pending'으로 간주 (마이그레이션 전 데이터 호환)
      if (filters.status === 'pending') {
        whereConditions.push(
          or(
            eq(wmsTables.fulfillmentOrders.directShipStatus, 'pending'),
            isNull(wmsTables.fulfillmentOrders.directShipStatus),
          )!,
        );
      } else {
        whereConditions.push(eq(wmsTables.fulfillmentOrders.directShipStatus, filters.status));
      }
    }
    if (filters?.warehouseId) {
      whereConditions.push(eq(wmsTables.fulfillmentOrders.warehouseId, filters.warehouseId));
    }

    // Step 1: fetch FOs + owner name via join
    const foRows = await this.db
      .select({
        id: wmsTables.fulfillmentOrders.id,
        holderName: wmsTables.holders.name,
        directShipStatus: wmsTables.fulfillmentOrders.directShipStatus,
        priority: wmsTables.fulfillmentOrders.priority,
        totalItems: wmsTables.fulfillmentOrders.totalItems,
        totalQty: wmsTables.fulfillmentOrders.totalQty,
        createdAt: wmsTables.fulfillmentOrders.createdAt,
        allocatedAt: wmsTables.fulfillmentOrders.allocatedAt,
        shippedAt: wmsTables.fulfillmentOrders.shippedAt,
      })
      .from(wmsTables.fulfillmentOrders)
      .leftJoin(wmsTables.holders, eq(wmsTables.holders.id, wmsTables.fulfillmentOrders.ownerId))
      .where(and(...whereConditions))
      .orderBy(desc(wmsTables.fulfillmentOrders.createdAt));

    if (foRows.length === 0) return [];

    const foIds = foRows.map((r) => r.id);

    // Step 2: fetch items + skus + supplier for all FOs
    const itemRows = await this.db
      .select({
        id: wmsTables.fulfillmentOrderItems.id,
        fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
        salesOrderId: wmsTables.fulfillmentOrderItems.salesOrderId,
        salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
        skuId: wmsTables.fulfillmentOrderItems.skuId,
        skuName: wmsTables.skus.name,
        qty: wmsTables.fulfillmentOrderItems.qty,
        supplierCode: wmsTables.suppliers.code,
        supplierSku: wmsTables.skuSuppliers.supplierSku,
      })
      .from(wmsTables.fulfillmentOrderItems)
      .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
      .leftJoin(wmsTables.skuSuppliers, eq(wmsTables.skuSuppliers.skuId, wmsTables.skus.id))
      .leftJoin(wmsTables.suppliers, eq(wmsTables.suppliers.id, wmsTables.skuSuppliers.supplierId))
      .where(inArray(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foIds));

    // Step 3: fetch customerInfo from salesOrders
    const salesOrderRows =
      foIds.length === 0
        ? []
        : await this.db
            .select({
              id: wmsTables.salesOrders.id,
              customerName: wmsTables.salesOrders.customerName,
              customerEmail: wmsTables.salesOrders.customerEmail,
              customerPhone: wmsTables.salesOrders.customerPhone,
              shippingAddress: wmsTables.salesOrders.shippingAddress,
              foId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
            })
            .from(wmsTables.salesOrders)
            .innerJoin(wmsTables.salesOrderLines, eq(wmsTables.salesOrderLines.salesOrderId, wmsTables.salesOrders.id))
            .innerJoin(
              wmsTables.fulfillmentOrderItems,
              // sales_order_line_id 는 varchar, sales_order_lines.id 는 uuid — 명시적 캐스트 필요
              sql`${wmsTables.fulfillmentOrderItems.salesOrderLineId}::uuid = ${wmsTables.salesOrderLines.id}`,
            )
            .where(inArray(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foIds));

    const customerInfoByFoId = new Map<
      string,
      {
        customerName: string | null;
        customerEmail: string | null;
        customerPhone: string | null;
        shippingAddress: unknown;
      }
    >();
    for (const row of salesOrderRows) {
      if (!customerInfoByFoId.has(row.foId)) {
        customerInfoByFoId.set(row.foId, {
          customerName: row.customerName,
          customerEmail: row.customerEmail,
          customerPhone: row.customerPhone,
          shippingAddress: row.shippingAddress,
        });
      }
    }

    const itemsByFoId = new Map<string, typeof itemRows>();
    for (const item of itemRows) {
      if (!itemsByFoId.has(item.fulfillmentOrderId)) {
        itemsByFoId.set(item.fulfillmentOrderId, []);
      }
      itemsByFoId.get(item.fulfillmentOrderId)!.push(item);
    }

    return foRows.map((fo) => {
      const items = itemsByFoId.get(fo.id) ?? [];
      const supplierCode = items[0]?.supplierCode ?? undefined;
      const customerInfo = customerInfoByFoId.get(fo.id) ?? undefined;
      return {
        fulfillmentOrderId: fo.id,
        salesOrderId: items[0]?.salesOrderId ?? null,
        companyName: fo.holderName ?? 'Unknown',
        supplierCode,
        status: fo.directShipStatus ?? 'pending',
        priority: fo.priority,
        totalItems: fo.totalItems,
        totalQty: fo.totalQty,
        createdAt: fo.createdAt,
        forwardedAt: fo.allocatedAt ?? undefined,
        completedAt: fo.shippedAt ?? undefined,
        customerInfo,
        items: items.map((item) => ({
          foiId: item.id,
          salesOrderLineId: item.salesOrderLineId,
          skuId: item.skuId,
          skuName: item.skuName ?? '',
          qty: item.qty,
          supplierSku: item.supplierSku ?? undefined,
        })),
      };
    });
  }

  async getDirectShipOrdersByCompany(): Promise<Map<string, DirectShipOrder[]>> {
    const orders = await this.getDirectShipOrders();
    const ordersByCompany = new Map<string, DirectShipOrder[]>();

    for (const order of orders) {
      const companyName = order.companyName;
      if (!ordersByCompany.has(companyName)) {
        ordersByCompany.set(companyName, []);
      }
      ordersByCompany.get(companyName)!.push(order);
    }

    return ordersByCompany;
  }

  async forwardOrdersToCompany(fulfillmentOrderIds: string[], companyName: string): Promise<void> {
    const holderId = await this.lookupHolderByName(companyName);

    const foRows = await this.db
      .select({ id: wmsTables.fulfillmentOrders.id, ownerId: wmsTables.fulfillmentOrders.ownerId })
      .from(wmsTables.fulfillmentOrders)
      .where(
        and(
          inArray(wmsTables.fulfillmentOrders.id, fulfillmentOrderIds),
          eq(wmsTables.fulfillmentOrders.fulfillmentMode, 'drop_ship'),
          or(
            eq(wmsTables.fulfillmentOrders.directShipStatus, 'pending'),
            isNull(wmsTables.fulfillmentOrders.directShipStatus),
          ),
        ),
      );

    if (foRows.length !== fulfillmentOrderIds.length) {
      throw new BadRequestException('Some orders are not available for forwarding');
    }

    // ownerId가 설정된 경우 동일한 holder인지 검증
    const invalidOrders = foRows.filter((fo) => fo.ownerId && fo.ownerId !== holderId);
    if (invalidOrders.length > 0) {
      throw new BadRequestException(
        `Orders belong to different company: ${invalidOrders.map((fo) => fo.id).join(', ')}`,
      );
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({
          directShipStatus: 'forwarded',
          allocatedAt: new Date(),
          ownerId: holderId,
        })
        .where(inArray(wmsTables.fulfillmentOrders.id, fulfillmentOrderIds));

      this.logger.log(
        `Forwarded ${fulfillmentOrderIds.length} orders to company: ${companyName} (holderId: ${holderId})`,
      );
    });
  }

  async markOrdersAsCompleted(fulfillmentOrderIds: string[], completedBy: string): Promise<void> {
    const foRows = await this.db
      .select({ id: wmsTables.fulfillmentOrders.id })
      .from(wmsTables.fulfillmentOrders)
      .where(
        and(
          inArray(wmsTables.fulfillmentOrders.id, fulfillmentOrderIds),
          eq(wmsTables.fulfillmentOrders.fulfillmentMode, 'drop_ship'),
          eq(wmsTables.fulfillmentOrders.directShipStatus, 'forwarded'),
        ),
      );

    if (foRows.length !== fulfillmentOrderIds.length) {
      throw new BadRequestException('Some orders are not available for completion');
    }

    await this.db.transaction(async (tx) => {
      // canonical ship path per FO: FOI shippedQty, FO status='shipped', shippedAt, FulfillmentShipped event
      for (const fo of foRows) {
        await this.fulfillmentsService.ship(fo.id, tx as unknown as DbTx);
      }

      // directShipStatus is drop_ship specific; ship() doesn't set it
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ directShipStatus: 'completed' })
        .where(inArray(wmsTables.fulfillmentOrders.id, fulfillmentOrderIds));

      this.logger.log(`Marked ${fulfillmentOrderIds.length} direct ship orders as completed by: ${completedBy}`);
    });
  }

  async exportOrdersForCompany(companyName: string, format: 'json' | 'csv' = 'json'): Promise<DirectShipExportData> {
    const orders = await this.getDirectShipOrders({ companyName, status: 'pending' });

    const exportData: DirectShipExportData = {
      companyName,
      orders: orders.flatMap((order) =>
        order.items.map((item) => ({
          salesOrderId: order.salesOrderId,
          salesOrderLineId: item.salesOrderLineId,
          productName: item.skuName,
          quantity: item.qty,
          supplierSku: item.supplierSku,
          customerInfo: order.customerInfo,
        })),
      ),
      totalOrders: orders.length,
      totalItems: orders.reduce((sum, order) => sum + order.totalItems, 0),
      exportedAt: new Date(),
    };

    this.logger.log(`Exported ${exportData.totalOrders} orders for company: ${companyName}`);
    return exportData;
  }

  async generateExportFile(
    companyName: string,
    format: 'csv' | 'xlsx' = 'csv',
  ): Promise<{
    fileName: string;
    content: Buffer;
    mimeType: string;
  }> {
    const exportData = await this.exportOrdersForCompany(companyName, 'json');
    const timestamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replace(/[:\-T]/g, '');

    if (format === 'csv') {
      const csvContent = this.generateCSVContent(exportData);
      return {
        fileName: `직배주문_${companyName}_${timestamp}.csv`,
        content: Buffer.from('﻿' + csvContent, 'utf8'),
        mimeType: 'text/csv; charset=utf-8',
      };
    } else {
      const content = await this.generateXLSXContent(exportData);
      return {
        fileName: `직배주문_${companyName}_${timestamp}.xlsx`,
        content,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }
  }

  private generateCSVContent(exportData: DirectShipExportData): string {
    const headers = ['판매주문ID', '주문라인ID', '상품명', '수량', '공급사SKU'];
    const rows = exportData.orders.map((order) => [
      order.salesOrderId ?? '',
      order.salesOrderLineId ?? '',
      order.productName,
      order.quantity.toString(),
      order.supplierSku ?? '',
    ]);
    return [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
  }

  private async generateXLSXContent(exportData: DirectShipExportData): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('직배주문');

    sheet.columns = [
      { header: '판매주문ID', key: 'salesOrderId', width: 36 },
      { header: '주문라인ID', key: 'salesOrderLineId', width: 36 },
      { header: '상품명', key: 'productName', width: 40 },
      { header: '수량', key: 'quantity', width: 10 },
      { header: '공급사SKU', key: 'supplierSku', width: 30 },
    ];

    for (const order of exportData.orders) {
      sheet.addRow({
        salesOrderId: order.salesOrderId ?? '',
        salesOrderLineId: order.salesOrderLineId ?? '',
        productName: order.productName,
        quantity: order.quantity,
        supplierSku: order.supplierSku ?? '',
      });
    }

    return workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }

  async getDashboard(): Promise<DirectShipDashboard> {
    const allOrders = await this.getDirectShipOrders();

    const pendingOrders = allOrders.filter((o) => o.status === 'pending').length;
    const forwardedOrders = allOrders.filter((o) => o.status === 'forwarded').length;
    const completedOrders = allOrders.filter((o) => o.status === 'completed').length;

    const companySummary = new Map<string, { pending: number; forwarded: number; completed: number }>();
    for (const order of allOrders) {
      if (!companySummary.has(order.companyName)) {
        companySummary.set(order.companyName, { pending: 0, forwarded: 0, completed: 0 });
      }
      const summary = companySummary.get(order.companyName)!;
      if (order.status === 'pending') summary.pending++;
      else if (order.status === 'forwarded') summary.forwarded++;
      else if (order.status === 'completed') summary.completed++;
    }

    const recentActivity = allOrders.slice(0, 10).map((order) => ({
      fulfillmentOrderId: order.fulfillmentOrderId,
      salesOrderId: order.salesOrderId,
      companyName: order.companyName,
      action: this.getRecentAction(order),
      timestamp: this.getRecentTimestamp(order),
    }));

    return {
      pendingOrders,
      forwardedOrders,
      completedOrders,
      totalOrders: allOrders.length,
      companySummary: Array.from(companySummary.entries()).map(([companyName, summary]) => ({
        companyName,
        pendingCount: summary.pending,
        forwardedCount: summary.forwarded,
        completedCount: summary.completed,
      })),
      recentActivity,
    };
  }

  async getCompanyList(): Promise<Array<{ companyName: string; orderCount: number; lastOrderDate?: Date }>> {
    const ordersByCompany = await this.getDirectShipOrdersByCompany();
    return Array.from(ordersByCompany.entries())
      .map(([companyName, orders]) => ({
        companyName,
        orderCount: orders.length,
        lastOrderDate: orders.length > 0 ? orders[0].createdAt : undefined,
      }))
      .sort((a, b) => b.orderCount - a.orderCount);
  }

  private getRecentAction(order: DirectShipOrder): 'created' | 'forwarded' | 'completed' {
    if (order.completedAt) return 'completed';
    if (order.forwardedAt) return 'forwarded';
    return 'created';
  }

  private getRecentTimestamp(order: DirectShipOrder): Date {
    return order.completedAt || order.forwardedAt || order.createdAt;
  }
}
