import type { SalesChannel } from '@packages/event-contracts/streams';
import type { LegacyAdapterChannelType } from '../adapters/channel-adapter.factory';

/**
 * 채널 능력 레지스트리 (ADR-0031).
 *
 * 채널 차이를 "퍼스트파티/서드파티" 같은 등급이 아니라 **능력 벡터**로 적는다. Medusa 가 다른
 * 것은 소유 구조가 아니라 능력이다 — 자사몰이라도 카페24 였다면 네이버와 같은 벡터였을 것이다.
 *
 * 거처가 DB 가 아니라 코드인 이유는 아래 `Record` 가 **exhaustive** 라는 것이다. 채널을 추가하면
 * 컴파일러가 모든 축의 결정을 요구한다 — 그것이 이 표의 값어치의 절반이고, DB 로 옮기면 그 자리가
 * 런타임 `undefined` 분기로 바뀐다.
 *
 * 능력은 채널 **종류**의 불변 사실이다. "지금 켤 것인가" 는 능력이 아니라 운영 결정이므로
 * `sales_channels.is_active` 가 갖는다. 이 표에 활성화 플래그를 넣지 말 것.
 */

/**
 * 나가는 쓰기를 누가 어떻게 수행하는가.
 *
 * `none` 과 `manual` 을 구분하는 기준은 **운영 큐에 항목이 남느냐**다.
 * - `none`: 그 채널엔 그 개념이 없다 (설계상 비대상, 조용한 no-op).
 * - `manual`: 해야 하는데 자동화가 없다 (사람이 하고, durable 한 운영 큐에 남는다).
 *
 * 둘을 뭉뚱그리면 *미구현*이 *비대상*으로 위장한다.
 */
export type ChannelRoute =
  | { kind: 'projection' }
  | { kind: 'adapter'; adapter: LegacyAdapterChannelType }
  | { kind: 'manual'; reason: string }
  | { kind: 'none' };

export interface FulfillmentCapability {
  route: ChannelRoute;
  multipleTrackingNumbers: boolean;
  partialQuantityDispatch: boolean;
  automatedRecall: boolean;
  automatedCancellation: boolean;
}

/**
 * 주문 라인에서 우리 variant 를 어떻게 알아내는가.
 * - `embedded`: 채널이 우리 식별자를 보관한다 (Medusa variant metadata 등).
 * - `mapped`: 채널 리스팅(`channel_variant_listings`)을 조회해야 안다.
 *
 * 매핑의 **정본**은 능력과 무관하게 항상 Core 다 — `embedded` 는 그 매핑의 채널 로컬 사본을
 * 읽는 fast path 일 뿐이다 (ADR-0031 결정 4).
 */
export type ChannelLineIdentityKind = 'embedded' | 'mapped';

/**
 * 외부 연동이 없는 채널(`3pl` = 전화주문 등 수기 채널)은 나머지 축을 갖지 않는다. 그 채널의
 * 주문은 channel-adapter 를 거치지 않고 Core 의 판매주문 생성 경로로 직접 들어온다.
 *
 * 이 유니온은 **주문 수집 source 가 필요한 채널의 집합**을 타입으로 표현한다.
 */
export type ChannelCapabilities =
  | { integration: 'none'; fulfillment: FulfillmentCapability }
  | {
      integration: 'api';
      fulfillment: FulfillmentCapability;
      /** 채널상품의 *내용*을 누가 만드는가. `theirs` 면 그 내용의 SoT 는 채널이다. */
      productOwnership: 'ours' | 'theirs';
      productProjection: ChannelRoute;
      inventory: ChannelRoute;
      lineIdentity: ChannelLineIdentityKind;
      orderCollection: 'source';
    };

export const CHANNEL_CAPABILITIES: Record<SalesChannel, ChannelCapabilities> = {
  medusa: {
    integration: 'api',
    productOwnership: 'ours',
    productProjection: { kind: 'projection' },
    inventory: { kind: 'projection' },
    lineIdentity: 'embedded',
    orderCollection: 'source',
    fulfillment: {
      route: { kind: 'projection' },
      multipleTrackingNumbers: true,
      partialQuantityDispatch: true,
      automatedRecall: true,
      automatedCancellation: true,
    },
  },
  naver: {
    integration: 'api',
    productOwnership: 'theirs',
    productProjection: { kind: 'none' },
    // 네이버는 `updateOptionStock` 이 구현돼 있으나 배선되지 않았다 — 그래서 `none` 이 아니라
    // `manual` 이고, 배선하면 `adapter` 로 승격된다.
    inventory: { kind: 'manual', reason: '네이버 재고 반영은 아직 배선되지 않아 운영자가 직접 처리한다.' },
    lineIdentity: 'mapped',
    orderCollection: 'source',
    fulfillment: {
      route: { kind: 'adapter', adapter: 'naver_smartstore' },
      multipleTrackingNumbers: true,
      partialQuantityDispatch: false,
      automatedRecall: false,
      automatedCancellation: false,
    },
  },
  coupang: {
    integration: 'api',
    productOwnership: 'theirs',
    productProjection: { kind: 'none' },
    inventory: { kind: 'manual', reason: '쿠팡 재고 반영은 미구현이라 운영자가 WING 에서 직접 처리한다.' },
    lineIdentity: 'mapped',
    orderCollection: 'source',
    fulfillment: {
      route: { kind: 'adapter', adapter: 'coupang' },
      multipleTrackingNumbers: true,
      partialQuantityDispatch: false,
      automatedRecall: false,
      automatedCancellation: false,
    },
  },
  '3pl': {
    integration: 'none',
    fulfillment: {
      route: { kind: 'manual', reason: '3PL shipment events require an operator-managed integration.' },
      multipleTrackingNumbers: false,
      partialQuantityDispatch: false,
      automatedRecall: false,
      automatedCancellation: false,
    },
  },
};

export function getChannelCapabilities(channel: SalesChannel): ChannelCapabilities | undefined {
  return CHANNEL_CAPABILITIES[channel];
}

/**
 * 출고 축만 꺼내는 접근자. 기존 두 소비자(`shipment-dispatch-inbox.worker`, `inbox-worker.service`)의
 * 호출부를 그대로 두기 위해 유지한다 — 둘 다 `capabilities.route` / `capabilities.automatedRecall`
 * 처럼 출고 필드만 읽는다.
 */
export function getChannelFulfillmentCapabilities(channel: SalesChannel): FulfillmentCapability | undefined {
  return CHANNEL_CAPABILITIES[channel]?.fulfillment;
}

/** 기존 import 이름 유지. `SalesChannel` 이 정본 어휘다 (ADR-0031 결정 7). */
export type ShipmentSalesChannel = SalesChannel;
