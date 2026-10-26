/**
 * 한국 배송 설정 시드 스크립트
 *
 * 멱등성 보장: 이미 존재하는 데이터는 생성하지 않음
 * 실행: yarn medusa exec ./src/scripts/seed-shipping.ts
 *
 * 기본 배송비 그룹과 반품 준비물(반품 배송 옵션·반품 사유)을 보장한다. 추가 그룹(간편식 등)과 금액 변경은 어드민에서 하며,
 * 여기 상수는 "처음 한 번" 값일 뿐이다 — 이미 그룹이 있으면 정책을 덮어쓰지 않는다.
 * 반품 준비물은 그룹 유무와 상관없이 매 부팅 보장한다(K8). 별도 `medusa exec` 로 나누지 않는다 — 부팅마다 앱을 한 번 더 띄우는 비용이다.
 */
import { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

import { listShippingGroups, provisionShippingGroup } from '../modules/almond-fulfillment/provision-shipping-group';
import { ensureReturnShippingOption } from '../modules/almond-fulfillment/return-shipping-option';
import { ensureReturnReasons } from '../workflows/orders/returns/return-reasons';
import {
  DEFAULT_AREA_TEMPLATE_CODE,
  DEFAULT_SHIPPING_GROUP_CODE,
  DEFAULT_SHIPPING_GROUP_DELIVERY,
} from '../modules/almond-fulfillment/types';

const DEFAULT_SHIPPING_OPTION_NAME = '기본배송';
const SHIPPING_FEE_KRW = 2_500;
const FREE_SHIPPING_THRESHOLD_KRW = 50_000;
const RETURN_SETUP_LOCK_KEY = 'almond:seed-shipping:return-setup';

export { getMissingSalesChannelIdsForStockLocation } from '../modules/almond-fulfillment/provision-shipping-group';
export type { StockLocationSalesChannelLink } from '../modules/almond-fulfillment/provision-shipping-group';

export default async function seedShipping({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  await ensureDefaultShippingGroup(container);
  await ensureReturnSetup(container);

  logger.info('[seed-shipping] 배송 설정 완료.');
}

/**
 * 반품 배송 옵션·사유 보장. 라이브는 store·admin 두 서비스가 부팅마다 이 시드를 동시에 돌린다 — DB advisory lock 으로 한 번에
 * 하나만 돌게 한다(잠금을 쥔 트랜잭션이 열려 있는 동안 다른 커넥션으로 일한다). Medusa locking 모듈은 쓰지 않는다 — redis 가
 * 태스크마다 붙은 사이드카라 태스크끼리 직렬화되지 않는다.
 * 실패해도 부팅은 계속한다. 반품은 아직 휴면이고, 옵션이 없으면 반품 요청이 거절한다(설계 §4.2) — 체크아웃까지 함께 죽일 이유가 없다.
 */
async function ensureReturnSetup(container: ExecArgs['container']) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  try {
    const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
    await pg.transaction(async (trx) => {
      await trx.raw('select pg_advisory_xact_lock(hashtext(?))', [RETURN_SETUP_LOCK_KEY]);
      await ensureReturnShippingOption(container);
      await ensureReturnReasons(container);
    });
  } catch (error) {
    logger.error(`[seed-shipping] 반품 준비 실패 — 부팅은 계속한다: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function ensureDefaultShippingGroup(container: ExecArgs['container']) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const existing = await listShippingGroups(container);
  if (existing.some((group) => group.code === DEFAULT_SHIPPING_GROUP_CODE)) {
    logger.info('[seed-shipping] 기본 배송비 그룹 이미 존재함, 정책 유지.');
    return;
  }

  await provisionShippingGroup(container, {
    code: DEFAULT_SHIPPING_GROUP_CODE,
    name: DEFAULT_SHIPPING_OPTION_NAME,
    policy: {
      type: 'conditional_free',
      baseFee: SHIPPING_FEE_KRW,
      freeThreshold: FREE_SHIPPING_THRESHOLD_KRW,
    },
    areaTemplateCode: DEFAULT_AREA_TEMPLATE_CODE,
    delivery: DEFAULT_SHIPPING_GROUP_DELIVERY,
  });
}
