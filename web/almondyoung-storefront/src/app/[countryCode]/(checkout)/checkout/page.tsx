import { EmptyCartView } from "@/components/cart/empty-cart-view"
import {
  ensureCorrectShippingMethod,
  findUnavailableLineItems,
  refreshCartPricesDuringRender,
  retrieveCart,
} from "@/lib/api/medusa/cart"
import { isUnavailableVariantError } from "@/lib/utils/cart-availability"
import UnavailableItemsNotice from "domains/checkout/components/unavailable-items-notice"
import {
  recoverCustomerCart,
  retrieveCustomer,
} from "@/lib/api/medusa/customer"
import { getMyPromotions } from "@/lib/api/medusa/promotion"
import { CartResponseDto } from "@/lib/types/dto/medusa"
import type { ShippingInfo } from "@/lib/types/ui/cart"
import { getMembershipGroupIdFromEnv } from "@/lib/utils/membership-group"
import ProtectedRoute from "@components/protected-route"
import CheckoutTemplate from "domains/checkout/templates/checkout-template"
import { getTranslations } from "next-intl/server"

const CHECKOUT_CART_FIELDS =
  "*items, +items.requires_shipping, +items.product_type, *items.product, *items.product.metadata, +items.product.shipping_profile.id, *items.product.tags, *items.variant, +items.variant.inventory_quantity, +items.variant.manage_inventory, +items.variant.allow_backorder, *region, *customer, *shipping_methods, *promotions, +item_subtotal, +shipping_total, +total, +discount_total, +items.discount_total, +shipping_methods.discount_total, +payment_collection.id, +currency_code"

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ cartId?: string }>
}) {
  const { countryCode } = await params
  const { cartId } = await searchParams

  return (
    <ProtectedRoute>
      <CheckoutManager cartId={cartId} countryCode={countryCode} />
    </ProtectedRoute>
  )
}

async function CheckoutManager({
  cartId,
  countryCode,
}: {
  cartId?: string
  countryCode: string
}) {
  // 카트 페이지와 같은 재계산을 여기서도 건다. 카트를 거치지 않고 바로 들어오는 경로가 있어서,
  // 이게 없으면 세일이 끝난 뒤에도 라인에 박힌 옛 세일가로 결제 금액이 잡힌다.
  await refreshCartPricesDuringRender()

  let cart = (await retrieveCart(
    cartId,
    CHECKOUT_CART_FIELDS,
    "no-store"
  )) as CartResponseDto["cart"]

  // 쿠키의 카트 id 가 없거나(다른 브라우저/앱 웹뷰) 가리키는 카트가 완료·삭제됐어도, 로그인
  // 상태면 고객의 미완료 카트를 customer_id 로 찾는다. 카트 페이지가 이미 하는 복구를
  // 여기서도 해야 '장바구니는 보이는데 결제 누르면 404' 가 안 난다.
  if (!cart) {
    const recovered = await recoverCustomerCart().catch(() => null)
    if (recovered?.id) {
      cart = (await retrieveCart(
        recovered.id,
        CHECKOUT_CART_FIELDS,
        "no-store"
      ).catch(() => null)) as CartResponseDto["cart"]
    }
  }

  // 비로그인 게스트는 쿠키가 유일한 단서라 복구할 수 없다. 그래도 '카트가 없는' 것이지
  // '페이지가 없는' 게 아니므로 404 대신 빈 장바구니를 보여준다.
  if (!cart || !cart.items?.length) {
    return (
      <ProtectedRoute>
        <EmptyCartView />
      </ProtectedRoute>
    )
  }

  // 보조 가드: 1차 차단은 장바구니에서 하지만, 만일의 경우를 대비해서 작성했음
  // draft/미게시(판매중단) 상품을 직접 감지해서,
  // 결제를 진행하면 어차피 터질 카트를 미리 안내 화면으로 막는다.
  // 담은 뒤 재고가 줄어 "담은 수량 > 가용재고"가 된 라인도 같이 막는다. 그대로 결제로 보내면
  // 결제 후 cart.complete 의 재고예약이 실패해 주문이 생성되지 않는다.
  const { productNames: unavailableNames, insufficientNames } =
    await findUnavailableLineItems(cart, countryCode)
  const blockedNames = Array.from(
    new Set(unavailableNames.concat(insufficientNames))
  )
  if (blockedNames.length > 0) {
    return (
      <ProtectedRoute>
        <UnavailableItemsNotice unavailableNames={blockedNames} />
      </ProtectedRoute>
    )
  }

  // 장바구니 아이템 타입에 따라 올바른 배송 옵션 자동 설정.
  // refreshAmounts: 여기서 확정된 금액으로 결제가 진행되므로 배송비를 다시 계산해 붙인다.
  // 어드민이 배송비 그룹 금액을 고쳐도 옛 금액으로 결제되지 않는다.
  let shippingResult: Awaited<ReturnType<typeof ensureCorrectShippingMethod>>
  try {
    shippingResult = await ensureCorrectShippingMethod(cart, { refreshAmounts: true })
  } catch (error) {
    if (isUnavailableVariantError(error)) {
      return (
        <ProtectedRoute>
          <UnavailableItemsNotice unavailableNames={[]} />
        </ProtectedRoute>
      )
    }
    throw error
  }

  const {
    cart: updatedCart,
    shippingMethods,
    requiresShipping,
  } = shippingResult
  cart = updatedCart as CartResponseDto["cart"]

  if (requiresShipping && !shippingMethods?.length) {
    return (
      <ProtectedRoute>
        <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col justify-center px-4 py-16">
          <div className="bg-destructive/5 rounded-md border border-red-200 p-5 text-red-900">
            <h1 className="text-base font-semibold">
              배송 옵션을 찾을 수 없습니다.
            </h1>
            <p className="mt-2 text-sm leading-6">
              배송이 필요한 상품에 적용 가능한 배송 수단이 없습니다. 고객센터로
              문의해주세요.
            </p>
          </div>
        </main>
      </ProtectedRoute>
    )
  }

  const promotionsResponse = await getMyPromotions({ limit: 100 }).catch(
    () => ({
      promotions: [],
      count: 0,
      offset: 0,
      limit: 100,
    })
  )

  // 배송료 정보.
  // 금액은 카트의 shipping_total 을 쓴다 — 배송옵션 조회(/store/shipping-options)는 계산형 옵션의
  // amount 를 주지 않고(null), 배송비 그룹이 2개 이상이면 첫 옵션 금액만으로는 합계가 되지 않는다.
  const shippingMethod = shippingMethods?.[0]
  const tProcess = await getTranslations("checkout.process")
  const shippingNames = (cart.shipping_methods ?? [])
    .map((method) => method.name)
    .filter(Boolean)
  const shipping: ShippingInfo = {
    amount: cart.shipping_total ?? 0,
    name: shippingNames.length ? shippingNames.join(" · ") : (shippingMethod?.name ?? tProcess("shippingFallback")),
    description: shippingMethod?.type?.description ?? "",
  }
  const customer = await retrieveCustomer()

  return (
    <CheckoutTemplate
      isMembership={
        !!customer?.groups?.some(
          (group) => group.id === getMembershipGroupIdFromEnv()
        )
      }
      cart={cart}
      checkoutCartId={cart.id}
      shipping={shipping}
      promotions={promotionsResponse.promotions}
    />
  )
}
