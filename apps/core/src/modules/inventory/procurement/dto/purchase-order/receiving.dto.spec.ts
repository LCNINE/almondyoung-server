import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReceivePurchaseOrderDto, ShortClosePurchaseOrderLineDto, UpdateLineExpectedArrivalDto } from './receiving.dto';

const SKU_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SKU_ID = '22222222-2222-4222-8222-222222222222';
const WAREHOUSE_ID = '33333333-3333-4333-8333-333333333333';

function receiveDto(lines: unknown): ReceivePurchaseOrderDto {
  return plainToInstance(ReceivePurchaseOrderDto, {
    idempotencyKey: 'receive-key',
    warehouseId: WAREHOUSE_ID,
    lines,
  });
}

describe('ReceivePurchaseOrderDto', () => {
  it.each([
    ['비배열', 'bad'],
    ['null 원소', [null]],
    [
      '중복 SKU',
      [
        { skuId: SKU_ID, quantity: 1 },
        { skuId: SKU_ID, quantity: 2 },
      ],
    ],
    ['빈 배열', []],
  ])('%s lines를 예외 없이 validation 오류로 돌린다', async (_label, lines) => {
    await expect(validate(receiveDto(lines))).resolves.not.toHaveLength(0);
  });

  it.each([0, -1, 1.5])('수량 %p를 거절한다', async (quantity) => {
    const errors = await validate(receiveDto([{ skuId: SKU_ID, quantity }]));
    expect(errors).not.toHaveLength(0);
  });

  it('서로 다른 SKU의 양수 정수 수량은 허용한다', async () => {
    const dto = receiveDto([
      { skuId: SKU_ID, quantity: 1 },
      { skuId: OTHER_SKU_ID, quantity: 2, memo: '검수 메모' },
    ]);

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});

describe('ShortClosePurchaseOrderLineDto', () => {
  it('공백뿐인 사유를 거절한다', async () => {
    const dto = plainToInstance(ShortClosePurchaseOrderLineDto, { reason: '   ' });

    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it('사유 앞뒤 공백을 제거한다', async () => {
    const dto = plainToInstance(ShortClosePurchaseOrderLineDto, { reason: '  공급처 미발송  ' });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.reason).toBe('공급처 미발송');
  });
});

describe('UpdateLineExpectedArrivalDto', () => {
  it.each([undefined, '', '2026-02-30', '2026/09/14'])('잘못됐거나 누락된 예정일 %p를 거절한다', async (value) => {
    const dto = plainToInstance(UpdateLineExpectedArrivalDto, { expectedArrival: value });

    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it.each([null, '2026-10-05'])('예정일 %p를 허용한다', async (expectedArrival) => {
    const dto = plainToInstance(UpdateLineExpectedArrivalDto, { expectedArrival });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
