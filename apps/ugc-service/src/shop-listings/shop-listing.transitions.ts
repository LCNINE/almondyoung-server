import { ConflictError } from '@app/shared';
import { type ShopListingStatus } from './shop-listing.constants';

/** 관리자 수정·삭제는 상태를 바꾸지 않으므로 여기 없다. */
export type ShopListingAction = 'member_edit' | 'close' | 'reopen' | 'approve' | 'reject' | 'hide' | 'unhide';

const TRANSITIONS: Record<ShopListingAction, Partial<Record<ShopListingStatus, ShopListingStatus>>> = {
  // hidden 은 없다 — 수정으로 관리자 숨김을 우회하지 못하게 한다. 삭제는 허용된다.
  member_edit: { pending: 'pending', published: 'pending', closed: 'pending', rejected: 'pending' },
  approve: { pending: 'published' },
  reject: { pending: 'rejected' },
  hide: { published: 'hidden', closed: 'hidden' },
  unhide: { hidden: 'published' },
  close: { published: 'closed' },
  reopen: { closed: 'published' },
};

export function nextStatus(current: ShopListingStatus, action: ShopListingAction): ShopListingStatus {
  const next = TRANSITIONS[action][current];
  if (!next) {
    throw new ConflictError(`이 글은 지금 상태(${current})에서 ${action} 할 수 없습니다.`);
  }
  return next;
}

export function countsTowardLimit(status: ShopListingStatus): boolean {
  return status === 'pending' || status === 'published';
}

export function entersLimit(from: ShopListingStatus, to: ShopListingStatus): boolean {
  return !countsTowardLimit(from) && countsTowardLimit(to);
}
