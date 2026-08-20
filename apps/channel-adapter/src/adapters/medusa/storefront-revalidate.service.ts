import { Injectable, Logger } from '@nestjs/common';

/**
 * 상품/재고가 Medusa 에 반영된 직후 스토어프론트의 on-demand 캐시 무효화를 트리거한다.
 *
 * 스토어프론트는 상품 목록/상세를 `revalidate: 3600` 로 캐싱하므로, 이 호출이 없으면
 * 어드민의 수동품절/재고 변경이 최대 1시간 늦게 노출된다. channel-adapter 가 동기화의
 * 마지막 단계에서 이 서비스를 호출해 스토어프론트 `/api/revalidate` 를 POST 한다.
 */
@Injectable()
export class StorefrontRevalidateService {
  private readonly logger = new Logger(StorefrontRevalidateService.name);
  private readonly url = process.env.STOREFRONT_REVALIDATE_URL;
  private readonly secret = process.env.STOREFRONT_REVALIDATE_SECRET;

  constructor() {
    if (!this.url || !this.secret) {
      this.logger.warn(
        'STOREFRONT_REVALIDATE_URL/SECRET 미설정 — 스토어프론트 캐시 무효화 비활성',
      );
    }
  }

  /**
   * 상품 변경(가격·재고·상세설명) 후 호출한다.
   *
   * `handle` 만 넘기면 스토어프론트는 `product-{handle}` 태그와 상세 경로만 무효화하는데,
   * 상세설명(descriptionHtml)은 Core `/masters/{id}` 응답이라 `pim-detail-{masterId}` 로
   * 따로 캐시된다 (storefront `src/lib/api/pim/products.ts`). 그 태그를 같이 비우지 않으면
   * 상세설명 변경이 최대 1시간 늦게 노출된다. Medusa handle === Core masterId 라 같은 값이다.
   */
  async revalidateProduct(handle: string): Promise<void> {
    await this.post({ handle, tags: [`pim-detail-${handle}`] }, `handle=${handle}`);
  }

  /**
   * 여러 상품을 한 번에 무효화한다. 대량등록처럼 상품이 연달아 바뀔 때 쓴다.
   *
   * 첫 handle 만 `handle` 로 싣는다. 라우트는 `handle` 이 있을 때만 전역 목록 태그
   * (PRODUCT_LIST_TAG)와 국가별 경로를 도는데, 그건 배치당 1회면 족하고 상품마다
   * 반복하면 캐시가 데워질 틈이 없어진다 — 그게 지금 고치려는 문제다.
   * 반대로 아예 안 실으면 목록 캐시가 영영 안 지워져 새 상품이 목록에 안 뜬다.
   *
   * 나머지 상품은 `product-{handle}` 태그로 정확히 지운다.
   */
  async revalidateProducts(handles: string[]): Promise<void> {
    if (handles.length === 0) return;

    const [first, ...rest] = handles;
    const tags = [
      // product-{first} 는 라우트가 handle 로부터 직접 친다. pim-detail 은 안 친다.
      `pim-detail-${first}`,
      ...rest.flatMap((h) => [`product-${h}`, `pim-detail-${h}`]),
    ];
    await this.post({ handle: first, tags }, `batch=${handles.length}`);
  }

  /**
   * 카테고리 변경(이미지·이름·정렬) 후 호출한다.
   *
   * 카테고리 트리(`/store/product-categories`)는 스토어프론트가 `product-categories` 태그로
   * 1시간 캐싱한다. 무캐시로 읽던 시절엔 페이지뷰마다 Medusa 를 쳐서 CPU 를 태웠다.
   * metadata.thumbnail 이 비었을 때 쓰는 PIM search 폴백은 `category-thumbnail-{medusaId}`
   * 태그로 따로 캐싱되므로 둘 다 비워야 이름·정렬·이미지 변경이 즉시 반영된다.
   */
  async revalidateCategory(medusaCategoryId?: string): Promise<void> {
    const tags = [
      'product-categories',
      ...(medusaCategoryId ? [`category-thumbnail-${medusaCategoryId}`] : []),
    ];
    await this.post({ tags }, `category=${medusaCategoryId ?? 'all'}`);
  }

  private async post(
    body: { handle?: string; tags?: string[]; paths?: string[] },
    label: string,
  ): Promise<void> {
    if (!this.url || !this.secret) {
      return;
    }

    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-revalidate-secret': this.secret,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        this.logger.warn(`Storefront revalidate failed (${res.status}) for ${label}`);
        return;
      }

      this.logger.log(`Storefront revalidate triggered for ${label}`);
    } catch (err: any) {
      this.logger.warn(`Storefront revalidate error for ${label}: ${err?.message ?? err}`);
    }
  }
}
