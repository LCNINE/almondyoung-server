import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

const tagVariants = cva(
  "inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "bg-gray-10 text-muted-foreground hover:bg-muted/80 border-gray-20",
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/90 border-primary/20",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/90 border-secondary/20",
      },
      size: {
        default: "h-8 text-sm",
        sm: "h-7 text-xs",
        lg: "h-9 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface TagProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof tagVariants> {
  onRemove?: () => void
}

export const Tag = React.forwardRef<HTMLDivElement, TagProps>(
  ({ className, variant, size, children, onRemove, ...props }, ref) => {
    return (
      <div
        className={tagVariants({ variant, size, className })}
        ref={ref}
        {...props}
      >
        <span className="truncate">{children}</span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="hover:bg-background/20 focus:ring-ring ml-1 inline-flex items-center justify-center rounded-full p-0.5 focus:ring-2 focus:outline-none"
            aria-label="Remove tag"
          >
            <X className="h-3 w-3" size={12} strokeWidth={2.5} />
          </button>
        )}
      </div>
    )
  }
)
