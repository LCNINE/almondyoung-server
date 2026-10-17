import { RefundRequestsService } from './refund-requests.service';

describe('RefundRequestsService.approve', () => {
  it('승인 환불은 kind ITEM_CANCEL 로 만든다', async () => {
    const req = {
      id: 'rq1',
      chargeId: 'c1',
      intentId: 'i1',
      amount: 1000,
      reason: null,
      bankCode: '06',
      accountNumber: '123',
      holderName: '홍길동',
    };
    const create = jest.fn().mockResolvedValue({ id: 'rf1', status: 'SUCCEEDED' });
    const returning = jest.fn().mockResolvedValue([{ id: 'rq1' }]);
    const dbService = { db: { update: () => ({ set: () => ({ where: () => ({ returning }) }) }) } };
    const service = new RefundRequestsService(dbService as any, {} as any, { create } as any, {} as any, {} as any);
    jest.spyOn(service as any, 'loadRequestable').mockResolvedValue(req);

    await service.approve('rq1', 'admin1');

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ITEM_CANCEL' }));
  });
});
