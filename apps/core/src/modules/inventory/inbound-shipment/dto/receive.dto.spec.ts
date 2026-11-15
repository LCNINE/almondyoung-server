import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'crypto';
import { AddInboundShipmentBoxDto, CancelBoxReceiptDto, ReceiveBoxDto } from './receive.dto';

const errors = (plain: object) => validate(plainToInstance(ReceiveBoxDto, plain));
const body = { counts: [{ lineId: randomUUID(), countedQty: 0 }], unplanned: [] };

describe('ReceiveBoxDto (창고 작업 계약 v2 고정)', () => {
  it('rejects a body without contractVersion and idempotencyKey', async () => {
    const found = await errors(body);
    expect(found.map((e) => e.property).sort()).toEqual(['contractVersion', 'idempotencyKey']);
  });
  it('rejects contractVersion 1', async () => {
    const found = await errors({ ...body, contractVersion: 1, idempotencyKey: 'k-1' });
    expect(found.map((e) => e.property)).toEqual(['contractVersion']);
  });
  it('rejects v2 without a key, or with a blank / too long key', async () => {
    expect((await errors({ ...body, contractVersion: 2 })).map((e) => e.property)).toEqual(['idempotencyKey']);
    expect((await errors({ ...body, contractVersion: 2, idempotencyKey: '   ' })).map((e) => e.property)).toEqual([
      'idempotencyKey',
    ]);
    expect(
      (await errors({ ...body, contractVersion: 2, idempotencyKey: 'k'.repeat(91) })).map((e) => e.property),
    ).toEqual(['idempotencyKey']);
  });
  it('accepts a valid v2 body', async () => {
    expect(await errors({ ...body, contractVersion: 2, idempotencyKey: 'k-1' })).toHaveLength(0);
  });
  it('caps counted and unplanned quantities at 1,000,000', async () => {
    const v2 = { contractVersion: 2, idempotencyKey: 'k-1' };
    const lineId = randomUUID();
    const skuId = randomUUID();
    expect(
      await errors({ ...v2, counts: [{ lineId, countedQty: 1_000_000 }], unplanned: [{ skuId, quantity: 1_000_000 }] }),
    ).toHaveLength(0);
    expect(
      (await errors({ ...v2, counts: [{ lineId, countedQty: 1_000_001 }], unplanned: [] })).map((e) => e.property),
    ).toEqual(['counts']);
    expect(
      (await errors({ ...v2, counts: [], unplanned: [{ skuId, quantity: 1_000_001 }] })).map((e) => e.property),
    ).toEqual(['unplanned']);
  });
});

describe('AddInboundShipmentBoxDto (창고 작업 계약 v2 고정)', () => {
  const addErrors = (plain: object) => validate(plainToInstance(AddInboundShipmentBoxDto, plain));
  it('rejects a body without contractVersion and idempotencyKey', async () => {
    expect((await addErrors({ label: 'L9' })).map((e) => e.property).sort()).toEqual([
      'contractVersion',
      'idempotencyKey',
    ]);
  });
  it('rejects contractVersion 1', async () => {
    expect(
      (await addErrors({ label: 'L9', contractVersion: 1, idempotencyKey: 'k-1' })).map((e) => e.property),
    ).toEqual(['contractVersion']);
  });
  it('rejects v2 without a key, or with a blank / too long key', async () => {
    expect((await addErrors({ label: 'L9', contractVersion: 2 })).map((e) => e.property)).toEqual(['idempotencyKey']);
    expect(
      (await addErrors({ label: 'L9', contractVersion: 2, idempotencyKey: '   ' })).map((e) => e.property),
    ).toEqual(['idempotencyKey']);
    expect(
      (await addErrors({ label: 'L9', contractVersion: 2, idempotencyKey: 'k'.repeat(91) })).map((e) => e.property),
    ).toEqual(['idempotencyKey']);
  });
  it('requires a label of at most 32 characters', async () => {
    expect((await addErrors({ contractVersion: 2, idempotencyKey: 'k-1' })).map((e) => e.property)).toEqual(['label']);
    expect(
      (await addErrors({ label: `L${'1'.repeat(32)}`, contractVersion: 2, idempotencyKey: 'k-1' })).map(
        (e) => e.property,
      ),
    ).toEqual(['label']);
  });
  it('accepts a valid v2 body', async () => {
    expect(await addErrors({ label: 'L9', contractVersion: 2, idempotencyKey: 'k-1' })).toHaveLength(0);
  });
});

describe('CancelBoxReceiptDto (창고 작업 계약 v2 고정)', () => {
  const cancelErrors = (plain: object) => validate(plainToInstance(CancelBoxReceiptDto, plain));
  it('rejects a body without contractVersion and idempotencyKey', async () => {
    expect((await cancelErrors({})).map((e) => e.property).sort()).toEqual(['contractVersion', 'idempotencyKey']);
  });
  it('rejects contractVersion 1', async () => {
    expect((await cancelErrors({ contractVersion: 1, idempotencyKey: 'k-1' })).map((e) => e.property)).toEqual([
      'contractVersion',
    ]);
  });
  it('rejects v2 without a key, or with a blank / too long key', async () => {
    expect((await cancelErrors({ contractVersion: 2 })).map((e) => e.property)).toEqual(['idempotencyKey']);
    expect((await cancelErrors({ contractVersion: 2, idempotencyKey: '   ' })).map((e) => e.property)).toEqual([
      'idempotencyKey',
    ]);
    expect((await cancelErrors({ contractVersion: 2, idempotencyKey: 'k'.repeat(91) })).map((e) => e.property)).toEqual(
      ['idempotencyKey'],
    );
  });
  it('accepts a valid v2 body', async () => {
    expect(await cancelErrors({ contractVersion: 2, idempotencyKey: 'k-1' })).toHaveLength(0);
  });
});
