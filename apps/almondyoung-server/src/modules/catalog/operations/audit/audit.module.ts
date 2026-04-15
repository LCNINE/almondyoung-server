import { Module } from '@nestjs/common';
import { ProductAuditController } from './product-audit.controller';
import { ProductAuditService } from './product-audit.service';

@Module({
  controllers: [ProductAuditController],
  providers: [ProductAuditService],
  exports: [ProductAuditService],
})
export class AuditModule {}
