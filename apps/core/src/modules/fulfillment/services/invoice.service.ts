import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { DbService } from '@app/db';
import { eq, inArray } from 'drizzle-orm';
import { FulfillmentsService } from './fulfillments.service';

interface ShippingAddressJson {
  recipientName?: string;
  name?: string;
  phone?: string;
  roadAddress?: string;
  detailAddress?: string;
  address?: string;
}
import { DeliveryProvider, DeliveryRequest } from './delivery-provider.interface';
import { GoodsflowDeliveryProvider } from './goodsflow-delivery.provider';

export interface IssueInvoiceRequest {
  fulfillmentOrderId: string;
  carrierCode: string;
  recipientName: string;
  recipientAddress: string;
  recipientPhone: string;
  senderName?: string;
  senderPhone?: string;
  deliveryMessage?: string;
  issueMethod?: 'goodsflow' | 'direct' | 'self';
}

export interface InvoiceDetail {
  id: string;
  fulfillmentOrderId: string;
  invoiceNumber: string;
  carrierCode?: string;
  issueMethod: 'goodsflow' | 'direct' | 'self';
  goodsflowServiceId?: string;
  status: 'issued' | 'printed' | 'shipped' | 'canceled';
  issuedAt?: Date;
  printedAt?: Date;
  shippedAt?: Date;
  recipientName?: string;
  recipientAddress?: string;
  recipientPhone?: string;
  items: Array<{
    id: string;
    foiId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
  }>;
}

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);
  private readonly deliveryProviders: Map<string, DeliveryProvider>;

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly fulfillmentsService: FulfillmentsService,
  ) {
    this.deliveryProviders = new Map();
    this.deliveryProviders.set('goodsflow', new GoodsflowDeliveryProvider());
  }

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async issueInvoice(request: IssueInvoiceRequest, tx?: DbTx): Promise<string> {
    const { fulfillmentOrderId, issueMethod = 'goodsflow' } = request;

    return this.inTx(async (trx) => {
      const foRows = await trx
        .select({ id: wmsTables.fulfillmentOrders.id, status: wmsTables.fulfillmentOrders.status })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);
      const fulfillmentOrder = foRows[0];

      if (!fulfillmentOrder) {
        throw new NotFoundException(`Fulfillment order ${fulfillmentOrderId} not found`);
      }

      const foiRows = await trx
        .select({
          foiId: wmsTables.fulfillmentOrderItems.id,
          salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
          productName: wmsTables.skus.name,
          quantity: wmsTables.fulfillmentOrderItems.qty,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));

      const salesOrderLineIds = foiRows.map((row) => row.salesOrderLineId).filter((id): id is string => id !== null);
      const salesOrderLines =
        salesOrderLineIds.length === 0
          ? []
          : await trx
              .select({ id: wmsTables.salesOrderLines.id, unitPrice: wmsTables.salesOrderLines.unitPrice })
              .from(wmsTables.salesOrderLines)
              .where(inArray(wmsTables.salesOrderLines.id, salesOrderLineIds));

      const priceMap = new Map(salesOrderLines.map((line) => [line.id, line.unitPrice]));

      if (fulfillmentOrder.status !== 'picked') {
        throw new ConflictException(`Cannot issue invoice for FO in status: ${fulfillmentOrder.status}`);
      }

      const existingRows = await trx
        .select({ id: wmsTables.invoices.id })
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.fulfillmentOrderId, fulfillmentOrderId))
        .limit(1);

      if (existingRows[0]) {
        throw new ConflictException(`Invoice already exists for FO ${fulfillmentOrderId}`);
      }

      let invoiceNumber: string;
      let goodsflowServiceId: string | undefined;

      if (issueMethod === 'goodsflow') {
        const provider = this.deliveryProviders.get('goodsflow');
        if (!provider) {
          throw new BadRequestException('Goodsflow provider not configured');
        }

        const deliveryRequest: DeliveryRequest = {
          centerCode: '',
          recipientName: request.recipientName,
          recipientAddress: request.recipientAddress,
          recipientPhone: request.recipientPhone,
          carrierCode: request.carrierCode,
          senderName: request.senderName,
          senderPhone: request.senderPhone,
          deliveryMessage: request.deliveryMessage,
          items: foiRows.map((row) => ({
            productName: row.productName ?? '',
            quantity: row.quantity,
            price: (row.salesOrderLineId && priceMap.get(row.salesOrderLineId)) || 0,
          })),
        };

        const response = await provider.issueInvoice(deliveryRequest);
        invoiceNumber = response.invoiceNumber;
        goodsflowServiceId = response.serviceId;
      } else {
        invoiceNumber = this.generateInvoiceNumber();
      }

      const [invoice] = await trx
        .insert(wmsTables.invoices)
        .values({
          fulfillmentOrderId,
          invoiceNumber,
          carrierCode: request.carrierCode,
          issueMethod,
          goodsflowServiceId,
          status: 'issued',
          issuedAt: new Date(),
        })
        .returning();

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'invoiced' })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

      this.logger.log(`Issued invoice ${invoiceNumber} for FO ${fulfillmentOrderId} via ${issueMethod}`);
      return invoice.id;
    }, tx);
  }

  async printInvoices(invoiceIds: string[], tx?: DbTx): Promise<{ printUri?: string }> {
    return this.inTx(async (trx) => {
      const invoices = await trx
        .select({
          id: wmsTables.invoices.id,
          issueMethod: wmsTables.invoices.issueMethod,
          goodsflowServiceId: wmsTables.invoices.goodsflowServiceId,
        })
        .from(wmsTables.invoices)
        .where(inArray(wmsTables.invoices.id, invoiceIds));

      if (invoices.length !== invoiceIds.length) {
        throw new NotFoundException('Some invoices not found');
      }

      const goodsflowInvoices = invoices.filter((inv) => inv.issueMethod === 'goodsflow' && inv.goodsflowServiceId);

      if (goodsflowInvoices.length === 0) {
        throw new BadRequestException('No Goodsflow invoices to print');
      }

      const provider = this.deliveryProviders.get('goodsflow');
      if (!provider) {
        throw new BadRequestException('Goodsflow provider not configured');
      }

      const serviceIds = goodsflowInvoices.map((inv) => inv.goodsflowServiceId!);
      const printResponse = await provider.generatePrintUri(serviceIds);

      await trx
        .update(wmsTables.invoices)
        .set({ status: 'printed', printedAt: new Date() })
        .where(
          inArray(
            wmsTables.invoices.id,
            goodsflowInvoices.map((inv) => inv.id),
          ),
        );

      this.logger.log(`Generated print URI for ${goodsflowInvoices.length} invoices`);
      return { printUri: printResponse.printUri };
    }, tx);
  }

  async markAsShipped(invoiceId: string, tx?: DbTx): Promise<void> {
    await this.inTx(async (trx) => {
      const invoice = await trx
        .select({
          id: wmsTables.invoices.id,
          fulfillmentOrderId: wmsTables.invoices.fulfillmentOrderId,
          issueMethod: wmsTables.invoices.issueMethod,
          invoiceNumber: wmsTables.invoices.invoiceNumber,
          status: wmsTables.invoices.status,
        })
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.id, invoiceId))
        .limit(1)
        .then((rows) => rows[0]);

      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }

      if (invoice.status === 'shipped') return;

      const isDirectOrSelf = invoice.issueMethod === 'direct' || invoice.issueMethod === 'self';
      const allowedStatuses = isDirectOrSelf ? ['issued', 'printed'] : ['printed'];
      if (!allowedStatuses.includes(invoice.status)) {
        throw new ConflictException(`Cannot ship invoice in status: ${invoice.status}`);
      }

      if (!invoice.invoiceNumber) {
        throw new BadRequestException('Cannot ship: invoiceNumber is required');
      }

      await trx
        .update(wmsTables.invoices)
        .set({ status: 'shipped', shippedAt: new Date() })
        .where(eq(wmsTables.invoices.id, invoiceId));

      // canonical ship path: FOI shippedQty, FO status='shipped', reservations, FulfillmentShipped event
      await this.fulfillmentsService.ship(invoice.fulfillmentOrderId, trx);

      this.logger.log(`Marked invoice ${invoiceId} as shipped`);
    }, tx);
  }

  async cancelInvoice(invoiceId: string, tx?: DbTx): Promise<void> {
    await this.inTx(async (trx) => {
      const invoice = await trx
        .select({
          id: wmsTables.invoices.id,
          fulfillmentOrderId: wmsTables.invoices.fulfillmentOrderId,
          issueMethod: wmsTables.invoices.issueMethod,
          goodsflowServiceId: wmsTables.invoices.goodsflowServiceId,
          status: wmsTables.invoices.status,
        })
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.id, invoiceId))
        .limit(1)
        .then((rows) => rows[0]);

      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }

      if (invoice.status === 'shipped') {
        throw new ConflictException('Cannot cancel shipped invoice');
      }

      if (invoice.issueMethod === 'goodsflow' && invoice.goodsflowServiceId) {
        const provider = this.deliveryProviders.get('goodsflow');
        if (provider) {
          try {
            await provider.cancelInvoice(invoice.goodsflowServiceId);
          } catch (error) {
            this.logger.warn(`Failed to cancel Goodsflow invoice ${invoice.goodsflowServiceId}:`, error);
          }
        }
      }

      await trx.update(wmsTables.invoices).set({ status: 'canceled' }).where(eq(wmsTables.invoices.id, invoiceId));

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'picked' })
        .where(eq(wmsTables.fulfillmentOrders.id, invoice.fulfillmentOrderId));

      this.logger.log(`Canceled invoice ${invoiceId}`);
    }, tx);
  }

  async getInvoiceDetail(invoiceId: string, tx?: DbTx): Promise<InvoiceDetail> {
    return this.inTx(async (trx) => {
      const rows = await trx
        .select({
          id: wmsTables.invoices.id,
          fulfillmentOrderId: wmsTables.invoices.fulfillmentOrderId,
          invoiceNumber: wmsTables.invoices.invoiceNumber,
          carrierCode: wmsTables.invoices.carrierCode,
          issueMethod: wmsTables.invoices.issueMethod,
          goodsflowServiceId: wmsTables.invoices.goodsflowServiceId,
          status: wmsTables.invoices.status,
          issuedAt: wmsTables.invoices.issuedAt,
          printedAt: wmsTables.invoices.printedAt,
          shippedAt: wmsTables.invoices.shippedAt,
          foShippingAddress: wmsTables.fulfillmentOrders.shippingAddress,
        })
        .from(wmsTables.invoices)
        .leftJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.invoices.fulfillmentOrderId),
        )
        .where(eq(wmsTables.invoices.id, invoiceId))
        .limit(1);

      const invoice = rows[0];
      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }

      const foiRows = await trx
        .select({
          foiId: wmsTables.fulfillmentOrderItems.id,
          salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
          productName: wmsTables.skus.name,
          quantity: wmsTables.fulfillmentOrderItems.qty,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, invoice.fulfillmentOrderId));

      const salesOrderLineIds = foiRows.map((r) => r.salesOrderLineId).filter((id): id is string => id !== null);
      const priceMap =
        salesOrderLineIds.length === 0
          ? new Map<string, number>()
          : await trx
              .select({ id: wmsTables.salesOrderLines.id, unitPrice: wmsTables.salesOrderLines.unitPrice })
              .from(wmsTables.salesOrderLines)
              .where(inArray(wmsTables.salesOrderLines.id, salesOrderLineIds))
              .then((lines) => new Map(lines.map((l) => [l.id, l.unitPrice])));

      const addr = invoice.foShippingAddress as ShippingAddressJson | null;
      const recipientName = addr?.recipientName ?? addr?.name ?? undefined;
      const recipientAddress = addr
        ? [addr.roadAddress ?? addr.address, addr.detailAddress].filter(Boolean).join(' ') || undefined
        : undefined;
      const recipientPhone = addr?.phone ?? undefined;

      return {
        id: invoice.id,
        fulfillmentOrderId: invoice.fulfillmentOrderId,
        invoiceNumber: invoice.invoiceNumber,
        carrierCode: invoice.carrierCode ?? undefined,
        issueMethod: invoice.issueMethod,
        goodsflowServiceId: invoice.goodsflowServiceId ?? undefined,
        status: invoice.status,
        issuedAt: invoice.issuedAt ?? undefined,
        printedAt: invoice.printedAt ?? undefined,
        shippedAt: invoice.shippedAt ?? undefined,
        recipientName,
        recipientAddress,
        recipientPhone,
        items: foiRows.map((r) => ({
          id: r.foiId,
          foiId: r.foiId,
          productName: r.productName ?? '',
          quantity: r.quantity,
          unitPrice: (r.salesOrderLineId && priceMap.get(r.salesOrderLineId)) || 0,
        })),
      };
    }, tx);
  }

  async trackInvoice(invoiceId: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const invoice = await trx
        .select({
          id: wmsTables.invoices.id,
          issueMethod: wmsTables.invoices.issueMethod,
          goodsflowServiceId: wmsTables.invoices.goodsflowServiceId,
        })
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.id, invoiceId))
        .limit(1)
        .then((rows) => rows[0]);

      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }

      if (invoice.issueMethod !== 'goodsflow' || !invoice.goodsflowServiceId) {
        throw new BadRequestException('Tracking is only available for Goodsflow invoices');
      }

      const provider = this.deliveryProviders.get('goodsflow');
      if (!provider) {
        throw new BadRequestException('Goodsflow provider not configured');
      }

      return provider.trackDelivery(invoice.goodsflowServiceId);
    }, tx);
  }

  private generateInvoiceNumber(): string {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `INV-${timestamp.slice(-8)}-${random}`;
  }
}
