# Shipping eligibility is a PIM fulfillment property

## Decision

Shipping eligibility is determined by `productMasterVersions.fulfillmentKind`.

- `physical` products require shipping, receive the default Medusa shipping profile, and receive Medusa-local sellable projection inventory items with `requires_shipping=true`.
- `digital` products do not require shipping, do not receive a Medusa shipping profile, and do not receive sellable projection inventory links.
- Missing `fulfillmentKind` is interpreted as `physical`.
- SKU matching, `void` matching strategy, and digital asset matching do not determine whether the product requires shipping.
- Storefront checkout uses Medusa line item `requires_shipping` as its canonical runtime signal.

## Context

Live Medusa had products whose line items required shipping but whose products had no shipping profile link. Medusa could not find any shipping option for those carts, and order completion failed with no selected shipping method.

The tempting repair is to attach every product to the default shipping profile. That fixes live physical products but would charge shipping for future digital products. The durable fix is to model shipping eligibility independently from matching and project it explicitly into Medusa.

## Consequences

- Existing products default to `physical`, so live repair can backfill the default shipping profile under the explicit assumption that live has no digital products.
- Future digital products must be marked `fulfillmentKind='digital'` before publication.
- A product that mixes physical and digital fulfillment should be split into separate sale offerings. Medusa shipping profile assignment is product-level, and mixed variant-level shipping creates ambiguous checkout behavior.
- Checkout must not create fake digital shipping methods. A no-shipping cart should have no automatically added shipping method and zero shipping charge.
