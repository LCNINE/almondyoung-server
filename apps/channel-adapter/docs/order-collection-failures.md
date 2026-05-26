# Order Collection Failures

Payment Accepted channel orders must not disappear from the order polling flow. If a Medusa order line cannot be
identified as a Core catalog variant, the channel adapter records the order in `order_collection_failures` instead of
publishing a normal `OrderCreated` event.

## Failure Reason

`channel_product_identification_failed`

This means at least one Medusa order line is missing `variant.metadata.pimVariantId`. It is not SKU matching failure.
SKU matching happens later, after Core has a sales order.

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
- `reason`: `channel_product_identification_failed`.
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

Do not move the polling watermark backward for this case. The quarantine row is the durable handle for recovery.
