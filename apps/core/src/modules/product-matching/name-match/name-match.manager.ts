import { Injectable } from '@nestjs/common';
import { NameMatchReader } from './name-match.reader';
import { ProductMatchingService } from '../services/product-matching.service';

// 관리자 프록시 30초 안에 끝나는 크기. 화면이 남은 건을 이어서 다시 부른다.
export const NAME_MATCH_LIMIT = 30;

@Injectable()
export class NameMatchManager {
  constructor(
    private readonly reader: NameMatchReader,
    private readonly matchingService: ProductMatchingService,
  ) {}

  async apply() {
    const candidates = await this.reader.candidates();
    const result: { resolved: number; skipped: number; failed: { matchingId: string; reason: string }[] } = {
      resolved: 0,
      skipped: Math.max(0, candidates.length - NAME_MATCH_LIMIT),
      failed: [],
    };

    for (const candidate of candidates.slice(0, NAME_MATCH_LIMIT)) {
      try {
        const links = [{ skuId: candidate.skuId, quantity: 1 }];

        await this.matchingService.resolveMatchingPending(candidate.matchingId, {
          ignore: false,
          strategy: 'variant',
          stockPolicy: { preStockSellable: true, alwaysSellableZeroStock: false },
          links,
          skuMappings: links,
          isGift: false,
        });
        result.resolved += 1;
      } catch (error) {
        result.failed.push({
          matchingId: candidate.matchingId,
          reason: error instanceof Error ? error.message : '연결하지 못했어요.',
        });
      }
    }

    return result;
  }
}
