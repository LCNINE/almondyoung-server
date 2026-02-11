import type { Metadata } from "next"
import Image from "next/image" // Next.js Image 컴포넌트 사용
import Link from "next/link"
import MembershipStatusSync from "./membership-status-sync"

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

export const metadata: Metadata = {
  title: "멤버십 가입 완료",
}

// 멤버십 가입 완료 페이지
export default function MembershipSuccessScreen() {
  return (
    // PARENT:
    // 화면 전체를 감싸고, 자식(Container)을 수직 배치합니다.
    <div className="flex min-h-screen flex-col bg-white">
      <MembershipStatusSync />
      {/* SINGLE CONTAINER:
        - 페이지의 모든 요소를 감싸는 "단일 컨테이너"입니다.
        - 너비(max-w-lg), 중앙 정렬(mx-auto), 좌우 패딩(px-6)을 담당합니다.
        - flex-1, flex-col: 자식 요소(header, div.content, footer)를 수직으로 배치합니다.
      */}
      <div className="mx-auto flex w-full flex-1 flex-col px-6">
        {/* INNER 1 (Header):
            - Container의 자식으로, flex-shrink-0을 통해 높이가 줄어들지 않습니다.
            - Container의 px-6를 사용하므로, 여기서는 수직 패딩(py-3)만 적용합니다.
        */}
        <header className="flex w-full shrink-0 items-center border-b border-gray-200 px-3 py-4 md:px-6 md:py-3">
          <div className="flex-1">
            <button aria-label="뒤로 가기" className="-m-2 p-2 text-black">
              <IconChevronLeft />
            </button>
          </div>
          <h1 className="flex-1 text-center text-base font-bold text-black">
            결제수단 관리
          </h1>
          {/* 제목을 중앙에 맞추기 위한 오른쪽 스페이서 */}
          <div className="flex-1" />
        </header>

        {/* INNER 2 (Content Area):
            - 'flex-1': Header와 Footer를 제외한 모든 남은 공간을 차지합니다.
            - 'overflow-y-auto': 콘텐츠가 많아지면 이 영역만 스크롤됩니다.
            - 'py-10': 콘텐츠의 상하 여백을 지정합니다.
        */}
        <div className="flex-1 py-10">
          {/* 콘텐츠 Inner */}
          <div className="flex flex-col gap-12">
            {/* 1. 환영 메시지 */}
            <section
              aria-labelledby="welcome-title"
              className="flex flex-col items-center gap-4 text-center"
            >
              <Image
                className="h-20 w-20" // rotate-180 제거
                src="https://placehold.co/80x80"
                alt="축하 아이콘"
                width={80}
                height={80}
              />
              <h2
                id="welcome-title"
                className="text-3xl leading-snug text-black"
              >
                축하합니다!
                <br />
                <span className="font-bold">아몬드영 멤버십</span>이
                <br />
                시작되었습니다.
              </h2>
            </section>

            {/* 2. 추천 링크 (가로 스크롤) */}
            <section aria-labelledby="recommend-links-title">
              <h3 id="recommend-links-title" className="sr-only">
                멤버십 추천 링크
              </h3>

              {/* - overflow-x-auto: 모바일에서 가로 스크롤을 활성화합니다.
                - -mx-6 px-6: 컨테이너의 패딩을 무시하고 좌우 끝까지 스크롤 영역을 확장합니다.
              */}
              <div className="mx-auto flex gap-4 px-6 py-4">
                {/* - flex-shrink-0: 아이템이 부모 너비에 맞춰 줄어들지 않도록 고정.
                  - w-32: 카드의 너비를 고정합니다.
                */}
                <a
                  href="#"
                  className="flex w-32 shrink-0 flex-col gap-4 rounded-lg border border-gray-300 p-3.5"
                >
                  <p className="text-base leading-5 font-medium text-black">
                    100원 웰컴딜
                    <br />
                    둘러보기
                  </p>
                  <Image
                    className="h-28 w-full rounded object-cover"
                    src="https://placehold.co/111x111"
                    alt=""
                    width={111}
                    height={111}
                  />
                </a>

                <a
                  href="#"
                  className="flex w-32 shrink-0 flex-col gap-4 rounded-lg border border-gray-300 p-3.5"
                >
                  <p className="text-base leading-5 font-medium text-black">
                    멤버십 전용 상품
                    <br />
                    둘러보기
                  </p>
                  <Image
                    className="h-28 w-full rounded object-cover"
                    src="https://placehold.co/111x111"
                    alt=""
                    width={111}
                    height={111}
                  />
                </a>

                <a
                  href="#"
                  className="flex w-32 shrink-0 flex-col gap-9 rounded-lg border border-gray-300 p-3.5"
                >
                  <p className="text-base leading-5 font-medium text-black">
                    다뷰 다운로드
                  </p>
                  <Image
                    className="h-28 w-full rounded object-cover"
                    src="https://placehold.co/111x111"
                    alt=""
                    width={111}
                    height={111}
                  />
                </a>
              </div>
            </section>
          </div>
        </div>

        {/* INNER 3 (Footer CTA):
            - 바텀 네비게이션은 요청대로 제거했습니다.
            - 'flex-shrink-0': 높이가 줄어들지 않습니다.
            - Container의 px-6 내부에 있으므로 py-4(수직 패딩)만 적용합니다.
        */}
        <footer className="w-full shrink-0 border-t border-gray-200 bg-white py-4">
          <Link
            href="/"
            className="block w-full rounded-md bg-amber-500 px-4 py-3 text-center text-sm leading-5 font-semibold text-white transition-colors hover:bg-amber-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
          >
            쇼핑 계속하기
          </Link>
        </footer>
      </div>
    </div>
  )
}
