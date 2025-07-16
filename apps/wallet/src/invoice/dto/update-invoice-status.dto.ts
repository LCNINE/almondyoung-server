import * as schema from '../../shared/schemas/schema';

export class UpdateInvoiceStatusDto {
  status: schema.InvoiceStatus;
  reason?: string;
}
