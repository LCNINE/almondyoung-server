"use client"

import { Checkbox } from "@components/common/ui/checkbox"
import { Label } from "@components/common/ui/label"
import { AgreementDrawer } from "./agreement-drawer"

interface AgreementItemProps {
  id: string
  name: string
  content?: string | null
  checked: boolean
  onChange: (checked: boolean) => void
  children?: Array<{
    id: string
    name: string
    checked: boolean
    onChange: (checked: boolean) => void
  }>
}

export function AgreementItem({
  id,
  name,
  content,
  checked,
  onChange,
  children,
}: AgreementItemProps) {
  return (
    <div className="flex flex-col">
      {/* 메인 약관 */}
      <div className="flex h-5 items-center justify-between">
        <div className="flex items-center gap-1">
          <Checkbox
            id={id}
            className="h-3.5 w-3.5"
            checked={checked}
            onCheckedChange={(checked) => onChange(checked as boolean)}
          />
          <Label htmlFor={id} className="text-xs">
            {name}
          </Label>
        </div>

        {/* 약관 내용 보기 버튼 */}
        {content && (
          <AgreementDrawer
            title={name}
            content={content}
            onCheckedChange={() => onChange(true)}
          />
        )}
      </div>

      {/* 하위 약관들 */}
      {children && children.length > 0 && (
        <ul className="ml-5">
          {children.map((child) => (
            <li className="mt-1 flex h-5 items-center gap-1" key={child.id}>
              <Checkbox
                id={child.id}
                className="h-3.5 w-3.5"
                checked={child.checked}
                onCheckedChange={(checked) =>
                  child.onChange(checked as boolean)
                }
              />
              <Label htmlFor={child.id} className="text-xs leading-5">
                {child.name}
              </Label>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
