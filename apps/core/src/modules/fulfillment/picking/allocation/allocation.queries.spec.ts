/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DbTx } from '../../../inventory/schema/inventory.schema';
import { isPlanValidationError } from './allocation.errors';
import {
  assertActiveBatchSession,
  assertPositiveQuantity,
  assertProfileComplete,
  assertRecipientComplete,
  assertWorkItemIdentity,
  databaseNow,
  loadWorkItem,
  requiredIds,
} from './allocation.queries';

function trxReturning(...results: Array<Array<Record<string, unknown>>>) {
  const queue = [...results];
  const chain = () => {
    const rows = queue.shift() ?? [];
    const promise = Promise.resolve(rows);
    const self: Record<string, unknown> = {
      from: () => self,
      where: () => self,
      limit: () => self,
      for: () => promise,
      then: promise.then.bind(promise),
    };
    return self;
  };
  return { select: chain } as never;
}

describe('assertActiveBatchSession', () => {
  it('시작 안 된 배치는 PICKING_BATCH_NOT_STARTED', async () => {
    const trx = trxReturning([{ pickingMethod: 'individual', startedAt: null }]);
    await expect(assertActiveBatchSession(trx, 's', 'b', 'discrete')).rejects.toMatchObject({
      response: { code: 'PICKING_BATCH_NOT_STARTED' },
    });
  });

  it('피킹 방식이 다르면 PICKING_BATCH_NOT_STARTED', async () => {
    const trx = trxReturning([{ pickingMethod: 'total_picking', startedAt: new Date() }]);
    await expect(assertActiveBatchSession(trx, 's', 'b', 'discrete')).rejects.toMatchObject({
      response: { code: 'PICKING_BATCH_NOT_STARTED' },
    });
  });

  it('다른 배치의 세션이면 PICKING_SESSION_NOT_ACTIVE', async () => {
    const trx = trxReturning(
      [{ pickingMethod: 'individual', startedAt: new Date() }],
      [{ batchId: 'other', status: 'active' }],
    );
    await expect(assertActiveBatchSession(trx, 's', 'b', 'discrete')).rejects.toMatchObject({
      response: { code: 'PICKING_SESSION_NOT_ACTIVE' },
    });
  });

  it('시작된 같은 방식 배치의 활성 세션이면 통과', async () => {
    const trx = trxReturning(
      [{ pickingMethod: 'individual', startedAt: new Date() }],
      [{ batchId: 'b', status: 'active' }],
    );
    await expect(assertActiveBatchSession(trx, 's', 'b', 'discrete')).resolves.toBeUndefined();
  });
});

