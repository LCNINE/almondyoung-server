/**
 * Order lifecycle event types that the channel-adapter collects into `inbox_events` and
 * publishes to `orders.events.v1` for the WMS to consume.
 *
 * This single list is the contract shared by the two services that split the `inbox_events`
 * table:
 *
 * - `OutboxDispatcherService` publishes these event types to `orders.events.v1`.
 * - `InboxWorkerService` EXCLUDES these event types from its own polling, so it never marks
 *   them published before the dispatcher reaches Kafka.
 *
 * Keep both behaviours driven by this one constant. If the two lists ever drift, an order
 * event type that is in neither would be swallowed by `InboxWorkerService` (its `default`
 * branch marks unknown events published) and never reach Kafka — which is exactly the failure
 * mode this constant exists to prevent.
 */
export const ORDER_STREAM_EVENT_TYPES = [
  'OrderCreated',
  'OrderModified',
  'OrderCancelled',
  'OrderRefundCreated',
] as const;

export type OrderStreamEventType = (typeof ORDER_STREAM_EVENT_TYPES)[number];
