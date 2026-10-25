import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateFulfillmentOrderDto } from './create-fulfillment-order.dto';

describe('CreateFulfillmentOrderDto.fulfillmentMode (K3 PR4)', () => {
  const salesOrderId = '11111111-1111-4111-8111-111111111111';

  async function modeErrors(fulfillmentMode: unknown) {
    const errors = await validate(plainToInstance(CreateFulfillmentOrderDto, { salesOrderId, fulfillmentMode }));
    return errors.filter((error) => error.property === 'fulfillmentMode');
  }

  it('drop_ship 모드를 거절한다 — 직배분은 FO 모드가 아니라 입점사 상자로 나뉜다(ADR-0050 §2)', async () => {
    expect(await modeErrors('drop_ship')).toHaveLength(1);
  });

  it.each(['in_house', '3pl', undefined])('%s 는 받는다', async (mode) => {
    expect(await modeErrors(mode)).toHaveLength(0);
  });
});
