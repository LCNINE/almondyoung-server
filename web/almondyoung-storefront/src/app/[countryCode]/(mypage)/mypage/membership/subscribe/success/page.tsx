import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { CartRefresher } from "./cart-refresher"
import { BackButton } from "./back-button"

export const metadata: Metadata = {
  title: "멤버십 가입 완료",
}

// 멤버십 가입 완료 페이지
export default function MembershipSuccessScreen() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <CartRefresher />
      <div className="mx-auto flex w-full flex-1 flex-col px-6">
        <header className="flex w-full shrink-0 items-center border-b border-gray-200 px-3 py-4 md:px-6 md:py-3">
          <div className="flex-1">
            <BackButton />
          </div>
          <h1 className="flex-1 text-center text-base font-bold text-black">
            멤버십 가입 완료
          </h1>
          {/* 제목을 중앙에 맞추기 위한 오른쪽 스페이서 */}
          <div className="flex-1" />
        </header>

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

              <div className="mx-auto flex gap-4 px-6 py-4">
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
