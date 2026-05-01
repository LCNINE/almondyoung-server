import { Card, CardContent } from "@components/common/ui/card"
import { cn } from "@lib/utils"

interface EmptyStateProps {
  message: string
  className?: string
  contentClassName?: string
  action?: React.ReactNode
}

// 비어있는 상태를 표시하는 컴포넌트
export default function EmptyState({
  message,
  className,
  contentClassName,
  action,
}: EmptyStateProps) {
  return (
    <Card className={cn("bg-gray-10 border-none shadow-none", className)}>
      <CardContent className={cn("p-4 md:p-6", contentClassName)}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-sm md:text-base">
            {message}
          </p>
          {action}
        </div>
      </CardContent>
    </Card>
  )
}
