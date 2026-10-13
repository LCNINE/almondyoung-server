import { AuthzSubject, systemPrincipal } from '@app/authorization';

/** 사람이 아닌 출고 처리(채널 주문 변경·주문 취소 연동)를 기록할 때 쓰는 행위자 id. */
export const FULFILLMENT_SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000010';

const FULFILLMENT_SYSTEM = systemPrincipal('core.fulfillment-system');

/**
 * 판정 지점에 넘길 주체. 시스템 행위자는 역할 이름이 아니라 시스템 주체로 본다 — 사람 토큰의 sub 는
 * user-service 가 발급한 사용자 id 라 이 고정 id 와 겹치지 않는다.
 */
export function authzSubjectOf(actor: { readonly id: string; readonly roles: readonly string[] }): AuthzSubject {
  return actor.id === FULFILLMENT_SYSTEM_ACTOR_ID ? FULFILLMENT_SYSTEM : { roles: actor.roles };
}
