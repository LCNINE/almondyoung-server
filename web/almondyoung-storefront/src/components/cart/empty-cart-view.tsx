import LocalizedClientLink from "../shared/localized-client-link"

interface EmptyCartViewProps {
  showHeader?: boolean
  bgColor?: string
}

export function EmptyCartView({
  showHeader = true,
  bgColor = "bg-white",
}: EmptyCartViewProps) {
  return (
    <div className={`flex min-h-screen w-full flex-col ${bgColor}`}>
      {showHeader && (
        <header className="border-border bg-foreground w-full border-b">
          <div className="container mx-auto flex h-14 items-center px-4">
            <span className="text-background text-lg font-bold tracking-tight">
              ALMOND YOUNG
            </span>
          </div>
        </header>
      )}

      <main className="flex flex-1 flex-col items-center justify-center px-4 sm:px-6">
        <div className="flex w-full max-w-md flex-col items-center">
          <h1 className="mb-3 text-center text-[24px] leading-snug font-semibold tracking-tight text-gray-900 sm:text-[28px] lg:text-[32px]">
            장바구니에 담긴 상품이 없어요
          </h1>
          <p className="mb-8 text-center text-[15px] text-gray-500 sm:mb-10 sm:text-[17px]">
            원하는 상품을 담아보세요
          </p>

          <LocalizedClientLink
            href={"/products"}
            className="rounded-xl bg-[#F29219] px-10 py-4 text-center text-[15px] font-semibold text-white transition-all hover:bg-[#E08510] sm:w-auto sm:text-[17px]"
          >
            상품 담으러 가기
          </LocalizedClientLink>
        </div>
      </main>
    </div>
  )
}
