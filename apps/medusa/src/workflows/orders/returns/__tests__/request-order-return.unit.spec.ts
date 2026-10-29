import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { beginReturnOrderWorkflow, requestItemReturnWorkflow } from '@medusajs/medusa/core-flows';
import { findReturnShippingOptionId } from '../../../../modules/almond-fulfillment/return-shipping-option';
import { fetchCoreReturnEligibility } from '../core-return-eligibility';
import { readReturnRequestRecord } from '../load-return-order';
import { requestOrderReturn, type RequestOrderReturnInput } from '../request-order-return';
import { remainingTopUp } from '../return-top-up-ledger';

jest.mock('@medusajs/medusa/core-flows', () => ({
  beginReturnOrderWorkflow: jest.fn(),
  cancelReturnRequestWorkflow: jest.fn(() => ({ run: jest.fn() })),
  confirmReturnRequestWorkflow: jest.fn(() => ({ run: jest.fn() })),
  createReturnShippingMethodWorkflow: jest.fn(() => ({ run: jest.fn() })),
  requestItemReturnWorkflow: jest.fn(),
}));
jest.mock('../../../../modules/almond-fulfillment/return-shipping-option');
jest.mock('../core-return-eligibility');
jest.mock('../return-top-up-ledger');

function setup() {
  const order = {
    id: 'order_1',
    status: 'pending',
    customer_id: 'customer_1',
    items: [{ id: 'item_1', detail: { quantity: 1, fulfilled_quantity: 1 } }],
    returns: [] as Array<{ id: string; status: string; metadata: Record<string, unknown> }>,
  };
  const begin = jest.fn(async ({ input }: { input: { metadata: Record<string, unknown> } }) => {
    order.returns.push({ id: 'ret_1', status: 'requested', metadata: input.metadata });

    return { result: { return_id: 'ret_1' } };
  });
  const requestItems = jest.fn();
  // Medusa 경계만 대역으로 바꾸고 기록 생성·파싱·멱등 판정은 실제 코드를 쓴다.
  jest.mocked(beginReturnOrderWorkflow).mockReturnValue({ run: begin } as never);
  jest.mocked(requestItemReturnWorkflow).mockReturnValue({ run: requestItems } as never);
  jest.mocked(findReturnShippingOptionId).mockResolvedValue('option_1');
  jest.mocked(remainingTopUp).mockResolvedValue([]);
  jest.mocked(fetchCoreReturnEligibility).mockResolvedValue({
    found: true,
    lines: [{ channelOrderItemId: 'item_1', deliveredUnits: 1, lastDeliveredAt: new Date('2026-10-28T00:00:00Z'), exchangeable: true }],
    customerReturns: [],
  });

  const services: Record<string, unknown> = {
    [Modules.LOCKING]: { execute: (_key: string, fn: () => Promise<unknown>) => fn() },
    [Modules.ORDER]: {
      listReturnReasons: jest.fn(async () => [
        {
          id: 'reason_1',
          value: 'defective',
          metadata: { feeBearer: 'seller', customerSelectable: true },
        },
      ]),
    },
    [ContainerRegistrationKeys.QUERY]: {
      graph: jest.fn(async ({ entity }: { entity: string }) => ({
        data: entity === 'order' ? [order] : [{ service_zone: { fulfillment_set: { location: { id: 'loc_1' } } } }],
      })),
    },
    [ContainerRegistrationKeys.LOGGER]: { error: jest.fn(), warn: jest.fn() },
  };
  const container = { resolve: (key: string) => services[key] } as unknown as MedusaContainer;
  const input: RequestOrderReturnInput = {
    orderId: 'order_1',
    requestId: 'req_1',
    items: [{ itemId: 'item_1', quantity: 1 }],
    reasonValue: 'defective',
    requestedBy: 'customer',
    customerId: 'customer_1',
    now: new Date('2026-10-29T00:00:00Z'),
  };

  return { container, input, order, begin, requestItems };
}

describe('반품 요청 메모', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['customer', 'operator'] as const)(
    '%s 메모는 다듬어 기록하고 원문은 internal_note로 넘긴다',
    async (requestedBy) => {
      const { container, input, order, requestItems } = setup();
      const note = '  포장이 찢어졌어요\n ';

      await requestOrderReturn(container, { ...input, requestedBy, note });

      expect(order.returns[0].metadata.almondReturn).toMatchObject({ note: '포장이 찢어졌어요' });
      expect(readReturnRequestRecord(order.returns[0].metadata)).toMatchObject({ note: '포장이 찢어졌어요' });
      expect(requestItems).toHaveBeenCalledWith({
        input: {
          return_id: 'ret_1',
          items: [{ id: 'item_1', quantity: 1, reason_id: 'reason_1', internal_note: note }],
        },
      });
    },
  );

  it.each([undefined, '', ' \n\t '])('메모 %p는 기록에서 생략한다', async (note) => {
    const { container, input, order } = setup();

    await requestOrderReturn(container, { ...input, note });

    expect(order.returns[0].metadata.almondReturn).not.toHaveProperty('note');
    expect(readReturnRequestRecord(order.returns[0].metadata)).not.toHaveProperty('note');
  });

  it.each([undefined, null, '', ' \n ', 42, {}])('기록의 메모 %p는 생략하고 나머지는 읽는다', async (note) => {
    const { container, input, order } = setup();

    await requestOrderReturn(container, input);
    const record = readReturnRequestRecord(order.returns[0].metadata);
    const parsed = readReturnRequestRecord({ almondReturn: { ...record, note } });

    expect(parsed).toMatchObject({ requestId: 'req_1' });
    expect(parsed).not.toHaveProperty('note');
  });

  it('기록을 읽을 때도 메모 양끝 공백을 제거한다', async () => {
    const { container, input, order } = setup();

    await requestOrderReturn(container, input);
    const record = readReturnRequestRecord(order.returns[0].metadata);

    expect(readReturnRequestRecord({ almondReturn: { ...record, note: '  파손\n ' } })).toMatchObject({ note: '파손' });
  });

  it('같은 요청의 메모 변경은 재접수하지 않고 최초 메모를 유지한다', async () => {
    const { container, input, order, begin } = setup();

    const first = await requestOrderReturn(container, { ...input, note: '최초 메모' });
    const retry = await requestOrderReturn(container, { ...input, note: '수정 메모' });

    expect(retry).toEqual(first);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(readReturnRequestRecord(order.returns[0].metadata)).toMatchObject({ note: '최초 메모' });
    await expect(requestOrderReturn(container, { ...input, reasonValue: 'wrong_item' })).rejects.toMatchObject({
      reason: 'request_id_conflict',
    });
  });
});
