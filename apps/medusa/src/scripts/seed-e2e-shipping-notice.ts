/**
 * 개별 배송비 그룹 표시 E2E(web/almondyoung-storefront/e2e/shipping-group-notice) 시드.
 *
 * 멱등: 그룹은 code 기준 upsert, 이미 있는 상품은 만들지 않는다. 로컬 전용 — 기본 시드(seed.ts, seed-shipping.ts)가
 * 먼저 돌아 region/판매채널/publishable key/기본 그룹이 있어야 한다.
 *
 * 실행: yarn medusa exec ./src/scripts/seed-e2e-shipping-notice.ts
 */
import { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules, ProductStatus } from '@medusajs/framework/utils';
import { createProductsWorkflow } from '@medusajs/medusa/core-flows';

import { provisionShippingGroup } from '../modules/almond-fulfillment/provision-shipping-group';
import { DEFAULT_AREA_TEMPLATE_CODE, DEFAULT_SHIPPING_GROUP_DELIVERY } from '../modules/almond-fulfillment/types';

const E2E_GROUPS = [
  {
    code: 'e2e-flat',
    name: 'E2E개별플랫',
    policy: { type: 'flat' as const, baseFee: 3_000 },
    description: '다른 출고지에서 개별 배송되는 상품이라 기본 배송과 분리되어 배송비가 별도 부과됩니다.',
    delivery: { ...DEFAULT_SHIPPING_GROUP_DELIVERY, carrier: '한진택배' },
  },
  {
    code: 'e2e-perqty',
    name: 'E2E개별개당',
    policy: { type: 'per_quantity' as const, baseFee: 5_000 },
  },
  {
    code: 'e2e-cond',
    name: 'E2E개별조건부',
    policy: { type: 'conditional_free' as const, baseFee: 4_000, freeThreshold: 30_000 },
  },
];

const E2E_PRODUCTS = [
  { handle: 'e2e-ship-default', title: 'E2E 기본그룹 상품', groupCode: null, price: 10_000 },
  { handle: 'e2e-ship-flat', title: 'E2E 플랫그룹 상품', groupCode: 'e2e-flat', price: 8_000 },
  { handle: 'e2e-ship-perqty', title: 'E2E 개당그룹 상품', groupCode: 'e2e-perqty', price: 12_000 },
  { handle: 'e2e-ship-cond', title: 'E2E 조건부그룹 상품', groupCode: 'e2e-cond', price: 9_000 },
  { handle: 'e2e-ship-digital', title: 'E2E 디지털 상품', groupCode: null, price: 5_000, digital: true },
];

export default async function seedE2eShippingNotice({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const productModuleService = container.resolve(Modules.PRODUCT);
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL);

  // provisionShippingGroup 은 code 기준 upsert 라 매번 불러도 안전하다.
  // 건너뛰면 정책·설명을 바꿔도 기존 로컬 DB 에 반영되지 않는다.
  for (const group of E2E_GROUPS) {
    await provisionShippingGroup(container, {
      areaTemplateCode: DEFAULT_AREA_TEMPLATE_CODE,
      delivery: DEFAULT_SHIPPING_GROUP_DELIVERY,
      ...group,
    });
  }

  const [salesChannel] = await salesChannelModuleService.listSalesChannels({
    name: 'Default Sales Channel',
  });
  if (!salesChannel) throw new Error('기본 시드(seed.ts)가 먼저 필요하다: sales channel 없음');

  const [defaultProfile] = await fulfillmentModuleService.listShippingProfiles({ type: 'default' });
  if (!defaultProfile) throw new Error('기본 시드(seed-shipping.ts)가 먼저 필요하다: default shipping profile 없음');

  const groupProfiles = await fulfillmentModuleService.listShippingProfiles({ type: 'shipping' });
  const profileByGroupCode = new Map(
    groupProfiles
      .filter((profile) => typeof profile.metadata?.shippingGroupCode === 'string')
      .map((profile) => [profile.metadata!.shippingGroupCode as string, profile.id]),
  );

  for (const spec of E2E_PRODUCTS) {
    const existing = await productModuleService.listProducts({ handle: spec.handle });
    if (existing.length > 0) {
      logger.info(`[seed-e2e-shipping] 상품 ${spec.handle} 이미 존재, 건너뜀.`);
      continue;
    }

    const shippingProfileId = spec.groupCode ? profileByGroupCode.get(spec.groupCode) : defaultProfile.id;
    if (!shippingProfileId) throw new Error(`그룹 ${spec.groupCode} 의 shipping profile 이 없다`);

    const metadata: Record<string, unknown> = {};
    if (spec.groupCode) metadata.shippingGroupCode = spec.groupCode;
    if (spec.digital) {
      metadata.fulfillmentKind = 'digital';
      metadata.requiresShipping = false;
    }

    await createProductsWorkflow(container).run({
      input: {
        products: [
          {
            title: spec.title,
            handle: spec.handle,
            status: ProductStatus.PUBLISHED,
            shipping_profile_id: shippingProfileId,
            sales_channels: [{ id: salesChannel.id }],
            metadata,
            options: [{ title: '기본', values: ['기본'] }],
            variants: [
              {
                title: '기본',
                sku: `${spec.handle}-sku`,
                options: { 기본: '기본' },
                manage_inventory: false,
                prices: [{ currency_code: 'krw', amount: spec.price }],
              },
            ],
          },
        ],
      },
    });
    logger.info(`[seed-e2e-shipping] 상품 ${spec.handle} 생성.`);
  }

  logger.info('[seed-e2e-shipping] 완료.');
}
