import { Injectable, Logger } from '@nestjs/common';
import type { SalesChannel } from '@packages/event-contracts/streams';
import type { ListingResolutionCause } from '@packages/domain-types';
import { ChannelListingClient } from '../clients/channel-listing.client';
import { getChannelCapabilities } from '../channel-capabilities';
import type { ChannelOrderLineSnapshot } from './channel-order-source.interface';

/**
 * 채널 주문 라인 → 우리 판매상품 variant 정체성 해석 (ADR-0031 결정 4).
 *
 * **분기 근거는 채널 이름이 아니라 능력(`lineIdentity`)이다.** 그래서 채널이 늘어도 이 파일은
 * 그대로다 — 새 채널은 능력 표에 한 줄을 더할 뿐이다.
 *
 * 해석 실패는 예외가 아니라 사유를 실은 값이다 (#674). 무엇을 할지(격리할지, 조용히 넘길지)는
 * 호출자인 `ChannelOrderTranslator` 의 정책이다 — 유료 주문 라인이 미식별이면 격리하고, 이미
 * 종결된 라이프사이클 스냅샷이면 격리하지 않는다.
 */
export interface ResolvedLineIdentity {
  variantId: string;
  masterId: string;
  versionId: string;
  /** 매핑이 알려주는 Core 판매상품명. `embedded` 채널은 채널이 가진 이름을 그대로 쓴다. */
  productName?: string;
}

/**
 * **판별 유니온이다.** 전에는 실패가 `null` 이라 "왜" 가 사라졌다 — 이 파일의
 * `OrderLifecycleEventItem` 주석이 말하는 것과 같은 실패 모드다(계약이 잡아 줄 것을
 * 호출부의 추측으로 덮기).
 */
export type LineResolution =
  | { identified: true; identity: ResolvedLineIdentity }
  | { identified: false; cause: ListingResolutionCause };

@Injectable()
export class ChannelLineIdentityResolver {
  private readonly logger = new Logger(ChannelLineIdentityResolver.name);

  constructor(private readonly channelListingClient: ChannelListingClient) {}

  async resolve(channel: SalesChannel, line: ChannelOrderLineSnapshot): Promise<LineResolution> {
    const capabilities = getChannelCapabilities(channel);
    if (!capabilities || capabilities.integration !== 'api') {
      // `unknown` 은 어휘를 확장하지 않고 쓰는 의도적 선택이다. `ListingResolutionCause` 는
      // Core catalog 상태(리스팅/상품/버전/품목)를 설명하는 어휘이지 어댑터 설정 오류를
      // 설명하는 어휘가 아니다 — 능력 표 누락은 그 범주 밖의 운영 설정 문제다. 원인은
      // 바로 위 warn 로그가 이미 시끄럽게 알리므로, 여기서 새 cause 를 만들 필요가 없다.
      this.logger.warn(`No order-collection capability registered for channel ${channel}`);
      return { identified: false, cause: 'unknown' };
    }

    if (capabilities.lineIdentity === 'embedded') {
      return this.fromEmbedded(line);
    }
    return this.fromChannelListing(channel, line);
  }

  /**
   * 채널이 심어둔 우리 식별자를 읽는다. **셋 다 있어야 한다** — 하나라도 비면 그 라인은
   * Core Catalog 를 통하지 않고 채널에서 직접 만들어진 상품이다 (CONTEXT §채널 상품 식별 실패).
   */
  private fromEmbedded(line: ChannelOrderLineSnapshot): LineResolution {
    const variantId = nonEmpty(line.embeddedVariantId);
    const masterId = nonEmpty(line.embeddedMasterId);
    const versionId = nonEmpty(line.embeddedVersionId);
    if (!variantId || !masterId || !versionId) {
      return { identified: false, cause: 'no_embedded_ids' };
    }
    return { identified: true, identity: { variantId, masterId, versionId } };
  }

  /**
   * 채널 리스팅(`channel_variant_listings`)을 조회한다. 조회 키는 `SalesChannel` 값이고, Core 는
   * 그것을 `sales_channels.site` 와 비교한다 — 두 어휘를 맞추는 일은 #639 다.
   */
  private async fromChannelListing(
    channel: SalesChannel,
    line: ChannelOrderLineSnapshot,
  ): Promise<LineResolution> {
    const lookupId = nonEmpty(line.channelProductId) ?? nonEmpty(line.channelOrderItemId);
    if (!lookupId) {
      return { identified: false, cause: 'no_lookup_key' };
    }

    const resolution = await this.channelListingClient.resolveByChannelCode(channel, lookupId);
    if (!resolution.found) {
      return { identified: false, cause: resolution.cause };
    }

    return {
      identified: true,
      identity: {
        variantId: resolution.listing.variantId,
        masterId: resolution.listing.masterId,
        versionId: resolution.listing.versionId,
        productName: nonEmpty(resolution.listing.productName),
      },
    };
  }
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
