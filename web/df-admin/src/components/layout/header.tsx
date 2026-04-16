import { Link } from "react-router-dom"
import { mainMenus } from "@/lib/menu"
import { cn } from "@/lib/utils"

interface HeaderProps {
  activeMenu: string
  onMenuChange: (menuId: string) => void
}

export function Header({ activeMenu, onMenuChange }: HeaderProps) {
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
    </header>
  )
}
