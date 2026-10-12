import type { MedusaContainer, StoreDTO } from '@medusajs/framework/types';
import { MedusaError, Modules } from '@medusajs/framework/utils';

/**
 * Store.metadata 를 고치는 유일한 길. 저장은 metadata 전체를 덮어쓰므로, 쓰는 쪽끼리 같은 잠금 안에서 최신 값을
 * 다시 읽고 자기 키만 바꿔야 한다 — 따로 잠그면 타임세일 설정과 배송 영역 템플릿이 서로의 변경을 옛 값으로 지운다.
 *
 * `change` 는 잠금 안에서 최신 store 를 받아 바꿀 키(`set`)와 돌려줄 값(`value`)을 준다.
 */
export async function updateStoreMetadata<T>(
  container: MedusaContainer,
  change: (store: StoreDTO) => { set: Record<string, unknown>; value: T } | Promise<{ set: Record<string, unknown>; value: T }>,
): Promise<T> {
  return container.resolve(Modules.LOCKING).execute(
    'store-metadata',
    async () => {
      const service = container.resolve(Modules.STORE);
      const [store] = await service.listStores();
      if (!store) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'Store를 찾을 수 없습니다.');

      const { set, value } = await change(store);
      await service.updateStores(store.id, { metadata: { ...(store.metadata ?? {}), ...set } });

      return value;
    },
    { timeout: 10 },
  );
}
