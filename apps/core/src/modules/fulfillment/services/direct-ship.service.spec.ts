import { BadRequestException } from '@nestjs/common';
import { DirectShipService } from './direct-ship.service';

describe('DirectShipService.markOrdersAsCompleted', () => {
  const fo1 = 'fo-drop-aaaa-1111-1111-1111-111111111111';
  const fo2 = 'fo-drop-bbbb-2222-2222-2222-222222222222';

  function makeService(foRows: Array<{ id: string }>) {
    const mockTx: any = {
      update: jest.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
    };

    const mockDb: any = {
      select: jest.fn(() => ({
        from: () => ({ where: () => Promise.resolve(foRows) }),
      })),
      transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn(mockTx)),
    };

    const dbService: any = { db: mockDb };
    const fulfillmentsService: any = { ship: jest.fn().mockResolvedValue(undefined) };

    const service = new DirectShipService(dbService, fulfillmentsService);
    return { service, mockTx, fulfillmentsService };
  }

  it('각 FO에 대해 ship()을 호출하여 FulfillmentShipped 이벤트 경로를 연결한다', async () => {
    const { service, fulfillmentsService } = makeService([{ id: fo1 }, { id: fo2 }]);

    await service.markOrdersAsCompleted([fo1, fo2], 'operator-1');

    expect(fulfillmentsService.ship).toHaveBeenCalledTimes(2);
    expect(fulfillmentsService.ship).toHaveBeenCalledWith(fo1, expect.anything());
    expect(fulfillmentsService.ship).toHaveBeenCalledWith(fo2, expect.anything());
  });

  it('ship() 호출 후 directShipStatus=completed 배치 업데이트를 수행한다', async () => {
    const { service, mockTx } = makeService([{ id: fo1 }]);

    await service.markOrdersAsCompleted([fo1], 'operator-1');

    expect(mockTx.update).toHaveBeenCalled();
    const updateArgs = mockTx.update.mock.calls[0];
    expect(updateArgs[0]).toBeDefined();
  });

  it('forwarded drop_ship 아닌 FO가 포함되면 BadRequestException', async () => {
    const { service } = makeService([{ id: fo1 }]);

    await expect(service.markOrdersAsCompleted([fo1, fo2], 'operator-1')).rejects.toThrow(BadRequestException);
  });

  it('단일 FO도 ship()을 한 번 호출한다', async () => {
    const { service, fulfillmentsService } = makeService([{ id: fo1 }]);

    await service.markOrdersAsCompleted([fo1], 'operator-1');

    expect(fulfillmentsService.ship).toHaveBeenCalledTimes(1);
    expect(fulfillmentsService.ship).toHaveBeenCalledWith(fo1, expect.anything());
  });
});
