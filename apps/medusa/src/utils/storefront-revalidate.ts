import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

/**
 * 스토어프론트의 `time-sale` 태그와 상품 캐시를 비운다. 실패해도 던지지 않는다 — 캐시는 `revalidate`
 * 안전망(목록 60초·상품 1시간)이 있고, 무효화 실패가 세일 저장을 되감을 이유는 없다.
 *
 * 라우트는 `handle` 이 실렸을 때만 전역 목록 태그와 카테고리 경로를 비운다. 그건 한 번이면 족하므로
 * 첫 상품만 handle 로 싣고 나머지는 태그로 정확히 지운다 (channel-adapter 의 배치 무효화와 같은 형태).
 */
export async function revalidateStorefront(
  container: MedusaContainer,
  params: { productHandles: string[]; logLabel: string },
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const url = process.env.STOREFRONT_REVALIDATE_URL;
  const secret = process.env.STOREFRONT_REVALIDATE_SECRET;
  if (!url || !secret) {
    logger.warn(`[time-sale] STOREFRONT_REVALIDATE_URL/SECRET 미설정 — 캐시를 비우지 못했다 (${params.logLabel})`);
    return;
  }

  const handles = [...new Set(params.productHandles.filter(Boolean))];
  const [first, ...rest] = handles;
  const body = {
    ...(first ? { handle: first } : {}),
    tags: ['time-sale', ...rest.map((handle) => `product-${handle}`)],
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': secret },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      logger.error(`[time-sale] 캐시 무효화 실패 status=${response.status} (${params.logLabel})`);
      return;
    }
    logger.info(`[time-sale] 상품 ${handles.length}개 캐시 무효화 (${params.logLabel})`);
  } catch (error) {
    logger.error(`[time-sale] 캐시 무효화 호출 실패: ${(error as Error).message} (${params.logLabel})`);
  }
}
