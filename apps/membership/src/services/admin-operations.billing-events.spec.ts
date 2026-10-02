import { AdminOperationsService } from './admin-operations.service';

const INTENT_ID = 'intent-1';
const CONTRACT_ID = 'contract-1';

const invoiceChargeEvent = {
  id: 'ev-1',
  contractId: CONTRACT_ID,
  eventType: 'CHARGE_SUCCESS',
  attemptNo: null,
  amount: 4990,
  paymentIntentId: INTENT_ID,
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-09-30T22:30:06.675Z',
};

function build(events: unknown[]) {
  const reader = {
    findBillingEventsByUserId: jest.fn().mockResolvedValue(events),
    findBillingEventsByContractId: jest.fn().mockResolvedValue(events),
    findContractPaymentRefsByUserId: jest
      .fn()
      .mockResolvedValue([{ contractId: CONTRACT_ID, lastPaymentIntentId: INTENT_ID }]),
    findContractPaymentRef: jest.fn().mockResolvedValue({ lastPaymentIntentId: INTENT_ID }),
  };
  const paymentClient = {
    getWalletPaymentIntent: jest.fn().mockResolvedValue({
      id: INTENT_ID,
      status: 'CAPTURED',
      payableAmount: 4990,
      createdAt: '2026-09-29T00:10:01.634Z',
    }),
  };
  const service = new AdminOperationsService(
    ...([null, null, null, null, null, reader, paymentClient, null, null] as unknown as ConstructorParameters<
      typeof AdminOperationsService
    >),
  );
  return { service, paymentClient };
}

describe('AdminOperationsService 결제 기록 legacy 합성', () => {
  it('INVOICE 결제(attemptNo 없음)가 이미 기록돼 있으면 같은 intent 로 한 줄 더 만들지 않는다 (userId 경로)', async () => {
    const { service, paymentClient } = build([invoiceChargeEvent]);
    const result = await service.getMemberBillingEventsByUserId('user-1');
    expect(result).toHaveLength(1);
    expect(paymentClient.getWalletPaymentIntent).not.toHaveBeenCalled();
  });

  it('contractId 경로도 같다', async () => {
    const { service } = build([invoiceChargeEvent]);
    expect(await service.getMemberBillingEvents(CONTRACT_ID)).toHaveLength(1);
  });

  it('기록이 없는 legacy 계약은 여전히 wallet intent 로 합성한다', async () => {
    const { service } = build([]);
    const result = await service.getMemberBillingEventsByUserId('user-1');
    expect(result).toHaveLength(1);
    expect(result[0].paymentIntentId).toBe(INTENT_ID);
  });
});
