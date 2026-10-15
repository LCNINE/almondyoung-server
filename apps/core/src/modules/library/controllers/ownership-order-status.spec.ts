import { validate } from 'class-validator';
import { OwnershipController } from './ownership.controller';
import { OwnershipOrderStatusDto } from '../dto/ownership-order-status.dto';

describe('ownership order status boundary', () => {
  it('rejects unauthenticated requests', async () => {
    const controller = new OwnershipController({} as any, {} as any);

    await expect(controller.orderStatus({}, { channelOrderIds: ['order_1'] })).rejects.toThrow(
      'Authenticated user required',
    );
  });

  it.each([undefined, 'order_1', [1], Array(101).fill('order_1'), ['x'.repeat(101)]])(
    'rejects invalid or unbounded input: %p',
    async (channelOrderIds) => {
      const dto = Object.assign(new OwnershipOrderStatusDto(), { channelOrderIds });

      expect((await validate(dto)).length).toBeGreaterThan(0);
    },
  );

  it('accepts a bounded batch', async () => {
    const dto = Object.assign(new OwnershipOrderStatusDto(), { channelOrderIds: ['order_1'] });

    expect(await validate(dto)).toEqual([]);
  });
});
