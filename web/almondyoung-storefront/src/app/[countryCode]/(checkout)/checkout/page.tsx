import { EmptyCartView } from "@/components/cart/empty-cart-view"
import {
  ensureCorrectShippingMethod,
  findUnavailableLineItems,
  retrieveCart,
} from "@/lib/api/medusa/cart"
import { isUnavailableVariantError } from "@/lib/utils/cart-availability"
import UnavailableItemsNotice from "domains/checkout/components/unavailable-items-notice"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getMyPromotions } from "@/lib/api/medusa/promotion"
import { CartResponseDto } from "@/lib/types/dto/medusa"
import type { ShippingInfo } from "@/lib/types/ui/cart"
import { getMembershipGroupIdFromEnv } from "@/lib/utils/membership-group"
import ProtectedRoute from "@components/protected-route"
import CheckoutTemplate from "domains/checkout/templates/checkout-template"
import { getTranslations } from "next-intl/server"
import { notFound } from "next/navigation"

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
  let cart = (await retrieveCart(
    cartId,
    "*items, +items.requires_shipping, +items.product_type, *items.product, *items.product.tags, *items.variant, +items.variant.inventory_quantity, +items.variant.manage_inventory, +items.variant.allow_backorder, *region, *customer, *shipping_methods, *promotions, +item_subtotal, +shipping_total, +total, +discount_total, +items.discount_total, +shipping_methods.discount_total, +payment_collection.id, +currency_code",
    "no-store"
  )) as CartResponseDto["cart"]

  if (!cart) {
    return notFound()
  }

  if (!cart.items?.length) {
    return (
      <ProtectedRoute>
        <EmptyCartView />
      </ProtectedRoute>
    )
  }

  // 보조 가드: 1차 차단은 장바구니에서 하지만, 만일의 경우를 대비해서 작성했음
  // draft/미게시(판매중단) 상품을 직접 감지해서,
  // 결제를 진행하면 어차피 터질 카트를 미리 안내 화면으로 막는다.
  const { productNames: unavailableNames } = await findUnavailableLineItems(
    cart,
    countryCode
  )
  if (unavailableNames.length > 0) {
    return (
      <ProtectedRoute>
        <UnavailableItemsNotice unavailableNames={unavailableNames} />
      </ProtectedRoute>
    )
  }

  // 장바구니 아이템 타입에 따라 올바른 배송 옵션 자동 설정.
  let shippingResult: Awaited<ReturnType<typeof ensureCorrectShippingMethod>>
  try {
    shippingResult = await ensureCorrectShippingMethod(cart)
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
          <div className="rounded-md border border-red-200 bg-red-50 p-5 text-red-900">
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

  // 배송료 정보
  const shippingMethod = shippingMethods?.[0]
  const tProcess = await getTranslations("checkout.process")
  const shipping: ShippingInfo = {
    amount: shippingMethod?.amount ?? 0,
    name: shippingMethod?.name ?? tProcess("shippingFallback"),
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
