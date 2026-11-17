import type { SalesOrderLineReservationStatePayload } from '@packages/event-contracts/streams/orders.stream';
import type { DbService } from '@app/db';
import type { wmsSchema } from '../../inventory/schema/inventory.schema';
import { LineReservationStateService, assembleLineStates } from './line-reservation-state.service';
import * as reader from '../line-reservation-state/line-reservation-state.reader';

jest.mock('../line-reservation-state/line-reservation-state.reader');
const mocked = jest.mocked(reader);

const line = (salesOrderLineId: string, channelOrderItemId: string | null) => ({
  salesOrderLineId,
  channelOrderItemId,
  variantId: 'v1',
  ordered: 2,
  canceledBeforeShipment: 0,
  demand: 2,
  heldUnits: 1,
});
const state = (
  salesOrderId: string,
  lines: SalesOrderLineReservationStatePayload['lines'],
): SalesOrderLineReservationStatePayload => ({
  salesOrderId,
  salesChannel: 'medusa',
  channelOrderId: `order_${salesOrderId}`,
  orderedAt: '2026-11-01T00:00:00.000Z',
  version: 3,
  asOf: '2026-11-09T00:00:00.000Z',
  lines,
});

describe('assembleLineStates', () => {
  it('요청 순서대로 줄에 주문 id·주문 시각을 붙이고, 못 찾은 id 는 unknown 으로 돌린다', () => {
    const result = assembleLineStates(
      ['i2', 'missing', 'i1'],
      [state('so1', [line('l1', 'i1'), line('l9', null)]), state('so2', [line('l2', 'i2')])],
    );
    expect(result.lines).toEqual([
      { ...line('l2', 'i2'), salesOrderId: 'so2', orderedAt: '2026-11-01T00:00:00.000Z' },
      { ...line('l1', 'i1'), salesOrderId: 'so1', orderedAt: '2026-11-01T00:00:00.000Z' },
    ]);
    expect(result.unknown).toEqual(['missing']);
  });

  it('중복 id 는 한 번만 센다', () => {
    const result = assembleLineStates(['i1', 'i1'], [state('so1', [line('l1', 'i1')])]);
    expect(result.lines).toHaveLength(1);
  });
});

describe('LineReservationStateService', () => {
  const dbService = { run: (fn: (trx: unknown) => unknown) => fn({}) } as unknown as DbService<typeof wmsSchema>;
  const service = new LineReservationStateService(dbService);

  it('다른 채널의 줄은 찾지 못해 unknown 이 된다', async () => {
    mocked.findOrderIdsByChannelOrderItemIds.mockResolvedValue([]);
    mocked.readLineReservationStates.mockResolvedValue([]);
    await expect(service.readStates('naver', ['i1'])).resolves.toEqual({ lines: [], unknown: ['i1'] });
    expect(mocked.findOrderIdsByChannelOrderItemIds).toHaveBeenCalledWith(expect.anything(), 'naver', ['i1']);
  });

  it('같은 주문의 줄은 주문을 한 번만 읽는다', async () => {
    mocked.findOrderIdsByChannelOrderItemIds.mockResolvedValue([
      { channelOrderItemId: 'i1', salesOrderId: 'so1' },
      { channelOrderItemId: 'i2', salesOrderId: 'so1' },
    ]);
    mocked.readLineReservationStates.mockResolvedValue([state('so1', [line('l1', 'i1'), line('l2', 'i2')])]);
    const result = await service.readStates('medusa', ['i1', 'i2', 'i3']);
    expect(mocked.readLineReservationStates).toHaveBeenCalledWith(expect.anything(), ['so1'], expect.any(Date));
    expect(result.lines.map((l) => l.channelOrderItemId)).toEqual(['i1', 'i2']);
    expect(result.unknown).toEqual(['i3']);
  });
});
