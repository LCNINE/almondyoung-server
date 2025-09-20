import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import { and, eq, inArray } from 'drizzle-orm';
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
    @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>
  ) {
    this.deliveryProviders = new Map();
    this.deliveryProviders.set('goodsflow', new GoodsflowDeliveryProvider());
  }

  private get db() {
    return this.dbService.db;
  }

  async issueInvoice(request: IssueInvoiceRequest): Promise<string> {
    const { fulfillmentOrderId, issueMethod = 'goodsflow' } = request;

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

    // Get price information from sales order lines
    const salesOrderLineIds = fulfillmentOrder.items.map(item => item.salesOrderLineId);
    const salesOrderLines = await this.db.query.salesOrderLines.findMany({
      where: inArray(wmsTables.salesOrderLines.id, salesOrderLineIds)
    });

    // Create price lookup map
    const priceMap = new Map(
      salesOrderLines.map(line => [line.id, line.unitPrice])
    );

    if (fulfillmentOrder.status !== 'picked') {
      throw new ConflictException(`Cannot issue invoice for FO in status: ${fulfillmentOrder.status}`);
    }

    const existingInvoice = await this.db.query.invoices.findFirst({
      where: eq(wmsTables.invoices.fulfillmentOrderId, fulfillmentOrderId)
    });

    if (existingInvoice) {
      throw new ConflictException(`Invoice already exists for FO ${fulfillmentOrderId}`);
    }

    return this.db.transaction(async (tx) => {
      let invoiceNumber: string;
      let goodsflowServiceId: string | undefined;

      if (issueMethod === 'goodsflow') {
        const provider = this.deliveryProviders.get('goodsflow');
        if (!provider) {
          throw new BadRequestException('Goodsflow provider not configured');
        }

        const deliveryRequest: DeliveryRequest = {
          centerCode: '', // Will be set from config
          recipientName: request.recipientName,
          recipientAddress: request.recipientAddress,
          recipientPhone: request.recipientPhone,
          carrierCode: request.carrierCode,
          senderName: request.senderName,
          senderPhone: request.senderPhone,
          deliveryMessage: request.deliveryMessage,
          items: fulfillmentOrder.items.map(item => ({
            productName: item.sku.name,
            quantity: item.qty,
            price: priceMap.get(item.salesOrderLineId) || 0
          }))
        };

        const response = await provider.issueInvoice(deliveryRequest);
        invoiceNumber = response.invoiceNumber;
        goodsflowServiceId = response.serviceId;

      } else {
        invoiceNumber = this.generateInvoiceNumber();
      }

      const [invoice] = await tx.insert(wmsTables.invoices)
        .values({
          fulfillmentOrderId,
          invoiceNumber,
          carrierCode: request.carrierCode,
          issueMethod,
          goodsflowServiceId,
          status: 'issued',
          issuedAt: new Date()
        })
        .returning();


      await tx.update(wmsTables.fulfillmentOrders)
        .set({
          status: 'invoiced',
          invoicedAt: new Date()
        })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

      this.logger.log(`Issued invoice ${invoiceNumber} for FO ${fulfillmentOrderId} via ${issueMethod}`);
      return invoice.id;
    });
  }

  async printInvoices(invoiceIds: string[]): Promise<{ printUri?: string }> {
    const invoices = await this.db.query.invoices.findMany({
      where: inArray(wmsTables.invoices.id, invoiceIds)
    });

    if (invoices.length !== invoiceIds.length) {
      throw new NotFoundException('Some invoices not found');
    }

    const goodsflowInvoices = invoices.filter(inv => inv.issueMethod === 'goodsflow' && inv.goodsflowServiceId);

    if (goodsflowInvoices.length === 0) {
      throw new BadRequestException('No Goodsflow invoices to print');
    }

    const provider = this.deliveryProviders.get('goodsflow');
    if (!provider) {
      throw new BadRequestException('Goodsflow provider not configured');
    }

    const serviceIds = goodsflowInvoices.map(inv => inv.goodsflowServiceId!);
    const printResponse = await provider.generatePrintUri(serviceIds);

    await this.db.update(wmsTables.invoices)
      .set({
        status: 'printed',
        printedAt: new Date()
      })
      .where(inArray(wmsTables.invoices.id, goodsflowInvoices.map(inv => inv.id)));

    this.logger.log(`Generated print URI for ${goodsflowInvoices.length} invoices`);

    return {
      printUri: printResponse.printUri
    };
  }

  async markAsShipped(invoiceId: string): Promise<void> {
    const invoice = await this.db.query.invoices.findFirst({
      where: eq(wmsTables.invoices.id, invoiceId)
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }

    if (invoice.status === 'shipped') {
      return; // Already shipped
    }

    if (invoice.status !== 'printed') {
      throw new ConflictException(`Cannot ship invoice in status: ${invoice.status}`);
    }

    await this.db.transaction(async (tx) => {
      await tx.update(wmsTables.invoices)
        .set({
          status: 'shipped',
          shippedAt: new Date()
        })
        .where(eq(wmsTables.invoices.id, invoiceId));

      await tx.update(wmsTables.fulfillmentOrders)
        .set({
          status: 'shipped',
          shippedAt: new Date()
        })
        .where(eq(wmsTables.fulfillmentOrders.id, invoice.fulfillmentOrderId));

      this.logger.log(`Marked invoice ${invoiceId} as shipped`);
    });
  }

  async cancelInvoice(invoiceId: string): Promise<void> {
    const invoice = await this.db.query.invoices.findFirst({
      where: eq(wmsTables.invoices.id, invoiceId)
    });

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

    await this.db.transaction(async (tx) => {
      await tx.update(wmsTables.invoices)
        .set({
          status: 'canceled',
          canceledAt: new Date()
        })
        .where(eq(wmsTables.invoices.id, invoiceId));

      await tx.update(wmsTables.fulfillmentOrders)
        .set({
          status: 'picked' // Revert to picked status
        })
        .where(eq(wmsTables.fulfillmentOrders.id, invoice.fulfillmentOrderId));

      this.logger.log(`Canceled invoice ${invoiceId}`);
    });
  }

  async getInvoiceDetail(invoiceId: string): Promise<InvoiceDetail> {
    const invoice = await this.db.query.invoices.findFirst({
      where: eq(wmsTables.invoices.id, invoiceId),
      with: {
        items: true
      }
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }

    return {
      id: invoice.id,
      fulfillmentOrderId: invoice.fulfillmentOrderId,
      invoiceNumber: invoice.invoiceNumber,
      carrierCode: invoice.carrierCode,
      issueMethod: invoice.issueMethod,
      goodsflowServiceId: invoice.goodsflowServiceId,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      printedAt: invoice.printedAt,
      shippedAt: invoice.shippedAt,
      items: invoice.items.map(item => ({
        id: item.id,
        foiId: item.foiId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice
      }))
    };
  }

  async trackInvoice(invoiceId: string) {
    const invoice = await this.db.query.invoices.findFirst({
      where: eq(wmsTables.invoices.id, invoiceId)
    });

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
  }

  private generateInvoiceNumber(): string {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `INV-${timestamp.slice(-8)}-${random}`;
  }
}