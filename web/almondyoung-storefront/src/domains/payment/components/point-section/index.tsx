import { Card, CardContent } from "@components/common/ui/card"
import { Price } from "@components/price"

// 아몬드영 적립금 섹션
export default async function PointSection({
  withdrawable,
}: {
  withdrawable: number
}) {
  return (
    <Card className="mb-4 border-none shadow-xs">
      <CardContent className="flex items-center justify-between p-7">
        <div>
          <span className="text-foreground text-lg font-bold">
            아몬드영 적립금
          </span>
        </div>

        <div>
          <Price
            amount={withdrawable}
            className="text-foreground mr-2 text-lg font-bold"
            unitClassName="text-muted-foreground text-base"
          />
        </div>
      </CardContent>
    </Card>
  )
}
