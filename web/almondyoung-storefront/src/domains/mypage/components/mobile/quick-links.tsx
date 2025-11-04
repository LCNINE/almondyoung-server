import { QuickLink } from "../../types/mypage-types"

interface QuickLinksProps {
  links: QuickLink[]
}

function MenuIcon({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-orange-100 text-2xl">
      {children}
    </div>
  )
}

export function QuickLinks({ links }: QuickLinksProps) {
  return (
    <nav aria-label="빠른 메뉴">
      <ul className="grid grid-cols-4 gap-3 rounded-lg bg-white p-4 shadow-sm">
        {links.map((link) => (
          <li key={link.label}>
            <a
              href="#"
              className="flex flex-col items-center gap-2 text-center"
            >
              <MenuIcon>{link.icon}</MenuIcon>
              <span className="text-sm font-medium text-gray-700">
                {link.label}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
