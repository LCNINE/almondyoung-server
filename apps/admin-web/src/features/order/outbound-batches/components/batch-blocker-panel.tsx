import { Fragment } from 'react';
import Link from 'next/link';
import { CircleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getBatchBlockerGroups, type ParsedServerError } from '@/lib/api/server-error';

export function BatchBlockerPanel({ error, title }: { error: ParsedServerError; title: string }) {
  const { groups, incomplete } = getBatchBlockerGroups(error);

  return (
    <section
      role="alert"
      className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <div className="flex items-start gap-2">
        <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div>
          <p className="font-semibold text-destructive">{title}</p>
          <p className="text-muted-foreground">아래 박스를 먼저 처리해 주세요.</p>
        </div>
      </div>
      {groups.map((group) => (
        <div key={group.reason} className="overflow-hidden rounded-md border bg-background">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <h4 className="font-semibold">{group.title}</h4>
            <Badge variant="secondary">{group.rows.length}건</Badge>
          </div>
          <table className="w-full">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">주문번호</th>
                <th className="px-3 py-1.5 text-left font-medium">송장</th>
                <th className="px-3 py-1.5 text-left font-medium">내용</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row, index) => (
                <tr key={`${index}-${row.orderNo}`} className="border-t">
                  <td className="px-3 py-2 font-mono">
                    {row.orderNos.length
                      ? row.orderNos.map((orderNo, i) => (
                          <Fragment key={`${i}-${orderNo}`}>
                            {i > 0 && ', '}
                            <Link
                              href={`/order/history?orderNo=${encodeURIComponent(orderNo)}`}
                              className="underline underline-offset-2 hover:text-primary"
                            >
                              {orderNo}
                            </Link>
                          </Fragment>
                        ))
                      : row.orderNo}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    <Link
                      href={`/order/fulfillments?shipmentId=${encodeURIComponent(row.shipmentId)}`}
                      className="underline underline-offset-2 hover:text-primary"
                    >
                      {row.trackingNo ?? '출고 상세'}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t bg-muted/40 px-3 py-2">
            <span className="mr-2 font-semibold">할 일</span>
            {group.guidance}
          </p>
        </div>
      ))}
      {incomplete && (
        <div className="space-y-1 rounded-md border bg-background px-3 py-2">
          <p>일부 박스의 상세 사유를 확인하지 못했어요. 배치와 해당 박스의 출고 상태를 확인해 주세요.</p>
          <p className="text-muted-foreground">서버 상세: {error.message}</p>
        </div>
      )}
    </section>
  );
}
