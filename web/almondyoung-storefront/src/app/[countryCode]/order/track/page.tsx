"use client"
import React, { useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"

// Zod 스키마 정의
const trackingFormSchema = z.object({
  orderNumber: z.string().min(10, "주문번호는 최소 10자 이상이어야 합니다"),
  email: z.string().email("올바른 이메일 형식이 아닙니다"),
})

type TrackingForm = z.infer<typeof trackingFormSchema>

// =================================================================================================
// 페이지 컴포넌트
// =================================================================================================
// Stepper UI를 위한 아이콘
const CheckIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
)
export const ShipmentTracker = ({
  isDelivered,
  steps,
  deliveryInfo,
}: {
  isDelivered: boolean
  steps: any
  deliveryInfo: any
}) => {
  // isDelivered가 true일 경우, "배송 완료" UI를 렌더링
  if (isDelivered) {
    return (
      <section className="overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="bg-[#2C2C54] p-4 text-center text-white">
          <h2 className="text-lg font-bold">{deliveryInfo.date} 도착 완료</h2>
        </div>
        <div className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm text-gray-500">
              송장 {deliveryInfo.trackingNumber}
            </p>
            <p className="mt-1 font-semibold text-gray-800">
              {deliveryInfo.time} 배송완료
            </p>
          </div>
          <a
            href="#"
            className="flex-shrink-0 rounded border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
          >
            자세히 보기
          </a>
        </div>
      </section>
    )
  }

  // isDelivered가 false일 경우, 기존의 "배송 추적" UI를 렌더링
  return (
    <section className="rounded-xl bg-[#2C2C54] px-8 py-10 text-white">
      <h2 className="text-center text-xl font-medium">
        상품 준비중! 오늘 출고
      </h2>
      <div className="mt-10 flex items-center justify-between">
        {steps.map((step: any, index: number) => (
          <React.Fragment key={step.name}>
            <div className="flex flex-col items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${step.status === "completed" ? "bg-[#FF7A00] text-white" : ""} ${step.status === "active" ? "bg-[#2C2C54] ring-2 ring-white" : ""} ${step.status === "pending" ? "bg-gray-500" : ""}`}
              >
                {step.status === "completed" ? <CheckIcon /> : index + 1}
              </div>
              <span
                className={`text-sm ${step.status === "active" ? "font-bold text-white" : "text-gray-300"}`}
              >
                {step.name}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`mx-4 h-0.5 flex-1 ${step.status === "completed" ? "bg-[#FF7A00]" : "bg-gray-500"}`}
              ></div>
            )}
          </React.Fragment>
        ))}
      </div>
      <p className="mt-8 text-center text-sm text-gray-400">
        배송이 시작되면 상세한 배송상태 확인이 가능합니다.
      </p>
    </section>
  )
}

