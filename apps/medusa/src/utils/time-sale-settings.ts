import { randomUUID } from 'node:crypto';
import type { MedusaContainer } from '@medusajs/framework/types';
import { MedusaError, Modules } from '@medusajs/framework/utils';
import { listActiveTimeSales, listAllTimeSales } from './time-sale';
import {
  defaultTimeSaleSettings,
  validateTimeSaleSettings,
  nextRepeatedPeriod,
  type SaleGroup,
  type TimeSaleSettings,
} from '../../../../packages/domain-types/time-sale';

type SaleGroups = { saleId: string; groups: SaleGroup[] }[];

// 설정은 Store.metadata 에 JSON 으로 저장하고, 낙관적 락용 revision 을 같이 둔다.
const KEY = 'timeSaleSettings';

// 세일 저장·상태 변경·반복 갱신이 같은 락을 잡아 서로 겹쳐 쓰지 않게 한다.
export const TIME_SALE_WRITE_LOCK = 'time-sale-write';

// 워크플로 한 번이 락을 잡고 있을 수 있는 최대 시간(초). 프로세스가 죽어도 이 시간 뒤엔 풀린다.
export const TIME_SALE_WRITE_LOCK_TTL = 120;

// 기간 모드·그룹 필드가 없던 옛 설정을 현재 형태(세일 단위 기간 + 그룹 1개)로 채운다.
export function normalizeLegacySales(settings: TimeSaleSettings, sales: SaleGroups): TimeSaleSettings {
  const legacy = Object.entries(settings.sales).filter(([, d]) => !d.periodMode || !Array.isArray(d.groups));
  if (legacy.length === 0) return settings;

  const byId = new Map(sales.map((sale) => [sale.saleId, sale]));
  const normalized = { ...settings.sales };
  for (const [key, display] of legacy) {
    const groups = (byId.get(key)?.groups ?? [])
      .filter((group) => group.productId === null)
      .slice(0, 1)
      .map(({ generalId, membershipId }) => ({ generalId, membershipId, productId: null }));

    normalized[key] = { ...display, periodMode: 'sale', groups };
  }

  return { ...settings, sales: normalized };
}

// Store.metadata 에서 설정 원본과 revision 을 읽는다(없으면 기본값).
async function readTimeSaleSettings(container: MedusaContainer): Promise<{ raw: TimeSaleSettings; revision: string }> {
  const [store] = await container.resolve(Modules.STORE).listStores();
  if (!store) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'Store를 찾을 수 없습니다.');

  const raw = store.metadata?.[KEY];
  if (!raw) return { raw: defaultTimeSaleSettings(), revision: '' };

  validateTimeSaleSettings(raw);
  const environment = { ...raw.environment, suspendedPriceListIds: raw.environment.suspendedPriceListIds ?? [] };

  return { raw: { ...raw, environment }, revision: String(store.metadata?.timeSaleSettingsRevision ?? '') };
}

// 중지 목록에서 이미 지워진 가격표 id 를 뺀다(어드민이 OFF 중 세일을 삭제한 경우).
export function pruneSuspendedPriceLists(settings: TimeSaleSettings, sales: SaleGroups): TimeSaleSettings {
  const existing = new Set(
    sales.flatMap((sale) => sale.groups.flatMap((group) => [group.generalId, group.membershipId])),
  );
  const kept = settings.environment.suspendedPriceListIds.filter((id) => existing.has(id));
  if (kept.length === settings.environment.suspendedPriceListIds.length) return settings;

  return { ...settings, environment: { ...settings.environment, suspendedPriceListIds: kept } };
}

// 설정을 읽고, 옛 형식이 섞여 있으면 세일 목록을 보고 정규화해서 돌려준다.
export async function loadTimeSaleSettings(
  container: MedusaContainer,
  sales?: SaleGroups,
): Promise<{ settings: TimeSaleSettings; revision: string }> {
  const { raw, revision } = await readTimeSaleSettings(container);
  const hasLegacy = Object.values(raw.sales).some((d) => !d.periodMode || !Array.isArray(d.groups));
  const hasSuspended = raw.environment.suspendedPriceListIds.length > 0;
  if (!hasLegacy && !hasSuspended) return { settings: raw, revision };

  const all = sales ?? (await listAllTimeSales(container));
  const settings = hasLegacy ? normalizeLegacySales(raw, all) : raw;

  return { settings: hasSuspended ? pruneSuspendedPriceLists(settings, all) : settings, revision };
}

// 스토어프론트 캐시(time-sale·products 태그) 무효화. 실패해도 저장은 성공으로 두고 경고만 남긴다.
export async function revalidateTimeSaleCache(container: MedusaContainer) {
  const url = process.env.STOREFRONT_REVALIDATE_URL,
    secret = process.env.STOREFRONT_REVALIDATE_SECRET;
  if (!url || !secret) return;

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

// 가격표 상태만 바뀌면 Medusa 상품 조회 캐시가 무효화되지 않아
// 할인가가 남는다. 걸린 상품과 목록 캐시를 비운다.
export async function clearTimeSaleProductCache(container: MedusaContainer, productIds: string[]) {
  if (productIds.length === 0) return;

  try {
    const tags = ['Product:list:*', ...productIds.map((id) => `Product:${id}`)];
    await container.resolve(Modules.CACHING).clear({ tags });
  } catch (error) {
    container.resolve('logger').warn(`[time-sale] 상품 캐시 비우기 실패: ${String(error)}`);
  }
}

// 설정 저장: 검증 → revision 이 같을 때만 쓰기(다른 관리자가 먼저 바꿨으면 409).
export async function saveTimeSaleSettings(
  container: MedusaContainer,
  settings: unknown,
  revision: unknown,
  options: { revalidate: boolean } = { revalidate: true },
) {
  try {
    validateTimeSaleSettings(settings);
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      error instanceof Error ? error.message : '설정을 확인하세요.',
    );
  }

  if (typeof revision !== 'string') {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'revision 은 문자열이어야 합니다.');
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

      if (options.revalidate) await revalidateTimeSaleCache(container);

      return { settings, revision: next };
    },
    { timeout: 10 },
  );
}

