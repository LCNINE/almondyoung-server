import { Menu } from "lucide-react"

export function CategoryDropdownTrigger() {
  return (
    <>
      <Menu className="h-5 w-5" />
      <span className="text-sm font-medium">카테고리</span>
    </>
  )
}
