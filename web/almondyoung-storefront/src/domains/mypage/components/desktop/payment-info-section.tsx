import { ChevronRight } from "lucide-react"

export function PaymentInfoSection() {
  /*
    [규칙 1] 시맨틱 태그: 최상위 <div>를 <section>으로 변경합니다.
    [규칙 2] 컨테이너/이너: <section>은 배경(Container)만 담당합니다.
    [규칙 4] 견고한 UI: 치명적인 고정 높이 'h-44'를 제거합니다.
  */
  return (
    <section className="self-stretch bg-white">
      {/*
        [규칙 2] 이너(Inner) 컨테이너:
        간격(py-6 pl-7)과 자식들의 레이아웃(flex-col, gap-4)을 담당합니다.
        원본의 items-center 대신, 하위 요소들의 정렬(justify-start)을 존중하여
        items-start로 정렬합니다.
      */}

      <div className="flex flex-col items-center justify-center gap-4 py-6 pl-7">
        {/*
          [규칙 1] 시맨틱 태그: 제목 <div>를 <h2>로 변경합니다.
          [규칙 3] 단일 책임: 불필요한 래퍼 <div>를 제거합니다.
          [규칙 4] 견고한 UI: 반복되는 font-['Pretendard']를 제거합니다.
        */}
        <h2 className="text-Labels-Primary text-lg font-bold">
          이번달 결제 금액
        </h2>

        <>
          {/* [규칙 1] 시맨틱 태그: <div>를 <p>로 변경합니다. */}
          <p className="text-sm font-normal text-black">2025.08.15 결제 예정</p>

          {/*
            [규칙 1] 시맨틱 태그: 금액, 통화, 아이콘을 묶는 <p> 태그를 사용합니다.
            내부 텍스트는 <span>으로 분리합니다.
          */}
          <p className="inline-flex items-center justify-center gap-1">
            <span className="text-lg font-bold text-black">300,500</span>
            <span className="text-sm font-normal text-black">원</span>

            <ChevronRight className="h-5 w-5 text-black" />
          </p>
        </>

        {/*
          [규칙 1] 시맨틱 태그: "이용기간"과 날짜는 key-value 쌍이므로
          <dl>(정의 목록), <dt>(용어), <dd>(설명)를 사용하는 것이 가장 적합합니다.
        */}
        <dl className="bg-gray-background inline-flex items-start justify-start gap-7 rounded-[5px] px-3.5 py-1.5">
          <dt className="text-sm font-normal text-black">이용기간</dt>
          <dd className="text-sm font-normal text-black">
            2025.07.01 ~ 2025.07.31
          </dd>
        </dl>
      </div>
    </section>
  )
}
