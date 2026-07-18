import { UnprocessableEntityException } from '@nestjs/common';
import { CaptureService } from './capture.service';

const authorizeCharge = {
  id: 'c1',
  paymentMethodId: 'pm1',
  amount: 1000,
  currency: 'KRW',
  providerTransactionId: 'ptx',
} as never;

function makeService(opts: {
  captureResult?: { status: string; errorCode?: string };
  existingCharge?: { id: string; status: string } | null;
  createThrows23505?: boolean;
} = {}) {
  const provider = {
    capture: jest.fn().mockResolvedValue(opts.captureResult ?? { status: 'SUCCEEDED', providerTransactionId: 'cap-ptx' }),
  };
  const dbService = {
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ userId: 'u1' }]) }) }) }),
    },
  };
  const paymentMethodsService = { findById: jest.fn().mockResolvedValue({ id: 'pm1', type: 'CMS_BATCH' }) };
  const findByKey = jest.fn();
  if (opts.createThrows23505) {
    findByKey.mockResolvedValueOnce(null).mockResolvedValueOnce(opts.existingCharge ?? { id: 'cap1', status: 'FAILED' });
  } else {
    findByKey.mockResolvedValue(opts.existingCharge ?? null);
  }
  const chargesService = {
    findAllSucceededAuthorizeByIntent: jest.fn().mockResolvedValue([authorizeCharge]),
    findByProviderIdempotencyKey: findByKey,
    generateIdempotencyKey: jest.fn().mockReturnValue('wallet:capture:c1'),
    create: opts.createThrows23505
      ? jest.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }))
      : jest.fn().mockResolvedValue({ id: 'cap1', status: 'CREATED' }),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  };
  const providerRegistry = { getProviderOrThrow: jest.fn().mockReturnValue(provider) };
  const stateTransitionService = { transitionIntent: jest.fn().mockResolvedValue(undefined) };

  const service = new CaptureService(
    dbService as never,
    paymentMethodsService as never,
    chargesService as never,
    providerRegistry as never,
    stateTransitionService as never,
  );
  return { service, provider, chargesService, stateTransitionService };
}

describe('CaptureService', () => {
  it('전 leg 실패 → throw + intent를 FAILED로 전이하지 않음(불법전이 방지)', async () => {
    const { service, stateTransitionService } = makeService({ captureResult: { status: 'FAILED', errorCode: 'X' } });
    await expect(service.capture('intent-1', 'corr-1')).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(stateTransitionService.transitionIntent).not.toHaveBeenCalled();
  });

  it('이미 SUCCEEDED인 capture charge → 재생성/provider 호출 없이 성공 처리', async () => {
    const { service, provider, chargesService, stateTransitionService } = makeService({
      existingCharge: { id: 'cap1', status: 'SUCCEEDED' },
    });
    await service.capture('intent-1', 'corr-1');
    expect(chargesService.create).not.toHaveBeenCalled();
    expect(provider.capture).not.toHaveBeenCalled();
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith('intent-1', 'CAPTURED', expect.anything());
  });

  it('동시 INSERT 23505 → 기존 charge 재조회 후 재시도 성공', async () => {
    const { service, provider, chargesService, stateTransitionService } = makeService({ createThrows23505: true });
    await service.capture('intent-1', 'corr-1');
    expect(provider.capture).toHaveBeenCalledTimes(1);
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith('intent-1', 'CAPTURED', expect.anything());
  });

  it('기존 FAILED charge 재사용 후 재시도 성공 시 에러필드를 null로 clear', async () => {
    const { service, chargesService } = makeService({ existingCharge: { id: 'cap1', status: 'FAILED' } });
    await service.capture('intent-1', 'corr-1');
    expect(chargesService.updateStatus).toHaveBeenCalledWith(
      'cap1',
      'SUCCEEDED',
      expect.objectContaining({ errorCode: null, errorMessage: null }),
    );
  });
});
