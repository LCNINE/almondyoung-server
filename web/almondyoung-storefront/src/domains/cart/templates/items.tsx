import { HttpTypes } from "@medusajs/types"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import Item from "../components/item"
import MobileItem from "../components/item/mobile-item"

type ItemsTemplateProps = {
  cart?: HttpTypes.StoreCart
}

export default function ItemsTemplate({ cart }: ItemsTemplateProps) {
  const items = cart?.items

  const sortedItems = items?.sort((a, b) => {
    return (a.created_at ?? "") > (b.created_at ?? "") ? -1 : 1
  })

  return (
    <>
      {/* 모바일: 카드 리스트 */}
      <div className="md:hidden">
        {sortedItems?.map((item) => (
          <MobileItem
            key={item.id}
            item={item}
            currencyCode={cart?.currency_code ?? "KRW"}
          />
        ))}
      </div>

      {/* 데스크탑: 테이블 */}
      <div className="hidden md:block">
        <Table>
          <TableHeader className="border-t-0">
            <TableRow>
              <TableHead className="pl-0">상품</TableHead>
              <TableHead></TableHead>
              <TableHead>수량</TableHead>
              <TableHead>단가</TableHead>
              <TableHead className="pr-0 text-right">합계</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {sortedItems?.map((item) => (
              <Item
                key={item.id}
                item={item}
                currencyCode={cart?.currency_code ?? "KRW"}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
