import { ForbiddenException } from '@nestjs/common';
import { PaymentIntentsController } from './payment-intents.controller';
import type { PaymentIntentsService } from './payment-intents.service';
import type { RefundsService } from '../refunds/refunds.service';
import type { TossApiClient } from '../providers/toss/toss-api.client';
import type { AuthenticatedRequest } from '../wallet.module';

describe('PaymentIntentsController BrandPay authorization', () => {
  const originalSecret = process.env.TOSS_WIDGET_SECRET_KEY;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.TOSS_WIDGET_SECRET_KEY;
    else process.env.TOSS_WIDGET_SECRET_KEY = originalSecret;
  });

  it('rejects a customerKey that differs from the signed-in user before calling Toss', async () => {
    process.env.TOSS_WIDGET_SECRET_KEY = 'test_gsk_widget';
    const service = { findByIdOrThrow: jest.fn() };
    const tossApi = { issueBrandPayAccessToken: jest.fn() };
    const controller = new PaymentIntentsController(
      service as unknown as PaymentIntentsService,
      {} as RefundsService,
      tossApi as unknown as TossApiClient,
    );
    const request = { jwtUserId: 'user-1' } as AuthenticatedRequest;

    await expect(
      controller.authorizeBrandPay('intent-1', { code: 'code', customerKey: 'user-user-2' }, request),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.findByIdOrThrow).not.toHaveBeenCalled();
    expect(tossApi.issueBrandPayAccessToken).not.toHaveBeenCalled();
  });

  it('checks intent ownership before exchanging the code', async () => {
    process.env.TOSS_WIDGET_SECRET_KEY = 'test_gsk_widget';
    const service = { findByIdOrThrow: jest.fn().mockResolvedValue({ userId: 'other-user' }) };
    const tossApi = { issueBrandPayAccessToken: jest.fn() };
    const controller = new PaymentIntentsController(
      service as unknown as PaymentIntentsService,
      {} as RefundsService,
      tossApi as unknown as TossApiClient,
    );
    const request = { jwtUserId: 'user-1' } as AuthenticatedRequest;

    await expect(
      controller.authorizeBrandPay('intent-1', { code: 'code', customerKey: 'user-user-1' }, request),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tossApi.issueBrandPayAccessToken).not.toHaveBeenCalled();
  });

});
