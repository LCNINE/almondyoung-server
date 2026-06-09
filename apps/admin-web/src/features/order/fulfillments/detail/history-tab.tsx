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

interface TimelineEvent {
  label: string;
  at: string | null | undefined;
}

const OUTBOX_STATUS_LABELS: Record<string, string> = {
  pending: '대기',
  processing: '처리 중',
  published: '발행 완료',
  failed: '실패',
};

const OUTBOX_STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  processing: 'secondary',
  published: 'default',
  failed: 'destructive',
};

const FO_EVENT_LABELS: Record<string, string> = {
  FulfillmentCreated: 'FO 생성',
  FulfillmentReady: '출고 준비',
  FulfillmentLabelled: '라벨/운송장 등록',
  FulfillmentShipped: '출고 완료',
  FulfillmentDelivered: '배송 완료',
  FulfillmentCancelled: 'FO 취소',
};

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleString('ko-KR');
}

export function HistoryTab({ fo }: { fo: FulfillmentOrderDetail }) {
  const { data: outboxEvents = [], isLoading, isError } = useFulfillmentOutboxEvents(fo.id);
  const events: TimelineEvent[] = [
    { label: '생성됨', at: fo.createdAt },
    { label: '할당됨', at: fo.allocatedAt },
    { label: '출고 완료', at: fo.shippedAt },
    { label: '취소됨', at: fo.canceledAt },
  ];

  const occurred = events.filter((e) => !!e.at);
  const failedOrPending = outboxEvents.filter((e) => e.status === 'failed' || e.status === 'pending');

  return (
    <div className="flex flex-col gap-4 py-4">
      <section>
        <h3 className="mb-3 text-sm font-semibold">상태 타임라인</h3>
        {occurred.length === 0 ? (
          <p className="text-sm text-muted-foreground">기록된 이벤트 없음</p>
        ) : (
          <ol className="relative ml-3 border-l border-muted-foreground/20">
            {occurred.map((e) => (
              <li key={e.label} className="mb-5 ml-4">
                <div className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border border-background bg-muted-foreground/40" />
                <p className="text-sm font-medium">{e.label}</p>
                <time className="text-xs text-muted-foreground">
                  {new Date(e.at!).toLocaleString('ko-KR')}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">이벤트 / 아웃박스 추적</h3>

        {isError && (
          <Alert variant="destructive" className="mb-3">
            <AlertTriangle />
            <AlertTitle>이벤트 조회 실패</AlertTitle>
            <AlertDescription>
              Core outbox 이벤트를 불러오지 못했습니다. 출고 상태와 채널 동기화 상태를 별도로 확인하세요.
            </AlertDescription>
          </Alert>
        )}

        {failedOrPending.length > 0 && (
          <Alert className="mb-3">
            <AlertTriangle />
            <AlertTitle>운영 확인 필요</AlertTitle>
            <AlertDescription>
              발행 실패 또는 대기 중인 이벤트가 있습니다. 채널 동기화가 아직 완료되지 않았을 수 있습니다.
            </AlertDescription>
          </Alert>
        )}

        <div className="overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이벤트</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="text-right">시도</TableHead>
                <TableHead>생성 시각</TableHead>
                <TableHead>발행 시각</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    이벤트를 불러오는 중입니다.
                  </TableCell>
                </TableRow>
              ) : outboxEvents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    기록된 outbox 이벤트가 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                outboxEvents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm">{FO_EVENT_LABELS[event.eventType] ?? event.eventType}</span>
                        <span className="font-mono text-xs text-muted-foreground">{event.eventType}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={OUTBOX_STATUS_VARIANTS[event.status] ?? 'outline'}>
                        {OUTBOX_STATUS_LABELS[event.status] ?? event.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{event.attempts}</TableCell>
                    <TableCell>{formatDate(event.createdAt)}</TableCell>
                    <TableCell>{formatDate(event.publishedAt)}</TableCell>
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
