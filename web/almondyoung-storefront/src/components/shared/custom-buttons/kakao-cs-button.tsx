"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface KakaoCsButtonProps {
  className?: string
}

export function KakaoCsButton({ className = "" }: KakaoCsButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href="https://pf.kakao.com/_xaxgxazs"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="카카오톡 상담"
            className={`mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-[#FEE500] shadow-lg transition-opacity hover:opacity-80 sm:h-14 sm:w-14 ${className}`}
          >
            <svg
              className="h-5 w-5 sm:h-7 sm:w-7"
              viewBox="0 0 256 256"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M128 36C70.562 36 24 72.713 24 118c0 29.279 19.466 54.97 48.748 69.477-1.593 5.494-10.237 35.344-10.581 37.689 0 0-.207 1.762.934 2.434 1.14.672 2.479.156 2.479.156 3.267-.457 37.843-24.926 43.854-29.18A163.3 163.3 0 00128 200c57.438 0 104-36.712 104-82S185.438 36 128 36z"
                fill="#3C1E1E"
              />
            </svg>
          </a>
        </TooltipTrigger>
        <TooltipContent side="left">고객센터</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
