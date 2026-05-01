import { Button } from "@components/common/ui/button"
import { Building2, Plus } from "lucide-react"

interface BusinessEmptyProps {
  onRegister: () => void
}

export default function BusinessEmpty({ onRegister }: BusinessEmptyProps) {
  return (
    <div className="border-border bg-muted/30 flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-16 text-center">
      <div className="bg-primary/10 mb-4 flex h-16 w-16 items-center justify-center rounded-full">
        <Building2 className="text-primary h-8 w-8" />
      </div>
      <h3 className="text-foreground mb-2 text-lg font-semibold">
        등록된 사업자 정보가 없습니다
      </h3>
      <p className="text-muted-foreground mb-6 max-w-sm text-sm">
        사업자 정보를 등록하시면 세금계산서 발행 및 사업자 전용 혜택을 이용하실
        수 있습니다.
      </p>
      <Button onClick={onRegister} className="gap-2">
        <Plus className="h-4 w-4" />
        사업자 정보 등록
      </Button>
    </div>
  )
}
