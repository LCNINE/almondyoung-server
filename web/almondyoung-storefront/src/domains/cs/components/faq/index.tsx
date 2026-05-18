"use client"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { useTranslations } from "next-intl"

const FAQ_IDS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const

export function Faq() {
  const t = useTranslations("cs.faq")
  return (
    <div className="px-4 py-6">
      <h2 className="mb-4 text-lg font-bold">{t("title")}</h2>
      <Accordion type="single" collapsible className="w-full">
        {FAQ_IDS.map((id) => (
          <AccordionItem key={id} value={id}>
            <AccordionTrigger className="text-left hover:no-underline">
              <div className="flex items-start gap-2">
                <span className="shrink-0 rounded bg-[#f29219]/10 px-2 py-0.5 text-xs font-medium text-[#f29219]">
                  {t(`items.${id}.category` as `items.1.category`)}
                </span>
                <span className="text-sm font-medium">
                  {t(`items.${id}.question` as `items.1.question`)}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <p className="pl-[52px] text-sm leading-relaxed text-gray-600">
                {t(`items.${id}.answer` as `items.1.answer`)}
              </p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}
