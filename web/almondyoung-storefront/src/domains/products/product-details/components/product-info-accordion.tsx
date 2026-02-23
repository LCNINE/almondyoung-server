"use client"

import { ChevronDown } from "lucide-react"
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
    <section className="bg-background mb-8 rounded-lg p-6">
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
            <ChevronDown
              className={`size-5 shrink-0 transition-transform duration-200 ${accordionStates.payment ? "rotate-180" : ""}`}
            />
          </button>
          <div
            id="payment-content"
            className={`grid transition-[grid-template-rows] duration-200 ${accordionStates.payment ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
          >
            <div className="overflow-hidden">
              <p className="px-4 pb-4 text-sm text-gray-600">
                고액 결제의 경우 안전을 위해 카드사에서 확인 전화를 드릴 수도
                있습니다. <br />
                <br />
                확인 과정에서 도난 카드의 사용이나 타인 명의의 주문 등 정상적인
                주문이 아니라고 판단될 경우 임의로 주문을 보류 또는 취소할 수
                있습니다.
                <br />
                <br />
                무통장 입금은 상품 구매 대금은 PC 뱅킹, 인터넷 뱅킹, 텔레 뱅킹
                혹은 가까운 은행에서 직접 입금하시면 됩니다. <br />
                <br />
                주문 시 입력한 입금자명과 실제 입금자의 성명이 반드시 일치하여야
                하며, 7일 이내로 입금을 하셔야 하며 입금되지 않은 주문은 자동
                취소 됩니다.
              </p>
            </div>
          </div>
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
            <ChevronDown
              className={`size-5 shrink-0 transition-transform duration-200 ${accordionStates.shipping ? "rotate-180" : ""}`}
            />
          </button>
          <div
            id="shipping-content"
            className={`grid transition-[grid-template-rows] duration-200 ${accordionStates.shipping ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
          >
            <div className="overflow-hidden">
              <div className="px-4 pb-4 text-sm text-gray-600">
                <ul className="list-disc space-y-1 pl-4">
                  <li>배송 방법 : 택배</li>
                  <li>배송 지역 : 전국지역</li>
                  <li>배송 비용 : 2,500원</li>
                  <li>배송 기간 : 2일 ~ 3일</li>
                  <li>배송 안내 : 택배사는CJ 대한통운입니다.</li>
                </ul>
                <p className="mt-4">
                  평균적으로 1~2일정도 소요되며, 택배사의 사정에 따라 변동될 수
                  있는 점, 양해부탁드립니다.
                </p>
                <p className="mt-4">
                  제주 / 도서 산간 지역은 조금 더 소요될 수 있습니다.
                </p>
                <p className="mt-4">
                  제주 지역 / 도서 산간 지역은 별도의 추가 금액을 지불하셔야
                  하는 경우가 있습니다.
                </p>
                <p className="mt-4">
                  고객님께서 주문하신 상품은 입금 확인 후 배송해 드립니다.
                </p>
                <p className="mt-4">
                  다만, 상품종류에 따라서 상품의 배송이 다소 지연될 수 있습니다.
                </p>
              </div>
            </div>
          </div>
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
            <ChevronDown
              className={`size-5 shrink-0 transition-transform duration-200 ${accordionStates.return ? "rotate-180" : ""}`}
            />
          </button>
          <div
            id="return-content"
            className={`grid transition-[grid-template-rows] duration-200 ${accordionStates.return ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
          >
            <div className="overflow-hidden">
              <div className="space-y-4 px-4 pb-4 text-sm text-gray-600">
                {/* 교환 및 반품 주소 */}
                <div>
                  <p className="font-medium text-gray-800 underline">
                    교환 및 반품 주소
                  </p>
                  <p className="-indent-3 pl-3">
                    - 경기도 부천시 평천로 832번길 42 4층 엘씨나인
                  </p>
                </div>

                {/* 교환 및 반품이 가능한 경우 */}
                <div className="space-y-1">
                  <p className="font-medium text-gray-800 underline">
                    교환 및 반품이 가능한 경우
                  </p>
                  <p className="-indent-3 pl-3">
                    - 상품을 공급 받으신 날로부터 7일 이내
                  </p>
                  <p className="-indent-3 pl-3">
                    - 단, 가전제품의 경우 포장을 개봉하였거나 포장이 훼손되어
                    상품 가치가 상실된 경우에는 교환/반품이 불가능합니다.
                  </p>
                  <p className="-indent-3 pl-3">
                    - 공급 받으신 상품 및 용역의 내용이 표시·광고 내용과
                    다르거나 다르게 이행된 경우에는 공급 받은 날로부터 3개월
                    이내, 그 사실을 알게 된 날로부터 30일 이내
                  </p>
                </div>

                {/* 교환 및 반품이 불가능한 경우 */}
                <div className="space-y-1">
                  <p className="font-medium text-gray-800 underline">
                    교환 및 반품이 불가능한 경우
                  </p>
                  <p className="-indent-3 pl-3">
                    - 고객님의 책임 있는 사유로 상품 등이 멸실 또는 훼손된 경우
                    단, 상품의 내용을 확인하기 위하여 포장 등을 훼손한 경우는
                    제외
                  </p>
                  <p className="-indent-3 pl-3">
                    - 포장을 개봉하였거나 포장이 훼손되어 상품 가치가 상실된 경우
                    <br />
                    (예 : 가전제품, 식품, 음반 등, 단 액정화면이 부착된 노트북,
                    LCD모니터, 디지털 카메라 등의 불량화소에 따른 반품/교환은
                    제조사 기준에 따릅니다.)
                  </p>
                  <p className="-indent-3 pl-3">
                    - 고객님의 사용 또는 일부 소비에 의하여 상품의 가치가 현저히
                    감소한 경우 단, 화장품등의 경우 시용제품을 제공한 경우에 한
                    합니다.
                  </p>
                  <p className="-indent-3 pl-3">
                    - 시간이 경과에 의하여 재판매가 곤란할 정도로 상품등의 가치가
                    현저히 감소한 경우
                  </p>
                  <p className="-indent-3 pl-3">
                    - 복제가 가능한 상품등의 포장을 훼손한 경우
                    <br />
                    (자세한 내용은 고객만족센터 1:1 E-MAIL 상담을 이용해 주시기
                    바랍니다.)
                  </p>
                </div>

                {/* 안내 */}
                <p>
                  ※ 고객님의 마음이 바뀌어 교환, 반품을 하실 경우 상품반송
                  비용은 고객님께서 부담하셔야 합니다.
                  <br />
                  (색상 교환, 사이즈 교환 등 포함)
                </p>
              </div>
            </div>
          </div>
        </li>
      </ul>
    </section>
  )
}
