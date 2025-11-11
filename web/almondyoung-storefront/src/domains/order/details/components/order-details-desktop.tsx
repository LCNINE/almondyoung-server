import { CustomButton } from "@components/common/custom-buttons/custom-button"
import Link from "next/link"

/**
 * OrderDetailsDesktop - 주문 상세 데스크탑 컴포넌트
 *
 * 웹 퍼블리셔 4대 규칙을 적용한 마크업 구조
 * (UI 디자인 및 기존 스타일 클래스 유지)
 */
export const OrderDetailsDesktop = () => {
  return (
    <div className="bg-white py-4 font-['Pretendard'] md:px-6">
      {/* [규칙 1] 시맨틱: <div> -> <section>
          [규칙 2] 컨테이너: 원본 클래스(gap-3.5) 유지
        */}
      <section className="mb-[35px] flex flex-col items-start justify-start gap-3.5 self-stretch">
        {/* [규칙 1] 시맨틱: <div> -> <h1> */}
        <h1 className="justify-start self-stretch text-2xl font-bold text-black">
          주문상세
        </h1>
        {/*
            [규칙 2] 컨테이너: 원본 클래스(bg-white, gap-2) 유지
            [규칙 4] 견고성: 'w-[813px]' -> 'w-full max-w-[813px]'로 변경
                         디자인은 유지하되, 작은 화면에서 깨지지 않도록 함.
          */}
        <div className="flex w-full max-w-[813px] flex-col items-start justify-start gap-2 bg-white">
          <div className="inline-flex items-center justify-between self-stretch">
            {/* [규칙 1] 시맨틱: <div> -> <p> */}
            <p className="text-Color-2 w-80 justify-start text-lg font-normal">
              2025. 7. 26 주문
            </p>
          </div>
          <div className="inline-flex items-center justify-between self-stretch">
            {/* [규칙 1] 시맨틱: <div> -> <p> (span 래퍼) */}
            <p className="w-80 justify-start">
              <span className="text-lg font-bold text-black">주문번호 </span>
              <span className="text-lg font-normal text-black underline">
                20253934092938
              </span>
            </p>
          </div>
        </div>
      </section>

      <article className="mb-[35px] flex border border-gray-200">
        {/* 메인 컨텐츠 영역 - container */}
        <div className="flex-1 p-7">
          <div className="space-y-6">
            {/* 상태 헤더 */}
            <h3 className="text-2xl font-bold text-black">상품준비중</h3>

            {/* 상품 정보 - container */}
            <div className="flex flex-wrap items-end gap-6">
              {/* 상품 이미지 */}
              <figure className="shrink-0">
                <img
                  className="h-24 w-24 rounded-[5px] border border-gray-200"
                  src="https://placehold.co/99x99"
                  alt="루가래쉬 플랫모"
                />
              </figure>

              {/* 상품 상세 - inner */}
              <div className="min-w-32 flex-1 space-y-3.5">
                <h4 className="text-lg text-black">루가래쉬 플랫모</h4>

                <div className="text-base text-gray-600">
                  <p>9,000원 · 2개</p>
                  <p>- 브러쉬 타입 1개</p>
                  <p>- 마스카라 타입 1개</p>
                </div>
              </div>

              {/* 장바구니 버튼 */}
              <CustomButton variant="outline" color="secondary" size="sm">
                장바구니 담기
              </CustomButton>
            </div>
          </div>
        </div>

        {/* 액션 영역 - container */}
        <div className="flex w-40 items-center justify-center border-l border-gray-200 px-7">
          {/* inner: 버튼만 */}
          <CustomButton variant="outline" color="secondary" size="lg">
            주문 취소 요청
          </CustomButton>
        </div>
      </article>
      {/* [규칙 1] 시맨틱: <div> -> <section> */}
      <section className="mb-[35px] flex flex-col items-start justify-start gap-4 self-stretch">
        {/* [규칙 1] 시맨틱: <div> -> <h2> */}
        <h2 className="justify-start self-stretch text-lg font-bold text-black">
          받는사람 정보
        </h2>
        {/* [규칙 1] 시맨틱: <div> -> <hr>
              [규칙 4] 견고성: h-0 outline 핵(hack) 대신 hr과 border-t로 교체 (시각 동일)
          */}
        <hr className="self-stretch border-t-[0.50px] border-stone-900" />

        {/*
            [규칙 1] 시맨틱: Key-Value 쌍을 <dl>로 래핑
            (원본의 flex layout 클래스는 유지)
          */}
        <dl className="flex flex-col items-start justify-start gap-4 self-stretch">
          <div className="flex items-center justify-start gap-16 self-stretch">
            {/* [규칙 1] 시맨틱: <div> -> <dt> */}
            <dt className="justify-start text-base font-normal text-black">
              받는사람
            </dt>
            {/* [규칙 1] 시맨틱: <div> -> <dd> */}
            <dd className="flex flex-1 items-center justify-between">
              <span className="w-80 justify-start text-base font-normal text-black">
                이연정 (이연정)
              </span>
              {/* [규칙 1] 시맨틱: <div> -> <button> (원본 클래스 유지) */}
              <button
                type="button"
                data-btn="Secondary"
                data-icon="Off"
                data-size="small"
                data-state="Enabled"
                className="flex h-7 items-center justify-start gap-1 rounded-[3px] bg-white p-2.5 outline-1 outline-offset-[-1px] outline-zinc-400"
              >
                <span className="text-Text-Default-Default justify-start text-center text-xs leading-snug font-normal">
                  변경
                </span>
              </button>
            </dd>
          </div>
          <div className="flex items-center justify-start gap-20">
            {/* [규칙 1] 시맨틱: <div> -> <dt> */}
            <dt className="justify-start text-base font-normal text-black">
              연락처
            </dt>
            {/* [규칙 1] 시맨틱: <div> -> <dd> */}
            <dd className="w-96 justify-start text-base font-normal text-black">
              010-0000-0000
            </dd>
          </div>

          <div className="inline-flex items-center justify-start gap-16">
            {/* [규칙 1] 시맨틱: <div> -> <dt> */}
            <dt className="justify-start text-base font-normal text-black">
              받는주소
            </dt>
            {/* [규칙 1] 시맨틱: <div> -> <dd> */}
            <dd className="justify-start text-base font-normal text-black">
              서울특별시 강북구 도봉로 89길 27(수유동) 4층{" "}
            </dd>
          </div>
          <div className="inline-flex items-center justify-start gap-10">
            {/* [규칙 1] 시맨틱: <div> -> <dt> */}
            <dt className="justify-start text-base font-normal text-black">
              배송요청사항
            </dt>
            {/* [규칙 1] 시맨틱: <div> -> <dd> */}
            <dd className="justify-start text-base font-normal text-black">
              문 앞
            </dd>
          </div>
        </dl>
      </section>

      {/* [규칙 1] 시맨틱: <div> -> <section> */}
      <section className="mb-[35px] flex flex-col items-start justify-start gap-4 self-stretch">
        {/* [규칙 1] 시맨틱: <div> -> <h2> */}
        <h2 className="justify-start self-stretch text-lg font-bold text-black">
          결제 정보
        </h2>
        <div className="flex flex-col items-start justify-start self-stretch">
          <div className="inline-flex items-start justify-between self-stretch border-t-[0.50px] border-stone-900">
            {/* [규칙 1] 시맨틱: <dl> 사용 */}
            <dl className="inline-flex w-96 flex-col items-start justify-start gap-2.5 self-stretch py-3.5">
              <dt className="inline-flex items-center justify-start gap-16">
                <span className="justify-start text-base font-normal text-black">
                  결제수단
                </span>
              </dt>
              <dd className="justify-start self-stretch text-base font-normal text-black">
                나중결제 / 우리은행
              </dd>
              <dd className="justify-start self-stretch text-base font-normal text-black">
                결제일 : 2025/08/15
              </dd>
            </dl>
            {/* [규칙 1] 시맨틱: <dl> 사용 */}
            <dl className="bg-gray-background inline-flex h-28 w-96 flex-col items-start justify-between p-3.5">
              <div className="inline-flex items-start justify-between self-stretch">
                <dt className="justify-start text-base font-normal text-black">
                  총 상품 가격
                </dt>
                <dd className="justify-start text-right text-base font-normal text-black">
                  60,000 원
                </dd>
              </div>
              <div className="inline-flex items-start justify-between self-stretch">
                <dt className="justify-start text-base font-normal text-black">
                  할인금액
                </dt>
                <dd className="justify-start text-right text-base font-normal text-black">
                  42,000 원
                </dd>
              </div>
              <div className="inline-flex items-start justify-between self-stretch">
                <dt className="justify-start text-base font-normal text-black">
                  배송비
                </dt>
                <dd className="justify-start text-right text-base font-normal text-black">
                  2,500 원
                </dd>
              </div>
            </dl>
          </div>
          <div className="border-Color inline-flex items-start justify-end gap-2.5 self-stretch border-t-[0.50px] border-b-[0.50px]">
            {/* [규칙 1] 시맨틱: <dl> 사용 */}
            <dl className="bg-gray-background inline-flex w-96 flex-col items-start justify-start gap-3 p-3.5">
              <div className="inline-flex items-start justify-between self-stretch">
                <dt className="justify-start text-base font-normal text-black">
                  나중결제
                </dt>
                <dd className="justify-start text-right text-base font-normal text-black">
                  20,500 원
                </dd>
              </div>
              <div className="inline-flex items-start justify-between self-stretch">
                <dt className="justify-start text-base font-bold text-black">
                  총 결제금액
                </dt>
                <dd className="justify-start text-right text-base font-bold text-black">
                  20,500 원
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section className="mb-[35px] flex flex-col items-start justify-start gap-4 self-stretch">
        <div className="justify-start self-stretch font-['Pretendard'] text-lg font-bold text-black">
          결제 영수증 정보
        </div>
        <div className="flex items-center justify-between self-stretch border-t-[0.50px] border-stone-900 py-3.5">
          <div className="w-80 justify-start font-['Pretendard'] text-base font-normal text-black">
            해당 주문건에 대해 거래명세서 확인이 가능합니다.
          </div>
          <div
            data-btn="Secondary"
            data-icon="Off"
            data-size="small"
            data-state="Enabled"
            className="flex h-7 items-center justify-start gap-1 rounded-[3px] bg-white p-2.5 outline-1 outline-offset-[-1px] outline-zinc-400"
          >
            <div className="text-Text-Default-Default justify-start text-center font-['Pretendard'] text-xs leading-snug font-normal">
              거래명세서
            </div>
          </div>
        </div>
      </section>
      <section className="flex justify-center gap-2.5">
        <div className="inline-flex items-center justify-center gap-2.5 self-stretch rounded-[5px] bg-white px-4 py-3 outline-1 outline-offset-[-1px] outline-amber-500">
          <button
            type="button"
            className="justify-start font-['Pretendard'] text-sm leading-snug font-medium text-amber-500"
          >
            <Link href="/mypage/orders"> 주문목록 돌아가기</Link>
          </button>
        </div>
        <div className="inline-flex items-center justify-center gap-2.5 self-stretch rounded-[5px] bg-white px-4 py-3 outline-1 outline-offset-[-1px] outline-zinc-400">
          <button
            type="button"
            className="text-Text-Default-Default justify-start text-center font-['Pretendard'] text-sm leading-snug font-normal"
          >
            주문내역 삭제
          </button>
        </div>
      </section>
    </div>
  )
}
