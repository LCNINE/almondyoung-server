"use client"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { FAQ_DATA } from "./benefits-data"

export default function MembershipFAQSection() {
  return (
    <section className="py-12">
      <div className="flex flex-col items-center gap-4 mb-8">
        <h2 className="text-2xl md:text-3xl font-bold text-center">
          <span className="text-white">자주 묻는 </span>
          <span className="text-[#f29219]">질문</span>
        </h2>
      </div>

      <Accordion type="single" collapsible className="w-full">
        {FAQ_DATA.map((faq, index) => (
          <AccordionItem
            key={index}
            value={`item-${index}`}
            className="border-white/10"
          >
            <AccordionTrigger className="text-white text-sm text-left hover:no-underline hover:text-[#f29219] [&>svg]:text-white">
              {faq.question}
            </AccordionTrigger>
            <AccordionContent className="text-white/70 text-sm">
              {faq.answer}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}
