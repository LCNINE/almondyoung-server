import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import {
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  deleteShippingOptionsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from '@medusajs/medusa/core-flows';

import { findAreaTemplate } from './area-templates';
import {
  DEFAULT_SHIPPING_GROUP_CODE,
  DEFAULT_SHIPPING_GROUP_DELIVERY,
  type ShippingFeePolicy,
  type ShippingGroup,
  type ShippingGroupDelivery,
  type ShippingGroupOptionData,
} from './types';

export const STOCK_LOCATION_NAME = '한국 물류창고';
export const FULFILLMENT_SET_NAME = '한국 배송';
export const SERVICE_ZONE_NAME = '한국 전국';

export const ALMOND_FULFILLMENT_PROVIDER_ID = 'almond_almond';
const MANUAL_FULFILLMENT_PROVIDER_ID = 'manual_manual';

export type StockLocationSalesChannelLink = { id?: string | null };

export function getMissingSalesChannelIdsForStockLocation(
  linkedSalesChannels: StockLocationSalesChannelLink[] | null | undefined,
  requiredSalesChannelIds: string[],
): string[] {
  const linkedIds = new Set(
    (linkedSalesChannels ?? []).map((salesChannel) => salesChannel.id).filter((id): id is string => Boolean(id)),
  );

  return requiredSalesChannelIds.filter((id) => !linkedIds.has(id));
}

type Infrastructure = {
  stockLocationId: string;
  fulfillmentSetId: string;
  serviceZoneId: string;
};

/**
 * 배송비 그룹들이 공유하는 배선 — 창고 / fulfillment provider / 판매채널 / 배송권역.
 * 모두 멱등이다.
 */
export async function ensureKoreanShippingInfrastructure(container: MedusaContainer): Promise<Infrastructure> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL);
  const stockLocationModuleService = container.resolve(Modules.STOCK_LOCATION);
  const storeModuleService = container.resolve(Modules.STORE);

  // ── Stock location ──────────────────────────────────────────────────────
  const existingLocations = await stockLocationModuleService.listStockLocations({ name: STOCK_LOCATION_NAME });
  let stockLocation = existingLocations[0];
  if (!stockLocation) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: { locations: [{ name: STOCK_LOCATION_NAME, address: { country_code: 'KR', address_1: '' } }] },
    });
    stockLocation = result[0];
    logger.info('[shipping-group] Stock location 생성 완료.');
  }

  // ── Stock location ↔ fulfillment provider ───────────────────────────────
  const { data: locationWithProviders } = await query.graph({
    entity: 'stock_location',
    fields: ['id', 'fulfillment_providers.id'],
    filters: { id: stockLocation.id },
  });
  const linkedProviderIds = new Set<string>(
    (locationWithProviders[0]?.fulfillment_providers ?? []).map((provider: { id: string }) => provider.id),
  );

  for (const providerId of [MANUAL_FULFILLMENT_PROVIDER_ID, ALMOND_FULFILLMENT_PROVIDER_ID]) {
    if (linkedProviderIds.has(providerId)) continue;
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: providerId },
    });
    logger.info(`[shipping-group] Fulfillment provider 연결 완료: ${providerId}`);
  }

  // ── Stock location ↔ sales channel ──────────────────────────────────────
  const [store] = await storeModuleService.listStores();
  let defaultSalesChannelId = store?.default_sales_channel_id ?? null;
  if (!defaultSalesChannelId) {
    const [defaultSalesChannel] = await salesChannelModuleService.listSalesChannels({ name: 'Default Sales Channel' });
    defaultSalesChannelId = defaultSalesChannel?.id ?? null;
  }
  if (!defaultSalesChannelId) {
    throw new Error('[shipping-group] Default sales channel을 찾을 수 없습니다. seed.ts를 먼저 실행하세요.');
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
        input: { id: stockLocation.id, add: missingSalesChannelIds },
      });
    } catch (error) {
      if ((await getMissingSalesChannelIds()).length) throw error;
      logger.info('[shipping-group] Sales channel이 다른 실행에서 이미 연결됨, 건너뜀.');
    }
  }

  // ── Fulfillment set + service zone ──────────────────────────────────────
  const existingSets = await fulfillmentModuleService.listFulfillmentSets(
    { name: FULFILLMENT_SET_NAME },
    { relations: ['service_zones'] },
  );
  let fulfillmentSet = existingSets[0];
  if (!fulfillmentSet) {
    fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
      name: FULFILLMENT_SET_NAME,
      type: 'shipping',
      service_zones: [{ name: SERVICE_ZONE_NAME, geo_zones: [{ country_code: 'kr', type: 'country' }] }],
    });
    logger.info('[shipping-group] Fulfillment set 생성 완료.');
  }

  const { data: locationWithSets } = await query.graph({
    entity: 'stock_location',
    fields: ['id', 'fulfillment_sets.id'],
    filters: { id: stockLocation.id },
  });
  const setLinked = locationWithSets[0]?.fulfillment_sets?.some((set: { id: string }) => set.id === fulfillmentSet.id);
  if (!setLinked) {
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
    });
    logger.info('[shipping-group] Fulfillment set 연결 완료.');
  }

  return {
    stockLocationId: stockLocation.id,
    fulfillmentSetId: fulfillmentSet.id,
    serviceZoneId: fulfillmentSet.service_zones[0].id,
  };
}

