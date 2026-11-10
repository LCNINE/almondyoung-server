"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { agreements, type Agreement } from "@/lib/data/agreements"
import type { StepValues } from "@/components/signup/types"
import { cn } from "@/lib/utils"

const CHECK_CLASS =
  "size-5 rounded-full text-primary data-[state=checked]:border-transparent data-[state=checked]:bg-transparent data-[state=checked]:text-primary"

export function AgreementsStep({
  defaultValues,
  onNext,
}: {
  defaultValues: StepValues
  onNext: (values: StepValues) => void
}) {
  const [checked, setChecked] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      agreements.map((a) => [a.id, defaultValues[a.id] === "on"])
    )
  )

  const allChecked = agreements.every((a) => checked[a.id])
  const requiredOk = agreements.every((a) => !a.required || checked[a.id])

  const setOne = (id: string, value: boolean) =>
    setChecked((prev) => ({ ...prev, [id]: value }))

  const setAll = (value: boolean) =>
    setChecked(Object.fromEntries(agreements.map((a) => [a.id, value])))

  const submit = () =>
    onNext(
      Object.fromEntries(
        agreements.map((a) => [a.id, checked[a.id] ? "on" : ""])
      )
    )

  return (
    <div className="flex flex-1 flex-col gap-6">
      <ul className="flex flex-col">
        {agreements.map((agreement, i) => (
          <AgreementRow
            key={agreement.id}
            agreement={agreement}
            // 필수와 선택 사이만 띄워 두 묶음으로 읽히게 한다
            startsGroup={
              i > 0 && agreements[i - 1].required !== agreement.required
            }
            checked={!!checked[agreement.id]}
            onCheckedChange={(v) => setOne(agreement.id, v)}
          />
        ))}
      </ul>

      <label className="flex min-h-11 cursor-pointer items-center gap-3 border-t border-border pt-4">
        <Checkbox
          checked={allChecked}
          onCheckedChange={(v) => setAll(v === true)}
          className={CHECK_CLASS}
          aria-label="전체 동의"
        />
        <span className="text-base font-bold">
          위 내용을 모두 확인했으며, 모두 동의해요
        </span>
      </label>

      <Button
        type="button"
        onClick={submit}
        disabled={!requiredOk}
        className="mt-auto h-13 rounded-lg text-base font-bold"
      >
        다음
      </Button>
    </div>
  )
}

function AgreementRow({
  agreement,
  startsGroup,
  checked,
  onCheckedChange,
}: {
  agreement: Agreement
  startsGroup: boolean
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <li className={cn("flex items-center gap-3 py-1", startsGroup && "mt-4")}>
      <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => onCheckedChange(v === true)}
          className={CHECK_CLASS}
        />
        <span className="text-sm">{agreement.name}</span>
      </label>

      {agreement.content && (
        <Dialog open={open} onOpenChange={setOpen}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-mr-2 h-11 min-w-11 shrink-0 px-2 text-sm text-muted-foreground underline underline-offset-4"
            onClick={() => setOpen(true)}
          >
            보기
          </Button>
          <DialogContent className="max-h-[85svh] gap-4 sm:max-w-2xl [&>[data-slot=dialog-close]]:size-11">
            <DialogHeader>
              <DialogTitle className="pr-10 text-left leading-snug">
                {agreement.name}
              </DialogTitle>
            </DialogHeader>
            <ScrollArea className="h-[min(50svh,24rem)] pr-4">
              <div className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {agreement.content}
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button
                type="button"
                onClick={() => {
                  onCheckedChange(true)
                  setOpen(false)
                }}
                className="h-[52px] w-full rounded-lg text-base font-bold"
              >
                확인
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </li>
  )
}
