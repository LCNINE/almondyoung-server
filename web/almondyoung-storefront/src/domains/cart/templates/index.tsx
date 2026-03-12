import { CartHeader } from "@/domains/cart/components/header"
import { Card, CardContent } from "@/components/ui/card"
import { HttpTypes } from "@medusajs/types"
import ItemsTemplate from "./items"
import Summary from "./summary"
import MobileCheckoutBar from "./mobile-checkout-bar"

type Props = {
  cart: HttpTypes.StoreCart | null
}

export default function CartTemplate({ cart }: Props) {
  return (
    <>
      <main className="bg-background container mx-auto max-w-[1360px] px-4 py-8">
        <CartHeader />

        <div className="grid grid-cols-1 gap-x-10 md:grid-cols-[1fr_360px]">
          <Card>
            <CardContent className="pt-6">
              {/* todo: 이거는 추후에 다시 고려해보겠습니다. 반응이 좀 느려요 */}
              {/* <ShippingNotice
              shippingTotal={cart?.shipping_total || 0}
              selectedTotal={cart?.subtotal || 0}
              variant="desktop"
            /> */}

              <ItemsTemplate cart={cart as HttpTypes.StoreCart} />
            </CardContent>
          </Card>

          {/* 데스크탑: 오른쪽 사이드바 */}
          <div className="hidden md:sticky md:top-5 md:block md:self-start">
            <Card>
              <CardContent>
                {cart && cart.region && (
                  <div className="py-6">
                    <Summary
                      cart={
                        cart as HttpTypes.StoreCart & {
                          promotions: HttpTypes.StorePromotion[]
                        }
                      }
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* 모바일: 하단 고정 바 */}
      {cart && cart.region && (
        <MobileCheckoutBar
          cart={
            cart as HttpTypes.StoreCart & {
              promotions: HttpTypes.StorePromotion[]
            }
          }
        />
      )}
    </>
  )
}
