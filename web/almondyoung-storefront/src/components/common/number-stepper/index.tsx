"use client"

import { Button } from "@components/common/ui/button"
import { Input } from "@components/common/ui/input"
import { useState } from "react"
import { CustomButton } from "../custom-buttons"

interface NumberStepperProps {
  yearsOperating: number
  increment: () => void
  decrement: () => void
  setValue: (value: number) => void
}

export function NumberStepper({
  yearsOperating,
  increment,
  decrement,
  setValue,
}: NumberStepperProps) {
  return (
    <div className="flex items-center">
      {/* 왼쪽 버튼 */}
      <Button
        variant="outline"
        size="icon"
        type="button"
        onClick={decrement}
        className="hover:text-gray-90 cursor-pointer rounded-none border-r-0 hover:bg-transparent"
      >
        -
      </Button>

      {/* 인풋 */}
      <Input
        type="string"
        value={yearsOperating}
        onChange={(e) => setValue(Number(e.target.value))}
        className="border-gray-30 w-12 rounded-none border text-center"
      />

      {/* 오른쪽 버튼 */}
      <Button
        variant="outline"
        size="icon"
        type="button"
        onClick={increment}
        className="hover:text-gray-90 cursor-pointer rounded-none border-l-0 hover:bg-transparent"
      >
        +
      </Button>
    </div>
  )
}
