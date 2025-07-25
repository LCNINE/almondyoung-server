import { Module } from '@nestjs/common';
import { PgProviderModule } from '../pg-provider/pg-provider.module';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { InvoiceSessionService } from './invoice-session.service';
import { InvoiceListener } from './listeners/invoice.listener';
/**
 * Invoice 모듈
 * - InvoiceController: Invoice CRUD API
 * - InvoiceService: Invoice 비즈니스 로직
 */
@Module({
  imports: [PgProviderModule],
  controllers: [InvoiceController],
  providers: [InvoiceService, InvoiceSessionService, InvoiceListener],
  exports: [InvoiceService, InvoiceSessionService],
})
export class InvoiceModule {}
