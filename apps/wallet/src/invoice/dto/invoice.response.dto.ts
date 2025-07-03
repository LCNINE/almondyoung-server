import { InvoiceStatus } from '../schema';

export class InvoiceEventResponseDto {
  id: number;
  eventUuid: string;
  eventType: InvoiceStatus;
  reason: string | null;
  occurredAt: Date;
}

export class InvoiceResponseDto {
  id: number;
  userId: number;
  invoiceNumber: string;
  invoiceType: string;
  amount: string;
  currency: string;
  status: InvoiceStatus;
  expiresAt: Date;
  dueAt: Date | null;
  createdAt: Date;
  events: InvoiceEventResponseDto[];
}
