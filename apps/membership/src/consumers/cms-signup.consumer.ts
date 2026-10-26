import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventPayload, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { UserContactClient } from '@app/shared';
import { SubscriptionService } from '../services/subscription.service';
import { ActiveSubscriptionExistsException } from '../shared/exceptions/subscription.exceptions';
import { PAYMENT_STREAM } from '@packages/event-contracts/streams/payment.stream';
import { EventPayloadOf } from '@packages/event-contracts/types';

/**
 * 가입 도중 등록한 CMS 계좌의 동의자료가 접수되면 정기 가입을 만든다.
 * 브라우저가 스토어프론트로 돌아오지 못해도 가입이 생기게 하려고 서버로 옮겨 온 경로다.
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class CmsSignupConsumer {
  private readonly logger = new Logger(CmsSignupConsumer.name);

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly userContactClient: UserContactClient,
  ) {}

  @On(PAYMENT_STREAM, 'cms.signup.requested')
  async onCmsSignupRequested(@EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'cms.signup.requested'>) {
    const email = await this.findEmail(payload.userId);
    try {
      await this.subscriptionService.subscribeWithBillingMethod(
        payload.userId,
        payload.planId,
        email,
        payload.billingMethodId,
        'recurring',
        undefined,
        payload.termsAgreementId ?? undefined,
      );
      this.logger.log(`[CmsSignup] 가입 생성: userId=${payload.userId} cmsAgreementId=${payload.cmsAgreementId}`);
    } catch (err) {
      // 재배달이거나 고객이 직접 먼저 가입했다.
      if (err instanceof ActiveSubscriptionExistsException) {
        this.logger.log(`[CmsSignup] 이미 가입됨, 스킵: userId=${payload.userId}`);
        return;
      }
      throw err;
    }
  }

  // 이메일은 그룹 동기화 이벤트에 싣는 부가 정보라, 못 찾아도 가입은 만든다.
  private async findEmail(userId: string): Promise<string> {
    try {
      return (await this.userContactClient.findContacts([userId])).get(userId)?.email ?? '';
    } catch (err) {
      this.logger.warn(`[CmsSignup] 연락처 조회 실패 (userId=${userId}): ${err instanceof Error ? err.message : err}`);
      return '';
    }
  }
}
