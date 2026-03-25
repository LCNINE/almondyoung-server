export interface DeliveryRequest {
  centerCode: string;
  recipientName: string;
  recipientAddress: string;
  recipientPhone: string;
  items: Array<{
    productName: string;
    quantity: number;
    price: number;
  }>;
  carrierCode: string;
  senderName?: string;
  senderPhone?: string;
  deliveryMessage?: string;
}

export interface DeliveryResponse {
  serviceId: string;
  invoiceNumber: string;
  carrierCode: string;
  estimatedDeliveryDate?: string;
}

export interface PrintResponse {
  printUri: string;
  expiresAt?: Date;
}

export interface TrackingResponse {
  serviceId: string;
  invoiceNumber: string;
  status: 'pending' | 'in_transit' | 'delivered' | 'failed' | 'canceled';
  location?: string;
  timestamp: Date;
  description?: string;
}

export abstract class DeliveryProvider {
  abstract issueInvoice(request: DeliveryRequest): Promise<DeliveryResponse>;
  abstract generatePrintUri(serviceIds: string[]): Promise<PrintResponse>;
  abstract trackDelivery(serviceId: string): Promise<TrackingResponse>;
  abstract cancelInvoice(serviceId: string): Promise<void>;
}
