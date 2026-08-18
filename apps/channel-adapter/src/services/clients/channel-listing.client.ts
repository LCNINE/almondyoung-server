import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { type ListingResolutionCause, toListingResolutionCause } from '@packages/domain-types';

export interface LookupVariantResult {
  masterId: string;
  versionId: string;
  productName: string;
  variantId: string;
  variantCode: string | null;
  variantName: string | null;
  isActive: boolean;
}

/** Core `/channel-listings/resolve` 의 응답 (#674). Core 쪽 동명 타입과 짝이다. */
export type ListingResolveResult =
  | { found: true; listing: LookupVariantResult }
  | { found: false; cause: ListingResolutionCause };

export interface CreateChannelListingRequest {
  variantId: string;
  salesChannelId: string;
  channelItemId: string;
  channelItemName?: string;
  channelOptionName?: string;
  channelPrice?: number;
  channelProductUrl?: string;
}

/**
 * PIM Channel Listing API 클라이언트
 *
 * 책임:
 * - PIM 서버의 채널 상품 매핑 API 호출
 * - 채널 상품 ID → PIM Variant ID 조회
 */
@Injectable()
export class ChannelListingClient {
  private readonly logger = new Logger(ChannelListingClient.name);
  private readonly pimBaseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.pimBaseUrl = this.configService.get<string>('PIM_API_URL') || 'http://localhost:3001';
  }

  /**
   * 채널 코드 + 채널 상품 ID로 Variant 조회
   */
  async lookupByChannelCode(channelCode: string, channelItemId: string): Promise<LookupVariantResult | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<LookupVariantResult | null>(`${this.pimBaseUrl}/channel-listings/lookup`, {
          params: {
            channelCode,
            channelItemId,
          },
          timeout: 5000,
        }),
      );

      if (response.status === 204 || !response.data) {
        return null;
      }

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404 || error.response?.status === 204) {
        return null;
      }

      this.logger.error(`❌ 채널 매핑 조회 실패: ${channelCode}/${channelItemId}`, error.message);
      throw error;
    }
  }

  /**
   * 채널 코드 + 채널 상품 ID 로 Variant 를 **사유와 함께** 해석한다 (#674).
   *
   * Core 가 아직 `/resolve` 를 모르면(배포 순서가 뒤집혔거나 롤백됐으면) 404 가 온다. 그때
   * 옛 `/lookup` 으로 폴백한다 — 사유를 얻으려다 수집을 통째로 멈추는 건 명백한 퇴행이다.
   * 폴백 경로에서는 사유를 알 길이 없으므로 지어내지 않고 `unknown` 이다.
   *
   * 폴백 제거는 Core 배포가 안정된 뒤 후속 PR.
   */
  async resolveByChannelCode(channelCode: string, channelItemId: string): Promise<ListingResolveResult> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<{ found: boolean; listing?: LookupVariantResult; cause?: unknown }>(
          `${this.pimBaseUrl}/channel-listings/resolve`,
          { params: { channelCode, channelItemId }, timeout: 5000 },
        ),
      );

      const body = response.data;
      if (body?.found) {
        if (!body.listing) {
          throw new Error(
            `Core /resolve 응답이 found=true 인데 listing 이 없다 (${channelCode}/${channelItemId}). ` +
              `Core 버그인지 배포 타이밍 오류인지 확인해라.`,
          );
        }
        return { found: true, listing: body.listing };
      }
      return { found: false, cause: toListingResolutionCause(body?.cause) };
    } catch (error: any) {
      if (error.response?.status !== 404) {
        this.logger.error(`❌ 채널 매핑 해석 실패: ${channelCode}/${channelItemId}`, error.message);
        throw error;
      }

      this.logger.warn(`/resolve 가 없어 /lookup 으로 폴백한다 (Core 가 구버전): ${channelCode}/${channelItemId}`);
      const listing = await this.lookupByChannelCode(channelCode, channelItemId);
      return listing ? { found: true, listing } : { found: false, cause: 'unknown' };
    }
  }

  /**
   * 판매 채널 ID + 채널 상품 ID로 Variant 조회
   */
  async lookupBySalesChannelId(salesChannelId: string, channelItemId: string): Promise<LookupVariantResult | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<LookupVariantResult | null>(`${this.pimBaseUrl}/channel-listings/lookup`, {
          params: {
            salesChannelId,
            channelItemId,
          },
          timeout: 5000,
        }),
      );

      if (response.status === 204 || !response.data) {
        return null;
      }

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404 || error.response?.status === 204) {
        return null;
      }

      this.logger.error(`❌ 채널 매핑 조회 실패: ${salesChannelId}/${channelItemId}`, error.message);
      throw error;
    }
  }

  /**
   * 여러 채널 상품 ID 일괄 조회
   */
  async lookupBatch(channelCode: string, channelItemIds: string[]): Promise<Map<string, LookupVariantResult | null>> {
    const results = new Map<string, LookupVariantResult | null>();

    // 병렬 조회 (최대 10개씩)
    const chunks = this.chunk(channelItemIds, 10);

    for (const chunk of chunks) {
      const promises = chunk.map(async (channelItemId) => {
        const result = await this.lookupByChannelCode(channelCode, channelItemId);
        return { channelItemId, result };
      });

      const chunkResults = await Promise.all(promises);
      for (const { channelItemId, result } of chunkResults) {
        results.set(channelItemId, result);
      }
    }

    return results;
  }

  /**
   * 새 채널 매핑 생성
   */
  async createListing(request: CreateChannelListingRequest): Promise<void> {
    try {
      await firstValueFrom(
        this.httpService.post(`${this.pimBaseUrl}/channel-listings`, request, {
          timeout: 10000,
        }),
      );

      this.logger.debug(`✅ 채널 매핑 생성: ${request.channelItemId} → ${request.variantId}`);
    } catch (error: any) {
      this.logger.error(`❌ 채널 매핑 생성 실패: ${request.channelItemId}`, error.message);
      throw error;
    }
  }

  /**
   * 채널 코드를 채널 타입으로 변환
   */
  getChannelCodeFromType(channel: 'naver_smartstore' | 'coupang' | 'medusa'): string {
    switch (channel) {
      case 'naver_smartstore':
        return 'naver';
      case 'coupang':
        return 'coupang';
      case 'medusa':
        return 'medusa';
      default:
        return channel;
    }
  }

  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
