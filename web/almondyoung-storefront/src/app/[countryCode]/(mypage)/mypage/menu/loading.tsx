import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"

export default function Loading() {
  return (
    <MypageLoadingShell title="전체메뉴">
      <div className="space-y-4 px-4 py-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-sm bg-gray-100" />
        ))}
      </div>
    </MypageLoadingShell>
  )
}
