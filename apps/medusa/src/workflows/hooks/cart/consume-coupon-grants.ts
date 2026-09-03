import { MedusaError } from '@medusajs/framework/utils';
import type PromotionMetaModuleService from '../../../modules/promotion-meta/service';

/** 훅 보상의 입력 — 이번 실행이 잡은 장. */
export type ConsumedCouponGrants = { cart_id: string; grant_ids: string[] };

/** 훅이 앞에서 모아 두는 판정 — 어느 쿠폰을, 장이 사용을 지배하는지(`grantsGovernUsage`)와 함께. */
export type ConsumeRequest = { promotion_id: string; grants_govern: boolean };

type ConsumeService = Pick<PromotionMetaModuleService, 'consumeOneUsableGrantForCart' | 'restoreGrants'>;

/**
 * `completeCartWorkflow` 의 `validate` 훅 «마지막 문장» — 쿠폰 장의 소모 (ADR-0034 2026-09-04 개정, 결정 5·7).
 *
 * 소모가 곧 검사다. 옛 구조는 훅이 장을 «읽어서 검사»하고(`hasUsableGrant`) 열 스텝 뒤 미문서 훅이
 * «썼다». 그 사이가 같은 고객의 두 카트가 장 하나로 둘 다 통과하는 창이었다. 이제
 * `consumeOneUsableGrantForCart` 의 결과가 판정이다 — `none` 이고 장이 사용을 지배하면 거절.
 *
 * 🔴 **이 함수는 훅 핸들러의 마지막에 불려야 한다.** 다른 거절(통관부호·멤버십·캡 …)이 전부 지난
 * 뒤여야, 여기서 잡은 장을 놓아야 하는 경우가 «이 함수 안의 거절» 로 좁혀진다(소모 자체의 DB
 * 오류나 되돌리기 실패로 못 놓은 장은 스위퍼가 받는다).
 *
 * 🔴 **거절할 때는 이번 호출이 잡은 장을 먼저 놓는다.** 실패한 스텝 자신의 보상은 invoke 출력을
 * 받지 못한다(`workflows-sdk` `create-step-handler.js` — `stepArguments.invoke[stepName]?.output`
 * 이 없으면 `undefined` 로 부른다). 뒤 스텝(주문 생성·재고예약·결제 승인)이 실패할 때만 훅
 * 보상(`restoreConsumedCouponGrants`)이 id 목록을 받아 되돌린다.
 *
 * 소모 실패(DB 오류)는 삼키지 않는다 — `validate` 는 돈이 움직이기 전이라 실패 = 주문 거절이고,
 * 그건 이미 `COUPON_EXPIRED` 가 하는 일이다. 옛 `orderCreated` 훅의 I1(「기록 실패로 결제된
 * 주문을 되돌리지 않는다」)은 결제 뒤 훅에 맞는 정책이었다.
 */
export async function consumeCouponGrantsForCart(
  service: ConsumeService,
  input: { cart_id: string; customer_id: string | null; now: Date },
  requests: ConsumeRequest[],
): Promise<ConsumedCouponGrants> {
  const grantIds: string[] = [];
  // 비회원 주문엔 발급 개념이 없다 — 소모할 장도 없다. 발급이 필요한 쿠폰은 훅 앞쪽이 이미 거절했다.
  if (!input.customer_id) return { cart_id: input.cart_id, grant_ids: grantIds };

  for (const request of requests) {
    const result = await service.consumeOneUsableGrantForCart({
      promotion_id: request.promotion_id,
      customer_id: input.customer_id,
      cart_id: input.cart_id,
      now: input.now,
    });
    if (result.outcome === 'consumed') {
      grantIds.push(result.grant_id);
      continue;
    }
    // `already` 는 이전 실행(완료된 카트의 재완료·엔진 재호출)이 잡은 장이다 — 통과이되 이번
    // 실행의 보상 목록엔 넣지 않는다. 남의 실행이 잡은 장을 이번 실행의 실패가 놓으면 안 된다.
    if (result.outcome === 'already') continue;
    if (request.grants_govern) {
      // 카트 미들웨어(`per-customer-limit`)와 같은 토큰 — 스토어프론트가 정확 일치로 본다.
      // 되돌리기가 실패해도 거절 토큰은 지킨다 — 스토어프론트가 정확 일치로 보는 값이다. 못 놓은 장은
      // 스위퍼(주문 없는 소모)가 받는다. 삼키는 것은 «undo 의 실패»이지 소모의 실패가 아니다.
      try {
        await service.restoreGrants(grantIds);
      } catch {
        // 스위퍼가 받는다.
      }
      throw new MedusaError(MedusaError.Types.INVALID_DATA, 'COUPON_EXPIRED');
    }
    // `public` 쿠폰(장이 지배하지 않음)의 `none` 은 소모할 장이 없을 뿐이다 — 정책이 정한다.
  }
  return { cart_id: input.cart_id, grant_ids: grantIds };
}

/** 훅 보상 — 뒤 스텝이 실패하면 이번 실행이 잡은 장을 전부 놓는다. 입력이 없으면(실패한 스텝 자신) 할 일이 없다. */
export async function restoreConsumedCouponGrants(
  service: Pick<PromotionMetaModuleService, 'restoreGrants'>,
  consumed: ConsumedCouponGrants | undefined,
): Promise<number> {
  if (!consumed || consumed.grant_ids.length === 0) return 0;
  return service.restoreGrants(consumed.grant_ids);
}
