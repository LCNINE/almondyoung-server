import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema } from '../../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import { and, eq, inArray, desc, isNotNull } from 'drizzle-orm';

export interface DirectShipOrder {
  fulfillmentOrderId: string;
  salesOrderId: string;
  companyName: string;
  supplierCode?: string;
  status: 'pending' | 'forwarded' | 'completed' | 'canceled';
  priority: 'normal' | 'high' | 'urgent';
  totalItems: number;
  totalQty: number;
  createdAt: Date;
  forwardedAt?: Date;
  completedAt?: Date;
  items: Array<{
    foiId: string;
    salesOrderLineId: string;
    skuId: string;
    skuName: string;
    qty: number;
    supplierSku?: string;
  }>;
}

export interface DirectShipExportData {
  companyName: string;
  orders: Array<{
    salesOrderId: string;
    salesOrderLineId: string;
    productName: string;
    quantity: number;
    supplierSku?: string;
    customerInfo?: any;
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
    salesOrderId: string;
    companyName: string;
    action: 'created' | 'forwarded' | 'completed';
    timestamp: Date;
  }>;
}

@Injectable()
export class DirectShipService {
  private readonly logger = new Logger(DirectShipService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async getDirectShipOrders(filters?: {
    companyName?: string;
    status?: 'pending' | 'forwarded' | 'completed' | 'canceled';
    warehouseId?: string;
  }): Promise<DirectShipOrder[]> {
    let whereConditions = [eq(wmsTables.fulfillmentOrders.fulfillmentMode, 'direct_ship')];

    if (filters?.companyName) {
      whereConditions.push(eq(wmsTables.fulfillmentOrders.ownerId, filters.companyName));
    }

    if (filters?.status) {
      whereConditions.push(eq(wmsTables.fulfillmentOrders.status, filters.status));
    }

    if (filters?.warehouseId) {
      whereConditions.push(eq(wmsTables.fulfillmentOrders.warehouseId, filters.warehouseId));
    }

    const fulfillmentOrders = await this.db.query.fulfillmentOrders.findMany({
      where: and(...whereConditions),
      orderBy: desc(wmsTables.fulfillmentOrders.createdAt),
      with: {
        items: {
          with: {
            sku: true
          }
        }
      }
    });

    return fulfillmentOrders.map(fo => ({
      fulfillmentOrderId: fo.id,
      salesOrderId: fo.items[0]?.salesOrderId || '',
      companyName: fo.ownerId || 'Unknown',
      supplierCode: undefined, // TODO: Get from company mapping
      status: this.mapFOStatusToDirectShipStatus(fo.status),
      priority: fo.priority,
      totalItems: fo.totalItems,
      totalQty: fo.totalQty,
      createdAt: fo.createdAt!,
      forwardedAt: fo.allocatedAt,
      completedAt: fo.shippedAt,
      items: fo.items.map(item => ({
        foiId: item.id,
        salesOrderLineId: item.salesOrderLineId,
        skuId: item.skuId,
        skuName: item.sku.name,
        qty: item.qty,
        supplierSku: undefined // TODO: Get from supplier mapping
      }))
    }));
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
    const fulfillmentOrders = await this.db.query.fulfillmentOrders.findMany({
      where: and(
        inArray(wmsTables.fulfillmentOrders.id, fulfillmentOrderIds),
        eq(wmsTables.fulfillmentOrders.fulfillmentMode, 'direct_ship'),
        eq(wmsTables.fulfillmentOrders.status, 'pending')
      )
    });

    if (fulfillmentOrders.length !== fulfillmentOrderIds.length) {
      throw new BadRequestException('Some orders are not available for forwarding');
    }

    const invalidOrders = fulfillmentOrders.filter(fo => fo.ownerId && fo.ownerId !== companyName);
    if (invalidOrders.length > 0) {
      throw new BadRequestException(`Orders belong to different company: ${invalidOrders.map(fo => fo.id).join(', ')}`);
    }

    await this.db.transaction(async (tx) => {
      await tx.update(wmsTables.fulfillmentOrders)
        .set({
          status: 'forwarded',
          allocatedAt: new Date(),
          ownerId: companyName
        })
        .where(inArray(wmsTables.fulfillmentOrders.id, fulfillmentOrderIds));

      this.logger.log(`Forwarded ${fulfillmentOrderIds.length} orders to company: ${companyName}`);
    });
  }

  async markOrdersAsCompleted(fulfillmentOrderIds: string[], completedBy: string): Promise<void> {
    const fulfillmentOrders = await this.db.query.fulfillmentOrders.findMany({
      where: and(
        inArray(wmsTables.fulfillmentOrders.id, fulfillmentOrderIds),
        eq(wmsTables.fulfillmentOrders.fulfillmentMode, 'direct_ship'),
        eq(wmsTables.fulfillmentOrders.status, 'forwarded')
      )
    });

    if (fulfillmentOrders.length !== fulfillmentOrderIds.length) {
      throw new BadRequestException('Some orders are not available for completion');
    }

    await this.db.transaction(async (tx) => {
      // Mark all FOIs as shipped
      for (const fo of fulfillmentOrders) {
        await tx.update(wmsTables.fulfillmentOrderItems)
          .set({
            shippedQty: wmsTables.fulfillmentOrderItems.qty,
            updatedAt: new Date()
          })
          .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id));
      }

      await tx.update(wmsTables.fulfillmentOrders)
        .set({
          status: 'completed',
          shippedAt: new Date()
        })
        .where(inArray(wmsTables.fulfillmentOrders.id, fulfillmentOrderIds));

      this.logger.log(`Marked ${fulfillmentOrderIds.length} direct ship orders as completed by: ${completedBy}`);
    });
  }

  async exportOrdersForCompany(companyName: string, format: 'json' | 'csv' = 'json'): Promise<DirectShipExportData> {
    const orders = await this.getDirectShipOrders({
      companyName,
      status: 'pending'
    });

    const exportData: DirectShipExportData = {
      companyName,
      orders: orders.flatMap(order =>
        order.items.map(item => ({
          salesOrderId: order.salesOrderId,
          salesOrderLineId: item.salesOrderLineId,
          productName: item.skuName,
          quantity: item.qty,
          supplierSku: item.supplierSku,
          customerInfo: undefined // TODO: Get from order data
        }))
      ),
      totalOrders: orders.length,
      totalItems: orders.reduce((sum, order) => sum + order.totalItems, 0),
      exportedAt: new Date()
    };

    this.logger.log(`Exported ${exportData.totalOrders} orders for company: ${companyName}`);
    return exportData;
  }

  async generateExportFile(companyName: string, format: 'csv' | 'xlsx' = 'csv'): Promise<{
    fileName: string;
    content: Buffer;
    mimeType: string;
  }> {
    const exportData = await this.exportOrdersForCompany(companyName, 'json');
    const timestamp = new Date().toISOString().slice(0, 16).replace(/[:\-T]/g, '');

    if (format === 'csv') {
      const csvContent = this.generateCSVContent(exportData);
      return {
        fileName: `직배주문_${companyName}_${timestamp}.csv`,
        content: Buffer.from('\uFEFF' + csvContent, 'utf8'), // Add BOM for proper Korean display
        mimeType: 'text/csv; charset=utf-8'
      };
    } else {
      // TODO: Implement XLSX generation
      throw new BadRequestException('XLSX format not yet implemented');
    }
  }

  private generateCSVContent(exportData: DirectShipExportData): string {
    const headers = ['판매주문ID', '주문라인ID', '상품명', '수량', '공급사SKU'];
    const rows = exportData.orders.map(order => [
      order.salesOrderId,
      order.salesOrderLineId,
      order.productName,
      order.quantity.toString(),
      order.supplierSku || ''
    ]);

    return [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');
  }

  async getDashboard(): Promise<DirectShipDashboard> {
    const allOrders = await this.getDirectShipOrders();

    const pendingOrders = allOrders.filter(o => o.status === 'pending').length;
    const forwardedOrders = allOrders.filter(o => o.status === 'forwarded').length;
    const completedOrders = allOrders.filter(o => o.status === 'completed').length;

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

    const recentActivity = allOrders
      .slice(0, 10)
      .map(order => ({
        fulfillmentOrderId: order.fulfillmentOrderId,
        salesOrderId: order.salesOrderId,
        companyName: order.companyName,
        action: this.getRecentAction(order),
        timestamp: this.getRecentTimestamp(order)
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
        completedCount: summary.completed
      })),
      recentActivity
    };
  }

  async getCompanyList(): Promise<Array<{
    companyName: string;
    orderCount: number;
    lastOrderDate?: Date;
  }>> {
    const ordersByCompany = await this.getDirectShipOrdersByCompany();

    return Array.from(ordersByCompany.entries()).map(([companyName, orders]) => ({
      companyName,
      orderCount: orders.length,
      lastOrderDate: orders.length > 0 ? orders[0].createdAt : undefined
    })).sort((a, b) => b.orderCount - a.orderCount);
  }

  private mapFOStatusToDirectShipStatus(foStatus: string): 'pending' | 'forwarded' | 'completed' | 'canceled' {
    switch (foStatus) {
      case 'created':
      case 'pending':
        return 'pending';
      case 'allocated':
      case 'forwarded':
        return 'forwarded';
      case 'completed':
      case 'shipped':
        return 'completed';
      case 'canceled':
        return 'canceled';
      default:
        return 'pending';
    }
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