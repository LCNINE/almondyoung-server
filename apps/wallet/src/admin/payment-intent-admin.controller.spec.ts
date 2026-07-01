import { ConflictException, HttpException } from '@nestjs/common';
import { PaymentIntentAdminController } from './payment-intent-admin.controller';

// cancel 은 서비스가 던진 HttpException(예: CMS 마감 후 취소불가 → 409)을 그대로 통과시켜야 한다.
// 그러지 않으면 message 정규식에 안 걸리는 에러코드가 InternalServerErrorException(500)으로 격하돼
// 관리자도 500 을 보고, 멱등 인터셉터가 500 을 캐시한다(Finding 3).
describe('PaymentIntentAdminController.cancel', () => {
  it('passes through a 409 HttpException from the service instead of re-mapping to 500 (W3)', async () => {
    const paymentIntentsService = {
      cancel: jest
        .fn()
        .mockRejectedValue(
          new ConflictException({ error: 'CMS_CUTOFF', message: 'CMS 출금 취소에 실패해 결제를 취소할 수 없습니다. (CMS_CUTOFF)' }),
        ),
    };
    const controller = new PaymentIntentAdminController(
      undefined as never,
      undefined as never,
      paymentIntentsService as never,
      undefined as never,
    );

    const err = await controller.cancel('intent-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(409);
  });
});
