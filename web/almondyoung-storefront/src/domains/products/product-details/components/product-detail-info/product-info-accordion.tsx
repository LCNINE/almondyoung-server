"use client"

import { ChevronDown } from "lucide-react"
import { useState } from "react"
import { useTranslations } from "next-intl"

export function ProductInfoAccordion() {
  const t = useTranslations("productDetail.accordion")
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
    <section className="bg-background mb-8 rounded-lg p-0 md:p-6 lg:p-6">
      <ul className="space-y-4">
        {/* 결제안내 */}
        <li className="rounded-lg border">
          <button
            onClick={() => toggleAccordion("payment")}
            className="flex w-full items-center justify-between p-4"
            aria-expanded={accordionStates.payment}
            aria-controls="payment-content"
          >
            <span className="font-medium">{t("payment")}</span>
            <ChevronDown
              className={`size-5 shrink-0 transition-transform duration-200 ${accordionStates.payment ? "rotate-180" : ""}`}
            />
          </button>
          <div
            id="payment-content"
            className={`grid transition-[grid-template-rows] duration-200 ${accordionStates.payment ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
          >
            <div className="overflow-hidden">
              <p className="px-4 pb-4 text-sm whitespace-pre-line text-gray-600">
                {t("paymentBody")}
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
            <span className="font-medium">{t("shipping")}</span>
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
                  <li>{t("shippingMethod")}</li>
                  <li>{t("shippingArea")}</li>
                  <li>{t("shippingFee")}</li>
                  <li>{t("shippingDuration")}</li>
                  <li>{t("shippingCarrier")}</li>
                </ul>
                <p className="mt-4">{t("shippingNote1")}</p>
                <p className="mt-4">{t("shippingNote2")}</p>
                <p className="mt-4">{t("shippingNote3")}</p>
                <p className="mt-4">{t("shippingNote4")}</p>
                <p className="mt-4">{t("shippingNote5")}</p>
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
            <span className="font-medium">{t("returnTitle")}</span>
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
                <div>
                  <p className="font-medium text-gray-800 underline">
                    {t("returnAddressTitle")}
                  </p>
                  <p className="pl-3 -indent-3">{t("returnAddress")}</p>
                </div>

                <div className="space-y-1">
                  <p className="font-medium text-gray-800 underline">
                    {t("returnableTitle")}
                  </p>
                  <p className="pl-3 -indent-3">{t("returnable1")}</p>
                  <p className="pl-3 -indent-3">{t("returnable2")}</p>
                  <p className="pl-3 -indent-3">{t("returnable3")}</p>
                </div>

                <div className="space-y-1">
                  <p className="font-medium text-gray-800 underline">
                    {t("notReturnableTitle")}
                  </p>
                  <p className="pl-3 -indent-3">{t("notReturnable1")}</p>
                  <p className="pl-3 -indent-3">{t("notReturnable2")}</p>
                  <p className="pl-3 -indent-3">{t("notReturnable3")}</p>
                  <p className="pl-3 -indent-3">{t("notReturnable4")}</p>
                  <p className="pl-3 -indent-3">{t("notReturnable5")}</p>
                </div>

                <p className="whitespace-pre-line">{t("exchangeNotice")}</p>
              </div>
            </div>
          </div>
        </li>
      </ul>
    </section>
  )
}