// 아래는 옛 legacy-plan.spec.ts 의 «layer 1 pure functions» 묶음 중 계획과 무관하게 살아 있는 함수들이다.
// 계획 층을 지우면서 스펙 파일이 사라져도 이 함수들의 검증까지 사라지지 않게 여기로 옮겼다.
describe('allocation layer — layer 1 pure functions', () => {
  describe('requiredIds', () => {
    it('sorts and de-duplicates nothing but rejects duplicates outright', () => {
      expect(requiredIds('shipmentIds', ['shipment-b', 'shipment-a'])).toEqual(['shipment-a', 'shipment-b']);
      expect(() => requiredIds('shipmentIds', ['shipment-a', 'shipment-a'])).toThrow(BadRequestException);
    });

    it('rejects an empty or blank-only list', () => {
      expect(() => requiredIds('shipmentIds', [])).toThrow('shipmentIds must not be empty');
      expect(() => requiredIds('shipmentIds', ['   '])).toThrow('shipmentIds must not be empty');
    });
  });

  describe('assertPositiveQuantity', () => {
    it.each([0, -1, 1.5, Number.NaN])('rejects %p', (quantity) => {
      expect(() => assertPositiveQuantity(quantity)).toThrow(BadRequestException);
    });

    it('accepts a positive integer', () => {
      expect(() => assertPositiveQuantity(2)).not.toThrow();
    });
  });

  describe('assertWorkItemIdentity', () => {
    it('rejects a work item belonging to another batch or shipment', () => {
      const item = { batchId: 'batch-1', shipmentId: 'shipment-a' } as never;
      expect(() => assertWorkItemIdentity(item, 'batch-1', 'shipment-a')).not.toThrow();
      expect(() => assertWorkItemIdentity(item, 'other-batch', 'shipment-a')).toThrow(ConflictException);
      expect(() => assertWorkItemIdentity(item, 'batch-1', 'shipment-b')).toThrow(ConflictException);
    });
  });

  describe('assertRecipientComplete', () => {
    const complete = {
      recipientName: '홍길동',
      phone: '010-0000-0000',
      postalCode: '06236',
      roadAddress: '서울시 강남구',
      detailAddress: '101호',
    };

    it('accepts a fully populated recipient snapshot', () => {
      expect(() => assertRecipientComplete(complete)).not.toThrow();
    });

    it.each(['recipientName', 'phone', 'postalCode', 'roadAddress', 'detailAddress'])(
      'names %s when it is blank',
      (field) => {
        expect(() => assertRecipientComplete({ ...complete, [field]: '  ' })).toThrow(
          expect.objectContaining({
            response: expect.objectContaining({
              code: 'SHIPMENT_RECIPIENT_INCOMPLETE',
              message: expect.stringContaining(field),
            }),
          }),
        );
      },
    );

    it('treats a missing snapshot as every field missing', () => {
      expect(() => assertRecipientComplete(null)).toThrow(/recipientName,phone,postalCode,roadAddress,detailAddress/);
    });
  });

  describe('assertProfileComplete', () => {
    const profile = {
      senderSnapshot: { name: '아몬드영', phone: '02-000-0000' },
      originAddressSnapshot: { roadAddress: '서울시' },
      returnAddressSnapshot: { roadAddress: '서울시' },
      carrierAccountRef: 'cj-account-1',
    } as never;

    it('accepts a profile carrying all three snapshots and a carrier account', () => {
      expect(() => assertProfileComplete(profile)).not.toThrow();
    });

    it('accepts the senderName/senderPhone spelling of the sender snapshot', () => {
      expect(() =>
        assertProfileComplete({
          ...(profile as object),
          senderSnapshot: { senderName: '아몬드영', senderPhone: '02-000-0000' },
        } as never),
      ).not.toThrow();
    });

    it.each([
      ['an empty snapshot object', { originAddressSnapshot: {} }],
      ['a missing snapshot', { returnAddressSnapshot: null }],
      ['an array snapshot', { originAddressSnapshot: [] }],
      ['a blank carrier account', { carrierAccountRef: '  ' }],
      ['a sender without a phone', { senderSnapshot: { name: '아몬드영' } }],
    ])('rejects %s', (_label, override) => {
      expect(() => assertProfileComplete({ ...(profile as object), ...override } as never)).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'SHIPMENT_PROFILE_CONFIGURATION_INCOMPLETE' }),
        }),
      );
    });
  });

  describe('isPlanValidationError', () => {
    it('treats only the three request-shaped Nest exceptions as validation failures', () => {
      expect(isPlanValidationError(new BadRequestException('x'))).toBe(true);
      expect(isPlanValidationError(new ConflictException('x'))).toBe(true);
      expect(isPlanValidationError(new NotFoundException('x'))).toBe(true);
      expect(isPlanValidationError(new Error('x'))).toBe(false);
      expect(isPlanValidationError('x')).toBe(false);
    });
  });

  describe('databaseNow', () => {
    it('reads the clock from the transaction rather than the process', async () => {
      const tx = { execute: jest.fn().mockResolvedValue([{ now: new Date('2026-07-15T00:10:00.000Z') }]) };
      await expect(databaseNow(tx as unknown as DbTx)).resolves.toEqual(new Date('2026-07-15T00:10:00.000Z'));
    });

    it('fails loudly when the database returns no clock', async () => {
      const tx = { execute: jest.fn().mockResolvedValue([]) } as unknown as DbTx;
      await expect(databaseNow(tx)).rejects.toThrow('Database clock unavailable');
    });
  });

  describe('loadWorkItem', () => {
    it('locks the row only when asked', async () => {
      const trx = trxReturning([{ id: 'work-item-a' }], [{ id: 'work-item-a' }]);
      await expect(loadWorkItem(trx, 'work-item-a')).resolves.toEqual({ id: 'work-item-a' });
      await expect(loadWorkItem(trx, 'work-item-a', true)).resolves.toEqual({ id: 'work-item-a' });
    });

    it('404s on an unknown work item', async () => {
      const trx = trxReturning([]);
      await expect(loadWorkItem(trx, 'work-item-a')).rejects.toThrow(NotFoundException);
    });
  });
});
