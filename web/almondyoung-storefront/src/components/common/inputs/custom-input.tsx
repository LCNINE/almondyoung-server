import * as React from "react"

import { cn } from "@lib/utils"
import AlertIcon from "icons/light-icon"
import ClearIcon from "../../../icons/clear-icon"

export interface CustomInputProps extends React.ComponentProps<"input"> {
  error?: boolean
  hasValue: boolean
  icon?: React.ReactNode
  onClear: () => void
}

const CustomInput = React.forwardRef<HTMLInputElement, CustomInputProps>(
  ({ className, type, error, hasValue, onClear, icon, ...props }, ref) => {
    return (
      <div className="relative">
        <input
          type={type}
          className={cn(
            "border-input border-b-gray-40 bg-gray-10 file:text-foreground placeholder:text-gray-40 focus-visible:ring-yellow-30 hover:border-b-yellow-30 flex h-9 w-full border border-b-1 px-3 py-1 pr-8 text-base transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-xs focus-visible:border-b-0 focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            error &&
              "border-destructive focus-visible:border-input hover:border-b-destructive",
            className
          )}
          ref={ref}
          {...props}
        />

        {!hasValue && icon && !error && (
          <div className="absolute top-1/2 right-2 flex h-4 w-4 -translate-y-1/2 items-center justify-center">
            {icon}
          </div>
        )}

        {/* 엑스 버튼  */}
        {hasValue && !error && (
          <button
            type="button"
            onClick={onClear}
            className="focus:ring-yellow-20 absolute top-1/2 right-2 flex h-4 w-4 -translate-y-1/2 cursor-pointer items-center justify-center transition-opacity hover:opacity-80 focus:ring-2 focus:outline-none"
            aria-label="입력 지우기"
            tabIndex={-1}
          >
            <ClearIcon className="text-gray-40 h-4 w-4 hover:text-gray-600" />
          </button>
        )}

        {/* 에러 아이콘 */}
        {error && (
          <div className="absolute top-1/2 right-2 flex h-4 w-4 -translate-y-1/2 items-center justify-center">
            <AlertIcon className="text-red-30 h-4 w-4" />
          </div>
        )}
      </div>
    )
  }
)
CustomInput.displayName = "CustomInput"

export { CustomInput }
