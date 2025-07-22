import { Module } from '@nestjs/common';
import { RefundService } from './refund.service';
import { RefundController } from './refund.controller';
import { RefundAdminController } from './refund-admin.controller';

/**
 * 환불(Refund) 모듈
 * - RefundService: 환불 비즈니스 로직 처리
 * - RefundController: 사용자용 환불 요청 API
 * - RefundAdminController: CS팀용 환불 관리 API
 */
@Module({
  providers: [RefundService],
  controllers: [RefundController, RefundAdminController],
  exports: [RefundService],
})
export class RefundModule {}