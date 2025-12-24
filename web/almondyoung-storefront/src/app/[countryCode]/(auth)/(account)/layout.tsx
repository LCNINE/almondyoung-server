export default async function Layout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="grid md:grid-cols-[1fr_1fr] lg:grid-cols-[3fr_2fr]">
      {/* 왼쪽 영역 - 60% (고정) */}
      <div className="relative hidden items-center justify-center bg-gradient-to-br from-[#FFA500] to-[#FFD97D] md:sticky md:top-0 md:flex md:h-screen">
        <div className="flex flex-wrap items-center justify-center gap-6 px-12">
          {/* 아이콘 */}
          <div className="shrink-0">
            <img
              src="/images/cart-icon.png"
              alt="cart icon"
              className="h-[186px] w-[186px] object-contain md:h-[199px] md:w-[199px]"
            />
          </div>

          {/* 텍스트 컨테이너 */}
          <div>
            {/* 타이틀 */}
            <h2 className="text-gray-90 text-[30px] leading-[38px] font-extrabold tracking-[-0.02em] md:text-[40px] md:leading-[50px]">
              최저가로! 빠르게! <br />
              미용 전문 재료를 <br />
              아몬드영 한 곳에서
            </h2>

            {/* 서브타이틀 */}
            <p className="text-gray-80 mt-4 text-lg md:text-base">
              최저가 미용재료 MRO 쇼핑몰
            </p>
          </div>
        </div>
      </div>

      {/* 오른쪽 영역 - 40% (스크롤 가능) */}
      <div className="bg-gray-0 overflow-x-hidden">
        <div className="flex h-full flex-col">
          <div className="flex h-full items-center justify-center px-4 py-8 sm:px-6 md:px-8 lg:px-12">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
