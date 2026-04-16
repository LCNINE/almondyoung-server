import { Copy } from "lucide-react"
import { toast } from "sonner"

export function IdCell({ value }: { value: string }) {
  const short = value.length > 8 ? `${value.slice(0, 8)}...` : value

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(value)
    toast.success("복사됨")
  }

  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
      {short}
      <button
        type="button"
        onClick={handleCopy}
        className="opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100"
      >
        <Copy className="h-3 w-3" />
      </button>
    </span>
  )
}
