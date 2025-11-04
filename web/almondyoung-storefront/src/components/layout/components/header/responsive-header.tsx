import { DesktopHeader } from "./desktop-header"
import { MobileHeader } from "./m.main-header"
import { UserBasicInfo } from "@lib/types/ui/user"

interface ResponsiveHeaderProps {
  user: UserBasicInfo | null | undefined
  showBack?: boolean
  showSearch?: boolean
  showCart?: boolean
}

export function ResponsiveHeader({
  user,
  showBack = false,
  showSearch = true,
  showCart = true,
}: ResponsiveHeaderProps) {
  return (
    <>
      {/* 데스크톱 헤더 - md 이상에서만 표시 */}
      <div className="hidden md:block">
        <DesktopHeader user={user} />
      </div>

      {/* 모바일 헤더 - sm에서만 표시 */}
      <div className="block md:hidden">
        <MobileHeader
          user={user}
          showBack={showBack}
          showSearch={showSearch}
          showCart={showCart}
        />
      </div>
    </>
  )
}
