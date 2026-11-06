import { ConflictError, UpstreamUnavailableError } from '@app/shared';
import { ConflictException, HttpException } from '@nestjs/common';
import { isTransientError, runPerShipment } from './bulk-shipment-result';

describe('runPerShipment', () => {
  it('runs sequentially, keeps successes around a failure, and counts already as success', async () => {
    const calls: string[] = [];
    const result = await runPerShipment(['a', 'b', 'c'], async (id) => {
      calls.push(`start:${id}`);
      await Promise.resolve();
      calls.push(`end:${id}`);

      if (id === 'b') {
        throw new ConflictException({ code: 'SHIPMENT_NOT_DRAFT' });
      }

      return id === 'a' ? 'done' : 'already';
    });

    expect(calls).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
    expect(result).toEqual({
      succeeded: ['a', 'c'],
      failed: [{ shipmentId: 'b', code: 'SHIPMENT_NOT_DRAFT', message: '상자 상태가 바뀌었어요', transient: false }],
    });
  });

  it.each([
    [new Error('boom'), 'UNKNOWN', true],
    [new ConflictError('private conflict details'), 'CONFLICT', false],
    [new UpstreamUnavailableError('private upstream details'), 'UPSTREAM_UNAVAILABLE', true],
    [new ConflictException({ code: 'FULFILLMENT_COMMAND_IN_PROGRESS' }), 'FULFILLMENT_COMMAND_IN_PROGRESS', true],
    [new HttpException('bad request', 400), 'UNKNOWN', false],
    [new HttpException({ code: 123 }, 500), 'UNKNOWN', true],
    [{ code: 'ECONNRESET', message: 'private database details' }, 'UNKNOWN', true],
  ])('normalizes errors without exposing their details: %p', async (error, code, transient) => {
    const result = await runPerShipment(['s1'], async () => {
      throw error;
    });

    expect(result).toEqual({
      succeeded: [],
      failed: [{ shipmentId: 's1', code, message: '처리하지 못했어요', transient }],
    });
  });

  it.each([
    ['SHIPMENT_NOT_FULLY_RESERVED', '재고 예약이 모자라요'],
    ['SHIPMENT_PROFILE_INCOMPATIBLE', '배송 프로필을 정할 수 없어요'],
    ['SHIPMENT_PROFILE_CONFIGURATION_INCOMPLETE', '배송 프로필 설정이 비어 있어요'],
    ['SHIPMENT_ACTIVE_WORK_ITEM', '이미 다른 배치에 들어 있어요'],
    ['toString', '처리하지 못했어요'],
  ])('uses the specified message for %s', async (code, message) => {
    const result = await runPerShipment(['s1'], async () => {
      throw new ConflictException({ code });
    });

    expect(result.failed).toEqual([{ shipmentId: 's1', code, message, transient: false }]);
  });
});

describe('isTransientError', () => {
  it.each([400, 401, 403, 404, 409, 429, 499])('does not retry HTTP %i', (status) => {
    expect(isTransientError(new HttpException({}, status))).toBe(false);
  });

  it.each([500, 502, 503])('retries HTTP %i', (status) => {
    expect(isTransientError(new HttpException({}, status))).toBe(true);
  });
});
