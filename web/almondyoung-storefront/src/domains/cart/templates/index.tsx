import { Card, CardContent } from "@/components/ui/card"
import { CartHeader } from "@/domains/cart/components/header"
import { HttpTypes } from "@medusajs/types"
import Items from "../components/items"
import MobileCheckoutBar from "../components/mobile-checkout-bar"
import Summary from "./summary"

type Props = {
  cart: HttpTypes.StoreCart | null
}

export default function CartTemplate({ cart }: Props) {
  return (
    <>
      <main className="bg-background container mx-auto max-w-[1360px] px-4 py-8">
        <CartHeader />

        <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-[1fr_360px]">
          <Card>
            <CardContent className="pt-6">
              <Items cart={cart as HttpTypes.StoreCart} />
            </CardContent>
          </Card>

          {/* 데스크탑: 오른쪽 사이드바 */}
          <div className="hidden lg:sticky lg:top-5 lg:block lg:self-start">
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
