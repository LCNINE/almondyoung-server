import type { MedusaContainer } from '@medusajs/framework/types';
import { MedusaError, Modules } from '@medusajs/framework/utils';
import { listActiveTimeSales, listAllTimeSales } from './time-sale';
import {
  defaultTimeSaleSettings,
  validateTimeSaleSettings,
  nextRepeatedPeriod,
  type TimeSaleSettings,
} from '../../../../packages/domain-types/time-sale';

const KEY = 'timeSaleSettings';

export async function loadTimeSaleSettings(
  container: MedusaContainer,
): Promise<{ settings: TimeSaleSettings; revision: string }> {
  const [store] = await container.resolve(Modules.STORE).listStores();
  if (!store) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'Store를 찾을 수 없습니다.');

  const raw = store.metadata?.[KEY];
  if (!raw) return { settings: defaultTimeSaleSettings(), revision: '' };

  validateTimeSaleSettings(raw);

  return { settings: raw, revision: String(store.metadata?.timeSaleSettingsRevision ?? '') };
}

export async function saveTimeSaleSettings(container: MedusaContainer, settings: unknown, revision: unknown) {
  try {
    validateTimeSaleSettings(settings);
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      error instanceof Error ? error.message : '설정을 확인하세요.',
    );
  }

  return container.resolve(Modules.LOCKING).execute(
    'time-sale-settings',
    async () => {
      const service = container.resolve(Modules.STORE);
      const [store] = await service.listStores();
      if (!store) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'Store를 찾을 수 없습니다.');

      if (String(store.metadata?.timeSaleSettingsRevision ?? '') !== revision)
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          '다른 관리자가 설정을 변경했습니다. 새로고침 후 다시 저장하세요.',
        );

      const next = new Date().toISOString();
      await service.updateStores(store.id, {
        metadata: { ...store.metadata, [KEY]: settings, timeSaleSettingsRevision: next },
      });

      const url = process.env.STOREFRONT_REVALIDATE_URL,
        secret = process.env.STOREFRONT_REVALIDATE_SECRET;
      if (url && secret) {
        try {
          const result = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': secret },
            body: JSON.stringify({ tags: ['time-sale', 'products'] }),
            signal: AbortSignal.timeout(5000),
          });
          if (!result.ok) throw new Error(`status ${result.status}`);
        } catch (error) {
          container.resolve('logger').warn(`[time-sale] 설정 저장 후 캐시 갱신 실패: ${String(error)}`);
        }
      }

      return { settings, revision: next };
    },
    { timeout: 10 },
  );
}

export async function privateTimeSaleProductIds(container: MedusaContainer): Promise<Set<string>> {
  const { settings } = await loadTimeSaleSettings(container);
  if (!settings.environment.membershipPriceOnly && !Object.values(settings.sales).some((d) => d.membershipPriceOnly))
    return new Set();

  const sales = await listActiveTimeSales(container);
  return new Set(
    sales
      .filter(
        (sale) =>
          settings.environment.membershipPriceOnly ||
          sale.priceListIds.some((id) => settings.sales[id]?.membershipPriceOnly),
      )
      .flatMap((sale) => sale.productIds),
  );
}

export async function repeatTimeSales(container: MedusaContainer) {
  await container.resolve(Modules.LOCKING).execute(
    'time-sale-repeat',
    async () => {
      const { settings } = await loadTimeSaleSettings(container);
      if (!settings.environment.enabled) return;

      let changed = false;
      for (const sale of await listAllTimeSales(container)) {
        const d = settings.sales[sale.generalId ?? sale.membershipId ?? ''];
        if (sale.status !== 'active' || !d?.repeatHours || !sale.startsAt || !sale.endsAt) continue;
        const next = nextRepeatedPeriod(sale.startsAt, sale.endsAt, d.repeatHours, d.repeatUntil);
        if (!next) continue;

        changed = true;
        await container
          .resolve(Modules.PRICING)
          .updatePriceLists(
            [sale.generalId, sale.membershipId]
              .filter((id): id is string => !!id)
              .map((id) => ({ id, starts_at: next.startsAt, ends_at: next.endsAt })),
          );
      }

      if (changed && process.env.STOREFRONT_REVALIDATE_URL && process.env.STOREFRONT_REVALIDATE_SECRET) {
        const response = await fetch(process.env.STOREFRONT_REVALIDATE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-revalidate-secret': process.env.STOREFRONT_REVALIDATE_SECRET,
          },
          body: JSON.stringify({ tags: ['time-sale', 'products'] }),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`반복 세일 캐시 갱신 실패: ${response.status}`);
      }
    },
    { timeout: 5 },
  );
}
