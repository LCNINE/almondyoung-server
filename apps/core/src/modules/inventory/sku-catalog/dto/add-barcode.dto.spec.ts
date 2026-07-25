import { validate } from 'class-validator';
import { AddBarcodeDto } from './add-barcode.dto';

describe('AddBarcodeDto', () => {
  function dtoWith(packingUnit: unknown): AddBarcodeDto {
    const dto = new AddBarcodeDto();
    dto.barcode = '8801234567890';
    // 잘못된 런타임 타입을 일부러 넣어 검증을 확인하는 테스트라 캐스팅이 필요하다
    dto.packingUnit = packingUnit as number;
    return dto;
  }

  it('양의 정수 packingUnit 을 받는다', async () => {
    await expect(validate(dtoWith(20))).resolves.toHaveLength(0);
  });

  it('packingUnit 생략을 받는다', async () => {
    const dto = new AddBarcodeDto();
    dto.barcode = '8801234567890';
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  // 전역 ValidationPipe 에 enableImplicitConversion 이 없어서 문자열은 number 로
  // 바뀌지 않는다. 계약을 number 로 고정한 이상 문자열은 거부되어야 한다.
  it('문자열 packingUnit 을 거부한다', async () => {
    const errors = await validate(dtoWith('20'));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('packingUnit');
  });

  it('0 과 음수를 거부한다', async () => {
    await expect(validate(dtoWith(0))).resolves.toHaveLength(1);
    await expect(validate(dtoWith(-1))).resolves.toHaveLength(1);
  });
});