export default function DeliveryTrackingPage() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [isDelivered, setIsDelivered] = useState(false)

  // React Hook Form 설정
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TrackingForm>({
    resolver: zodResolver(trackingFormSchema),
  })

  const onTrackingSubmit = (data: TrackingForm) => {
    console.log("Tracking form submitted:", data)
    alert(`주문번호 ${data.orderNumber}의 배송을 조회합니다`)
  }
  // ✅ 이벤트 핸들러 타입 개선
  const onMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault()
    if (!scrollRef.current) return
    setIsDragging(true)
    setStartX(e.pageX - scrollRef.current.offsetLeft) // ✅ 타입 단언 제거
    setScrollLeft(scrollRef.current.scrollLeft)
  }

  const onMouseUpOrLeave = () => {
    setIsDragging(false)
  }

  const onMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!isDragging || !scrollRef.current) return
    e.preventDefault()
    const x = e.pageX - scrollRef.current.offsetLeft
    const walk = Number(x - startX) * 2
    scrollRef.current.scrollLeft = scrollLeft - walk
  }
  // --- 슬라이더 로직 끝 ---
  // 배송 단계 데이터
  const inProgressSteps = [
    { name: "결제완료", status: "completed" },
    { name: "상품준비중", status: "active" },
    { name: "배송시작", status: "pending" },
    { name: "배송중", status: "pending" },
    { name: "배송완료", status: "pending" },
  ]
  // BasicProductCard에 맞는 예시 데이터
  const recommendedProducts = [
    {
      id: "1",
      image:
        "https://almondyoung.com/web/product/medium/202503/d21d85aa58f14bb4cc2a69342d24c4fa.jpg", // 이미지 색상 조정
      thumbnail:
        "https://almondyoung.com/web/product/medium/202503/d21d85aa58f14bb4cc2a69342d24c4fa.jpg",
      name: "포스아이래쉬 여우펌 콜라겐 케라틴 파우더 10g",
      price: {
        original: 30000,
        member: 5000,
        discountRate: 83,
        isMembership: false,
      },
      membershipPrice: 5000,
      discountRate: 78,
      rating: 4.5,
      reviewCount: 401,
      isSoldOut: false,
      hasOptions: true,
    },
    {
      id: "2",
      image:
        "https://almondyoung.com/web/product/medium/202402/9b57c6aa76f40052f31f2ea85c6876a7.jpg", // 이미지 색상 조정
      thumbnail:
        "https://almondyoung.com/web/product/medium/202402/9b57c6aa76f40052f31f2ea85c6876a7.jpg",
      name: "반하다 알록달록 무쌍 레인보우 롯드 LU컬",
      price: {
        original: 30000,
        member: 28000,
        discountRate: 7,
        isMembership: false,
      },
      membershipPrice: 28000, // 멤버십 가격 추가
      discountRate: 78,
      rating: 5,
      reviewCount: 401,
      isSoldOut: false,
      isSingleOption: true,
      shipmentInfo: "무료배송",
    },
    {
      id: "3",
      image:
        "https://almondyoung.com/web/product/medium/202508/f78ca31bb7f7c9cb0461ba7bc24145dc.png", // 이미지 색상 조정
      thumbnail:
        "https://almondyoung.com/web/product/medium/202508/f78ca31bb7f7c9cb0461ba7bc24145dc.png",
      name: "반하다 바싹펌",
      price: {
        original: 30000,
        member: 15000,
        discountRate: 50,
        isMembership: false,
      },
      membershipPrice: 15000, // 멤버십 가격
      discountRate: 78,
      isSoldOut: false, // 품절 아님으로 변경
      rating: 3.8,
      reviewCount: 288, // 리뷰 수 조정
    },
    {
      // 추가 상품 (슬라이드 테스트용)
      id: "4",
      image:
        "https://almondyoung.com/web/product/medium/202508/c3a909e285d10ac83233c8dcc4e361f8.jpg", // 이미지 색상 조정
      thumbnail:
        "https://almondyoung.com/web/product/medium/202508/c3a909e285d10ac83233c8dcc4e361f8.jpg",
      name: "NEW 에센스 펌 세트",
      price: {
        original: 25000,
        member: 18000,
        discountRate: 28,
        isMembership: false,
      },
      membershipPrice: 18000,
      discountRate: 28,
      rating: 4.2,
      reviewCount: 120,
      isSoldOut: false,
    },
  ]
  // '배송 완료' 상태일 때 사용할 데이터
  const completedInfo = {
    date: "8/20(수)",
    trackingNumber: "102301-1023012030",
    time: "오늘 19:00",
  }
  return (
    <div className="min-h-screen w-full bg-[#F8F8FB] font-sans">
      <div className="relative mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
        {/* 배송 조회 폼 */}
        <section className="mb-6 rounded-xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-bold">배송 조회</h2>
          <form onSubmit={handleSubmit(onTrackingSubmit)} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                주문번호
              </label>
              <input
                {...register("orderNumber")}
                placeholder="주문번호를 입력하세요"
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              />
              {errors.orderNumber && (
                <p className="mt-1 text-sm text-red-500">
                  {errors.orderNumber.message}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                이메일
              </label>
              <input
                {...register("email")}
                type="email"
                placeholder="example@email.com"
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              />
              {errors.email && (
                <p className="mt-1 text-sm text-red-500">
                  {errors.email.message}
                </p>
              )}
            </div>

            <button
              type="submit"
              className="w-full rounded-md bg-blue-500 py-3 font-medium text-white hover:bg-blue-600"
            >
              배송 조회하기
            </button>
          </form>
        </section>

        {/* 상태 변경 테스트용 버튼 */}
        <div className="mb-4 text-center">
          <button
            onClick={() => setIsDelivered(!isDelivered)}
            className="rounded-lg bg-blue-500 px-4 py-2 text-white"
          >
            배송 상태 토글: {isDelivered ? "완료" : "진행중"}
          </button>
        </div>
        <ShipmentTracker
          isDelivered={isDelivered}
          steps={inProgressSteps}
          deliveryInfo={completedInfo}
        />

        {/* 배송 정보 (순수 UI) */}
        <section className="mt-6 rounded-xl bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-bold">배송 정보</h3>
          <p className="text-gray-800">이연정</p>
          <p className="mt-2 text-sm text-gray-600">
            (10303) 서울특별시 강북구 도봉로 89길 27(수유동)4층
          </p>
          <p className="mt-1 text-sm text-gray-600">010-0000-0000</p>
          <hr className="border-muted my-4" />
          <dl className="flex text-sm">
            <dt className="w-28 shrink-0 text-gray-500">배송요청사항</dt>
            <dd className="text-gray-700">부재 시 문앞에 놔주세요.</dd>
          </dl>
        </section>

        {/* 추천 상품 섹션 (순수 UI - 슬라이드 기능만) */}
        <section className="mt-10">
          <h3 className="mb-4 text-lg font-bold">
            이 상품과 많이 구매하는 상품
          </h3>
          <div className="relative overflow-hidden rounded-xl bg-white p-4">
            <div
              ref={scrollRef}
              onMouseDown={onMouseDown}
              onMouseUp={onMouseUpOrLeave}
              onMouseLeave={onMouseUpOrLeave}
              onMouseMove={onMouseMove}
              className={`scrollbar-hide flex cursor-grab overflow-x-auto scroll-smooth pb-4 ${isDragging ? "cursor-grabbing" : ""}`}
            >
              {recommendedProducts.map((product) => (
                <div
                  key={product.id}
                  className="w-[40%] flex-shrink-0 pr-4 sm:w-[calc(100%/3)] md:w-[calc(100%/2.5)] lg:w-1/3"
                  onDragStart={(e) => e.preventDefault()}
                >
                  <div className="rounded-lg border p-4">
                    <img
                      src={product.image}
                      alt={product.name}
                      className="mb-2 h-40 w-full rounded object-cover"
                    />
                    <h4 className="mb-2 text-sm font-medium">{product.name}</h4>
                    <p className="text-lg font-bold text-amber-500">
                      {product.price.member.toLocaleString()}원
                    </p>
                    {product.price.discountRate > 0 && (
                      <p className="text-xs text-gray-500 line-through">
                        {product.price.original.toLocaleString()}원
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
