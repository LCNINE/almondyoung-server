"use client"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils/ui"
import { Slot } from "@radix-ui/react-slot"
import copy from "copy-to-clipboard"
import { CheckIcon, CopyIcon } from "lucide-react"
import React, { useState } from "react"

type CopyProps = React.HTMLAttributes<HTMLButtonElement> & {
  content: string
  asChild?: boolean
}

const Copy = React.forwardRef<HTMLButtonElement, CopyProps>(
  (
    {
      children,
      className,
      content,
      asChild = false,
      ...props
    }: CopyProps,
    ref
  ) => {
    const [done, setDone] = useState(false)
    const [open, setOpen] = useState(false)
    const [text, setText] = useState("복사하기")

    const copyToClipboard = (
      e:
        | React.MouseEvent<HTMLElement, MouseEvent>
        | React.MouseEvent<HTMLButtonElement, MouseEvent>
    ) => {
      e.stopPropagation()

      setDone(true)
      copy(content)

      setTimeout(() => {
        setDone(false)
      }, 2000)
    }

    React.useEffect(() => {
      if (done) {
        setText("복사됨")
        return
      }

      setTimeout(() => {
        setText("복사하기")
      }, 500)
    }, [done])

    const Component = asChild ? Slot : "button"

    return (
      <Tooltip open={done || open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <Component
            ref={ref}
            aria-label="Copy code snippet"
            type="button"
            className={cn(
              "h-fit w-fit",
              className
            )}
            onClick={copyToClipboard}
            {...props}
          >
            {
              children ? (
                children
              ) : done
                ? <CheckIcon size={16} />
                : <CopyIcon size={16} />
            }
          </Component>
        </TooltipTrigger>
        <TooltipContent>
          { text }
        </TooltipContent>
      </Tooltip>
    )
  }
)
Copy.displayName = "Copy"

export { Copy }