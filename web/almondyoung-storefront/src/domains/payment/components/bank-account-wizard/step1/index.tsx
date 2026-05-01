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
      <p className="mb-4 text-center text-sm">
        본인 명의의 계좌만 등록 가능합니다.
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
