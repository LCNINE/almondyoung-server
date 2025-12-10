import { Card, CardContent } from "@components/common/ui/card"
import { Price } from "@components/price"

// 적립 예정인 적립금 섹션
export default function PendingPointsSection() {
  return (
    <Card className="my-4 border-none shadow-none">
      <CardContent className="flex items-center justify-between p-7">
        <div>
          <span className="text-foreground text-lg font-bold">
            아몬드영 적립금
          </span>
        </div>

        <div>
          <Price
            amount={0}
            className="text-foreground mr-2 text-lg font-bold"
            unitClassName="text-muted-foreground text-base"
          />
        </div>
      </CardContent>
    </Card>
  )
}
