// src/components/ui/input.tsx
import * as React from "react"
import { cn } from "@/lib/utils/ui"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // 기본 스타일
        "flex h-8 w-full min-w-0 items-center",
        "px-2 gap-1",
        "bg-white rounded-md border-0",
        "shadow-[0px_1px_2px_rgba(0,0,0,0.12),0px_0px_0px_1px_rgba(0,0,0,0.08)]",
        // 텍스트 스타일
        "text-[13px] leading-5 font-normal",
        "text-gray-900",
        "placeholder:text-[#71717A]",
        // 포커스 스타일
        "outline-none",
        "focus:shadow-[0px_1px_2px_rgba(0,0,0,0.12),0px_0px_0px_2px_rgba(0,0,0,0.12)]",
        "focus:ring-0",
        // hover 스타일
        "hover:shadow-[0px_1px_2px_rgba(0,0,0,0.12),0px_0px_0px_1px_rgba(0,0,0,0.12)]",
        // disabled 스타일
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        // 파일 인풋
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        // selection 스타일
        "selection:bg-blue-100 selection:text-gray-900",
        // 트랜지션
        "transition-shadow",
        className
      )}
      {...props}
    />
  )
}

export { Input }