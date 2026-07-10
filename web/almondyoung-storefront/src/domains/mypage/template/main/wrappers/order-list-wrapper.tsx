import {
  getOrderListPageData,
  type OrderListPageData,
} from "@/domains/order/list/get-order-list-data"
import { OrderList } from "@/domains/order/list/order-list"
import { withMypageTimeout } from "./mypage-timeout"

/**
 * 마이페이지 홈(데스크탑)에 임베드되는 주문목록 wrapper.
 * order/list 페이지와 동일한 서버 페이지네이션 데이터를 받아 embedded 모드로 렌더한다.
 * 페이지/기간/검색은 /mypage 의 searchParams(page, period, q)로 제어된다.
 */
export async function OrderListWrapper({
  page,
  period,
  q,
}: {
  page: number
  period: string
  q: string
}) {
  const data = await withMypageTimeout<OrderListPageData | null>(
    getOrderListPageData({ page, period, q }),
    null
  )

  if (!data) {
    return (
      <OrderList
        orders={[]}
        page={1}
        pageCount={1}
        period="recent"
        q=""
        count={0}
        actionsMap={{}}
        refundMap={{}}
        hasError
        embedded
      />
    )
  }

  return (
    <OrderList
      orders={data.orders}
      page={data.page}
      pageCount={data.pageCount}
      period={data.period}
      q={data.q}
      count={data.count}
      actionsMap={data.actionsMap}
      refundMap={data.refundMap}
      hasError={data.hasError}
      embedded
    />
  )
}
