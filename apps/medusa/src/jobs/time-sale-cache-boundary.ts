import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import type { MedusaContainer } from '@medusajs/framework/types';
import { listProductsInPriceLists, listTimeSalesCrossingBoundary } from '../utils/time-sale';

// 크론 주기(60초)보다 넉넉하게 잡는다. 실행이 밀려 경계를 건너뛰면 종료된 세일가가 캐시에 그대로
// 남는데, 겹쳐 도는 건 revalidateTag 가 멱등이라 무해하다.
const BOUNDARY_WINDOW_SECONDS = 70;

// 세일 **시작**만 이만큼 앞당겨 캐시를 비운다. 시작 순간은 트래픽이 몰리는데 거기서 전역 목록
// 캐시를 버리면 미스가 한꺼번에 Medusa 로 가 CPU 가 포화된다. 미리 비워 워밍을 분산시킨다.
// BOUNDARY_WINDOW_SECONDS 보다 커야 같은 시작이 두 번 잡히지 않는다.
const START_PREWARM_SECONDS = 120;

/**
 * 타임세일 시작·종료 순간에 스토어프론트 캐시를 비운다.
 *
 * Medusa 의 가격 계산은 price_list 의 starts_at/ends_at 을 SQL 에서 즉시 반영하지만, 스토어프론트는
 * 상품 목록·상세를 `revalidate: 3600` 으로 캐싱한다. 이 잡이 없으면 세일이 끝난 뒤 최대 한 시간 동안
 * 세일가가 화면에 남고, 그걸 보고 담은 손님은 결제창에서 정가를 만난다.
 *
 * 시작 지연은 손님에게 유리하지만 종료 지연은 CS 라, 양쪽 경계를 모두 친다.
 */
export default async function timeSaleCacheBoundaryJob(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  const crossed = await listTimeSalesCrossingBoundary(
    container,
    BOUNDARY_WINDOW_SECONDS,
    START_PREWARM_SECONDS
  );
  if (crossed.length === 0) return;

  const url = process.env.STOREFRONT_REVALIDATE_URL;
  const secret = process.env.STOREFRONT_REVALIDATE_SECRET;
  if (!url || !secret) {
    logger.warn(
      '[time-sale] STOREFRONT_REVALIDATE_URL/SECRET 미설정 — 세일 경계를 지났지만 캐시를 비우지 못했다'
    );
    return;
  }

  const products = await listProductsInPriceLists(
    container,
    crossed.map((list) => list.id)
  );
  // 한 상품이 여러 리스트에 걸려 있으면 행도 여럿이라 중복을 걷는다 (무효화는 멱등이지만 태그가 불어난다).
  const handles = [...new Set(products.map((product) => product.handle).filter(Boolean))];

  // 라우트는 `handle` 이 실렸을 때만 전역 목록 태그와 카테고리 경로를 비운다. 그건 한 번이면 족하므로
  // 첫 상품만 handle 로 싣고 나머지는 태그로 정확히 지운다 (channel-adapter 의 배치 무효화와 같은 형태).
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
      logger.error(`[time-sale] 캐시 무효화 실패 status=${response.status}`);
      return;
    }

    // 시작 시각이 아직 미래면 예열이다 — 종료 무효화와 구분돼야 "종료됐는데 세일가가 남았다" 를 볼 때
    // 어느 쪽이 안 돌았는지 로그로 가른다.
    const now = Date.now();
    const label = (list: { title: string; startsAt: string | null }) =>
      list.startsAt && Date.parse(list.startsAt) > now ? `${list.title}(시작예열)` : `${list.title}(종료)`;

    logger.info(
      `[time-sale] 경계 ${crossed.length}건 → 상품 ${handles.length}개 캐시 무효화` +
        ` (${crossed.map(label).join(', ')})`
    );
  } catch (error) {
    logger.error(`[time-sale] 캐시 무효화 호출 실패: ${(error as Error).message}`);
  }
}

export const config = {
  name: 'time-sale-cache-boundary',
  schedule: '* * * * *',
};
