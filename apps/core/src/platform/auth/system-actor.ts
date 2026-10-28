import { AuthzSubject, SystemPrincipal, systemPrincipal } from '@app/authorization';

/** 사람이 아닌 출고 처리(채널 주문 변경·주문 취소 연동)를 기록할 때 쓰는 행위자 id. 감사 기록용이고, 판정에는 쓰지 않는다. */
export const FULFILLMENT_SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000010';

/** 판정 지점에 넘기는 행위자. 시스템 행위자만 `principal` 을 갖는다 — 토큰이나 DB 값으로는 만들 수 없다. */
export interface AuthzActor {
  readonly id: string;
  readonly roles: readonly string[];
  readonly principal?: SystemPrincipal;
}

const NO_ROLES: string[] = [];

/** 사람이 아닌 출고 처리의 행위자. 시스템 경로는 이 값을 그대로 넘긴다. */
export const FULFILLMENT_SYSTEM_ACTOR = {
  id: FULFILLMENT_SYSTEM_ACTOR_ID,
  roles: NO_ROLES,
  principal: systemPrincipal('core.fulfillment-system'),
} satisfies AuthzActor;

/** 판정 지점에 넘길 주체. 시스템 주체는 행위자가 들고 온 것만 인정하고, 나머지는 역할로 판정한다. */
export function authzSubjectOf(actor: AuthzActor): AuthzSubject {
  return actor.principal ?? { roles: actor.roles };
}
