import { Injectable, Logger } from '@nestjs/common';
import { ConflictError } from '@app/shared';
import { ChargesService } from '../charges/charges.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { ProviderRegistry } from '../providers/provider.registry';

/** Minimal intent shape required to release its charges. */
export interface ReleasableIntent {
  id: string;
  userId: string | null;
  currency: string;
}

/**
 * Releases the provider-side holds/authorizations backing an intent's charges,
 * without owning the intent's terminal state transition.
 *
 * Extracted from CancelService so that cancel, expiration, and confirm-retry
 * share one cleanup path (POINTS hold release, TOSS cancel, …).
 */
@Injectable()
export class ChargeReleaseService {
  private readonly logger = new Logger(ChargeReleaseService.name);

  constructor(
    private readonly chargesService: ChargesService,
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async releaseIntentCharges(intent: ReleasableIntent, correlationId: string): Promise<void> {
    // 대부분의 in-flight charge(POINTS hold/TOSS 결제창 대기)는 외부에 확정된 상태가 없어 DB CANCELED만으로 충분하다.
    // 그러나 CMS 배치는 PENDING 시점에 이미 효성에 출금신청(cms_withdrawals=REQUESTED)이 들어가 있으므로
    // provider.cancel(효성 출금삭제)을 호출해야 실제 은행 출금이 막힌다. (호출 안 하면 intent는 CANCELED인데 돈은 빠져나간다)
    const activeCharge = await this.chargesService.findActiveByIntentAndOperation(intent.id, 'AUTHORIZE');
    if (activeCharge) {
      const activeMethod = await this.paymentMethodsService.findById(activeCharge.paymentMethodId);
      if (activeMethod && activeMethod.type === 'CMS_BATCH') {
        // CMS는 PENDING 시점에 이미 효성 출금신청이 들어가 있으므로 provider.cancel(출금삭제)이
        // 성공해야만 내부를 CANCELED로 전이한다. cancel은 실패 시 throw가 아니라 {status:'FAILED'}를
        // 반환하므로 반드시 반환값을 검사한다. 실패(마감 후 취소불가 등)면 여기서 throw해 상위 호출자가
        // intent를 CANCELED로 전이하지 못하게 막는다 — 안 그러면 돈은 빠지는데 취소완료로 보인다.
        const provider = this.providerRegistry.getProviderOrThrow(activeMethod.type);
        const result = await provider.cancel({
          chargeId: activeCharge.id,
          intentId: intent.id,
          paymentMethodId: activeCharge.paymentMethodId,
          userId: intent.userId ?? '',
          amount: activeCharge.amount,
          currency: intent.currency,
          idempotencyKey: `wallet:cancel:cms_batch:${activeCharge.id}:${correlationId}`,
          correlationId,
        });
        if (result.status !== 'SUCCEEDED') {
          this.logger.error(
            `CMS 출금 취소 실패 — 취소 중단(intent 비전이): intentId=${intent.id}, chargeId=${activeCharge.id}, code=${result.errorCode}, msg=${result.errorMessage}`,
          );
          throw new ConflictError(
            `CMS 출금 취소에 실패해 결제를 취소할 수 없습니다. (${result.errorCode ?? 'CMS_CANCEL_FAILED'})`,
          );
        }
      }
      // CMS는 위에서 성공했을 때만 도달. 비-CMS active charge(POINTS hold/TOSS 대기)는
      // 외부 확정 상태가 없어 DB CANCELED만으로 충분하다.
      await this.chargesService.updateStatus(activeCharge.id, 'CANCELED', {});
    }

    // Release all SUCCEEDED AUTHORIZE charges via their respective providers
    // (POINTS requires a hold-release call; TOSS/others require a refund/cancel API call).
    const succeededAuthorizeCharges = await this.chargesService.findAllSucceededAuthorizeByIntent(intent.id);
    for (const charge of succeededAuthorizeCharges) {
      const method = await this.paymentMethodsService.findById(charge.paymentMethodId);
      if (!method) continue;
      const provider = this.providerRegistry.getProviderOrThrow(method.type);
      try {
        await provider.cancel({
          chargeId: charge.id,
          intentId: intent.id,
          paymentMethodId: charge.paymentMethodId,
          userId: intent.userId ?? '',
          amount: charge.amount,
          currency: intent.currency,
          idempotencyKey: `wallet:cancel:${method.type.toLowerCase()}:${charge.id}:${correlationId}`,
          correlationId,
        });
        await this.chargesService.updateStatus(charge.id, 'CANCELED', {});
      } catch (err) {
        this.logger.error(
          `Failed to release ${method.type} charge: intentId=${intent.id}, chargeId=${charge.id}, error=${err}`,
        );
        // Continue releasing the remaining charges even if one provider call fails.
      }
    }
  }
}
