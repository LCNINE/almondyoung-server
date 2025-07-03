import { InvoiceStatus } from '../schema';

export class UpdateInvoiceStatusDto {
  status: InvoiceStatus;
  reason?: string;
}
