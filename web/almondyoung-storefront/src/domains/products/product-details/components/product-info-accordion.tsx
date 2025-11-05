"use client"

import { ChevronDown, ChevronUp } from "lucide-react"
import { useState } from "react"

/**
 * @description 구매/반품/교환 정보 아코디언
 * 시맨틱: <details>와 <summary> 사용 고려했으나 애니메이션을 위해 state 사용
 */
export function ProductInfoAccordion() {
  const [accordionStates, setAccordionStates] = useState({
    payment: false,
    shipping: false,
    return: false,
  })

  const toggleAccordion = (key: keyof typeof accordionStates) => {
    setAccordionStates({
      ...accordionStates,
      [key]: !accordionStates[key],
    })
  }

  return (
    <section className="mb-8 rounded-lg bg-white py-6">
      <ul className="space-y-4">
        {/* 결제안내 */}
        <li className="rounded-lg border">
          <button
            onClick={() => toggleAccordion("payment")}
            className="flex w-full items-center justify-between p-4"
            aria-expanded={accordionStates.payment}
            aria-controls="payment-content"
          >
            <span className="font-medium">결제안내</span>
            {accordionStates.payment ? <ChevronUp /> : <ChevronDown />}
          </button>
          {accordionStates.payment && (
            <div id="payment-content" className="px-4 pb-4">
              <p className="text-sm text-gray-600">
                고액 결제의 경우 안전을 위해 카드사에서 확인 전화를 드릴 수도
                있습니다. 확인 과정에서 도난 카드의 사용이나 타인 명의의 주문 등
                정상적인 주문이 아니라고 판단될 경우 임의로 주문을 보류 또는
                취소할 수 있습니다.
              </p>
            </div>
          )}
        </li>

        {/* 배송 안내 */}
        <li className="rounded-lg border">
          <button
            onClick={() => toggleAccordion("shipping")}
            className="flex w-full items-center justify-between p-4"
            aria-expanded={accordionStates.shipping}
            aria-controls="shipping-content"
          >
            <span className="font-medium">배송 안내</span>
            {accordionStates.shipping ? <ChevronUp /> : <ChevronDown />}
          </button>
          {accordionStates.shipping && (
            <div id="shipping-content" className="px-4 pb-4">
              <p className="text-sm text-gray-600">
                배송 방법 : 택배
                <br />
                배송 지역 : 전국지역
                <br />
                배송 비용 : 2,500원
                <br />
                배송 기간 : 2일 ~ 3일
                <br />
                배송 안내 : 택배사는 CJ 대한통운입니다.
              </p>
            </div>
          )}
        </li>

        {/* 교환/반품 안내 */}
        <li className="rounded-lg border">
          <button
            onClick={() => toggleAccordion("return")}
            className="flex w-full items-center justify-between p-4"
            aria-expanded={accordionStates.return}
            aria-controls="return-content"
          >
            <span className="font-medium">교환/반품 안내</span>
            {accordionStates.return ? <ChevronUp /> : <ChevronDown />}
          </button>
          {accordionStates.return && (
            <div id="return-content" className="px-4 pb-4">
              <p className="text-sm text-gray-600">
                교환 및 반품 주소
                <br />
                - 경기도 부천시 평천로 832번길 42 4층 엘씨나인
                <br />
                <br />
                교환 및 반품이 가능한 경우
                <br />- 상품을 공급 받으신 날로부터 7일 이내
              </p>
            </div>
          )}
        </li>
      </ul>
    </section>
  )
}
