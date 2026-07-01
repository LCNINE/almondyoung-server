import { ConflictException, Injectable, Logger } from '@nestjs/common';
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
    // 그러나 CMS 배치는 이미 효성에 출금신청이 들어가 있으므로 provider.cancel(효성 출금삭제)이 성공해야 실제
    // 은행 출금이 막힌다. (호출 안 하거나 결과를 무시하면 intent는 CANCELED인데 돈은 빠져나간다)
    const activeCharge = await this.chargesService.findActiveByIntentAndOperation(intent.id, 'AUTHORIZE');
    if (activeCharge) {
      const activeMethod = await this.paymentMethodsService.findById(activeCharge.paymentMethodId);
      if (activeMethod && activeMethod.type === 'CMS_BATCH') {
        await this.cancelCmsChargeOrThrow(activeCharge, intent, correlationId);
      } else {
        // 비-CMS active charge(POINTS hold/TOSS 대기)는 외부 확정 상태가 없어 DB CANCELED만으로 충분하다.
        await this.chargesService.updateStatus(activeCharge.id, 'CANCELED', {});
      }
    }

    // SUCCEEDED AUTHORIZE charges 해제. CMS 폴러가 정산 성공 시 charge 를 SUCCEEDED 로 올리므로(active 아님),
    // 정산완료 CMS 도 이 경로로 온다 → active 분기와 대칭으로 취소 성공 여부를 반드시 검사한다. 복합결제에서
    // 부분 해제를 막기 위해 CMS_BATCH 를 먼저 처리해, 실패 시 비-CMS hold 해제 전에 throw 되게 한다.
    const succeededAuthorizeCharges = await this.chargesService.findAllSucceededAuthorizeByIntent(intent.id);
    const withMethodType: Array<{ charge: (typeof succeededAuthorizeCharges)[number]; methodType: string }> = [];
    for (const charge of succeededAuthorizeCharges) {
      const method = await this.paymentMethodsService.findById(charge.paymentMethodId);
      if (!method) continue;
      withMethodType.push({ charge, methodType: method.type });
    }
    withMethodType.sort((a, b) => (a.methodType === 'CMS_BATCH' ? 0 : 1) - (b.methodType === 'CMS_BATCH' ? 0 : 1));

    for (const { charge, methodType } of withMethodType) {
      if (methodType === 'CMS_BATCH') {
        // 실패 시 throw → releaseIntentCharges 중단 → 상위(CancelService)가 intent 를 CANCELED 로 전이하지 못함.
        await this.cancelCmsChargeOrThrow(charge, intent, correlationId);
        continue;
      }
      const provider = this.providerRegistry.getProviderOrThrow(methodType);
      try {
        await provider.cancel({
          chargeId: charge.id,
          intentId: intent.id,
          paymentMethodId: charge.paymentMethodId,
          userId: intent.userId ?? '',
          amount: charge.amount,
          currency: intent.currency,
          idempotencyKey: `wallet:cancel:${methodType.toLowerCase()}:${charge.id}:${correlationId}`,
          correlationId,
        });
        await this.chargesService.updateStatus(charge.id, 'CANCELED', {});
      } catch (err) {
        this.logger.error(
          `Failed to release ${methodType} charge: intentId=${intent.id}, chargeId=${charge.id}, error=${err}`,
        );
        // Continue releasing the remaining charges even if one non-CMS provider call fails.
      }
    }
  }

  /**
   * CMS charge 취소: 효성 출금삭제가 성공해야만 내부를 CANCELED로 전이한다. provider.cancel 은 실패 시
   * throw 가 아니라 {status:'FAILED'} 를 반환하므로 반드시 반환값을 검사한다. 실패(마감 후/이미 정산완료
   * 등)면 여기서 throw 해 상위 호출자가 intent 를 CANCELED 로 전이하지 못하게 막는다 — 안 그러면 돈은
   * 빠지는데 취소완료로 보인다. active(PENDING) charge 와 succeeded(정산완료) charge 가 공유한다.
   */
  private async cancelCmsChargeOrThrow(
    charge: { id: string; paymentMethodId: string; amount: number },
    intent: ReleasableIntent,
    correlationId: string,
  ): Promise<void> {
    const provider = this.providerRegistry.getProviderOrThrow('CMS_BATCH');
    const result = await provider.cancel({
      chargeId: charge.id,
      intentId: intent.id,
      paymentMethodId: charge.paymentMethodId,
      userId: intent.userId ?? '',
      amount: charge.amount,
      currency: intent.currency,
      idempotencyKey: `wallet:cancel:cms_batch:${charge.id}:${correlationId}`,
      correlationId,
    });
    if (result.status !== 'SUCCEEDED') {
      this.logger.error(
        `CMS 출금 취소 실패 — 취소 중단(intent 비전이): intentId=${intent.id}, chargeId=${charge.id}, code=${result.errorCode}, msg=${result.errorMessage}`,
      );
      // ApplicationException 은 wallet 멱등 인터셉터가 500 으로 캐시하므로(wallet 은 GlobalExceptionFilter
      // 미등록) 반드시 HttpException 을 던진다. 그래야 유저/관리자 취소 경로가 409 응답 + 409 캐시가 된다.
      throw new ConflictException({
        error: result.errorCode ?? 'CMS_CANCEL_FAILED',
        message: `CMS 출금 취소에 실패해 결제를 취소할 수 없습니다. (${result.errorCode ?? 'CMS_CANCEL_FAILED'})`,
      });
    }
    await this.chargesService.updateStatus(charge.id, 'CANCELED', {});
  }
}
