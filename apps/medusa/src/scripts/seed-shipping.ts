/**
 * 한국 배송 설정 시드 스크립트
 *
 * 멱등성 보장: 이미 존재하는 데이터는 생성하지 않음
 * 실행: yarn medusa exec ./src/scripts/seed-shipping.ts
 *
 * 배송비 정책:
 *   - 기본 배송비: SHIPPING_FEE_KRW
 *   - FREE_SHIPPING_THRESHOLD_KRW 이상 주문 시 무료배송
 */
import { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import {
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from '@medusajs/medusa/core-flows';

// ─── 설정값 ───────────────────────────────────────────────────────────────────
const STOCK_LOCATION_NAME = '한국 물류창고';
const FULFILLMENT_SET_NAME = '한국 배송';
const SERVICE_ZONE_NAME = '한국 전국';
const SHIPPING_OPTION_NAME = '기본배송';

const SHIPPING_FEE_KRW = 2_500;
const FREE_SHIPPING_THRESHOLD_KRW = 50_000;
// ─────────────────────────────────────────────────────────────────────────────

export type StockLocationSalesChannelLink = {
  id?: string | null;
};

export function getMissingSalesChannelIdsForStockLocation(
  linkedSalesChannels: StockLocationSalesChannelLink[] | null | undefined,
  requiredSalesChannelIds: string[],
): string[] {
  const linkedIds = new Set(
    (linkedSalesChannels ?? [])
      .map((salesChannel) => salesChannel.id)
      .filter((id): id is string => Boolean(id)),
  );

  return requiredSalesChannelIds.filter((id) => !linkedIds.has(id));
}

export default async function seedShipping({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL);
  const stockLocationModuleService = container.resolve(Modules.STOCK_LOCATION);
  const storeModuleService = container.resolve(Modules.STORE);

  // ── 1. Stock Location ────────────────────────────────────────────────────
  logger.info('[seed-shipping] Stock location 확인 중...');
  const existingLocations = await stockLocationModuleService.listStockLocations({
    name: STOCK_LOCATION_NAME,
  });

  let stockLocation;
  if (existingLocations.length) {
    stockLocation = existingLocations[0];
    logger.info('[seed-shipping] Stock location 이미 존재함, 건너뜀.');
  } else {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: STOCK_LOCATION_NAME,
            address: { country_code: 'KR', address_1: '' },
          },
        ],
      },
    });
    stockLocation = result[0];
    logger.info('[seed-shipping] Stock location 생성 완료.');
  }

  // ── 2. StockLocation ↔ FulfillmentProvider 연결 ──────────────────────────
  logger.info('[seed-shipping] Fulfillment provider 연결 확인 중...');
  const { data: locationWithProviders } = await query.graph({
    entity: 'stock_location',
    fields: ['id', 'fulfillment_providers.id'],
    filters: { id: stockLocation.id },
  });
  const providerLinked = locationWithProviders[0]?.fulfillment_providers?.some(
    (p: { id: string }) => p.id === 'manual_manual',
  );

  if (!providerLinked) {
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: 'manual_manual' },
    });
    logger.info('[seed-shipping] Fulfillment provider 연결 완료.');
  } else {
    logger.info('[seed-shipping] Fulfillment provider 이미 연결됨, 건너뜀.');
  }

  // ── 3. StockLocation ↔ SalesChannel 연결 ────────────────────────────────
  logger.info('[seed-shipping] Sales channel 연결 확인 중...');
  const [store] = await storeModuleService.listStores();
  let defaultSalesChannelId = store?.default_sales_channel_id ?? null;

  if (!defaultSalesChannelId) {
    const [defaultSalesChannel] = await salesChannelModuleService.listSalesChannels({
      name: 'Default Sales Channel',
    });
    defaultSalesChannelId = defaultSalesChannel?.id ?? null;
  }

  if (!defaultSalesChannelId) {
    throw new Error('[seed-shipping] Default sales channel을 찾을 수 없습니다. seed.ts를 먼저 실행하세요.');
  }

  const requiredSalesChannelIds = [defaultSalesChannelId];
  const getMissingSalesChannelIds = async () => {
    const { data } = await query.graph({
      entity: 'stock_location',
      fields: ['id', 'sales_channels.id'],
      filters: { id: stockLocation.id },
    });

    return getMissingSalesChannelIdsForStockLocation(data[0]?.sales_channels, requiredSalesChannelIds);
  };

  const missingSalesChannelIds = await getMissingSalesChannelIds();
  if (missingSalesChannelIds.length) {
    try {
      await linkSalesChannelsToStockLocationWorkflow(container).run({
        input: {
          id: stockLocation.id,
          add: missingSalesChannelIds,
        },
      });
      logger.info('[seed-shipping] Sales channel 연결 완료.');
    } catch (error) {
      const stillMissingSalesChannelIds = await getMissingSalesChannelIds();
      if (stillMissingSalesChannelIds.length) {
        throw error;
      }

      logger.info('[seed-shipping] Sales channel이 다른 seed 실행에서 이미 연결됨, 건너뜀.');
    }
  } else {
    logger.info('[seed-shipping] Sales channel 이미 연결됨, 건너뜀.');
  }

  // ── 4. Shipping Profile ──────────────────────────────────────────────────
  logger.info('[seed-shipping] Shipping profile 확인 중...');
  const existingProfiles = await fulfillmentModuleService.listShippingProfiles({ type: 'default' });

  let shippingProfile;
  if (existingProfiles.length) {
    shippingProfile = existingProfiles[0];
    logger.info('[seed-shipping] Default shipping profile 이미 존재함, 건너뜀.');
  } else {
    const { result } = await createShippingProfilesWorkflow(container).run({
      input: {
        data: [{ name: 'Default', type: 'default' }],
      },
    });
    shippingProfile = result[0];
    logger.info('[seed-shipping] Default shipping profile 생성 완료.');
  }

  // ── 5. FulfillmentSet + ServiceZone ──────────────────────────────────────
  logger.info('[seed-shipping] Fulfillment set 확인 중...');
  const existingSets = await fulfillmentModuleService.listFulfillmentSets(
    { name: FULFILLMENT_SET_NAME },
    { relations: ['service_zones'] },
  );

  let fulfillmentSet;
  if (existingSets.length) {
    fulfillmentSet = existingSets[0];
    logger.info('[seed-shipping] Fulfillment set 이미 존재함, 건너뜀.');
  } else {
    fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
      name: FULFILLMENT_SET_NAME,
      type: 'shipping',
      service_zones: [
        {
          name: SERVICE_ZONE_NAME,
          geo_zones: [{ country_code: 'kr', type: 'country' }],
        },
      ],
    });
    logger.info('[seed-shipping] Fulfillment set 생성 완료.');
  }

  // ── 6. StockLocation ↔ FulfillmentSet 연결 ───────────────────────────────
  logger.info('[seed-shipping] Fulfillment set 연결 확인 중...');
  const { data: locationWithSets } = await query.graph({
    entity: 'stock_location',
    fields: ['id', 'fulfillment_sets.id'],
    filters: { id: stockLocation.id },
  });
  const setLinked = locationWithSets[0]?.fulfillment_sets?.some((s: { id: string }) => s.id === fulfillmentSet.id);

  if (!setLinked) {
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
    });
    logger.info('[seed-shipping] Fulfillment set 연결 완료.');
  } else {
    logger.info('[seed-shipping] Fulfillment set 이미 연결됨, 건너뜀.');
  }

  // ── 7. Shipping Option ───────────────────────────────────────────────────
  logger.info('[seed-shipping] Shipping option 확인 중...');
  const existingOptions = await fulfillmentModuleService.listShippingOptions({
    name: SHIPPING_OPTION_NAME,
  });

  if (existingOptions.length) {
    logger.info('[seed-shipping] Shipping option 이미 존재함, 건너뜀.');
  } else {
    const serviceZoneId = fulfillmentSet.service_zones[0].id;

    await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: SHIPPING_OPTION_NAME,
          price_type: 'flat',
          provider_id: 'manual_manual',
          service_zone_id: serviceZoneId,
          shipping_profile_id: shippingProfile.id,
          type: {
            label: '기본배송',
            description: '3~5일 내 배송',
            code: 'standard',
          },
          // CreateFlatRateShippingOptionPriceRecord 타입에 rules 필드가 누락된 Medusa 타입 버그
          // 런타임에서는 정상 동작함 (https://docs.medusajs.com/resources/commerce-modules/pricing/price-rules)
          prices: [
            // 기본 배송비
            {
              currency_code: 'krw',
              amount: SHIPPING_FEE_KRW,
            },
            // 일정 금액 이상 무료배송
            {
              currency_code: 'krw',
              amount: 0,
              rules: [
                {
                  attribute: 'item_total',
                  operator: 'gte',
                  value: FREE_SHIPPING_THRESHOLD_KRW,
                },
              ],
            },
          ] as any[],
          rules: [
            { attribute: 'enabled_in_store', value: 'true', operator: 'eq' },
            { attribute: 'is_return', value: 'false', operator: 'eq' },
          ],
        },
      ],
    });
    logger.info('[seed-shipping] Shipping option 생성 완료.');
  }

  logger.info('[seed-shipping] 배송 설정 완료.');
}
