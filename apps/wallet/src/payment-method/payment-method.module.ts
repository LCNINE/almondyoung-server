import { Module } from '@nestjs/common';
import { PaymentMethodService } from './payment-method.service';
import { PaymentMethodController } from './payment-method.controller';
import { SharedModule } from '@app/shared';
import { BnplService } from './bnpl.service';
// HMS API 서비스들
import { CardPaymentProfileService, CardPaymentTransactionService } from './services/card-payment.service';
import { BatchCmsMemberService, BatchCmsAgreementService, BatchCmsWithdrawalService } from './services/batch-cms.service';

@Module({
  imports: [SharedModule],
  controllers: [PaymentMethodController],
  providers: [
    PaymentMethodService,
    BnplService,
    // 카드 결제 서비스들 (실제 HMS API)
    CardPaymentProfileService,
    CardPaymentTransactionService,
    // 배치 CMS 서비스들 (목업서버)
    BatchCmsMemberService,
    BatchCmsAgreementService,
    BatchCmsWithdrawalService,
  ],
  exports: [PaymentMethodService, BnplService],
})
export class PaymentMethodModule {}
