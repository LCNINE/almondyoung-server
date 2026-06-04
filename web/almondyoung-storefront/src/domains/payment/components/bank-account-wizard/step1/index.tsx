import { ScrollArea } from "@components/common/ui/scroll-area"
import BANKS from "../banks.data.json"
import { Button } from "@components/common/ui/button"
import { cn } from "@lib/utils"

/**
 * 은행 선택하는 컴포넌트
 */
export default function BankSelectorStep({
  onSelect,
}: {
  onSelect: (bank: { code: string; name: string }) => void // 은행 선택 시 호출되는 함수
}) {
  return (
    <>
      <p className="mb-3 text-center text-sm">
        본인 명의의 계좌만 등록 가능합니다.
      </p>
      <p className="mb-4 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
        자동이체 계좌 등록 후 <strong>1~2영업일</strong> 심사를 거쳐 정기결제 수단으로 사용 가능합니다. 심사 중에는 정기결제 수단으로 선택할 수 없습니다.
      </p>
      <ScrollArea className="h-80">
        <div className="grid grid-cols-3 gap-3">
          {BANKS.map((bank) => (
            <Button
              variant="outline"
              key={bank.code}
              onClick={() => onSelect(bank)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border p-3 transition"
              )}
            >
              <span className="text-xs font-medium sm:text-base">
                {bank.name}
              </span>
            </Button>
          ))}
        </div>
      </ScrollArea>
    </>
  )
}
