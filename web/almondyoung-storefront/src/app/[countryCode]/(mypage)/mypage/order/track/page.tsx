"use client"
import { OrderInfoCardShipping } from "@components/orders/order-info-cards"
import { ExternalLink } from "lucide-react"
import { Accordion } from "./accordion"
import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@components/layout/mypage-layout"
export default function OrderTrackPage() {
  const faqData = [
    {
      id: "faq-1",
      question: "[상품누락] 상품을 구매했는데 일부만 배송되었어요.",
      answer: (
        <>
          <p>
            상품이 누락되었다면 교환을 통해 상품을 다시 받거나, 반품 후 환불을
            받을 수 있습니다. 구성품의 일부가 누락된 경우에는 부분 배송이
            불가하므로 상품 전체를 교환/반품으로 진행해 주시기 바랍니다. 교환 및
            반품은 아래의 경로를 통해 직접 신청이 가능합니다.
          </p>
          <div>
            <p>
              <strong className="font-bold">교환/반품 신청하기</strong>
            </p>
            <p>
              • 마이쿠팡 →{" "}
              <a
                href="https://mc.coupang.com/ssr/desktop/order/list"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 underline"
              >
                <span>주문목록</span>
                <ExternalLink className="h-4 w-4" />
              </a>{" "}
              → 상품선택 → [교환, 반품 신청] 선택
            </p>
            <p>• 이후 각 단계에 해당하는 항목을 선택하여 신청을 완료합니다.</p>
          </div>
        </>
      ),
    },
    {
      id: "faq-2",
      question: "[환불] 반품 신청을 했는데, 언제 환불되나요?",
      answer: (
        <p>
          환불은 결제수단에 따라 다소 시간이 소요될 수 있습니다. (답변 예시)
        </p>
      ),
    },
    {
      id: "faq-3",
      question: "[배송완료미수령] 상품을 받지 못했는데 배송완료로 확인됩니다.",
      answer: (
        <p>
          배송 기사님께 연락하거나 고객센터로 문의해 주시기 바랍니다. (답변
          예시)
        </p>
      ),
    },
    {
      id: "faq-4",
      question: "[교환/반품] 상품을 교환/반품하고 싶어요.",
      answer: (
        <p>
          마이쿠팡 {">"} 주문목록에서 직접 신청하실 수 있습니다. (답변 예시)
        </p>
      ),
    },
  ]
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
      }}
    >
      <MypageLayout>
        <div className="min-h-screen bg-white py-4 md:px-6">
          <div className="flex flex-col items-center justify-start gap-7 self-stretch bg-gray-700 p-7">
            <div className="justify-start self-stretch text-center font-['Pretendard'] text-2xl font-bold text-white">
              배송이 시작되었습니다!
            </div>
            <div className="flex w-80 gap-7">
              <div className="relative h-12 flex-1">
                <div className="absolute top-0 left-0 h-7 w-7 rounded-[5px] bg-amber-500" />
                <div
                  data-size="20"
                  className="absolute top-[5px] left-[5px] h-5 w-5 overflow-hidden"
                >
                  <div className="absolute top-[5px] left-[3.33px] h-2.5 w-3.5 outline-2 outline-offset-[-1px] outline-white" />
                </div>
                <div className="text-Text-Default-Tertiary absolute top-[40px] left-[-1px] justify-start text-center font-['Pretendard'] text-xs font-medium">
                  결제완료
                </div>
              </div>
              <div className="relative h-12 flex-1">
                <div className="absolute top-0 left-0 h-7 w-7 rounded-[5px] bg-amber-500" />
                <div
                  data-size="20"
                  className="absolute top-[5px] left-[5px] h-5 w-5 overflow-hidden"
                >
                  <div className="absolute top-[1.67px] left-[2.50px] h-4 w-3.5 outline-2 outline-offset-[-1px] outline-white" />
                </div>
                <div className="text-Text-Default-Tertiary absolute top-[40px] left-[-7px] justify-start text-center font-['Pretendard'] text-xs font-medium">
                  상품 준비중
                </div>
              </div>
              <div className="relative h-12 flex-1">
                <div className="absolute top-0 left-0 h-7 w-7 rounded-[5px] bg-amber-500" />
                <div
                  data-size="20"
                  className="absolute top-[5px] left-[5px] h-5 w-5 overflow-hidden"
                >
                  <div className="absolute top-[1.67px] left-[3.33px] h-4 w-3.5 outline-2 outline-offset-[-1px] outline-white" />
                </div>
                <div className="text-Text-Default-Tertiary absolute top-[40px] left-[-1px] justify-start text-center font-['Pretendard'] text-xs font-medium">
                  배송시작
                </div>
              </div>
              <div className="relative h-11 flex-1">
                <div className="bg-Color absolute top-0 left-0 h-7 w-7 rounded-[5px]" />
                <div
                  data-size="20"
                  className="absolute top-[5px] left-[5px] h-5 w-5 overflow-hidden"
                >
                  <div className="outline-Border-Neutral-tertiary absolute top-[2.50px] left-[0.83px] h-3.5 w-5 outline-2 outline-offset-[-1px]" />
                </div>
                <div className="text-Text-Default-Tertiary absolute top-[40px] left-[4px] justify-start text-center font-['Pretendard'] text-xs font-medium">
                  배송중
                </div>
              </div>
              <div className="relative h-12 flex-1">
                <div className="bg-Color absolute top-0 left-0 h-7 w-7 rounded-[5px]" />
                <div
                  data-size="20"
                  className="absolute top-[5px] left-[5px] h-5 w-5 overflow-hidden"
                >
                  <div className="outline-Border-Neutral-tertiary absolute top-[0.83px] left-[2.50px] h-5 w-3.5 outline-2 outline-offset-[-1px]" />
                </div>
                <div className="text-Text-Default-Tertiary absolute top-[40px] left-[-1px] justify-start text-center font-['Pretendard'] text-xs font-medium">
                  배송완료
                </div>
              </div>
            </div>
          </div>

          {/* --- 주문 정보 --- */}
          <section className="mt-9">
            <div className="border-border-muted flex items-center justify-between border-b pb-4">
              <h3 className="text-[12px] font-bold text-gray-800">
                2025. 5. 14 주문
              </h3>
              <a href="#" className="text-[12px] text-[#ffa500]">
                주문 상세 보기
              </a>
            </div>
            <div className="rounded-xl bg-white p-6 py-6 shadow-sm">
              <div className="flex gap-4 rounded-xl">
                <img
                  src="https://almondyoung.com/web/product/medium/202503/d21d85aa58f14bb4cc2a69342d24c4fa.jpg"
                  alt="주문 상품 이미지"
                  className="h-24 w-24 shrink-0 rounded-md border"
                />
                <div className="flex flex-col justify-center">
                  <p className="font-semibold text-gray-800">
                    노모드 속눈썹 영양제 블랙
                  </p>
                  <p className="mt-1 text-sm text-gray-600">9,000원</p>
                  <p className="mt-1 text-sm text-gray-500">브러쉬 타입 1개</p>
                  <p className="text-sm text-gray-500">마스카라 타입 1개</p>
                </div>
              </div>
              <button className="mt-[30px] flex h-[33px] w-full items-center justify-center rounded-[5px] border border-solid bg-white pt-[9px] pr-[7.5px] pb-[10px] pl-[10px]">
                <span className="text-[12px]">주문 취소</span>
              </button>
            </div>
          </section>

          <section className="mt-10">
            <OrderInfoCardShipping />
          </section>

          <section className="mt-10 bg-white">
            <div>
              <h3 className="mb-4 text-xl font-bold">
                배송에 대해 궁금한 점이 있으십니까?
              </h3>
              <Accordion.Root defaultValue="faq-1">
                {faqData.map((faq) => (
                  <Accordion.Item key={faq.id} value={faq.id}>
                    <Accordion.Trigger value={faq.id}>
                      {faq.question}
                    </Accordion.Trigger>
                    <Accordion.Content value={faq.id}>
                      {faq.answer}
                    </Accordion.Content>
                  </Accordion.Item>
                ))}
              </Accordion.Root>
            </div>
          </section>
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
