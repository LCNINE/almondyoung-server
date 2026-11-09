import { outboundTenantForTesting } from '@app/tenancy';
import { of, throwError } from 'rxjs';
import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import { CORE_LINE_STATE_BATCH, CoreLineReservationStateClient } from './core-line-reservation-state.client';

const config = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;
const make = (post: jest.Mock, values: Record<string, string | undefined> = { CORE_INTERNAL_KEY: 'k', PIM_API_URL: 'http://core' }) =>
  new CoreLineReservationStateClient({ post } as unknown as HttpService, config(values), outboundTenantForTesting());

describe('CoreLineReservationStateClient', () => {
  it('상태 조회는 200건씩 나눠 묻고 unknown 을 모은다', async () => {
    const post = jest.fn((_u: string, body: { channelOrderItemIds: string[] }, _c?: unknown) =>
      of({ data: { lines: [], unknown: body.channelOrderItemIds.slice(0, 1) } }),
    );
    const ids = Array.from({ length: CORE_LINE_STATE_BATCH + 1 }, (_, i) => `i${i}`);
    const res = await make(post).states('medusa', ids);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][0]).toBe('http://core/internal/sales-orders/line-reservation-states');
    expect(post.mock.calls[0][2]).toMatchObject({ headers: { Authorization: 'Bearer k' } });
    expect(res.unknown).toEqual(['i0', 'i200']);
  });

  it('후보는 nextAfterLineId 로 끝까지 순회한다', async () => {
    const post = jest
      .fn()
      .mockReturnValueOnce(of({ data: { channelOrderItemIds: ['a'], nextAfterLineId: 'L1' } }))
      .mockReturnValueOnce(of({ data: { channelOrderItemIds: ['b'], nextAfterLineId: null } }));
    const ids = await make(post).candidates('medusa', new Date('2026-11-01T00:00:00Z'));
    expect(ids).toEqual(['a', 'b']);
    expect(post.mock.calls[1][1]).toMatchObject({ afterLineId: 'L1' });
  });

  it('실패는 삼키지 않고 던진다', async () => {
    const post = jest.fn(() => throwError(() => new Error('500')));
    await expect(make(post).states('medusa', ['a'])).rejects.toThrow('500');
    await expect(make(jest.fn(), { PIM_API_URL: 'x' }).candidates('medusa', new Date())).rejects.toThrow('CORE_INTERNAL_KEY');
  });
});
