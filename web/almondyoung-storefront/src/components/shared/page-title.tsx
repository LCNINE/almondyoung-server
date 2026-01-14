"use client"

interface PageTitleProps {
  children: React.ReactNode
}

export function PageTitle({ children }: PageTitleProps) {
  return (
    <>
      {/* 데스크탑: 큰 제목만 */}
      <div className="hidden bg-white pt-5 pb-4 md:block">
        <h1 className="text-[28px] font-bold text-[#1A1A1A]">{children}</h1>
      </div>
    </>
  )
}
