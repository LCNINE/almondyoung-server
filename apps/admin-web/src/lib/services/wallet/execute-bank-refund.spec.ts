import { useExecuteBankRefund } from './mutations';
import { walletApi } from '@/lib/api/domains/wallet';
import { client } from '@/lib/api/client';

const useMutationMock = jest.fn((options) => options);
const invalidateQueries = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  useMutation: (options: unknown) => useMutationMock(options),
  useQueryClient: () => ({ invalidateQueries }),
}));
jest.mock('@/lib/api/client', () => ({
  client: {
    get: jest.fn().mockResolvedValue({ data: { data: [], total: 0 } }),
    post: jest
      .fn()
      .mockResolvedValue({ data: { id: 'rf-1', status: 'SUCCEEDED' } }),
  },
}));
jest.mock('@/lib/api/domains/orders', () => ({ salesOrders: {} }));

it('계좌는 wallet 직접 라우트에 HTTP 멱등키와 함께 보내며 실행·PII 권한을 요구한다', async () => {
  const account = {
    bank: '06',
    accountNumber: '1234567890',
    holderName: '테스트',
  };
  useExecuteBankRefund();
  const call = useMutationMock.mock.lastCall;

  if (!call) throw new Error('mutation hook was not called');

  const options = call[0];
  await options.mutationFn({ refundId: 'rf-1', intentId: 'pi-1', account });

  expect(client.post).toHaveBeenCalledWith(
    expect.stringContaining('/v1/admin/refunds/rf-1/execute-bank-refund'),
    account,
    { headers: { 'Idempotency-Key': expect.any(String) } }
  );
  expect(useExecuteBankRefund.permission).toEqual({
    allOf: [['payment.refund.execute'], ['customer.pii.read']],
  });
  options.onSettled(undefined, new Error('timeout'), { intentId: 'pi-1' });
  expect(invalidateQueries.mock.calls.map(([arg]) => arg.queryKey)).toEqual([
    ['wallet', 'intents', 'pi-1'],
    ['wallet', 'intents', 'pi-1', 'state-transitions'],
    ['wallet', 'refunds'],
  ]);
  expect(walletApi.executeBankRefund).toBeDefined();
});

it('묶음 조회는 intentIds를 서버 DTO가 받는 쉼표 목록으로 보낸다', async () => {
  await walletApi.listRefunds({
    intentIds: ['pi-1', 'pi-2'],
    page: 2,
    limit: 100,
  });

  expect(client.get).toHaveBeenCalledWith(
    expect.stringContaining(
      '/v1/admin/refunds?intentIds=pi-1%2Cpi-2&page=2&limit=100'
    )
  );
});
