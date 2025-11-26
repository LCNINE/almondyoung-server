import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface LookupVariantResult {
  variantId: string;
  variantCode: string | null;
  variantName: string | null;
  isActive: boolean;
}

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
  async lookupByChannelCode(
    channelCode: string,
    channelItemId: string,
  ): Promise<LookupVariantResult | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<LookupVariantResult | null>(
          `${this.pimBaseUrl}/channel-listings/lookup`,
          {
            params: {
              channelCode,
              channelItemId,
            },
            timeout: 5000,
          },
        ),
      );

      if (response.status === 204 || !response.data) {
        return null;
      }

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404 || error.response?.status === 204) {
        return null;
      }

      this.logger.error(
        `❌ 채널 매핑 조회 실패: ${channelCode}/${channelItemId}`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * 판매 채널 ID + 채널 상품 ID로 Variant 조회
   */
  async lookupBySalesChannelId(
    salesChannelId: string,
    channelItemId: string,
  ): Promise<LookupVariantResult | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<LookupVariantResult | null>(
          `${this.pimBaseUrl}/channel-listings/lookup`,
          {
            params: {
              salesChannelId,
              channelItemId,
            },
            timeout: 5000,
          },
        ),
      );

      if (response.status === 204 || !response.data) {
        return null;
      }

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404 || error.response?.status === 204) {
        return null;
      }

      this.logger.error(
        `❌ 채널 매핑 조회 실패: ${salesChannelId}/${channelItemId}`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * 여러 채널 상품 ID 일괄 조회
   */
  async lookupBatch(
    channelCode: string,
    channelItemIds: string[],
  ): Promise<Map<string, LookupVariantResult | null>> {
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

      this.logger.debug(
        `✅ 채널 매핑 생성: ${request.channelItemId} → ${request.variantId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `❌ 채널 매핑 생성 실패: ${request.channelItemId}`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * 채널 코드를 채널 타입으로 변환
   */
  getChannelCodeFromType(
    channel: 'naver_smartstore' | 'coupang' | 'medusa',
  ): string {
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

