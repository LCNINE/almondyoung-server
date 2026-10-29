import { ValidationPipe } from '@nestjs/common';
import { SalesOrdersInternalController } from './sales-orders-internal.controller';
import { SalesOrderLookupRequestDto } from './sales-order-lookup.dto';
import type { SalesOrderLookupService } from './sales-order-lookup.service';
import type { ReturnEligibilityService } from './return-eligibility.service';
import { ReturnEligibilityRequestDto } from './return-eligibility.dto';
import type { CustomerReturnService } from '../customer-return/customer-return.service';
import { ReleaseCustomerReturnPickupDto } from './dto/release-customer-return-pickup.dto';

const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const validate = (body: unknown): Promise<SalesOrderLookupRequestDto> =>
  pipe.transform(body, { type: 'body', metatype: SalesOrderLookupRequestDto });

describe('SalesOrdersInternalController', () => {
  it('서비스에 그대로 넘기고 응답을 감싼다', async () => {
    const lookup = jest
      .fn()
      .mockResolvedValue([
        { externalOrderId: 'order_1', salesOrder: { status: 'confirmed' }, openEventFailure: false },
      ]);
    const controller = new SalesOrdersInternalController(
      { lookup } as unknown as SalesOrderLookupService,
      {} as unknown as ReturnEligibilityService,
      {} as unknown as CustomerReturnService,
    );
    const dto = await validate({ salesChannel: 'medusa', orders: [{ externalOrderId: 'order_1' }] });

    await expect(controller.lookup(dto)).resolves.toEqual({
      orders: [{ externalOrderId: 'order_1', salesOrder: { status: 'confirmed' }, openEventFailure: false }],
    });
    expect(lookup).toHaveBeenCalledWith('medusa', [{ externalOrderId: 'order_1' }]);
  });

  it('200건을 넘으면 400', async () => {
    const orders = Array.from({ length: 201 }, (_, i) => ({ externalOrderId: `o${i}` }));
    await expect(validate({ salesChannel: 'medusa', orders })).rejects.toThrow();
  });

  it('빈 목록이면 400', async () => {
    await expect(validate({ salesChannel: 'medusa', orders: [] })).rejects.toThrow();
  });

  it('모르는 채널이면 400', async () => {
    await expect(validate({ salesChannel: '3pl', orders: [{ externalOrderId: 'x' }] })).rejects.toThrow();
  });

  describe('returnEligibility', () => {
    it('서비스 결과를 그대로 돌려준다', async () => {
      const result = {
        found: true,
        lines: [{ channelOrderItemId: 'ordli_1', deliveredUnits: 2, lastDeliveredAt: '2026-10-22T05:00:00.000Z' }],
      };
      const read = jest.fn().mockResolvedValue(result);
      const controller = new SalesOrdersInternalController(
        {} as unknown as SalesOrderLookupService,
        { read } as unknown as ReturnEligibilityService,
        {} as unknown as CustomerReturnService,
      );
      const dto = await pipe.transform(
        { salesChannel: 'medusa', externalOrderId: 'order_1' },
        { type: 'body', metatype: ReturnEligibilityRequestDto },
      );

      await expect(controller.returnEligibility(dto)).resolves.toBe(result);
      expect(read).toHaveBeenCalledWith({ salesChannel: 'medusa', externalOrderId: 'order_1' });
    });

    it('medusa 가 아닌 채널이면 400', async () => {
      await expect(
        pipe.transform(
          { salesChannel: 'naver', externalOrderId: 'x' },
          { type: 'body', metatype: ReturnEligibilityRequestDto },
        ),
      ).rejects.toThrow();
    });
  });

  describe('releaseCustomerReturnPickup', () => {
    const validateRelease = (body: unknown): Promise<ReleaseCustomerReturnPickupDto> =>
      pipe.transform(body, { type: 'body', metatype: ReleaseCustomerReturnPickupDto });

    it('channelReturnId 를 서비스에 넘기고 결과를 그대로 돌려준다', async () => {
      const releasePickup = jest.fn().mockResolvedValue({ result: 'picked_up' });
      const controller = new SalesOrdersInternalController(
        {} as unknown as SalesOrderLookupService,
        {} as unknown as ReturnEligibilityService,
        { releasePickup } as unknown as CustomerReturnService,
      );
      const dto = await validateRelease({ channelReturnId: 'return_01' });

      await expect(controller.releaseCustomerReturnPickup(dto)).resolves.toEqual({ result: 'picked_up' });
      expect(releasePickup).toHaveBeenCalledWith('return_01');
    });

    it.each([{}, { channelReturnId: '' }, { channelReturnId: 7 }, { channelReturnId: 'r'.repeat(256) }])(
      '본문 %o 는 400',
      async (body) => {
        await expect(validateRelease(body)).rejects.toThrow();
      },
    );
  });
});
