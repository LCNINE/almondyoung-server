/**
 * 보관 상한(생성일 +14일)을 넘긴 공동현관 비번을 **주문과 카트** metadata 에서 파기한다.
 *
 * Medusa 는 이 값의 통과점일 뿐이다 — 체크아웃이 받아 `cart.metadata.entrance_password` 에
 * 실어두면 `complete-cart` 가 그걸 `order.metadata` 로 복사하고, channel-adapter 가 주문 쪽을
 * 읽어 core 로 넘긴다. 그 뒤 송장 조립·배송 완료 파기·보관 상한 배치는 전부 core 가 한다.
 * 여기 남은 사본은 **둘 다** 보관 의무가 아니라 잔여물이다.
 *
 * **카트를 빼면 파기가 성립하지 않는다.** 주문 쪽만 지우면 모든 주문의 비번이 그 카트 행에
 * 영구히 남고, 메모 단계까지 갔다가 결제하지 않은 카트는 아예 파기 신호를 못 받는다.
 *
 * 잔여물을 즉시 지우지 않고 14일을 두는 이유는 core 가 값을 못 받은 경우의 복구 여지 때문이다.
 * 상한은 core 와 같은 값을 쓴다(`lib/entrance-password-purge.ts` 의 TTL 주석 참고).
 *
 * 실행 방법 (평시에는 아래 스케줄 잡이 대신 돌린다):
 *   npx medusa exec ./src/scripts/purge-expired-entrance-passwords.ts
 */
import type { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import {
  ENTRANCE_PASSWORD_CANDIDATE_SQL,
  ENTRANCE_PASSWORD_CART_CANDIDATE_SQL,
  type EntrancePasswordCandidate,
  buildEntrancePasswordPurgeUpdates,
  chunk,
  expiredEntrancePasswordRowIds,
} from './lib/entrance-password-purge';

/**
 * 한 틱에 훑는 후보 수의 상한. 비번을 들고 있는 행은 상한(14일) 안에 만들어진 것과 아직
 * 파기되지 않은 잔여물뿐이라 실제로는 수백 건 규모지만, 상한이 없으면 사고가 났을 때 틱 하나가
 * 무한정 길어진다. 넘친 분은 다음 틱이 가져간다 — 파기는 몇 번을 돌아도 결과가 같다.
 *
 * 주문과 카트가 각각 이 상한을 받는다. 한쪽이 상한을 채워도 다른 쪽이 굶지 않는다.
 */
export const ENTRANCE_PASSWORD_SWEEP_BATCH = 500;

/** `updateOrders` / `updateCarts` 한 번에 넘기는 행 수. */
export const ENTRANCE_PASSWORD_UPDATE_CHUNK = 50;

export interface EntrancePasswordTtlSweepResult {
  purgedOrders: number;
  holdingOrders: number;
  purgedCarts: number;
  holdingCarts: number;
}

export default async function purgeExpiredEntrancePasswords({
  container,
}: ExecArgs): Promise<EntrancePasswordTtlSweepResult> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const orderModule = container.resolve(Modules.ORDER);
  const cartModule = container.resolve(Modules.CART);

  const now = new Date();

  const orderResult = await knex.raw(ENTRANCE_PASSWORD_CANDIDATE_SQL, [ENTRANCE_PASSWORD_SWEEP_BATCH]);
  const orderCandidates: EntrancePasswordCandidate[] = orderResult.rows ?? [];
  const expiredOrderIds = expiredEntrancePasswordRowIds(orderCandidates, now);

  const cartResult = await knex.raw(ENTRANCE_PASSWORD_CART_CANDIDATE_SQL, [ENTRANCE_PASSWORD_SWEEP_BATCH]);
  const cartCandidates: EntrancePasswordCandidate[] = cartResult.rows ?? [];
  const expiredCartIds = expiredEntrancePasswordRowIds(cartCandidates, now);

  // 빈 문자열 = 키 삭제. 이미 지워진 행에 다시 써도 no-op 이라 중복 실행이 안전하다
  // (Medusa 는 worker_mode 미분리 + 다중 인스턴스라 이 잡이 인스턴스마다 돌 수 있다).
  for (const ids of chunk(expiredOrderIds, ENTRANCE_PASSWORD_UPDATE_CHUNK)) {
    await orderModule.updateOrders(buildEntrancePasswordPurgeUpdates(ids));
  }
  for (const ids of chunk(expiredCartIds, ENTRANCE_PASSWORD_UPDATE_CHUNK)) {
    await cartModule.updateCarts(buildEntrancePasswordPurgeUpdates(ids));
  }

  // 건수만 남긴다. 값은 애초에 조회하지 않으므로 로그에 실릴 경로가 없다.
  const batchNote = (holding: number) =>
    holding === ENTRANCE_PASSWORD_SWEEP_BATCH
      ? ` (배치 상한 ${ENTRANCE_PASSWORD_SWEEP_BATCH} 도달 — 남은 분은 다음 실행이 가져간다)`
      : '';

  if (expiredOrderIds.length === 0 && expiredCartIds.length === 0) {
    logger.info(
      `[entrance-password-ttl] 파기 대상 없음 (비번 보유 주문 ${orderCandidates.length}건 · 카트 ${cartCandidates.length}건, 전부 상한 내)`,
    );
  } else {
    logger.info(
      `[entrance-password-ttl] 보관 상한 초과 공동현관 비번 파기 — 주문 ${expiredOrderIds.length}건` +
        `${batchNote(orderCandidates.length)}, 카트 ${expiredCartIds.length}건${batchNote(cartCandidates.length)}`,
    );
  }

  return {
    purgedOrders: expiredOrderIds.length,
    holdingOrders: orderCandidates.length,
    purgedCarts: expiredCartIds.length,
    holdingCarts: cartCandidates.length,
  };
}
