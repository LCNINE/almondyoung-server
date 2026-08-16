import { Injectable, Logger } from '@nestjs/common';
import type { SalesChannel } from '@packages/event-contracts/streams';
import { ChannelListingClient } from '../clients/channel-listing.client';
import { getChannelCapabilities } from '../channel-capabilities';
import type { ChannelOrderLineSnapshot } from './channel-order-source.interface';

/**
 * 채널 주문 라인 → 우리 판매상품 variant 정체성 해석 (ADR-0031 결정 4).
 *
 * **분기 근거는 채널 이름이 아니라 능력(`lineIdentity`)이다.** 그래서 채널이 늘어도 이 파일은
 * 그대로다 — 새 채널은 능력 표에 한 줄을 더할 뿐이다.
 *
 * 해석 실패는 예외가 아니라 `null` 이다. 무엇을 할지(격리할지, 조용히 넘길지)는 호출자인
 * `ChannelOrderTranslator` 의 정책이다 — 유료 주문 라인이 미식별이면 격리하고, 이미 종결된
 * 라이프사이클 스냅샷이면 격리하지 않는다.
 */
export interface ResolvedLineIdentity {
  variantId: string;
  masterId: string;
  versionId: string;
  /** 매핑이 알려주는 Core 판매상품명. `embedded` 채널은 채널이 가진 이름을 그대로 쓴다. */
  productName?: string;
}

@Injectable()
export class ChannelLineIdentityResolver {
  private readonly logger = new Logger(ChannelLineIdentityResolver.name);

  constructor(private readonly channelListingClient: ChannelListingClient) {}

  async resolve(channel: SalesChannel, line: ChannelOrderLineSnapshot): Promise<ResolvedLineIdentity | null> {
    const capabilities = getChannelCapabilities(channel);
    if (!capabilities || capabilities.integration !== 'api') {
      this.logger.warn(`No order-collection capability registered for channel ${channel}`);
      return null;
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
  private fromEmbedded(line: ChannelOrderLineSnapshot): ResolvedLineIdentity | null {
    const variantId = nonEmpty(line.embeddedVariantId);
    const masterId = nonEmpty(line.embeddedMasterId);
    const versionId = nonEmpty(line.embeddedVersionId);
    if (!variantId || !masterId || !versionId) {
      return null;
    }
    return { variantId, masterId, versionId };
  }

  /**
   * 채널 리스팅(`channel_variant_listings`)을 조회한다. 조회 키는 `SalesChannel` 값이고, Core 는
   * 그것을 `sales_channels.site` 와 비교한다 — 두 어휘를 맞추는 일은 #639 다.
   */
  private async fromChannelListing(
    channel: SalesChannel,
    line: ChannelOrderLineSnapshot,
  ): Promise<ResolvedLineIdentity | null> {
    const lookupId = nonEmpty(line.channelProductId) ?? nonEmpty(line.channelOrderItemId);
    if (!lookupId) {
      return null;
    }

    const listing = await this.channelListingClient.lookupByChannelCode(channel, lookupId);
    if (!listing) {
      return null;
    }

    return {
      variantId: listing.variantId,
      masterId: listing.masterId,
      versionId: listing.versionId,
      productName: nonEmpty(listing.productName),
    };
  }
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
