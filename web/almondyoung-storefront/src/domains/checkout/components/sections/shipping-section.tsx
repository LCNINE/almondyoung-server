export const ShippingSection = () => (
  <section aria-labelledby="shipping-heading" className="mb-8">
    <h2
      id="shipping-heading"
      className="mb-3 text-base font-bold text-gray-900 md:text-xl"
    >
      배송지
    </h2>
    <div className="rounded-md border border-gray-200 bg-white px-[14px] py-[18px] md:rounded-[10px] md:px-10 md:py-8">
      <div className="flex justify-between md:w-full">
        <div className="flex-1">
          <p className="mb-3 flex flex-col gap-2 text-[15px] font-semibold text-gray-900 md:flex-row md:items-center md:text-lg">
            <span>이연정 (이연정)</span>
            <span className="hidden rounded bg-[#e8f6ea] px-2 py-[2px] text-[11px] font-semibold text-[#2ba24c] md:inline">
              기본 배송지
            </span>
          </p>
          <p className="mt-1 text-[13px] text-gray-700 md:text-base">
            010-0000-0000
          </p>
          <address className="text-[13px] leading-5 text-gray-700 not-italic md:text-base">
            서울특별시 강북구 도봉로 89길 27(수유동) 4층
          </address>
        </div>
        <button className="h-fit rounded border border-gray-300 px-3 py-1 text-[12px] font-medium text-gray-700 md:rounded-[3px] md:px-2.5 md:py-[5px] md:text-[13px]">
          변경
        </button>
      </div>
      <div className="mt-3">
        <label htmlFor="memo" className="sr-only">
          배송메모
        </label>
        <select
          id="memo"
          className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-700 md:rounded-[5px] md:px-4 md:py-3.5 md:text-sm"
          defaultValue=""
        >
          <option value="" disabled>
            배송메모를 선택해주세요
          </option>
        </select>
      </div>
    </div>
  </section>
)
