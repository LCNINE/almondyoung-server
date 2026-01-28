/**
 * v0 by Vercel.
 * @see https://v0.app/t/201LHGOvdM8
 * Documentation: https://v0.app/docs#integrating-generated-code-into-your-nextjs-app
 */
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@components/ui/select"

interface CustomDropdownProps {
  items: { id: string; label: string }[]
  defaultValue?: string
  onSelect?: (value: string) => void
}

export default function CustomDropdown({
  items,
  defaultValue,
  onSelect,
}: CustomDropdownProps) {
  const selectedItem = items.find((item) => item.id === defaultValue) || items[0]

  return (
    <Select defaultValue={defaultValue || items[0]?.id} onValueChange={onSelect}>
      <SelectTrigger className="h-10 border-none px-0 font-['Pretendard'] text-sm font-medium text-gray-700 shadow-none focus:ring-0">
        <SelectValue placeholder={selectedItem?.label}>
          {selectedItem?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="font-['Pretendard'] text-sm">
        {items.map((item) => (
          <SelectItem
            key={item.id}
            value={item.id}
            className="font-medium text-gray-700 data-[highlighted]:bg-amber-500"
          >
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
