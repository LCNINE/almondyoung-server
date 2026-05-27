# Medusa Direct Service Call Exceptions

Medusa is a sales channel. Normal cart, checkout, inventory validation, and order creation must not call Core commerce/WMS/availability APIs. Checkout inventory decisions use Medusa local inventory data, where each PIM-synced variant's inventory quantity is the Core Product Sellable Quantity projection synced through channel-adapter.

## Current Checkout Inventory Path

- Cart creation and add-to-cart validation use `src/utils/validate-inventory.ts`.
- Cart completion validation uses `src/workflows/hooks/cart/complete-cart.ts`.
- Both paths use the projection-aware validation helper in `src/utils/validate-inventory.ts`, which prefers the Product Sellable Quantity inventory item if stale legacy inventory links are still present.
- Medusa does not require `WMS_API_URL` or a Core commerce URL for checkout inventory decisions.

## Explicit Exceptions

These direct calls are allowed because they target bounded contexts needed to operate the sales channel, not Core commerce/WMS availability decisions.

| Context | Code | Reason |
| --- | --- | --- |
| Auth / customer identity | `src/modules/user-service-sso/service.ts` | OIDC token exchange and userinfo lookup against user-service. |
| Payment | `src/modules/almond-payment/service.ts` | Wallet payment provider authorization, capture, cancel, refund, and status operations. |
| Membership purchase policy | `src/workflows/hooks/cart/handle-validate-cart-items-inventory.ts`, `src/subscribers/*membership*`, `src/api/store/orders/[id]/confirm-purchase/route.ts` | Membership eligibility and benefit recording. This is not a stock or WMS decision. |
| Reviews / UGC | `src/workflows/orders/steps/create-review-eligibility-step.ts` | Review eligibility creation after order placement. |

No direct Core commerce/WMS/availability call should be added to Medusa order creation. If a future checkout rule appears to need Core data, add it to the Core projection emitted through channel-adapter instead.
