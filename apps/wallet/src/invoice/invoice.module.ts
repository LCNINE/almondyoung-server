import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { InvoiceListener } from './listeners/invoice.listener';

@Module({
  controllers: [InvoiceController],
  providers: [InvoiceService, InvoiceListener],
})
export class InvoiceModule {}
