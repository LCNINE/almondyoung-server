import { handleCancelProjection, handleCaptureProjection, handleRefundProjection } from '../route';
import { capturePaymentWorkflow } from '@medusajs/core-flows';
import { completeCartWorkflow } from '@medusajs/medusa/core-flows';

// Workflow imports are mocked so importing the route is cheap and we can assert
// they are NOT invoked on skip paths.
jest.mock('@medusajs/core-flows', () => ({ capturePaymentWorkflow: jest.fn() }));
jest.mock('@medusajs/medusa/core-flows', () => ({ completeCartWorkflow: jest.fn() }));

type PaymentModuleStub = {
  listPaymentSessions: jest.Mock;
  listPayments: jest.Mock;
  updatePayment: jest.Mock;
};

function makeScope(paymentModule: Partial<PaymentModuleStub>) {
  const full: PaymentModuleStub = {
    listPaymentSessions: jest.fn().mockResolvedValue([]),
    listPayments: jest.fn().mockResolvedValue([]),
    updatePayment: jest.fn(),
    ...paymentModule,
  };
  const scope = { resolve: jest.fn().mockReturnValue(full) };
  return { scope, paymentModule: full };
}

const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };

beforeEach(() => jest.clearAllMocks());

describe('handleCancelProjection', () => {
  it('비-Medusa intent(session 없음)는 throw 없이 skip 한다', async () => {
    const { scope, paymentModule } = makeScope({
      listPaymentSessions: jest.fn().mockResolvedValue([]),
    });

    await expect(
      handleCancelProjection(scope as any, 'intent_non_medusa', 'msg_1', logger as any),
    ).resolves.toBeUndefined();

    expect(paymentModule.updatePayment).not.toHaveBeenCalled();
  });

  it('실제 Medusa payment가 있으면 canceled_at 으로 표시한다 (회귀 가드)', async () => {
    const payment = { id: 'pay_1', canceled_at: null, metadata: {} };
    const { scope, paymentModule } = makeScope({
      listPaymentSessions: jest.fn().mockResolvedValue([{ id: 'payses_1' }]),
      listPayments: jest.fn().mockResolvedValue([payment]),
    });

    await handleCancelProjection(scope as any, 'intent_medusa', 'msg_4', logger as any);

    expect(paymentModule.updatePayment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pay_1', canceled_at: expect.any(Date) }),
    );
  });
});

describe('handleCaptureProjection', () => {
  it('session 자체가 없으면 무통장 복구를 시도하지 않고 skip 한다', async () => {
    const { scope } = makeScope({
      listPaymentSessions: jest.fn().mockResolvedValue([]),
    });

    await expect(
      handleCaptureProjection(scope as any, 'intent_non_medusa', 'msg_2', logger as any),
    ).resolves.toBeUndefined();

    expect(completeCartWorkflow).not.toHaveBeenCalled();
    expect(capturePaymentWorkflow).not.toHaveBeenCalled();
  });
});

describe('handleRefundProjection', () => {
  it('Medusa payment 없으면 throw 없이 skip 한다', async () => {
    const { scope, paymentModule } = makeScope({
      listPaymentSessions: jest.fn().mockResolvedValue([]),
    });

    await expect(
      handleRefundProjection(scope as any, 'intent_non_medusa', 1000, 'msg_3', undefined, logger as any),
    ).resolves.toBeUndefined();

    expect(paymentModule.updatePayment).not.toHaveBeenCalled();
  });
});
