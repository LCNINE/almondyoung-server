import type { MedusaContainer } from '@medusajs/framework/types';
import { MedusaError, Modules } from '@medusajs/framework/utils';

import {
  DEFAULT_AREA_TEMPLATE_CODE,
  STORE_AREA_TEMPLATES_KEY,
  type ShippingAreaTemplate,
} from './types';

/**
 * 지역별 배송비 템플릿 (제주·도서산간 추가 금액).
 *
 * 여러 배송비 그룹이 같은 금액을 공유하도록 그룹에서 분리했다. 저장소는 store.metadata —
 * 행이 몇 개 안 되고, 이걸 위해 커스텀 모듈 + 마이그레이션을 하나 더 만들 규모가 아니다.
 */

export const DEFAULT_AREA_TEMPLATE: ShippingAreaTemplate = {
  code: DEFAULT_AREA_TEMPLATE_CODE,
  name: '기본 템플릿',
  jejuExtraFee: 5_000,
  islandExtraFee: 0,
};

async function loadStore(container: MedusaContainer) {
  const storeModuleService = container.resolve(Modules.STORE);
  const [store] = await storeModuleService.listStores();
  if (!store) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, 'Store 를 찾을 수 없습니다. seed 를 먼저 실행하세요.');
  }
  return store;
}

export async function listAreaTemplates(container: MedusaContainer): Promise<ShippingAreaTemplate[]> {
  const store = await loadStore(container);
  const raw = (store.metadata as Record<string, unknown> | null)?.[STORE_AREA_TEMPLATES_KEY];
  if (!Array.isArray(raw) || raw.length === 0) return [DEFAULT_AREA_TEMPLATE];

  return raw
    .filter((entry): entry is ShippingAreaTemplate => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      code: String(entry.code),
      name: String(entry.name),
      jejuExtraFee: Number(entry.jejuExtraFee) || 0,
      islandExtraFee: Number(entry.islandExtraFee) || 0,
    }));
}

export async function findAreaTemplate(
  container: MedusaContainer,
  code?: string | null,
): Promise<ShippingAreaTemplate | null> {
  if (!code) return null;
  const templates = await listAreaTemplates(container);
  return templates.find((template) => template.code === code) ?? null;
}

async function saveAreaTemplates(container: MedusaContainer, templates: ShippingAreaTemplate[]): Promise<void> {
  const storeModuleService = container.resolve(Modules.STORE);
  const store = await loadStore(container);
  await storeModuleService.updateStores(store.id, {
    metadata: { ...(store.metadata ?? {}), [STORE_AREA_TEMPLATES_KEY]: templates },
  });
}

export async function upsertAreaTemplate(
  container: MedusaContainer,
  template: ShippingAreaTemplate,
): Promise<ShippingAreaTemplate[]> {
  const templates = await listAreaTemplates(container);
  const index = templates.findIndex((candidate) => candidate.code === template.code);
  if (index >= 0) templates[index] = template;
  else templates.push(template);

  await saveAreaTemplates(container, templates);
  return templates;
}

export async function deleteAreaTemplate(container: MedusaContainer, code: string): Promise<void> {
  if (code === DEFAULT_AREA_TEMPLATE_CODE) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, '기본 템플릿은 삭제할 수 없습니다.');
  }
  const templates = await listAreaTemplates(container);
  await saveAreaTemplates(
    container,
    templates.filter((template) => template.code !== code),
  );
}
