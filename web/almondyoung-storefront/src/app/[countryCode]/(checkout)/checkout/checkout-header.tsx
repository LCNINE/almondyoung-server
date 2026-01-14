export default function CheckoutHeader({ title }: { title: string }) {
  return (
    // <header> 태그: 페이지의 머리말
    <header className="flex w-full items-center justify-center self-stretch bg-white px-10 py-5 shadow-sm">
      {/* 중앙 정렬을 위한 래퍼. 
        `absolute` 대신 `relative` 컨테이너와 `justify-center`를 사용.
      */}
      <div className="relative flex w-full max-w-6xl items-center justify-center">
        {/* 로고는 홈으로 가는 링크여야 함 */}
        <a href="/" className="absolute top-1/2 left-0 -translate-y-1/2">
          <img
            src="/images/almond-logo-black.png"
            className="h-[29px] w-[218px] object-contain"
            alt="아몬드 로고"
          />
        </a>
        <p className="text-2xl font-bold text-black">{title}</p>
      </div>
    </header>
  )
}
