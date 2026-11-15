import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'crypto';
import { CancelBoxReceiptDto, ReceiveBoxDto } from './receive.dto';

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
