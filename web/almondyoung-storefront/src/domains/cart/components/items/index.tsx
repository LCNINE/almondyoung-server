"use client"

import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { HttpTypes } from "@medusajs/types"

import Item from "./item"

type ItemsProps = {
  cart?: HttpTypes.StoreCart
}

export default function Items({ cart }: ItemsProps) {
  const items = cart?.items

  const sortedItems = items?.sort((a, b) => {
    return (a.created_at ?? "") > (b.created_at ?? "") ? -1 : 1
  })

  return (
    <>
      {/* 모바일: 카드 리스트 */}
      <div className="md:hidden">
        {sortedItems?.map((item) => (
          <Item key={item.id} item={item}>
            <Item.Mobile />
          </Item>
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
              <Item key={item.id} item={item}>
                <Item.Desktop />
              </Item>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
