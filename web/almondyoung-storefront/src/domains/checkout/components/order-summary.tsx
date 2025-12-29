// 모바일 주문 요약
export const MobileOrderSummary = () => (
  <section aria-labelledby="order-summary-heading" className="mb-6 md:hidden">
    <h2
      id="order-summary-heading"
      className="mb-4 text-lg font-bold text-gray-800"
    >
      주문 요약
    </h2>
    <div className="overflow-hidden rounded-lg bg-white">
      <dl>
        <div className="flex justify-between px-5 py-4">
          <dt className="text-sm text-gray-600">주문 상품</dt>
          <dd className="text-sm font-semibold text-gray-800">60,000원</dd>
        </div>
        <div className="flex justify-between px-5 py-4">
          <dt className="text-sm text-gray-600">배송비</dt>
          <dd className="text-sm font-semibold text-gray-800">2,500원</dd>
        </div>
        <div className="flex items-center justify-between px-5 py-4">
          <dt className="flex items-center gap-1.5 text-sm text-gray-600">
            할인 / 부가결제
            <span className="inline-flex items-center rounded-sm bg-[#FFF8F2] px-1.5 py-0.5 text-[11px] font-bold text-[#F79A3A]">
              멤버십 할인
            </span>
          </dt>
          <dd className="text-sm font-semibold text-gray-800">- 42,000원</dd>
        </div>
      </dl>
      <div className="flex items-center justify-between bg-[#FFFBF2] px-5 py-4">
        <p className="text-base font-bold text-gray-800">총 주문 금액</p>
        <p className="text-xl font-extrabold text-[#F77F00]">20,500원</p>
      </div>
    </div>
  </section>
)
