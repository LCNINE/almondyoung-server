import React from "react"

/**
 * 헬퍼 컴포넌트: 가독성을 위해 복잡한 SVG를 분리
 * (단일 태그에 과도한 마크업 중첩 방지)
 */
function CloseIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
      preserveAspectRatio="none"
    >
      <path
        d="M15 5L5 15M5 5L15 15"
        stroke="#1E1E1E"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ArrowRightIcon() {
  return (
    <svg
      width={21}
      height={17}
      viewBox="0 0 21 17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-[17px] w-[20px]"
      preserveAspectRatio="none"
    >
      <path
        d="M7.55225 12.4687L12.587 8.3125L7.55225 4.15625"
        stroke="#757575"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function FiveStarRatingSvg() {
  return (
    <svg
      width={122}
      height={23}
      viewBox="0 0 122 23"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-[22.4px] w-[121.33px]"
      preserveAspectRatio="none"
    >
      <path d="M11.0195 0.378273C11.092..." fill="#D9D9D9" />
      <path d="M35.2856 0.378273C35.3581..." fill="#D9D9D9" />
      <path d="M60.4889 0.343686C60.5635..." fill="#D9D9D9" />
      <path d="M85.686 0.378273C85.7585..." fill="#D9D9D9" />
      <path d="M109.953 0.378273C110.026..." fill="#D9D9D9" />
    </svg>
  )
}

/**
 * 주문 완료 모바일 페이지
 * - `absolute`를 제거하고 `flex flex-col` 기반의 시맨틱 마크업으로 재구조화
 */
export default function OrderSuccessContainer() {
  // `w-[375px] h-[812px]`는 디자인 툴의 뷰포트 크기입니다.
  // 실제 마크업은 `max-w-[375px]`(혹은 max-w-sm)과 `min-h-screen`을 사용합니다.
  return (
    <div className="mx-auto flex min-h-screen w-full flex-col overflow-hidden bg-[#f8f8f8]">
      {/* 1. <header>: 페이지 헤더 (제목 + 닫기 버튼) */}
      {/* 원본의 top-16 (64px)을 pt-16으로 변환 */}
      <header className="flex w-full items-center justify-between px-4 pt-16">
        <h2 className="text-base font-bold text-black">주문 완료</h2>
        <button type="button" aria-label="닫기" className="p-1">
          <CloseIcon />
        </button>
      </header>

      {/* 2. <main>: 핵심 콘텐츠 영역 */}
      {/* `flex-1`을 주어 남은 공간을 모두 차지하게 하고, 
          `absolute` 대신 `flex-col`과 `gap`으로 레이아웃 구성
      */}
      <main className="flex-1 flex-col px-4">
        {/* 원본의 H1 (top-[113px])과 Header(top-16/64px)의 
            차이(49px)를 `mt-12` (48px)로 구현
        */}
        <h1 className="mt-12 text-base font-bold text-black">
          주문이 완료되었습니다!
        </h1>

        {/* 3. <section>: 주문 상세 정보 카드 */}
        {/* 원본의 Card (top-[142px])와 H1(top-[113px])의 
            차이(29px)를 `mt-7` (28px)로 구현
        */}
        <section className="mt-7 w-full rounded-[5px] border-[0.5px] border-[#d9d9d9] bg-white">
          <div className="flex flex-col p-4">
            {/* 3-1. <dl>: 배송 정보 (정의 목록) */}
            <dl className="flex flex-col gap-y-4 text-xs">
              <div className="flex">
                <dt className="w-24 shrink-0 text-left text-black">받는사람</dt>
                <dd className="text-left text-black">이연정 / 010-0000-0000</dd>
              </div>
              <div className="flex">
                <dt className="w-24 shrink-0 text-left text-black">받는주소</dt>
                <dd className="flex-1 text-left text-black">
                  서울특별시 강북구 도봉로 89길 27(수유동)4층
                </dd>
              </div>
              <div className="flex">
                <dt className="w-24 shrink-0 text-left text-black">
                  배송요청사항
                </dt>
                <dd className="flex-1 text-left text-black">
                  부재 시 문앞에 둬주세요.
                </dd>
              </div>
            </dl>

            {/* 3-2. <hr>: 시맨틱한 구분선 */}
            <hr className="my-6 border-t-[0.5px] border-[#d9d9d9]" />

            {/* 3-3. <dl>: 결제 항목 */}
            <dl className="flex flex-col gap-y-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-left text-black">총 상품 가격</dt>
                <dd className="text-right font-bold text-black">18,000원</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-left text-black">배송비</dt>
                <dd className="text-right font-bold text-black">2,500원</dd>
              </div>
            </dl>

            {/* 3-4. <hr>: 시맨틱한 구분선 */}
            <hr className="my-6 border-t-[0.5px] border-[#d9d9d9]" />

            {/* 3-5. <dl>: 총 결제 금액 */}
            <dl className="flex flex-col gap-y-1">
              <div className="flex items-center justify-between">
                <dt className="text-left text-[13px] text-black">
                  총 결제 금액
                </dt>
                <dd className="text-right text-sm font-bold text-[#ffa500]">
                  20,500원
                </dd>
              </div>
              <div className="flex justify-end">
                <dt className="sr-only">결제 수단</dt>
                <dd className="text-right text-xs font-medium text-[#757575]">
                  나중결제/익월 이체
                </dd>
              </div>
            </dl>

            {/* 3-6. 주문내역 보기 버튼 (<a> 태그로 변경) */}
            <a
              href="/mypage/orders" // 시맨틱: 적절한 링크
              className="mt-6 flex h-8 w-full items-center justify-center gap-1.5 rounded-[5px] border border-[#d1d1d6] text-xs font-medium text-[#757575] transition-colors hover:bg-gray-50"
            >
              주문내역 보기
              <ArrowRightIcon />
            </a>
          </div>
        </section>

        {/* 4. <section>: 리뷰 유도 카드 */}
        {/* 원본의 Card 2 (top-[494.75px])와 Card 1(top-[142px] + h-[335px] = 477px)의 
            차이(~17px)를 `mt-4` (16px)로 구현
        */}
        <section className="mt-4 w-full rounded-[5px] border-[0.5px] border-[#d9d9d9] bg-white px-2 py-4 text-center">
          <h3 className="text-xs font-bold text-black">
            구매 경험이 만족스러웠나요?
          </h3>
          <div className="mt-2 flex justify-center">
            <FiveStarRatingSvg />
          </div>
        </section>
      </main>
    </div>
  )
}
