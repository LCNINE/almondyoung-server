import { useVersions } from "@/lib/services/catalog/versions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { DateCell } from "@/components/table-cells/date-cell"

const VERSION_STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  active: { label: "활성", variant: "default" },
  inactive: { label: "비활성", variant: "secondary" },
  draft: { label: "초안", variant: "outline" },
}

export function ProductVersionsCard({ masterId }: { masterId: string }) {
  const { data: versions, isLoading } = useVersions(masterId)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">버전 이력</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !versions || versions.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            버전 이력이 없습니다
          </p>
        ) : (
          <div className="space-y-2">
            {versions.map((v) => {
              const info = VERSION_STATUS[v.status] ?? {
                label: v.status,
                variant: "secondary" as const,
              }
              return (
                <div
                  key={v.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">v{v.version}</span>
                    <Badge variant={info.variant} className="text-xs">
                      {info.label}
                    </Badge>
                  </div>
                  <DateCell value={v.createdAt} />
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
