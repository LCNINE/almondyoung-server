import { Injectable, Logger } from '@nestjs/common';
import { UpstreamUnavailableError } from '@app/shared';
import { protos } from '@google-analytics/data';
import { Ga4Client } from '../ga4/ga4.client';
import { ItemBehaviorResponseDto, ItemBehaviorTotalsDto, SingleItemBehaviorDto } from '../api/item-behavior.dto';

type RunReportResponse = protos.google.analytics.data.v1beta.IRunReportResponse;

/** GA4 는 외부 API 라 지연·쿼터가 있다 — 같은 조회는 잠시 재사용한다(행동 탭 캐시와 같은 규격). */
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

function toNum(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** itemId 로 필터한 item 리포트 → 그 상품 한 행. 행이 없으면 null(기간 내 노출 없음). */
export function mapSingleItem(response: RunReportResponse, itemId: string): SingleItemBehaviorDto | null {
  const row = (response.rows ?? [])[0];
  if (!row) return null;
  const viewed = toNum(row.metricValues?.[0]?.value);
  const addedToCart = toNum(row.metricValues?.[1]?.value);
  const purchased = toNum(row.metricValues?.[2]?.value);
  return {
    itemId: row.dimensionValues?.[0]?.value ?? itemId,
    name: row.dimensionValues?.[1]?.value ?? null,
    viewed,
    addedToCart,
    purchased,
    revenue: toNum(row.metricValues?.[3]?.value),
    cartRate: rate(addedToCart, viewed),
    purchaseRate: rate(purchased, addedToCart),
  };
}

/** 차원 없는 item 리포트 → 전 상품 합계. 상품 행과 **같은 지표(아이템 수)** 라서 분모가 맞는다. */
export function mapItemTotals(response: RunReportResponse): ItemBehaviorTotalsDto {
  const row = (response.rows ?? [])[0];
  const viewed = toNum(row?.metricValues?.[0]?.value);
  const addedToCart = toNum(row?.metricValues?.[1]?.value);
  const purchased = toNum(row?.metricValues?.[2]?.value);
  return {
    viewed,
    addedToCart,
    purchased,
    cartRate: rate(addedToCart, viewed),
    purchaseRate: rate(purchased, addedToCart),
  };
}

/**
 * 상품 하나의 GA4 행동(조회→담기→구매).
 *
 * 행동 탭이 이미 받는 item 리포트에 `itemId` 차원을 더하는 대신 **리포트를 따로 부른다**:
 *  - 차원을 더하면 같은 이름의 다른 id 로 행이 쪼개져 행동 탭의 기존 표가 바뀐다(회귀).
 *  - 상위 N 행만 받는 리포트에서 특정 상품을 찾는 방식은 N 밖 상품에서 조용히 빈다.
 * 필터 리포트 1개 + 전 상품 합계 리포트 1개로 **정확한 값과 정확한 분모**를 같이 얻는다.
 *
 * 조인 키는 GA4 `item_id` = **Medusa product id** 다(스토어프론트가 `product.id` 를 보낸다).
 * masterId ↔ Medusa product id 변환은 channel-adapter 매핑이 하고, 이 read-model 은 이미 변환된
 * itemId 만 받는다 — analytics 가 다른 BC 의 매핑 표를 읽지 않게 하려는 절단이다.
 */
@Injectable()
export class ItemBehaviorQuery {
  private readonly logger = new Logger(ItemBehaviorQuery.name);
  private readonly cache = new Map<string, { at: number; value: ItemBehaviorResponseDto }>();

  constructor(private readonly ga4: Ga4Client) {}

  async getItemBehavior(from: string, to: string, itemId: string): Promise<ItemBehaviorResponseDto> {
    const base = { range: { from, to }, itemId };
    if (!this.ga4.enabled) {
      return { ...base, enabled: false, item: null, totals: null };
    }

    const cacheKey = `${from}|${to}|${itemId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    const dateRanges = [{ startDate: from, endDate: to }];
    const metrics = [
      { name: 'itemsViewed' },
      { name: 'itemsAddedToCart' },
      { name: 'itemsPurchased' },
      { name: 'itemRevenue' },
    ];

    let item: RunReportResponse;
    let totals: RunReportResponse;
    try {
      [item, totals] = await Promise.all([
        this.ga4.runReport({
          dateRanges,
          dimensions: [{ name: 'itemId' }, { name: 'itemName' }],
          dimensionFilter: { filter: { fieldName: 'itemId', stringFilter: { value: itemId } } },
          metrics,
          limit: 1,
        }),
        this.ga4.runReport({
          dateRanges,
          metrics: metrics.slice(0, 3),
        }),
      ]);
    } catch (error) {
      this.logger.warn(`GA4 상품 행동 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
      throw new UpstreamUnavailableError('GA4 조회에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }

    const value: ItemBehaviorResponseDto = {
      ...base,
      enabled: true,
      item: mapSingleItem(item, itemId),
      totals: mapItemTotals(totals),
    };

    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(cacheKey, { at: Date.now(), value });
    return value;
  }
}
