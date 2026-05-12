import { Module } from '@nestjs/common';
import { ProductApprovalController } from './product-approval.controller';
import { ProductApprovalService } from './product-approval.service';

@Module({
  controllers: [ProductApprovalController],
  providers: [ProductApprovalService],
  exports: [ProductApprovalService],
})
export class ApprovalModule {}
