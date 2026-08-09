/**
 * Order lifecycle event types that the channel-adapter collects into `inbox_events` and
 * publishes to `orders.events.v1` for the WMS to consume.
 *
 * This list used to be the contract between the two services that split the `inbox_events`
 * table. The publishing half is gone (ADR-0029 Task 6-C-4): these event types now reach
 * `orders.events.v1` through the shared `StreamPublisher.enqueue` /
 * `event.outbox_events` path, not through a channel-adapter-local dispatcher.
 *
 * - `InboxWorkerService` EXCLUDES these event types from its own polling. That exclusion is
 *   what this constant still drives — the worker must not touch rows it does not own.
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
