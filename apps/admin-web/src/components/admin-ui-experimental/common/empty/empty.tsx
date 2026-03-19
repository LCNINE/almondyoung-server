import { cn } from "@/lib/utils/cn"

interface EmptyProps {
  message?: string;
  className?: string;
}

export function Empty({ message = "데이터 없음", className }: EmptyProps) {
  return (
    <p className={cn("p-4 text-sm text-muted-foreground text-center", className)}>
      {message}
    </p>
  );
}
