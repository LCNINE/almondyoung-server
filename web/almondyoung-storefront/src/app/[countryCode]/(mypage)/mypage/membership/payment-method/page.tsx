import type { Metadata } from "next"

// (아이콘은 실제 프로젝트에서는 @heroicons/react 등을 사용해야 합니다)
// 임시 아이콘 컴포넌트
const IconChevronLeft = () => (
  <svg
    className="h-5 w-5"
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M12.79 5.23a.75.75 0 010 1.06L9.06 10l3.73 3.71a.75.75 0 11-1.06 1.06l-4.25-4.25a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 0z"
      clipRule="evenodd"
    />
  </svg>
)

//  멤버십 회비 결제 수단 관리 페이지
export const metadata: Metadata = {
  title: "멤버십 회비 결제 수단 관리",
}

export default function PaymentMethodScreen() {
  return (
    // PARENT:
    // 화면 전체를 감싸고, 자식(Container)을 수직 배치합니다.
    <div className="flex min-h-screen flex-col bg-white font-['Pretendard']">
      {/* SINGLE CONTAINER:
        - 페이지의 모든 요소를 감싸는 "단일 컨테이너"입니다.
        - 너비(max-w-lg), 중앙 정렬(mx-auto)을 담당합니다.
        - flex-1, flex-col: 자식 요소(header, div.content, footer)를 수직으로 배치하고
          전체 높이를 채웁니다.
      */}
      <div className="mx-auto flex w-full flex-1 flex-col">
        {/* INNER 1 (Header):
            - Container의 자식으로, flex-shrink-0을 통해 높이가 줄어들지 않습니다.
            - px-4: 컨테이너 좌우 패딩(px-6)과 별도로 헤더 패딩을 지정할 수 있습니다.
                   (혹은 컨테이너에 px-6을 주고 여기선 px-0을 사용)
                   여기서는 일관성을 위해 px-6을 사용합니다.
        */}
        <header className="flex w-full shrink-0 items-center border-b border-gray-200 px-3 py-4 md:px-6 md:py-3">
          <div className="flex-1">
            <button aria-label="뒤로 가기" className="-m-2 p-2 text-black">
              <IconChevronLeft />
            </button>
          </div>
          <h1 className="flex-1 text-center text-base font-bold text-black">
            멤버십 회비 결제 수단 관리
          </h1>
          {/* 제목을 중앙에 맞추기 위한 오른쪽 스페이서 */}
          <div className="flex-1" />
        </header>

        {/* INNER 2 (Content Area):
            - 'flex-1': Header와 Footer를 제외한 모든 남은 공간을 차지합니다.
            - 'overflow-y-auto': 콘텐츠가 많아지면 이 영역만 스크롤됩니다.
            - 'px-6 py-8': 콘텐츠의 좌우, 상하 여백을 지정합니다.
        */}
        <div className="flex-1 overflow-y-auto px-6 py-8">
          {/* 콘텐츠 Inner */}
          <div className="flex flex-col gap-8">
            {/* 현재 결제 수단 */}
            <section aria-labelledby="primary-method-title">
              <h2
                id="primary-method-title"
                className="text-xs leading-4 font-bold text-black"
              >
                멤버십 회비 결제수단
              </h2>
              <div className="mt-2 flex flex-col gap-1">
                <p className="text-xs leading-4 text-gray-800">
                  하나 BC카드 하나 바로카드
                </p>
                <p className="font-['Inter'] text-base font-semibold text-black">
                  454525******212*
                </p>
              </div>
            </section>

            {/* 안내 문구 */}
            <section aria-label="결제 안내">
              <p className="text-xs leading-relaxed font-medium text-gray-600">
                매월 7일 결제되며, 해당 날짜가 없는 달에는 말일에 결제됩니다.
                (예, 29일,30일,31일)
                <br />
                결제 실패 시, 결제 수단 목록 순서대로 결제를 시도합니다.
              </p>
            </section>

            {/* 다른 결제 수단 목록 */}
            {/* - flex-col sm:flex-row: 모바일에서는 수직, 데스크탑(sm)에서는 수평 배치
              - sm:items-center sm:justify-between: 수평 배치 시 정렬
            */}
            <section
              aria-label="다른 결제 수단"
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-3 rounded-md bg-gray-100 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs leading-4 font-medium text-gray-700">
                    우리은행 계좌
                  </p>
                  <p className="text-xs leading-4 text-black">
                    1239-*******-****23
                  </p>
                </div>
                <button className="shrink-0 rounded-sm border border-gray-400 bg-white px-2.5 py-1.5 text-xs leading-4 font-normal text-black shadow-sm transition-colors hover:bg-gray-50">
                  멤버십 회비 결제수단으로 변경
                </button>
              </div>
              {/* (다른 결제 수단이 있다면 여기에 추가) */}
            </section>
          </div>
        </div>

        {/* INNER 3 (Footer / Nav):
            - 'flex-shrink-0': 높이가 줄어들지 않습니다.
            - 'w-full': Container의 너비를 따릅니다 (max-w-lg).
        */}
        <footer className="w-full shrink-0">
          {/* CTA 버튼 영역 */}
          <div className="border-t border-gray-200 bg-white p-4">
            <button className="w-full rounded-md bg-amber-500 px-4 py-3 text-center text-sm leading-5 font-semibold text-white transition-colors hover:bg-amber-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600">
              새로운 결제수단 등록하기
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
