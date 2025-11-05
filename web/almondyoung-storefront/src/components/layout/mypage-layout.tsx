import React from "react"

import MypageSidebar from "domains/mypage/components/mypage-sidebar"

// URL 기반 페이지 제목 매핑

interface MypageLayoutProps {
  children: React.ReactNode
}

/**
 * ✅ SSR + SEO 대응
 * ✅ 전역 Header 유지
 * ✅ Container 폭 전담 / Inner 여백 분리
 * ✅ 시멘틱 태그 적용
 * ✅ CSS 미디어쿼리 기반 반응형 (조건부 렌더링 없음)
 */
export default function MypageLayout({ children }: MypageLayoutProps) {
  return (
    <main className="md:bg-muted w-full bg-white">
      <div className="container mx-auto max-w-[1360px]">
        <div className="inner md:px-[40px] md:py-10">
          <div className="flex flex-row gap-8">
            <aside className="sidebar hidden w-[280px] flex-shrink-0 lg:block">
              <MypageSidebar />
            </aside>

            <section className="content-area w-full flex-1">{children}</section>
          </div>
        </div>
      </div>
    </main>
  )
}
