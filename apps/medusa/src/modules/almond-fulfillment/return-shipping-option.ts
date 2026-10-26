import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { createShippingOptionsWorkflow } from '@medusajs/medusa/core-flows';

import { ALMOND_FULFILLMENT_PROVIDER_ID, ensureKoreanShippingInfrastructure } from './provision-shipping-group';

/**
 * 반품 배송 옵션 — 반품 배송 방법은 이 옵션으로만 만든다(K8 설계 §4.2, PR2 N1).
 *
 * 배송비 그룹 profile 밖, 전용 profile 하나에 옵션 하나를 둔다. provisionShippingGroup 은 그룹 profile 의 다른 옵션을
 * 지우므로 그룹 profile 에 두면 그룹을 고칠 때 사라진다. 반품 택배비는 이 옵션이 아니라 주문 시점 policySnapshot 으로
 * 계산하므로(§4.4) 그룹마다 옵션이 있을 이유가 없다. 코어의 반품 배송 방법 생성은 profile 을 검사하지 않는다.
 *
 * flat 0원이라 provider 의 calculatePrice(정책 없는 옵션에서 던진다)를 타지 않는다. 금액은 워크플로가 custom_amount 로 정한다.
 */
export const RETURN_SHIPPING_PROFILE_TYPE = 'return';
export const RETURN_SHIPPING_OPTION_PURPOSE = 'return';

const RETURN_SHIPPING_PROFILE_NAME = '반품';
const RETURN_SHIPPING_OPTION_NAME = '반품 회수';

export async function ensureReturnShippingOption(container: MedusaContainer): Promise<string> {
  const existing = await findReturnShippingOptionId(container);
  if (existing) return existing;

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const { serviceZoneId } = await ensureKoreanShippingInfrastructure(container);
  const profile = await findOrCreateReturnProfile(container);

  const { result } = await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: RETURN_SHIPPING_OPTION_NAME,
        price_type: 'flat',
        provider_id: ALMOND_FULFILLMENT_PROVIDER_ID,
        service_zone_id: serviceZoneId,
        shipping_profile_id: profile.id,
        type: { label: RETURN_SHIPPING_OPTION_NAME, description: '고객 반품 회수', code: 'return' },
        prices: [{ currency_code: 'krw', amount: 0 }],
        data: { purpose: RETURN_SHIPPING_OPTION_PURPOSE },
        rules: [
          { attribute: 'enabled_in_store', value: 'false', operator: 'eq' },
          { attribute: 'is_return', value: 'true', operator: 'eq' },
        ],
      },
    ],
  });
  logger.info('[return-shipping] 반품 배송 옵션 생성 완료.');
  return result[0].id;
}

/** 반품 배송 옵션 id. 부팅이 겹쳐 둘이 생겨도 늘 같은(가장 오래된) 하나를 고른다. 없으면 null — 반품 요청이 거절할 근거다. */
export async function findReturnShippingOptionId(container: MedusaContainer): Promise<string | null> {
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const profiles = await fulfillmentModuleService.listShippingProfiles({ type: RETURN_SHIPPING_PROFILE_TYPE });
  if (!profiles.length) return null;

  const options = await fulfillmentModuleService.listShippingOptions({ shipping_profile_id: profiles.map((p) => p.id) });
  const [oldest] = options
    .filter((option) => (option.data as { purpose?: unknown } | null)?.purpose === RETURN_SHIPPING_OPTION_PURPOSE)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id.localeCompare(b.id));
  return oldest?.id ?? null;
}

async function findOrCreateReturnProfile(container: MedusaContainer): Promise<{ id: string }> {
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const [existing] = await fulfillmentModuleService.listShippingProfiles({ type: RETURN_SHIPPING_PROFILE_TYPE });
  if (existing) return existing;
  return fulfillmentModuleService.createShippingProfiles({
    name: RETURN_SHIPPING_PROFILE_NAME,
    type: RETURN_SHIPPING_PROFILE_TYPE,
  });
}
