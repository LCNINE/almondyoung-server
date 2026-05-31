# Order Collection Failures

Payment Accepted channel orders must not disappear from the order polling flow. If a Medusa order line cannot be
identified as a Core catalog variant, the channel adapter records the order in `order_collection_failures` instead of
publishing a normal `OrderCreated` event. The same quarantine table is also used when a Medusa order changes after the
channel adapter has already collected it.

## Failure Reason

`channel_product_identification_failed`

This means at least one Medusa order line is missing `variant.metadata.pimVariantId`. It is not SKU matching failure.
SKU matching happens later, after Core has a sales order.

`collected_order_modification_not_accepted`

This means the channel adapter has already collected the Medusa order and later observed a changed order payload. Core
treats the collected Payment Accepted order as the sales-order processing contract, so Medusa-side order changes are not
published as `OrderModified`. Handle CS item additions/removals through a separate Core order amendment or extra shipment
workflow.

Cancellation and refund observations are not treated as contract modifications. After an order has been collected, the
adapter records those observations through the Core lifecycle event path (`OrderCancelled` / `OrderRefundCreated`) and
keeps product, quantity, shipping-address, and order-total changes quarantined under
`collected_order_modification_not_accepted`.

Medusa can expose `refunded` / `partially_refunded` status before concrete refund rows are visible in the fetched order
payload. The adapter must still keep that snapshot in the order candidate path, marked ineligible for `OrderCreated`, so
already mapped orders can be hash-compared and quarantined if the contract snapshot changed. It must not synthesize an
`OrderRefundCreated` event until a concrete refund transaction or payment refund row is present.

## Operator API

List quarantined failures:

```http
GET /adapter/order-collection-failures?channel=medusa&status=quarantined
```

Inspect one failure:

```http
GET /adapter/order-collection-failures/:id
```

The record contains:

- `externalOrderId`: raw Medusa order id.
- `affectedLineIds`: Medusa line item ids missing `pimVariantId`.
- `reason`: `channel_product_identification_failed` or `collected_order_modification_not_accepted`.
- `rawOrder`: Medusa order payload retained for investigation.

## Replay Path

1. Inspect the failure and identify the affected Medusa variant from `rawOrder.items`.
2. Fix product identity in Medusa by setting `variant.metadata.pimVariantId` to the Core catalog variant id.
3. Replay the failure:

```http
POST /adapter/order-collection-failures/:id/replay
```

Replay fetches the current Medusa order by `externalOrderId` and runs it through the normal order collection path.
If any line still lacks `pimVariantId`, the failure remains `quarantined` and no `OrderCreated` is emitted. If the
order is now identifiable, the adapter enqueues the normal `OrderCreated` event and marks the failure `replayed`.

`collected_order_modification_not_accepted` is not replayable. It is an operator signal that Medusa changed an already
collected order; do not try to make Core accept the change through polling.

Do not move the polling watermark backward for this case. The quarantine row is the durable handle for recovery.
