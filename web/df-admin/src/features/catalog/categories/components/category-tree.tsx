import { ChevronRight, Folder, FolderOpen } from "lucide-react"
import type { CategoryTreeNode } from "@/lib/types/catalog"
import { cn } from "@/lib/utils"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { useState } from "react"

type CategoryTreeProps = {
  nodes: CategoryTreeNode[]
  selectedId?: string
  onSelect: (node: CategoryTreeNode) => void
}

export function CategoryTree({ nodes, selectedId, onSelect }: CategoryTreeProps) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => (
        <CategoryTreeItem
          key={node.id}
          node={node}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

function CategoryTreeItem({
  node,
  selectedId,
  onSelect,
}: {
  node: CategoryTreeNode
  selectedId?: string
  onSelect: (node: CategoryTreeNode) => void
}) {
  const [open, setOpen] = useState(false)
  const hasChildren = node.children && node.children.length > 0
  const isSelected = selectedId === node.id

  if (hasChildren) {
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-accent"
            >
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  open && "rotate-90",
                )}
              />
            </button>
          </CollapsibleTrigger>
          <button
            type="button"
            onClick={() => onSelect(node)}
            className={cn(
              "flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
              isSelected && "bg-accent font-medium",
            )}
          >
            {open ? (
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Folder className="h-4 w-4 text-muted-foreground" />
            )}
            {node.name}
            {!node.visible && (
              <span className="text-xs text-muted-foreground">(숨김)</span>
            )}
          </button>
        </div>
        <CollapsibleContent>
          <div className="ml-4 border-l pl-2">
            {node.children.map((child) => (
              <CategoryTreeItem
                key={child.id}
                node={child}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(node)}
      className={cn(
        "flex w-full items-center gap-2 rounded-md py-1.5 pl-9 pr-2 text-sm hover:bg-accent",
        isSelected && "bg-accent font-medium",
      )}
    >
      <Folder className="h-4 w-4 text-muted-foreground" />
      {node.name}
      {!node.visible && (
        <span className="text-xs text-muted-foreground">(숨김)</span>
      )}
    </button>
  )
}
