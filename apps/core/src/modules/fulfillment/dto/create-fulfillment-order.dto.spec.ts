import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateFulfillmentOrderDto } from './create-fulfillment-order.dto';

describe('CreateFulfillmentOrderDto.fulfillmentMode (K3 PR4)', () => {
  const salesOrderId = '11111111-1111-4111-8111-111111111111';

  async function modeErrors(fulfillmentMode: unknown) {
    const errors = await validate(plainToInstance(CreateFulfillmentOrderDto, { salesOrderId, fulfillmentMode }));
    return errors.filter((error) => error.property === 'fulfillmentMode');
  }

  // 옛 FO 단위 직배 모드는 K3 PR 8 이 enum 에서 걷었다 — 직배분은 FO 모드가 아니라 입점사 상자로 나뉜다(ADR-0050 §2)
  it('enum 밖의 모드는 거절한다', async () => {
    expect(await modeErrors('unknown_mode')).toHaveLength(1);
  });

  it.each(['in_house', '3pl', undefined])('%s 는 받는다', async (mode) => {
    expect(await modeErrors(mode)).toHaveLength(0);
  });
});
