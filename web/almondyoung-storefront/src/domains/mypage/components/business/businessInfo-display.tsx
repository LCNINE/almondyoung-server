import { Button } from "@components/common/ui/button"
import type { BusinessInfo } from "@lib/api/users/business/types"
import { formatBusinessNumber } from "@lib/utils/format-business-number"
import { FileText, Pencil } from "lucide-react"

interface BusinessInfoDisplayProps {
  data: BusinessInfo
  onEdit: () => void
}

export default function BusinessInfoDisplay({
  data,
  onEdit,
}: BusinessInfoDisplayProps) {
  const infoItems = [
    {
      label: "사업자등록번호",
      value: formatBusinessNumber(data.businessNumber ?? ""),
    },
    { label: "대표자명", value: data.representativeName },
  ]

  return (
    <div className="space-y-6">
      {/* 정보 그리드 */}
      <div className="border-border bg-card rounded-lg border">
        <dl className="divide-border divide-y">
          {infoItems.map((item) => (
            <div
              key={item.label}
              className="flex flex-col gap-1 px-4 py-4 sm:flex-row sm:items-center sm:gap-4"
            >
              <dt className="text-muted-foreground min-w-[140px] text-sm font-medium">
                {item.label}
              </dt>
              <dd className="text-foreground text-sm">{item.value}</dd>
            </div>
          ))}

          {/* 파일 정보 */}
          {data.fileUrl && (
            <div className="flex flex-col gap-1 px-4 py-4 sm:flex-row sm:items-center sm:gap-4">
              <dt className="text-muted-foreground min-w-[140px] text-sm font-medium">
                사업자등록증
              </dt>
              <dd className="text-foreground flex items-center gap-2 text-sm">
                <FileText className="text-primary h-4 w-4" />
                <span>{data.fileUrl}</span>
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* 수정 버튼 */}
      <div className="flex justify-end">
        <Button onClick={onEdit} className="gap-2">
          <Pencil className="h-4 w-4" />
          정보 수정
        </Button>
      </div>
    </div>
  )
}
