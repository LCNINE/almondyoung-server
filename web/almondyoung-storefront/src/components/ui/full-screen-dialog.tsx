"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@lib/utils"

const FullScreenDialog = DialogPrimitive.Root

const FullScreenDialogTrigger = DialogPrimitive.Trigger

const FullScreenDialogPortal = DialogPrimitive.Portal

const FullScreenDialogClose = DialogPrimitive.Close

const FullScreenDialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
      className
    )}
    {...props}
  />
))
FullScreenDialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const FullScreenDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <FullScreenDialogPortal>
    <FullScreenDialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed inset-x-2 top-2 z-50 flex h-[calc(100dvh_-_1rem)] flex-col overflow-hidden rounded-lg border shadow-lg duration-200 sm:inset-x-4 sm:top-4 sm:h-[calc(100dvh_-_2rem)]",
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </FullScreenDialogPortal>
))
FullScreenDialogContent.displayName = DialogPrimitive.Content.displayName

interface FullScreenDialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  closeLabel?: string
  showCloseButton?: boolean
}

const FullScreenDialogHeader = React.forwardRef<
  HTMLDivElement,
  FullScreenDialogHeaderProps
>(
  (
    {
      className,
      children,
      closeLabel = "Close",
      showCloseButton = true,
      ...props
    },
    ref
  ) => (
    <div
      ref={ref}
      className={cn(
        "border-border flex min-h-14 shrink-0 items-center gap-3 border-b px-4 py-2",
        className
      )}
      {...props}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {showCloseButton && <FullScreenDialogCloseButton label={closeLabel} />}
    </div>
  )
)
FullScreenDialogHeader.displayName = "FullScreenDialogHeader"

const FullScreenDialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-foreground truncate text-base font-semibold",
      className
    )}
    {...props}
  />
))
FullScreenDialogTitle.displayName = DialogPrimitive.Title.displayName

const FullScreenDialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-muted-foreground text-sm", className)}
    {...props}
  />
))
FullScreenDialogDescription.displayName =
  DialogPrimitive.Description.displayName

const FullScreenDialogBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4",
      className
    )}
    {...props}
  />
))
FullScreenDialogBody.displayName = "FullScreenDialogBody"

const FullScreenDialogFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "border-border flex shrink-0 flex-col gap-2 border-t px-4 pt-3 pb-[calc(1rem_+_env(safe-area-inset-bottom))]",
      className
    )}
    {...props}
  />
))
FullScreenDialogFooter.displayName = "FullScreenDialogFooter"

interface FullScreenDialogCloseButtonProps extends Omit<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Close>,
  "asChild" | "children"
> {
  label?: string
}

function FullScreenDialogCloseButton({
  className,
  label = "Close",
  ...props
}: FullScreenDialogCloseButtonProps) {
  return (
    <DialogPrimitive.Close asChild {...props}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("size-11", className)}
        aria-label={label}
      >
        <XIcon />
        <span className="sr-only">{label}</span>
      </Button>
    </DialogPrimitive.Close>
  )
}

export {
  FullScreenDialog,
  FullScreenDialogBody,
  FullScreenDialogClose,
  FullScreenDialogCloseButton,
  FullScreenDialogContent,
  FullScreenDialogDescription,
  FullScreenDialogFooter,
  FullScreenDialogHeader,
  FullScreenDialogOverlay,
  FullScreenDialogPortal,
  FullScreenDialogTitle,
  FullScreenDialogTrigger,
}
