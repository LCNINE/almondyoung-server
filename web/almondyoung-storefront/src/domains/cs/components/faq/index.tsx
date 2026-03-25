"use client"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

interface FaqItem {
  id: string
  question: string
  answer: string
  category: string
}

const FAQ_DATA: FaqItem[] = [
  {
    id: "1",
    category: "배송",
    question: "배송은 얼마나 걸리나요?",
    answer:
      "주문 후 평균 2-3일 내에 배송이 완료됩니다. 단, 도서산간 지역은 추가 1-2일이 소요될 수 있습니다.",
  },
  {
    id: "2",
    category: "배송",
    question: "배송 조회는 어디서 하나요?",
    answer:
      "마이페이지 > 주문/배송 조회에서 실시간 배송 현황을 확인하실 수 있습니다. 또한 주문 시 입력하신 연락처로 배송 관련 알림을 발송해 드립니다.",
  },
  {
    id: "3",
    category: "교환/반품",
    question: "교환/반품은 어떻게 하나요?",
    answer:
      "상품 수령 후 7일 이내에 마이페이지 > 주문/배송 조회에서 교환/반품 신청이 가능합니다. 단순 변심의 경우 반품 배송비가 발생할 수 있습니다.",
  },
  {
    id: "4",
    category: "교환/반품",
    question: "반품 시 환불은 언제 되나요?",
    answer:
      "반품 상품이 물류센터에 입고된 후 상품 상태 확인 후 1-2일 내에 환불 처리됩니다. 결제 수단에 따라 환불 소요 기간이 다를 수 있습니다.",
  },
  {
    id: "5",
    category: "회원",
    question: "회원 탈퇴는 어떻게 하나요?",
    answer:
      "마이페이지 > 회원정보 수정 > 회원 탈퇴에서 진행하실 수 있습니다. 탈퇴 시 보유하신 적립금 및 쿠폰은 모두 소멸됩니다.",
  },
  {
    id: "6",
    category: "결제",
    question: "결제 수단은 어떤 것이 있나요?",
    answer:
      "신용카드, 체크카드, 실시간 계좌이체, 가상계좌, 카카오페이, 네이버페이, 토스페이 등 다양한 결제 수단을 지원합니다.",
  },
  {
    id: "7",
    category: "적립금",
    question: "적립금은 어떻게 사용하나요?",
    answer:
      "주문 시 결제 단계에서 보유한 적립금을 사용하실 수 있습니다. 적립금은 1,000원 이상부터 사용 가능하며, 일부 상품에는 적립금 사용이 제한될 수 있습니다.",
  },
  {
    id: "8",
    category: "상품",
    question: "품절 상품은 언제 재입고되나요?",
    answer:
      "품절 상품의 재입고 일정은 상품마다 다르며, 상품 상세 페이지에서 재입고 알림 신청을 하시면 입고 시 알림을 받으실 수 있습니다.",
  },
]

export function Faq() {
  return (
    <div className="px-4 py-6">
      <h2 className="mb-4 text-lg font-bold">자주 묻는 질문</h2>
      <Accordion type="single" collapsible className="w-full">
        {FAQ_DATA.map((item) => (
          <AccordionItem key={item.id} value={item.id}>
            <AccordionTrigger className="text-left hover:no-underline">
              <div className="flex items-start gap-2">
                <span className="shrink-0 rounded bg-[#f29219]/10 px-2 py-0.5 text-xs font-medium text-[#f29219]">
                  {item.category}
                </span>
                <span className="text-sm font-medium">{item.question}</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <p className="pl-[52px] text-sm leading-relaxed text-gray-600">
                {item.answer}
              </p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}
