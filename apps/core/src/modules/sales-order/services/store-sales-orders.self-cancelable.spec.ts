import { StoreSalesOrdersService } from './store-sales-orders.service';
import type { StoreOrderActionsResponseDto } from '../dto/store-order-actions.dto';

function view(channelOrderId: string, availableActions: string[]): StoreOrderActionsResponseDto {
  return { channelOrderId, availableActions } as unknown as StoreOrderActionsResponseDto;
}

describe('StoreSalesOrdersService.selfCancelableChannelOrderIds', () => {
  const service = Object.create(StoreSalesOrdersService.prototype) as StoreSalesOrdersService;

  afterEach(() => jest.restoreAllMocks());

  it('고객이 아직 직접 취소할 수 있는 주문만 남긴다', async () => {
    const batch = jest
      .spyOn(service, 'getActionsByChannelOrderBatch')
      .mockResolvedValue([view('o1', ['cancel']), view('o2', ['track'])]);

    await expect(service.selfCancelableChannelOrderIds('u1', ['o1', 'o2', 'o3'])).resolves.toEqual(['o1']);
    expect(batch).toHaveBeenCalledWith(['o1', 'o2', 'o3'], 'u1');
  });

  it('빈 입력은 조회하지 않는다', async () => {
    const batch = jest.spyOn(service, 'getActionsByChannelOrderBatch');

    await expect(service.selfCancelableChannelOrderIds('u1', [])).resolves.toEqual([]);
    expect(batch).not.toHaveBeenCalled();
  });
});
