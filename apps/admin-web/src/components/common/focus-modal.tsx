'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils/ui';

const FocusModal = DialogPrimitive.Root;
FocusModal.displayName = 'FocusModal';

const FocusModalTrigger = DialogPrimitive.Trigger;
FocusModalTrigger.displayName = 'FocusModal.Trigger';

const FocusModalClose = DialogPrimitive.Close;
FocusModalClose.displayName = 'FocusModal.Close';

const FocusModalPortal = DialogPrimitive.Portal;
FocusModalPortal.displayName = 'FocusModal.Portal';

const FocusModalOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/50',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
FocusModalOverlay.displayName = 'FocusModal.Overlay';

const FocusModalContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    overlayProps?: React.ComponentPropsWithoutRef<typeof FocusModalOverlay>;
    portalProps?: React.ComponentPropsWithoutRef<typeof FocusModalPortal>;
  }
>(({ className, children, overlayProps, portalProps, ...props }, ref) => (
  <FocusModalPortal {...portalProps}>
    <FocusModalOverlay {...overlayProps} />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'bg-background fixed inset-8 z-50 flex flex-col overflow-hidden rounded-lg border shadow-lg outline-none',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        'duration-200',
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </FocusModalPortal>
));
FocusModalContent.displayName = 'FocusModal.Content';

const FocusModalHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex items-center justify-between border-b px-4 py-3',
      className,
    )}
    {...props}
  >
    <DialogPrimitive.Close className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
      <XIcon className="size-4" />
      <span className="text-xs">esc</span>
    </DialogPrimitive.Close>
    {children}
  </div>
));
FocusModalHeader.displayName = 'FocusModal.Header';

const FocusModalBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex-1 overflow-auto', className)} {...props} />
));
FocusModalBody.displayName = 'FocusModal.Body';

const FocusModalFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center justify-end gap-2 border-t p-4', className)}
    {...props}
  />
));
FocusModalFooter.displayName = 'FocusModal.Footer';

const FocusModalTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-sm font-semibold', className)}
    {...props}
  />
));
FocusModalTitle.displayName = 'FocusModal.Title';

const FocusModalDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
FocusModalDescription.displayName = 'FocusModal.Description';

export {
  FocusModal,
  FocusModalTrigger,
  FocusModalClose,
  FocusModalContent,
  FocusModalOverlay,
  FocusModalPortal,
  FocusModalHeader,
  FocusModalBody,
  FocusModalFooter,
  FocusModalTitle,
  FocusModalDescription,
};
