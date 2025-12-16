import { ChevronRight } from "lucide-react"
import { MenuItem } from "../../types/mypage-types"
import Link from "next/link"
interface MenuListProps {
  items: MenuItem[]
}

function ListIcon({ children }: { children: React.ReactNode }) {
  return <div className="h-6 w-6 text-2xl text-gray-500">{children}</div>
}

export function MenuList({ items }: MenuListProps) {
  return (
    <nav aria-label="마이페이지 메뉴">
      <ul className="rounded-lg bg-white shadow-sm">
        {items.map((item, index) => (
          <li key={item.label}>
            <Link
              href={item.path}
              className={`hover:bg-gray-10 flex w-full items-center gap-4 p-4 transition-colors ${index > 0 ? "border-muted border-t" : ""}`}
            >
              <ListIcon>{item.icon}</ListIcon>
              <span className="grow text-base text-gray-800">{item.label}</span>
              <ChevronRight className="h-5 w-5" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
