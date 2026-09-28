import { ConflictError } from '@app/shared';
import { SHOP_LISTING_STATUSES, type ShopListingStatus } from '../shop-listing.constants';
import {
  countsTowardLimit,
  entersLimit,
  nextStatus,
  type ShopListingAction,
} from '../shop-listing.transitions';

/** spec §5 의 허용 전이 전부. 여기 없는 (상태, 동작) 조합은 모두 거부돼야 한다. */
const ALLOWED: Array<[ShopListingStatus, ShopListingAction, ShopListingStatus]> = [
  ['pending', 'member_edit', 'pending'],
  ['published', 'member_edit', 'pending'],
  ['closed', 'member_edit', 'pending'],
  ['rejected', 'member_edit', 'pending'],
  ['pending', 'approve', 'published'],
  ['pending', 'reject', 'rejected'],
  ['published', 'hide', 'hidden'],
  ['closed', 'hide', 'hidden'],
  ['hidden', 'unhide', 'published'],
  ['published', 'close', 'closed'],
  ['closed', 'reopen', 'published'],
];

const ACTIONS: ShopListingAction[] = ['member_edit', 'close', 'reopen', 'approve', 'reject', 'hide', 'unhide'];

describe('nextStatus', () => {
  it.each(ALLOWED)('%s --%s--> %s', (from, action, to) => {
    expect(nextStatus(from, action)).toBe(to);
  });

  const denied = SHOP_LISTING_STATUSES.flatMap((from) =>
    ACTIONS.filter((action) => !ALLOWED.some(([f, a]) => f === from && a === action)).map(
      (action) => [from, action] as const,
    ),
  );

  it.each(denied)('%s 에서 %s 는 ConflictError', (from, action) => {
    expect(() => nextStatus(from, action)).toThrow(ConflictError);
  });

  it('숨김 글은 회원이 수정해 숨김을 풀 수 없다', () => {
    expect(() => nextStatus('hidden', 'member_edit')).toThrow(ConflictError);
  });
});

describe('동시 게시 한도', () => {
  it('pending 과 published 만 센다', () => {
    expect(SHOP_LISTING_STATUSES.filter(countsTowardLimit)).toEqual(['pending', 'published']);
  });

  it('세지 않는 상태에서 세는 상태로 들어갈 때만 한도를 검사한다', () => {
    expect(entersLimit('closed', 'published')).toBe(true);
    expect(entersLimit('rejected', 'pending')).toBe(true);
    expect(entersLimit('published', 'pending')).toBe(false);
    expect(entersLimit('pending', 'rejected')).toBe(false);
  });
});
