import { EmptyCartView } from "@/components/cart/empty-cart-view"
import CartTemplate from "@/domains/cart/templates"
import { getActiveTimeSale } from "@/lib/api/medusa/time-sale"
import {
  ensureCorrectShippingMethod,
  findUnavailableLineItems,
  refreshCartPricesDuringRender,
  retrieveCart,
} from "@/lib/api/medusa/cart"
import { recoverCustomerCart } from "@/lib/api/medusa/customer"
import { isUnavailableVariantError } from "@/lib/utils/cart-availability"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

export default async function Cart({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params

  // 멤버십 가입/해지로 달라진 가격을 카트에 반영한다. 카트를 읽기 전에, 배송수단 정합보다 먼저,
  // 이 요청 안에서 순차로 돌린다. 예전에는 이걸 클라이언트에서 걸고 router.refresh 로 다시
  // 그렸는데, 그 재계산이 다음 렌더의 배송수단 교체와 겹쳐 같은 카트를 동시에 고쳤다.
  await refreshCartPricesDuringRender()

  // 무통장입금 주문 선생성 시 원본 장바구니 아이템은 Medusa 서버사이드에서 제거됨.
  // 그 정리는 storefront 의 carts 캐시 태그를 무효화하지 못하므로, 이미 force-dynamic 인 카트
  // 페이지에서는 no-store 로 항상 최신 카트를 읽어 '구매한 상품이 장바구니에 남아있는' 오표시를 막음.
  let cart = await retrieveCart(undefined, undefined, "no-store").catch(
    (error) => {
      console.error(error)
      return notFound()
    }
  )

  // 쿠키가 가리키는 카트가 못 쓰게 됐거나(완료/404/삭제) 아예 없어서 위에서 빈 화면이 될 상황이어도,
  // 로그인 상태면 서버에서 고객의 '미완료' 카트를 customer_id 기준으로 찾아 표시한다.
  // 이게 없으면 쿠키만 어긋나도 '빈 장바구니'로 고착된다(카트는 서버에 멀쩡히 존재).
  if (!cart || cart.items?.length === 0) {
    const recovered = await recoverCustomerCart().catch(() => null)
    if (recovered?.id) {
      cart = await retrieveCart(recovered.id, undefined, "no-store").catch(
        () => cart
      )
    }
  }

  if (!cart || cart.items?.length === 0) {
    return <EmptyCartView showHeader={false} bgColor="bg-muted" />
  }

  // draft/미게시(판매중단)된 상품과 옵션만 사라진 라인을 직접 감지한다.
  // (배송수단 throw 에 의존하지 않음)
  const {
    variantIds: unavailableVariantIds,
    optionGoneVariantIds,
    soldOutVariantIds,
    availableByVariantId,
  } = await findUnavailableLineItems(cart, countryCode)

  // 배송 옵션 자동 설정. draft 상품이 있으면 throw 할 수 있으나, 그대로 두면
  // 장바구니까지 500 으로 깨져 상품을 삭제할 화면조차 못 본다. 잡아서 원본 카트를
  // 그대로 렌더한다 (판매중단 뱃지는 위에서 이미 감지).
  try {
    const result = await ensureCorrectShippingMethod(cart)
    cart = result.cart
  } catch (error) {
    if (!isUnavailableVariantError(error)) {
      throw error
    }
  }

  const timeSale = await getActiveTimeSale()

  return (
    <CartTemplate
      cart={cart}
      timeSaleProductIds={timeSale?.productIds ?? []}
      unavailableVariantIds={unavailableVariantIds}
      optionGoneVariantIds={optionGoneVariantIds}
      soldOutVariantIds={soldOutVariantIds}
      availableByVariantId={availableByVariantId}
    />
  )
}
