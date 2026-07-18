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
        await this.cancelChargeOrThrow(activeMethod.type, activeCharge, intent, correlationId);
      } else {
        // 비-CMS active charge(POINTS hold/TOSS 결제창 대기)는 외부에 확정된 상태가 없어 DB CANCELED만으로 충분하다.
        await this.chargesService.updateStatus(activeCharge.id, 'CANCELED', {});
      }
    }

    // SUCCEEDED AUTHORIZE charges 해제. 이건 외부에 이미 확정된 매출(CMS 정산완료, TOSS/NICEPAY 빌링 승인)이므로
    // provider.cancel 이 실제로 성공해야만 내부를 CANCELED 로 전이할 수 있다 — 결과를 무시하면 돈은 빠졌는데
    // 취소완료로 보인다. provider 는 실패 시 throw 가 아니라 {status:'FAILED'} 를 반환하므로 반드시 검사한다.
    // 복합결제에서 부분 해제를 막기 위해 CMS_BATCH 를 먼저 처리해, 실패 시 나머지 해제 전에 throw 되게 한다.
    const succeededAuthorizeCharges = await this.chargesService.findAllSucceededAuthorizeByIntent(intent.id);
    const withMethodType: Array<{ charge: (typeof succeededAuthorizeCharges)[number]; methodType: string }> = [];
    for (const charge of succeededAuthorizeCharges) {
      const method = await this.paymentMethodsService.findById(charge.paymentMethodId);
      if (!method) continue;
      withMethodType.push({ charge, methodType: method.type });
    }
    withMethodType.sort((a, b) => (a.methodType === 'CMS_BATCH' ? 0 : 1) - (b.methodType === 'CMS_BATCH' ? 0 : 1));

    for (const { charge, methodType } of withMethodType) {
      // 실패 시 throw → releaseIntentCharges 중단 → 상위(CancelService)가 intent 를 CANCELED 로 전이하지 못함.
      await this.cancelChargeOrThrow(methodType, charge, intent, correlationId);
    }
  }

  /**
   * 외부 확정 상태가 있는 charge 취소: provider 취소가 성공해야만 내부를 CANCELED로 전이한다. provider.cancel 은
   * 실패 시 throw 가 아니라 {status:'FAILED'} 를 반환하므로 반드시 반환값을 검사한다. 실패(마감 후/이미 정산완료/
   * 토스 취소 거부 등)면 여기서 throw 해 상위 호출자가 intent 를 CANCELED 로 전이하지 못하게 막는다 — 안 그러면
   * 돈은 빠지는데 취소완료로 보인다. CMS active(PENDING) charge 와 모든 정산완료 charge 가 공유한다.
   */
  private async cancelChargeOrThrow(
    methodType: string,
    charge: { id: string; paymentMethodId: string; amount: number },
    intent: ReleasableIntent,
    correlationId: string,
  ): Promise<void> {
    const provider = this.providerRegistry.getProviderOrThrow(methodType);
    const result = await provider.cancel({
      chargeId: charge.id,
      intentId: intent.id,
      paymentMethodId: charge.paymentMethodId,
      userId: intent.userId ?? '',
      amount: charge.amount,
      currency: intent.currency,
      idempotencyKey: `wallet:cancel:${methodType.toLowerCase()}:${charge.id}:${correlationId}`,
      correlationId,
    });
    if (result.status !== 'SUCCEEDED') {
      this.logger.error(
        `결제 취소 실패 — 취소 중단(intent 비전이): methodType=${methodType}, intentId=${intent.id}, chargeId=${charge.id}, code=${result.errorCode}, msg=${result.errorMessage}`,
      );
      // ApplicationException 은 wallet 멱등 인터셉터가 500 으로 캐시하므로(wallet 은 GlobalExceptionFilter
      // 미등록) 반드시 HttpException 을 던진다. 그래야 유저/관리자 취소 경로가 409 응답 + 409 캐시가 된다.
      throw new ConflictException({
        error: result.errorCode ?? `${methodType}_CANCEL_FAILED`,
        message: `결제 취소에 실패해 결제를 취소할 수 없습니다. (${result.errorCode ?? `${methodType}_CANCEL_FAILED`})`,
      });
    }
    await this.chargesService.updateStatus(charge.id, 'CANCELED', {});
  }
}
