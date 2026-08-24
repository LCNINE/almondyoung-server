import { validate } from 'class-validator';
import { createGlobalValidationPipe } from '../../../../platform/http/validation-pipe';
import { UpdateWarehouseDto } from './update-warehouse.dto';

describe('UpdateWarehouseDto', () => {
  function dtoWith(strategies: unknown): UpdateWarehouseDto {
    const dto = new UpdateWarehouseDto();
    // 잘못된 런타임 타입을 일부러 넣어 검증을 확인하는 테스트라 캐스팅이 필요하다
    dto.supportedPickingStrategies = strategies as UpdateWarehouseDto['supportedPickingStrategies'];
    return dto;
  }

  it('등록된 전략 이름들을 받는다', async () => {
    await expect(validate(dtoWith(['discrete', 'pick_to_tote']))).resolves.toHaveLength(0);
  });

  it('필드 생략을 받는다', async () => {
    await expect(validate(new UpdateWarehouseDto())).resolves.toHaveLength(0);
  });

  // 빈 배열은 "출고 불가로 되돌린다"는 유효한 의도다. 이걸 막으면 켠 것을 끌 수단이 없다.
  it('빈 배열을 받는다', async () => {
    await expect(validate(dtoWith([]))).resolves.toHaveLength(0);
  });

  // 막지 않으면 plan 단계에서야 BadRequestException 이 난다 — 쓰기 시점에 400 으로 끊는다.
  it('등록되지 않은 전략 이름을 거부한다', async () => {
    const errors = await validate(dtoWith(['discrete', 'zone_picking']));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('supportedPickingStrategies');
  });

  it('배열이 아닌 값을 거부한다', async () => {
    const errors = await validate(dtoWith('discrete'));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('supportedPickingStrategies');
  });

  it('중복된 전략 이름을 거부한다', async () => {
    const errors = await validate(dtoWith(['discrete', 'discrete']));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('supportedPickingStrategies');
  });

  // PartialType + 전역 파이프(whitelist: true) 를 실제로 태워, 배포 설정이
  // supportedPickingStrategies 를 body 에서 잘라내지 않는지 확인한다. 데코레이터만
  // 검증하는 위 테스트들은 이 whitelist 경로를 통과하지 않는다.
  describe('전역 ValidationPipe (whitelist: true) 를 통과할 때', () => {
    it('유효한 전략 배열이 whitelist 를 통과해 살아남는다', async () => {
      const pipe = createGlobalValidationPipe();
      const transformed = (await pipe.transform(
        { supportedPickingStrategies: ['discrete', 'pick_to_tote'] },
        { type: 'body', metatype: UpdateWarehouseDto },
      )) as UpdateWarehouseDto;

      expect(transformed.supportedPickingStrategies).toEqual(['discrete', 'pick_to_tote']);
    });

    // 빈 배열은 "출고 불가로 되돌린다"는 유효한 의도다. whitelist 가 undefined 값과
    // 구분하지 못하고 잘라내면 켠 것을 끌 수단이 사라진다.
    it('빈 배열도 whitelist 를 통과해 살아남는다', async () => {
      const pipe = createGlobalValidationPipe();
      const transformed = (await pipe.transform(
        { supportedPickingStrategies: [] },
        { type: 'body', metatype: UpdateWarehouseDto },
      )) as UpdateWarehouseDto;

      expect(transformed.supportedPickingStrategies).toEqual([]);
    });
  });
});

describe('UpdateWarehouseDto.isSellable', () => {
  function dtoWithSellable(value: unknown): UpdateWarehouseDto {
    const dto = new UpdateWarehouseDto();
    // 잘못된 런타임 타입을 일부러 넣어 검증을 확인하는 테스트라 캐스팅이 필요하다
    dto.isSellable = value as UpdateWarehouseDto['isSellable'];
    return dto;
  }

  it('true 를 받는다', async () => {
    await expect(validate(dtoWithSellable(true))).resolves.toHaveLength(0);
  });

  // false 는 "이 창고를 판매 대상에서 뺀다"는 유효한 의도다. 이걸 막으면 중국 창고를
  // 비판매로 되돌릴 수단이 없어져 이번 변경의 목적 자체가 무너진다.
  it('false 를 받는다', async () => {
    await expect(validate(dtoWithSellable(false))).resolves.toHaveLength(0);
  });

  it('불린이 아닌 값을 거부한다', async () => {
    const errors = await validate(dtoWithSellable('true'));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('isSellable');
  });

  // supportedPickingStrategies 의 빈 배열과 같은 함정이다 — false 는 falsy 라
  // whitelist 가 undefined 와 구분하지 못하고 잘라내면 끄는 수단이 조용히 사라진다.
  it('false 가 전역 whitelist 를 통과해 살아남는다', async () => {
    const pipe = createGlobalValidationPipe();
    const transformed = (await pipe.transform(
      { isSellable: false },
      { type: 'body', metatype: UpdateWarehouseDto },
    )) as UpdateWarehouseDto;

    expect(transformed.isSellable).toBe(false);
  });
});
