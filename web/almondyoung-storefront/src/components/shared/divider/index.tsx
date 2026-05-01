import { cn } from "@/lib/utils"

const Divider = ({ className }: { className?: string }) => (
  <div className={cn("mt-1 h-px w-full border-b border-gray-200", className)} />
)

export default Divider
