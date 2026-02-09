import React from "react"
import MypageSidebar from "domains/mypage/components/mypage-sidebar"
import { MypageBreadcrumb } from "domains/mypage/components/mypage-breadcrumb"

interface MypageLayoutProps {
  children: React.ReactNode
}

export default function MypageLayout({ children }: MypageLayoutProps) {
  return (
    <main className="md:bg-muted w-full bg-white">
      <div className="container mx-auto max-w-[1360px]">
        <div className="inner md:px-[40px] md:py-10">
          <MypageBreadcrumb />
          <div className="flex flex-row gap-8">
            <aside className="hidden w-[280px] shrink-0 lg:block">
              <MypageSidebar />
            </aside>

            <section className="content-area min-w-0 w-full flex-1">{children}</section>
          </div>
        </div>
      </div>
    </main>
  )
}
