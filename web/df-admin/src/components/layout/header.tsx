import { Link, useNavigate } from "react-router-dom"
import { LogOut } from "lucide-react"
import { mainMenus } from "@/lib/menu"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/features/auth/auth-context-internal"

interface HeaderProps {
  activeMenu: string
  onMenuChange: (menuId: string) => void
}

export function Header({ activeMenu, onMenuChange }: HeaderProps) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate("/login", { replace: true })
  }

  return (
    <header className="flex h-12 items-center border-b bg-background px-4">
      <nav className="flex items-center gap-1">
        {mainMenus.map((menu) => (
          <Link
            key={menu.id}
            to={menu.defaultPath ?? "#"}
            onClick={() => onMenuChange(menu.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
              activeMenu === menu.id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground",
            )}
          >
            {menu.title}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        {user && (
          <span className="text-sm text-muted-foreground">
            {user.nickname ?? user.username ?? user.loginId}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          className="gap-1.5"
        >
          <LogOut className="h-4 w-4" />
          로그아웃
        </Button>
      </div>
    </header>
  )
}
