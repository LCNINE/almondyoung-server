import { Settings, X } from "lucide-react"

interface MobileHeaderProps {
  userName: string
}

export function MobileHeader({ userName }: MobileHeaderProps) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">{userName} 님</h1>
        <button aria-label="설정">
          <Settings className="h-6 w-6" />
        </button>
      </div>
      <button aria-label="닫기">
        <X className="h-6 w-6" />
      </button>
    </header>
  )
}
