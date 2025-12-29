export const OrderProductsSection = () => (
  <section aria-labelledby="order-heading" className="mb-8">
    <h2
      id="order-heading"
      className="mb-3 text-base font-bold text-gray-900 md:text-xl"
    >
      주문 상품
    </h2>
    <article className="rounded-md border border-gray-200 bg-white p-4 md:rounded-[10px] md:p-10">
      <div className="flex items-start gap-3 md:gap-8">
        <img
          src="/images/product-thumb.png"
          alt="루가래쉬 플랫모"
          className="h-[64px] w-[64px] rounded object-cover md:h-[99px] md:w-[99px] md:rounded-[5px]"
        />
        <p className="flex-1 text-[14px] font-semibold text-gray-900 md:text-base md:font-normal">
          루가래쉬 플랫모
        </p>
      </div>

      <div className="mt-3 space-y-2 md:mt-6 md:space-y-3">
        <div className="bg-muted flex items-start justify-between rounded pt-[5.5px] pr-3 pb-[11px] pl-2 lg:rounded-[2px] lg:pt-2.5 lg:pr-4 lg:pb-4 lg:pl-3">
          <div className="flex items-center gap-2 md:gap-4">
            <span className="rounded-[2px] border border-gray-300 px-1 py-0.5 text-[12px] font-medium text-gray-600 lg:text-[11px]">
              옵션
            </span>
            <span className="text-[12px] text-gray-700 md:text-base">
              C / 0.10 / 7mm | 1개
            </span>
          </div>
          <div className="text-right">
            <span className="mr-2 text-[12px] text-gray-400 line-through md:text-sm">
              30,000
            </span>
            <span className="text-[13px] font-semibold text-gray-900 md:text-base md:font-normal">
              9,000원
            </span>
          </div>
        </div>
      </div>

      <p className="mt-3 text-right text-[12px] text-gray-600 md:mt-4 md:text-base">
        배송비 2,500원
      </p>
    </article>
  </section>
)
