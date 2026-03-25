import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import {
  DeliveryProvider,
  DeliveryRequest,
  DeliveryResponse,
  PrintResponse,
  TrackingResponse,
} from './delivery-provider.interface';

export interface GoodsflowConfig {
  apiUrl: string;
  apiKey: string;
  centerCode: string;
}

@Injectable()
export class GoodsflowDeliveryProvider extends DeliveryProvider {
  private readonly logger = new Logger(GoodsflowDeliveryProvider.name);
  private readonly config: GoodsflowConfig;

  constructor() {
    super();
    this.config = {
      apiUrl: process.env.GOODSFLOW_API_URL || 'https://api.goodsflow.com',
      apiKey: process.env.GOODSFLOW_API_KEY || '',
      centerCode: process.env.GOODSFLOW_CENTER_CODE || '',
    };

    if (!this.config.apiKey || !this.config.centerCode) {
      this.logger.warn('Goodsflow API configuration is incomplete');
    }
  }

  async issueInvoice(request: DeliveryRequest): Promise<DeliveryResponse> {
    try {
      const payload = {
        center_code: request.centerCode || this.config.centerCode,
        recipient_name: request.recipientName,
        recipient_address: request.recipientAddress,
        recipient_phone: request.recipientPhone,
        sender_name: request.senderName || 'AlmondYoung',
        sender_phone: request.senderPhone || '02-1234-5678',
        carrier_code: request.carrierCode,
        delivery_message: request.deliveryMessage || '',
        items: request.items.map((item) => ({
          product_name: item.productName,
          quantity: item.quantity,
          price: item.price,
        })),
      };

      const response = await this.makeRequest('/v1/invoices', 'POST', payload);

      this.logger.log(`Issued invoice via Goodsflow: ${response.service_id}`);

      return {
        serviceId: response.service_id,
        invoiceNumber: response.invoice_number,
        carrierCode: response.carrier_code,
        estimatedDeliveryDate: response.estimated_delivery_date,
      };
    } catch (error) {
      this.logger.error('Failed to issue invoice via Goodsflow:', error);
      throw new BadRequestException('Failed to issue invoice');
    }
  }

  async generatePrintUri(serviceIds: string[]): Promise<PrintResponse> {
    try {
      const payload = {
        service_ids: serviceIds,
      };

      const response = await this.makeRequest('/v1/invoices/print', 'POST', payload);

      this.logger.log(`Generated print URI for ${serviceIds.length} invoices`);

      return {
        printUri: response.print_uri,
        expiresAt: response.expires_at ? new Date(response.expires_at) : undefined,
      };
    } catch (error) {
      this.logger.error('Failed to generate print URI via Goodsflow:', error);
      throw new BadRequestException('Failed to generate print URI');
    }
  }

  async trackDelivery(serviceId: string): Promise<TrackingResponse> {
    try {
      const response = await this.makeRequest(`/v1/invoices/${serviceId}/tracking`, 'GET');

      return {
        serviceId: response.service_id,
        invoiceNumber: response.invoice_number,
        status: this.mapGoodsflowStatus(response.status),
        location: response.location,
        timestamp: new Date(response.timestamp),
        description: response.description,
      };
    } catch (error) {
      this.logger.error(`Failed to track delivery ${serviceId} via Goodsflow:`, error);
      throw new BadRequestException('Failed to track delivery');
    }
  }

  async cancelInvoice(serviceId: string): Promise<void> {
    try {
      await this.makeRequest(`/v1/invoices/${serviceId}/cancel`, 'POST');
      this.logger.log(`Canceled invoice ${serviceId} via Goodsflow`);
    } catch (error) {
      this.logger.error(`Failed to cancel invoice ${serviceId} via Goodsflow:`, error);
      throw new BadRequestException('Failed to cancel invoice');
    }
  }

  private async makeRequest(endpoint: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', data?: any): Promise<any> {
    const url = `${this.config.apiUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      'X-Center-Code': this.config.centerCode,
    };

    const options: RequestInit = {
      method,
      headers,
      ...(data && { body: JSON.stringify(data) }),
    };

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Goodsflow API error: ${response.status} - ${errorData}`);
    }

    return response.json();
  }

  private mapGoodsflowStatus(goodsflowStatus: string): TrackingResponse['status'] {
    switch (goodsflowStatus) {
      case 'pending':
      case 'processing':
        return 'pending';
      case 'shipped':
      case 'in_delivery':
        return 'in_transit';
      case 'delivered':
        return 'delivered';
      case 'failed':
      case 'exception':
        return 'failed';
      case 'canceled':
        return 'canceled';
      default:
        return 'pending';
    }
  }
}
