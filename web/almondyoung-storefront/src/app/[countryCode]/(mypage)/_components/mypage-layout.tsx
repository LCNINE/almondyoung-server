import React from "react"
import MypageSidebar from "domains/mypage/components/mypage-sidebar"
import { MypageBreadcrumb } from "domains/mypage/components/mypage-breadcrumb"

interface MypageLayoutProps {
  children: React.ReactNode
}

export default function MypageLayout({ children }: MypageLayoutProps) {
  return (
    <main className="w-full bg-white">
      <div className="container mx-auto max-w-[1360px]">
        <div className="inner md:px-[40px] md:py-10">
          <MypageBreadcrumb />
          <div className="flex flex-row gap-8">
            <aside className="hidden w-[280px] shrink-0 lg:block">
              <div className="sticky top-10">
                <MypageSidebar />
              </div>
            </aside>

            <section className="content-area w-full min-w-0 flex-1">
              {children}
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
