export const PaymentInfoSection = () => (
  <section className="mb-8">
    <h2 className="mb-3 text-xl font-bold text-gray-900 md:text-xl">
      결제 정보
    </h2>
    <div className="rounded-[10px] border border-gray-200 bg-white p-4 md:p-8">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-base text-gray-900">주문 상품</span>
          <span className="text-base text-gray-900">60,000원</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-base text-gray-900">배송비</span>
          <span className="text-base text-gray-900">2,500원</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base text-gray-900">할인 / 부가결제</span>
            <span className="rounded bg-[#E08F00] px-2 py-0.5 text-[11px] text-white">
              멤버십 할인
            </span>
          </div>
          <span className="text-base text-gray-900">- 42,000원</span>
        </div>
      </div>
      <div className="bg-opacity-50 -mx-8 mt-6 -mb-8 flex items-center justify-between rounded-b-[10px] bg-[#FFF7E5] px-9 py-5">
        <span className="text-lg font-bold text-gray-900">총 주문 금액</span>
        <span className="text-lg font-bold text-[#F29219]">20,500원</span>
      </div>
    </div>
  </section>
)