/**
 * 배송비 그룹 하나를 만들거나 정책을 갱신한다.
 *
 * 그룹 = shipping profile 1개 + 그 profile 에 달린 calculated shipping option 1개.
 * profile 을 나누는 이유는 Medusa 가 카트에 담긴 profile 마다 배송수단을 하나씩 요구하기 때문이다
 * (core-flows 의 validateShippingStep). 이게 곧 "그룹당 배송비 1회" 다.
 */
export async function provisionShippingGroup(container: MedusaContainer, group: ShippingGroup): Promise<string> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const { serviceZoneId } = await ensureKoreanShippingInfrastructure(container);

  const profile = await findOrCreateShippingProfile(container, group);
  // 지역 추가비는 템플릿이 소유한다. provider 는 store 모듈에 접근할 수 없으므로 여기서 복사해 둔다.
  const areaTemplate = await findAreaTemplate(container, group.areaTemplateCode);
  const optionData: ShippingGroupOptionData = {
    shippingGroupCode: group.code,
    shippingProfileId: profile.id,
    policy: {
      ...group.policy,
      jejuExtraFee: areaTemplate?.jejuExtraFee ?? 0,
      islandExtraFee: areaTemplate?.islandExtraFee ?? 0,
    },
    areaTemplateCode: group.areaTemplateCode,
    delivery: group.delivery,
    // JSON 병합 갱신이라 키를 빠뜨리면 옛 값이 남는다 — 지울 때도 빈 문자열로 항상 쓴다.
    description: group.description ?? '',
  };

  const existingOptions = await fulfillmentModuleService.listShippingOptions({ shipping_profile_id: profile.id });
  const ownOption = existingOptions.find(
    (option) => (option.data as Partial<ShippingGroupOptionData> | null)?.shippingGroupCode === group.code,
  );

  if (ownOption) {
    // 옛 flat 옵션(2,500원 + item_total 가격규칙)이 남아 있으면 카트에 배송수단이 2개 붙는다.
    const staleOptions = existingOptions.filter((option) => option.id !== ownOption.id);
    await deleteStaleOptions(container, staleOptions);

    // updateShippingOptionsWorkflow 는 가격/규칙까지 통째로 다시 쓰는 경로라 prices 없는
    // calculated 옵션에서 mikro-orm populate 에러로 깨진다. 우리는 data/name 만 바꾸면 되므로
    // 모듈 서비스를 직접 쓴다.
    await fulfillmentModuleService.updateShippingOptions(ownOption.id, {
      name: group.name,
      data: optionData as unknown as Record<string, unknown>,
    });
    logger.info(`[shipping-group] 그룹 갱신: ${group.code}`);
    return profile.id;
  }

  await deleteStaleOptions(container, existingOptions);

  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: group.name,
        price_type: 'calculated',
        provider_id: ALMOND_FULFILLMENT_PROVIDER_ID,
        service_zone_id: serviceZoneId,
        shipping_profile_id: profile.id,
        type: { label: group.name, description: '3~5일 내 배송', code: 'standard' },
        data: optionData as unknown as Record<string, unknown>,
        rules: [
          { attribute: 'enabled_in_store', value: 'true', operator: 'eq' },
          { attribute: 'is_return', value: 'false', operator: 'eq' },
        ],
      },
    ],
  });
  logger.info(`[shipping-group] 그룹 생성: ${group.code}`);
  return profile.id;
}

