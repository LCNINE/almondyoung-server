/**
 * 기본 스토어 설정 시드 스크립트
 *
 * 멱등성 보장: 이미 존재하는 데이터는 생성하지 않음
 * 실행: yarn seed  (또는 yarn medusa exec ./src/scripts/seed.ts)
 *
 * 담당 범위:
 *   - Store 통화/Sales Channel 설정
 *   - Region (한국/KRW)
 *   - Tax Region (한국)
 *   - Publishable API Key
 *
 * 배송/Fulfillment 설정은 seed-shipping.ts 참고
 */
import { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import {
  createApiKeysWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  updateStoresWorkflow,
} from '@medusajs/medusa/core-flows';

export default async function seedData({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL);
  const storeModuleService = container.resolve(Modules.STORE);
  const regionModuleService = container.resolve(Modules.REGION);
  const taxModuleService = container.resolve(Modules.TAX);
  const apiKeyModuleService = container.resolve(Modules.API_KEY);

  // ── 1. Sales Channel ─────────────────────────────────────────────────────
  logger.info('[seed] Sales channel 확인 중...');
  let defaultSalesChannel = await salesChannelModuleService.listSalesChannels({
    name: 'Default Sales Channel',
  });

  if (!defaultSalesChannel.length) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: {
        salesChannelsData: [{ name: 'Default Sales Channel' }],
      },
    });
    defaultSalesChannel = result;
    logger.info('[seed] Sales channel 생성 완료.');
  } else {
    logger.info('[seed] Sales channel 이미 존재함, 건너뜀.');
  }

  // ── 2. Store 설정 ─────────────────────────────────────────────────────────
  logger.info('[seed] Store 설정 중...');
  const [store] = await storeModuleService.listStores();
  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        supported_currencies: [
          { currency_code: 'krw', is_default: true },
        ],
        default_sales_channel_id: defaultSalesChannel[0].id,
      },
    },
  });
  logger.info('[seed] Store 설정 완료.');

  // ── 3. Region ─────────────────────────────────────────────────────────────
  // 이름이 아닌 국가 코드 기준으로 확인 (기존 리전 이름이 달라도 중복 생성 방지)
  logger.info('[seed] Region 확인 중...');
  const allRegions = await regionModuleService.listRegions(
    {},
    { relations: ['countries'] },
  );
  const krRegionExists = allRegions.some((r) =>
    r.countries?.some((c) => c.iso_2 === 'kr'),
  );

  if (!krRegionExists) {
    await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: 'Korea',
            currency_code: 'krw',
            countries: ['kr'],
            payment_providers: ['pp_system_default'],
          },
        ],
      },
    });
    logger.info('[seed] Region 생성 완료.');
  } else {
    logger.info('[seed] Region 이미 존재함, 건너뜀.');
  }

  // ── 4. Tax Region ─────────────────────────────────────────────────────────
  logger.info('[seed] Tax region 확인 중...');
  const existingTaxRegions = await taxModuleService.listTaxRegions({
    country_code: 'kr',
  });

  if (!existingTaxRegions.length) {
    await createTaxRegionsWorkflow(container).run({
      input: [{ country_code: 'kr', provider_id: 'tp_system' }],
    });
    logger.info('[seed] Tax region 생성 완료.');
  } else {
    logger.info('[seed] Tax region 이미 존재함, 건너뜀.');
  }

  // ── 5. Publishable API Key ────────────────────────────────────────────────
  logger.info('[seed] Publishable API key 확인 중...');
  const existingApiKeys = await apiKeyModuleService.listApiKeys({
    title: 'Webshop',
    type: 'publishable',
  });

  if (!existingApiKeys.length) {
    const { result: apiKeyResult } = await createApiKeysWorkflow(
      container,
    ).run({
      input: {
        api_keys: [{ title: 'Webshop', type: 'publishable', created_by: '' }],
      },
    });

    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: {
        id: apiKeyResult[0].id,
        add: [defaultSalesChannel[0].id],
      },
    });
    logger.info('[seed] Publishable API key 생성 완료.');
  } else {
    logger.info('[seed] Publishable API key 이미 존재함, 건너뜀.');
  }

  logger.info('[seed] 기본 스토어 설정 완료.');
}
