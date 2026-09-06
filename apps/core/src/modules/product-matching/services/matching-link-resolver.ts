import { BadRequestException, Injectable } from '@nestjs/common';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { SkuCatalogService } from '../../inventory/sku-catalog/services/sku-catalog.service';
import { SkuCreationSource } from '../../inventory/sku-catalog/dto/create-sku.dto';
import { MatchingLinkInputDto } from '../dto/matching-link-input.dto';
import { SkuQuantityMapping } from '../strategies/matching-strategy.interface';

/**
 * 매칭 링크 입력을 SKU 매핑으로 바꾼다. `newSku` 가 오면 호출자의 트랜잭션 위에서
 * 실제 SKU 를 만든다 — 그래서 생성·링크·상태전이가 한 트랜잭션에 들어가고
 * 중간 실패 시 고아 SKU 가 남지 않는다.
 */
@Injectable()
export class MatchingLinkResolver {
  constructor(private readonly skuCatalogService: SkuCatalogService) {}

  async resolve(links: MatchingLinkInputDto[], trx: DbTx): Promise<SkuQuantityMapping[]> {
    const mappings: SkuQuantityMapping[] = [];

    // 순차 생성이어야 한다. SkuCatalogManager.generateSkuCode 가 max(code) 를 읽어
    // 다음 코드를 만들므로 병렬로 만들면 같은 코드가 나와 unique 제약에 걸린다.
    for (const link of links) {
      const quantity = this.normalizeQuantity(link.quantity);

      if (link.skuId) {
        mappings.push({ skuId: link.skuId, quantity });
        continue;
      }

      if (!link.newSku) {
        throw new BadRequestException('link 항목은 skuId 또는 newSku 중 정확히 하나를 가져야 합니다.');
      }

      const created = await this.skuCatalogService.create(
        { ...link.newSku, source: SkuCreationSource.AUTO_MATCHING },
        trx,
      );
      mappings.push({ skuId: created.id, quantity });
    }

    return mappings;
  }

  private normalizeQuantity(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value)) return 1;
    const truncated = Math.trunc(value);
    return truncated < 1 ? 1 : truncated;
  }
}
