import type { LegacyAdapterChannelType } from '../adapters/channel-adapter.factory';

export type ShipmentSalesChannel = 'naver' | 'coupang' | 'medusa' | '3pl';
export type ChannelFulfillmentRoute =
  | { kind: 'adapter'; adapter: LegacyAdapterChannelType }
  | { kind: 'projection' }
  | { kind: 'manual'; reason: string };

export interface ChannelFulfillmentCapabilities {
  route: ChannelFulfillmentRoute;
  multipleTrackingNumbers: boolean;
  partialQuantityDispatch: boolean;
  automatedRecall: boolean;
  automatedCancellation: boolean;
}

/**
 * Deliberately exhaustive. Adding a sales channel to the event contract must be
 * accompanied by an explicit outbound capability decision here.
 */
export const CHANNEL_FULFILLMENT_CAPABILITIES: Record<ShipmentSalesChannel, ChannelFulfillmentCapabilities> = {
  naver: {
    route: { kind: 'adapter', adapter: 'naver_smartstore' },
    multipleTrackingNumbers: true,
    partialQuantityDispatch: false,
    automatedRecall: false,
    automatedCancellation: false,
  },
  coupang: {
    route: { kind: 'adapter', adapter: 'coupang' },
    multipleTrackingNumbers: true,
    partialQuantityDispatch: false,
    automatedRecall: false,
    automatedCancellation: false,
  },
  medusa: {
    route: { kind: 'projection' },
    multipleTrackingNumbers: true,
    partialQuantityDispatch: true,
    automatedRecall: true,
    automatedCancellation: true,
  },
  '3pl': {
    route: { kind: 'manual', reason: '3PL shipment events require an operator-managed integration.' },
    multipleTrackingNumbers: false,
    partialQuantityDispatch: false,
    automatedRecall: false,
    automatedCancellation: false,
  },
};

export function getChannelFulfillmentCapabilities(channel: ShipmentSalesChannel): ChannelFulfillmentCapabilities {
  return CHANNEL_FULFILLMENT_CAPABILITIES[channel];
}
