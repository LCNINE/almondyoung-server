import type { MedusaContainer } from '@medusajs/framework/types';
import { MedusaError, Modules } from '@medusajs/framework/utils';
import { validateTimeSaleSettings, type TimeSaleSettings } from '../../../../packages/domain-types/time-sale';
import { revalidateStorefront } from './storefront-revalidate';

// 진열·스타일 설정은 Store.metadata 에 JSON 으로 저장하고, 낙관적 락용 revision 을 같이 둔다.
// 가격·기간·상태의 정본은 time_sale 모듈이다. 여기엔 화면에 어떻게 보일지만 있다.
const KEY = 'timeSaleSettings';
const REVISION_KEY = 'timeSaleSettingsRevision';

// Store.metadata 에서 설정과 revision 을 읽는다. 저장된 적이 없으면 null 이다 — 기본값은 화면(스토어프론트·
// 어드민)이 자기 코드로 채운다. 여기서 채우면 Medusa 가 들고 있는 옛 기본값이 새 화면 코드와 갈린다.
export async function loadTimeSaleSettings(
  container: MedusaContainer,
): Promise<{ settings: TimeSaleSettings | null; revision: string }> {
  const [store] = await container.resolve(Modules.STORE).listStores();
  if (!store) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'Store를 찾을 수 없습니다.');

  const raw = store.metadata?.[KEY];
  if (!raw) return { settings: null, revision: '' };

  validateTimeSaleSettings(raw);

  return { settings: raw, revision: String(store.metadata?.[REVISION_KEY] ?? '') };
}

// 설정 저장: 검증 → revision 이 같을 때만 쓰기(다른 관리자가 먼저 바꿨으면 409).
export async function saveTimeSaleSettings(container: MedusaContainer, settings: unknown, revision: unknown) {
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

  const result = await container.resolve(Modules.LOCKING).execute(
    'time-sale-settings',
    async () => {
      const service = container.resolve(Modules.STORE);
      const [store] = await service.listStores();
      if (!store) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'Store를 찾을 수 없습니다.');

      if (String(store.metadata?.[REVISION_KEY] ?? '') !== revision)
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          '다른 관리자가 설정을 변경했습니다. 새로고침 후 다시 저장하세요.',
        );

      const next = new Date().toISOString();
      await service.updateStores(store.id, {
        metadata: { ...store.metadata, [KEY]: settings, [REVISION_KEY]: next },
      });

      return { settings, revision: next };
    },
    { timeout: 10 },
  );

  // 진열·스타일만 바뀌므로 상품 캐시는 두고 time-sale 태그만 비운다.
  await revalidateStorefront(container, { productHandles: [], logLabel: '진열 설정 저장' });

  return result;
}