// 워크플로 보상용 스냅샷: 쓰기 전 설정·revision 과 이번에 쓴 revision(written).
export type TimeSaleSettingsSnapshot = { settings: unknown; revision: unknown; written: string };

export async function readTimeSaleSettingsSnapshot(container: MedusaContainer) {
  const [store] = await container.resolve(Modules.STORE).listStores();

  return { settings: store?.metadata?.[KEY] ?? null, revision: store?.metadata?.timeSaleSettingsRevision ?? null };
}

// 보상: 내가 쓴 revision 이 그대로일 때만 되돌린다(그 사이 다른 저장이 있었으면 건드리지 않는다).
export async function restoreTimeSaleSettings(container: MedusaContainer, snapshot: TimeSaleSettingsSnapshot) {
  await container.resolve(Modules.LOCKING).execute(
    'time-sale-settings',
    async () => {
      const service = container.resolve(Modules.STORE);
      const [store] = await service.listStores();
      if (!store || String(store.metadata?.timeSaleSettingsRevision ?? '') !== snapshot.written) return;

      await service.updateStores(store.id, {
        metadata: { ...store.metadata, [KEY]: snapshot.settings, timeSaleSettingsRevision: snapshot.revision },
      });
    },
    { timeout: 10 },
  );
}

// 공개 제한 세일 여부: 전체 환경 설정이 켜져 있거나 해당 세일에만 켜져 있으면 true.
export const isPrivateTimeSale = (settings: TimeSaleSettings, saleId: string) =>
  settings.environment.membershipPriceOnly || !!settings.sales[saleId]?.membershipPriceOnly;

type PrivacySale = { saleId: string; title: string };

// 설정 저장으로 공개 제한 여부가 바뀌는 세일 제목들. 가격표
// 규칙이 같이 바뀌어야 해서 세일 화면 저장으로만 허용한다.
export function timeSalePrivacyConflicts(prev: TimeSaleSettings, next: TimeSaleSettings, sales: PrivacySale[]) {
  return sales
    .filter((sale) => isPrivateTimeSale(prev, sale.saleId) !== isPrivateTimeSale(next, sale.saleId))
    .map((sale) => sale.title);
}

export const PRIVACY_CHANGE_MESSAGE = '가격 공개 제한은 세일 화면에서 세일별로 저장하세요';

// 지금 활성인 공개 제한 세일에 걸린 상품 id. 제한이 하나도 없으면 세일 목록을 읽지 않고 빈 Set.
export async function privateTimeSaleProductIds(container: MedusaContainer): Promise<Set<string>> {
  const { raw: settings } = await readTimeSaleSettings(container);
  if (!settings.environment.membershipPriceOnly && !Object.values(settings.sales).some((d) => d.membershipPriceOnly))
    return new Set();

  const sales = await listActiveTimeSales(container);
  return new Set(sales.filter((sale) => isPrivateTimeSale(settings, sale.saleId)).flatMap((sale) => sale.productIds));
}

// 반복 세일의 가격표 기간을 다음 회차로 옮긴다(1분
// 크론). 저장 중이면 락을 못 잡으니 이번 턴은 건너뛴다.
export async function repeatTimeSales(container: MedusaContainer) {
  const locking = container.resolve(Modules.LOCKING);
  const ownerId = `time-sale-repeat:${randomUUID()}`;

  try {
    await locking.acquire(TIME_SALE_WRITE_LOCK, { ownerId, expire: TIME_SALE_WRITE_LOCK_TTL });
  } catch {
    container.resolve('logger').info('[time-sale] 다른 저장이 진행 중이라 이번 반복 갱신을 건너뜁니다.');
    return;
  }

  try {
    await (async () => {
      const sales = await listAllTimeSales(container);
      const { settings } = await loadTimeSaleSettings(container, sales);
      if (!settings.environment.enabled) return;

      let changed = false;
      for (const sale of sales) {
        const d = settings.sales[sale.saleId];
        if (sale.status !== 'active' || !d?.repeatHours) continue;

        // 지난 회차면 nextRepeatedPeriod 가 다음 기간을 주고,
        // 그 기간으로 일반·멤버십 가격표를 같이 옮긴다.
        const updates = sale.groups.flatMap((group) => {
          if (!group.startsAt || !group.endsAt) return [];

          const next = nextRepeatedPeriod(group.startsAt, group.endsAt, d.repeatHours, d.repeatUntil);
          if (!next) return [];

          return [group.generalId, group.membershipId]
            .filter((id): id is string => !!id)
            .map((id) => ({ id, starts_at: next.startsAt, ends_at: next.endsAt }));
        });
        if (updates.length === 0) continue;

        changed = true;
        await container.resolve(Modules.PRICING).updatePriceLists(updates);
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
    })();
  } finally {
    await locking.release(TIME_SALE_WRITE_LOCK, { ownerId });
  }
}
