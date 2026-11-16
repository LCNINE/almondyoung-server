import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CloseInboundShipmentDto,
  ConfirmInboundShipmentDto,
  EditBoxDto,
  EditLineDto,
  UpdateHeaderDto,
} from './draft-edit.dto';

const errors = (cls: new () => object, plain: object) => validate(plainToInstance(cls, plain));

describe('draft edit DTOs', () => {
  it('rejects null where null is meaningless', async () => {
    expect((await errors(UpdateHeaderDto, { name: null })).length).toBeGreaterThan(0);
    expect((await errors(EditBoxDto, { label: null })).length).toBeGreaterThan(0);
    expect((await errors(EditBoxDto, { disposition: null })).length).toBeGreaterThan(0);
  });
  it('allows null to clear expectedArrival, memo, forwardNote', async () => {
    expect(await errors(UpdateHeaderDto, { expectedArrival: null, memo: null })).toHaveLength(0);
    expect(await errors(EditBoxDto, { forwardNote: null })).toHaveLength(0);
  });
  it('caps expectedQty at 1,000,000', async () => {
    expect(await errors(EditLineDto, { kind: 'free', expectedQty: 1_000_000 })).toHaveLength(0);
    expect((await errors(EditLineDto, { kind: 'free', expectedQty: 1_000_001 })).map((e) => e.property)).toEqual([
      'expectedQty',
    ]);
  });
  it('kind is optional for a quantity-only edit, but not null or unknown', async () => {
    expect(await errors(EditLineDto, { expectedQty: 3 })).toHaveLength(0);
    expect((await errors(EditLineDto, { kind: null, expectedQty: 3 })).map((e) => e.property)).toEqual(['kind']);
    expect((await errors(EditLineDto, { kind: 'unresolved' })).map((e) => e.property)).toEqual(['kind']);
  });
  it('caps boxLabels at 20', async () => {
    const boxLabels = Array.from({ length: 21 }, (_, i) => `L${i + 1}`);
    expect((await errors(EditLineDto, { kind: 'free', boxLabels })).length).toBeGreaterThan(0);
  });
});

describe('CloseInboundShipmentDto', () => {
  it('trims the reason before the length cap', async () => {
    const padded = `  ${'x'.repeat(500)}  `;
    expect(await errors(CloseInboundShipmentDto, { reason: padded })).toHaveLength(0);
    expect(plainToInstance(CloseInboundShipmentDto, { reason: padded }).reason).toBe('x'.repeat(500));
  });
  it('rejects a blank or too long reason', async () => {
    expect((await errors(CloseInboundShipmentDto, { reason: '   ' })).map((e) => e.property)).toEqual(['reason']);
    expect((await errors(CloseInboundShipmentDto, { reason: 'x'.repeat(501) })).map((e) => e.property)).toEqual([
      'reason',
    ]);
    expect((await errors(CloseInboundShipmentDto, {})).map((e) => e.property)).toEqual(['reason']);
  });
  it('ConfirmInboundShipmentDto requires a uuid array of at most 2,000', async () => {
    const id = '8f0e4c3a-5b1d-4e6f-9a2b-1c3d5e7f9a0b';
    expect(await errors(ConfirmInboundShipmentDto, { acknowledgedForwardBoxIds: [] })).toHaveLength(0);
    expect(await errors(ConfirmInboundShipmentDto, { acknowledgedForwardBoxIds: [id] })).toHaveLength(0);
    expect((await errors(ConfirmInboundShipmentDto, {})).length).toBeGreaterThan(0);
    expect((await errors(ConfirmInboundShipmentDto, { acknowledgedForwardBoxIds: ['x'] })).length).toBeGreaterThan(0);
    expect(
      (await errors(ConfirmInboundShipmentDto, { acknowledgedForwardBoxIds: Array(2001).fill(id) })).length,
    ).toBeGreaterThan(0);
  });
});
