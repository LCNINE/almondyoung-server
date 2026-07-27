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

const CHECK_CLASS =
  "size-5 rounded-full data-[state=checked]:border-transparent data-[state=checked]:bg-transparent data-[state=checked]:text-primary"

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
        {agreements.map((agreement) => (
          <AgreementRow
            key={agreement.id}
            agreement={agreement}
            checked={!!checked[agreement.id]}
            onCheckedChange={(v) => setOne(agreement.id, v)}
          />
        ))}
      </ul>

      <div className="mt-auto flex flex-col gap-4 pt-4">
        <label className="flex cursor-pointer items-center gap-3">
          <Checkbox
            checked={allChecked}
            onCheckedChange={(v) => setAll(v === true)}
            className={CHECK_CLASS}
            aria-label="전체 동의"
          />
          <span className="text-base font-bold">
            아래 내용을 모두 확인하였으며, 모두 동의합니다
          </span>
        </label>

        <Button
          type="button"
          onClick={submit}
          disabled={!requiredOk}
          className="h-13 rounded-xl text-base font-bold"
        >
          다음
        </Button>
      </div>
    </div>
  )
}

function AgreementRow({
  agreement,
  checked,
  onCheckedChange,
}: {
  agreement: Agreement
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <li className="flex items-center gap-3 py-3.5">
      <label className="flex flex-1 cursor-pointer items-center gap-3">
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
            className="h-auto shrink-0 px-1 py-0 text-sm text-muted-foreground underline underline-offset-4"
            onClick={() => setOpen(true)}
          >
            보기
          </Button>
          <DialogContent className="max-h-[85vh] gap-4 sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-left">{agreement.name}</DialogTitle>
            </DialogHeader>
            <ScrollArea className="h-[60vh] pr-4">
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
                className="h-[52px] w-full rounded-xl text-base font-bold"
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
