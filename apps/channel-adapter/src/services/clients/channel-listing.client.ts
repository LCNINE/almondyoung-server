import { OutboundTenant } from '@app/tenancy';
import { Inject, Injectable, Logger } from '@nestjs/common';
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

/** Core `/internal/channel-listings/resolve` 의 응답 (#674). Core 쪽 동명 타입과 짝이다. */
export type ListingResolveResult =
  | { found: true; listing: LookupVariantResult }
  | { found: false; cause: ListingResolutionCause };

/**
 * Core 채널 리스팅 해석 클라이언트 — 채널 상품 ID → 판매상품 variant.
 *
 * core 의 내부 키 입구라 `CORE_INTERNAL_KEY` 와 테넌트 헤더를 싣는다.
 */
@Injectable()
export class ChannelListingClient {
  private readonly logger = new Logger(ChannelListingClient.name);
  private readonly pimBaseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @Inject(OutboundTenant) private readonly outboundTenant: Pick<OutboundTenant, 'headers'>,
  ) {
    this.pimBaseUrl = this.configService.get<string>('PIM_API_URL') || 'http://localhost:3001';
  }

  /**
   * 채널 코드 + 채널 상품 ID 로 Variant 를 **사유와 함께** 해석한다 (#674).
   *
   * 실패를 삼키지 않는다. 무인증이던 때는 401·404 를 «옛 Core» 로 보고 사유 없는 `/lookup` 으로 폴백했지만, 내부 키 입구에서
   * 401 은 키가 틀렸다는 뜻이다 — 폴백하면 모든 라인이 조용히 미식별로 격리된다. 던지면 그 주문이 처리 실패로 격리돼 재시도된다.
   */
  async resolveByChannelCode(channelCode: string, channelItemId: string): Promise<ListingResolveResult> {
    const internalKey = this.configService.get<string>('CORE_INTERNAL_KEY');
    if (!internalKey) {
      throw new Error('CORE_INTERNAL_KEY 가 설정되지 않아 채널 리스팅을 해석할 수 없다.');
    }
    try {
      const response = await firstValueFrom(
        this.httpService.get<{ found: boolean; listing?: LookupVariantResult; cause?: unknown }>(
          `${this.pimBaseUrl}/internal/channel-listings/resolve`,
          {
            params: { channelCode, channelItemId },
            headers: { Authorization: `Bearer ${internalKey}`, ...this.outboundTenant.headers() },
            timeout: 5000,
          },
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
    } catch (error: unknown) {
      this.logger.error(
        `❌ 채널 매핑 해석 실패: ${channelCode}/${channelItemId}`,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
}
