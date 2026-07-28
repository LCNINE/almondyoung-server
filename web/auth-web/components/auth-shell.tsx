import { cn } from "@/lib/utils"

/**
 * 인증 화면 공통 셸.
 *
 * - 모바일: 화면을 꽉 채우고 하단 CTA 는 `mt-auto` 로 바닥에 붙는다.
 * - 데스크톱(sm~): 카드로 묶어 화면 세로 중앙에 띄운다. 뷰포트가 세로로 길 때
 *   요소들이 위아래로 벌어져 붕 떠 보이는 것을 막는다.
 *
 * 내부에서 `flex-1` / `mt-auto` 가 계속 동작하도록, 데스크톱에서도 최소 높이를 준다.
 */
export function AuthShell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className="flex min-h-svh flex-col items-center sm:justify-center sm:bg-muted sm:p-6">
      <main
        className={cn(
          "flex w-full max-w-[480px] flex-1 flex-col gap-6 px-4 py-10",
          "sm:min-h-[600px] sm:flex-none sm:rounded-2xl sm:border sm:border-border sm:bg-background sm:p-8 sm:shadow-[0_2px_10px_rgba(0,0,0,0.1)]",
          className
        )}
      >
        {children}
      </main>
    </div>
  )
}