async function deleteStaleOptions(
  container: MedusaContainer,
  options: Array<{ id: string; name: string }>,
): Promise<void> {
  if (!options.length) return;
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  await deleteShippingOptionsWorkflow(container).run({ input: { ids: options.map((option) => option.id) } });
  logger.info(`[shipping-group] 옛 배송옵션 제거: ${options.map((option) => option.name).join(', ')}`);
}

async function findOrCreateShippingProfile(
  container: MedusaContainer,
  group: ShippingGroup,
): Promise<{ id: string; name: string }> {
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);

  // 기본 그룹은 Medusa 의 default profile 을 그대로 쓴다. 기존 상품들이 이미 이걸 참조한다.
  if (group.code === DEFAULT_SHIPPING_GROUP_CODE) {
    const [existing] = await fulfillmentModuleService.listShippingProfiles({ type: 'default' });
    if (existing) return existing;

    const { result } = await createShippingProfilesWorkflow(container).run({
      input: { data: [{ name: 'Default', type: 'default' }] },
    });
    return result[0];
  }

  const profiles = await fulfillmentModuleService.listShippingProfiles({ type: 'shipping' });
  const existing = profiles.find((profile) => profile.metadata?.shippingGroupCode === group.code);
  if (existing) return existing;

  // createShippingProfilesWorkflow 의 입력 타입에는 metadata 가 빠져 있다(모듈 DTO 에는 있다).
  // 그룹 코드를 metadata 에 심어야 하므로 모듈 서비스를 직접 쓴다.
  return fulfillmentModuleService.createShippingProfiles({
    name: group.name,
    type: 'shipping',
    metadata: { shippingGroupCode: group.code },
  });
}

export type ResolvedShippingGroup = ShippingGroup & { shippingProfileId: string; shippingOptionId: string };

/** 등록된 배송비 그룹 전체. 어드민/스토어 API 와 channel-adapter 매핑이 모두 이걸 읽는다. */
export async function listShippingGroups(container: MedusaContainer): Promise<ResolvedShippingGroup[]> {
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const options = await fulfillmentModuleService.listShippingOptions({});

  const groups: ResolvedShippingGroup[] = [];
  for (const option of options) {
    const data = option.data as Partial<ShippingGroupOptionData> | null;
    if (!data?.shippingGroupCode || !data.policy || !data.shippingProfileId) continue;
    groups.push({
      code: data.shippingGroupCode,
      name: option.name,
      policy: data.policy as ShippingFeePolicy,
      areaTemplateCode: data.areaTemplateCode,
      delivery: (data.delivery as ShippingGroupDelivery | undefined) ?? DEFAULT_SHIPPING_GROUP_DELIVERY,
      description: typeof data.description === 'string' && data.description.trim() ? data.description : undefined,
      shippingProfileId: data.shippingProfileId,
      shippingOptionId: option.id,
    });
  }

  return groups.sort((a, b) => (a.code === DEFAULT_SHIPPING_GROUP_CODE ? -1 : a.code.localeCompare(b.code)));
}

/**
 * 지역별 배송비 템플릿이 바뀌면 그 템플릿을 쓰는 그룹들의 배송옵션 data 를 다시 쓴다.
 * 지역 추가비는 계산 시점에 조회할 수 없어 그룹에 복사돼 있기 때문이다.
 */
export async function reprovisionGroupsUsingAreaTemplate(
  container: MedusaContainer,
  areaTemplateCode: string,
): Promise<number> {
  const groups = await listShippingGroups(container);
  const targets = groups.filter((group) => group.areaTemplateCode === areaTemplateCode);

  for (const group of targets) {
    await provisionShippingGroup(container, {
      code: group.code,
      name: group.name,
      policy: group.policy,
      areaTemplateCode: group.areaTemplateCode,
      delivery: group.delivery,
    });
  }

  return targets.length;
}
