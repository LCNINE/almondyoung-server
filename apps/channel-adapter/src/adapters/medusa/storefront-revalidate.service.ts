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

  async revalidateProduct(handle: string): Promise<void> {
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
        body: JSON.stringify({ handle }),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        this.logger.warn(`Storefront revalidate failed (${res.status}) for handle=${handle}`);
        return;
      }

      this.logger.log(`Storefront revalidate triggered for handle=${handle}`);
    } catch (err: any) {
      this.logger.warn(`Storefront revalidate error for handle=${handle}: ${err?.message ?? err}`);
    }
  }
}
