'use client';

import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useFulfillmentOutboxEvents } from '@/lib/services/orders';
import type { FulfillmentOrderDetail } from '@/lib/types/dto/fulfillment';
import { outboxEventLabel, outboxStatusLabel } from './fulfillment-labels';

interface TimelineEvent {
  label: string;
  at: string | null | undefined;
}

const OUTBOX_STATUS_VARIANTS: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  pending: 'secondary',
  processing: 'secondary',
  published: 'default',
  failed: 'destructive',
  skipped: 'outline',
};

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleString('ko-KR');
}

export function HistoryTab({ fo }: { fo: FulfillmentOrderDetail }) {
  const {
    data: outboxEvents = [],
    isLoading,
    isError,
  } = useFulfillmentOutboxEvents(fo.id);
  const timeline: TimelineEvent[] = [
    { label: '생성됨', at: fo.createdAt },
    { label: '재고 확보', at: fo.allocatedAt },
    { label: '출고 완료', at: fo.shippedAt },
    { label: '취소됨', at: fo.canceledAt },
  ].filter((event) => !!event.at);

  // failed 는 재시도 한도를 다 써서 더 보내지 않는다. pending 에 시도가 있으면 다시 보내는 중이다
  const stopped = outboxEvents.filter((event) => event.status === 'failed');
  const retrying = outboxEvents.filter(
    (event) => event.status === 'pending' && event.attempts > 0
  );

  return (
    <div className="flex flex-col gap-6 py-4">
      <section>
        <h3 className="mb-3 text-sm font-semibold">상태 타임라인</h3>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">기록이 없어요.</p>
        ) : (
          <ol className="relative ml-3 border-l border-muted-foreground/20">
            {timeline.map((event) => (
              <li key={event.label} className="mb-5 ml-4">
                <div className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border border-background bg-muted-foreground/40" />
                <p className="text-sm font-medium">{event.label}</p>
                <time className="text-xs text-muted-foreground">
                  {formatDate(event.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">쇼핑몰·연동 알림</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          출고 상태가 바뀔 때 쇼핑몰과 연동 서비스에 보낸 알림이에요. «보냄»은
          알림을 전달했다는 뜻이고, 쇼핑몰에 반영됐는지는 배송 탭의 쇼핑몰
          반영에서 확인해요.
        </p>

        {isError && (
          <Alert variant="destructive" className="mb-3">
            <AlertTriangle />
            <AlertTitle>알림 기록을 불러오지 못했어요</AlertTitle>
            <AlertDescription>
              잠시 뒤 새로고침해 주세요. 출고 상태와 쇼핑몰 반영은 배송 탭에서
              따로 확인할 수 있어요.
            </AlertDescription>
          </Alert>
        )}

        {(stopped.length > 0 || retrying.length > 0) && (
          <Alert variant="destructive" className="mb-3">
            <AlertTriangle />
            <AlertTitle>확인이 필요해요</AlertTitle>
            <AlertDescription>
              {stopped.length > 0 && (
                <p>
                  {`보내지 못하고 멈춘 알림이 ${stopped.length}건 있어요. 다시 보내지 않으니 개발팀에 알려 주세요.`}
                </p>
              )}
              {retrying.length > 0 && (
                <p>
                  {`다시 보내는 중인 알림이 ${retrying.length}건 있어요. 계속 실패하면 개발팀에 알려 주세요.`}
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>알림</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="text-right">시도</TableHead>
                <TableHead>보낸 시각</TableHead>
                <TableHead>생성 시각</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-6 text-center text-muted-foreground"
                  >
                    알림 기록을 불러오는 중이에요.
                  </TableCell>
                </TableRow>
              ) : outboxEvents.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-6 text-center text-muted-foreground"
                  >
                    보낸 알림이 없어요.
                  </TableCell>
                </TableRow>
              ) : (
                outboxEvents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <span className="text-sm">
                        {outboxEventLabel(event.eventType)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          OUTBOX_STATUS_VARIANTS[event.status] ?? 'outline'
                        }
                      >
                        {outboxStatusLabel(event.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {event.attempts}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {event.publishedAt
                        ? formatDate(event.publishedAt)
                        : event.status === 'failed'
                          ? '다시 보내지 않아요'
                          : event.status === 'pending' &&
                              event.attempts > 0 &&
                              event.nextAttemptAt
                            ? `다시 보낼 시각: ${formatDate(event.nextAttemptAt)}`
                            : '-'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(event.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
