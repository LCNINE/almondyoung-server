import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import type { OrderCreatedPayload, OrderItem, SalesChannel } from '@packages/event-contracts/streams';
import { ChannelLineIdentityResolver, ResolvedLineIdentity } from './channel-line-identity.resolver';
import type { ChannelOrderSnapshot, LifecycleObservation } from './channel-order-source.interface';
import {
  CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
  OrderCollectionFailureItem,
  OrderFetchItem,
  OrderFetchOutcome,
  OrderLifecycleEventItem,
} from './channel-order-provider.interface';

/**
 * 채널 원어 스냅샷 → Core 주문 처리 계약 (ADR-0031, 후보 2).
 *
 * 전에는 이 일이 채널별 provider 안에 있었다. 그래서 새 채널을 붙이는 비용이 "API 매핑" 이 아니라
 * "Core 계약 재구현" 이었다. 여기로 올라온 것은 채널과 무관한 것들뿐이다 — orderId 발급, 식별
 * 해석 정책, 격리 판단, payload 조립.
 *
 * **해시는 여기서 나온 값으로 계산한다.** `OrderFetchItem.changes` 는 저장된
 * `polling_change_hashes` 의 입력이므로 모양이 바뀌면 배포 직후 한 주기의 주문이 전부
 * `collected_order_modification_not_accepted` 로 격리되고, 그 사유는 replay 가 거부한다. 그래서
 * `changes` 는 채널 원어가 아니라 **번역 결과**(Core 계약 값)를 담는다 — 이 리팩터 전과 같은 값이다.
 */
@Injectable()
export class ChannelOrderTranslator {
  constructor(private readonly identityResolver: ChannelLineIdentityResolver) {}

  async translate(
    channel: SalesChannel,
    snapshot: ChannelOrderSnapshot,
  ): Promise<{ outcome: OrderFetchOutcome; lifecycle: OrderLifecycleEventItem[] }> {
    const eligibleForOrderCreation = snapshot.paymentState === 'accepted';
    const lifecycle = this.buildLifecycleItems(snapshot);

    const identities = await Promise.all(
      snapshot.lines.map((line) => this.identityResolver.resolve(channel, line)),
    );

    // 유료 주문 라인이 미식별이면 조용히 넘기지 않고 격리한다 (CONTEXT §채널 상품 식별 실패).
    // 이미 종결된 스냅샷(취소/환불 관측)은 판매주문을 만들지 않으므로 식별을 요구하지 않는다.
    const unidentifiedLineIds = snapshot.lines
      .filter((_, index) => identities[index] === null)
      .map((line) => line.channelOrderItemId);

    if (eligibleForOrderCreation && unidentifiedLineIds.length > 0) {
      return {
        outcome: {
          kind: 'failure',
          failure: {
            externalOrderId: snapshot.externalOrderId,
            sourceUpdatedAt: snapshot.sourceUpdatedAt,
            reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
            affectedLineIds: unidentifiedLineIds,
            rawOrder: snapshot.raw,
          } satisfies OrderCollectionFailureItem,
        },
        lifecycle,
      };
    }

    const items = snapshot.lines.map((line, index) => this.buildOrderItem(line, identities[index]));

    const createPayload: OrderCreatedPayload = {
      orderId: uuidv4(),
      externalOrderId: snapshot.externalOrderId,
      ...(snapshot.displayOrderNo != null ? { displayOrderNo: snapshot.displayOrderNo } : {}),
      salesChannel: channel,
      customerId: snapshot.customerId,
      ...(snapshot.email ? { email: snapshot.email } : {}),
      ...(snapshot.walletIntentId ? { walletIntentId: snapshot.walletIntentId } : {}),
      items,
      totalAmount: snapshot.amounts.total,
      subtotalAmount: snapshot.amounts.subtotal,
      shippingAmount: snapshot.amounts.shipping,
      discountAmount: snapshot.amounts.discount,
      ...(snapshot.amounts.points && snapshot.amounts.points > 0 ? { pointsAmount: snapshot.amounts.points } : {}),
      currency: snapshot.amounts.currency,
      shippingAddress: snapshot.shippingAddress,
      status: 'confirmed',
      createdAt: snapshot.createdAt,
    };

    const order: OrderFetchItem = {
      externalOrderId: snapshot.externalOrderId,
      sourceUpdatedAt: snapshot.sourceUpdatedAt,
      eligibleForOrderCreation,
      createPayload,
      changes: {
        items,
        shippingAddress: snapshot.shippingAddress,
        totalAmount: snapshot.amounts.total,
      },
      modifiedAt: snapshot.sourceUpdatedAt,
    };

    return { outcome: { kind: 'order', order }, lifecycle };
  }

  /**
   * 미식별 라인도 계약 모양은 유지한다 — 이 라인들은 격리되지 않은 스냅샷(종결 관측)에서만
   * 나타나고, `changes` 해시의 입력으로만 쓰인다.
   */
  private buildOrderItem(
    line: ChannelOrderSnapshot['lines'][number],
    identity: ResolvedLineIdentity | null,
  ): OrderItem {
    const variantId = identity?.variantId ?? '';
    return {
      orderItemId: line.channelOrderItemId,
      skuId: variantId,
      masterId: identity?.masterId ?? '',
      versionId: identity?.versionId ?? '',
      variantId,
      // 매핑이 Core 판매상품명을 알려주면 그것을 쓴다. 창고·CS 화면이 채널마다 다른 이름을 보면
      // 운영이 갈리기 때문이다 (ADR-0031 결정 3).
      productName: identity?.productName ?? line.productName,
      ...(line.channelProductId ? { channelProductId: line.channelProductId } : {}),
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      totalPrice: line.unitPrice * line.quantity,
      ...(line.fulfillmentKind ? { fulfillmentKind: line.fulfillmentKind } : {}),
      ...(line.requiresShipping !== undefined ? { requiresShipping: line.requiresShipping } : {}),
    };
  }

  private buildLifecycleItems(snapshot: ChannelOrderSnapshot): OrderLifecycleEventItem[] {
    return snapshot.lifecycle.map((observation) => this.toLifecycleItem(snapshot, observation));
  }

  /**
   * 판별 유니온을 **분기해서** 옮긴다. 한 줄로 스프레드하면 `eventType` 과 `payload` 의 상관관계가
   * 풀려 캐스팅이 필요해지는데, 계약이 잡아 줄 것을 캐스팅으로 덮는 것이 ADR-0029 가 없애려던
   * 실패 모드 그 자체다.
   */
  private toLifecycleItem(
    snapshot: ChannelOrderSnapshot,
    observation: LifecycleObservation,
  ): OrderLifecycleEventItem {
    const base = {
      externalOrderId: snapshot.externalOrderId,
      sourceUpdatedAt: snapshot.sourceUpdatedAt,
      eventKey: observation.eventKey,
      rawEvent: observation.rawEvent,
    };

    if (observation.eventType === 'OrderCancelled') {
      return { ...base, eventType: 'OrderCancelled', payload: observation.payload };
    }
    return { ...base, eventType: 'OrderRefundCreated', payload: observation.payload };
  }
}
