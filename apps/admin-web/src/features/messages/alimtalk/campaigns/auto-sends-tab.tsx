'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AlimtalkAutoSend } from '@/lib/api/domains/alimtalk';
import {
  useAlimtalkAutoSendResult,
  useAlimtalkAutoSends,
} from '@/lib/services/alimtalk';
import { autoSendOutcomeLabel, autoSendStatusLabel } from '../lib/alimtalk';

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * 사건이 생겨 자동으로 나간 알림톡(출금 실패·해지 안내 등). 관리자가 만든 캠페인과는 따로 쌓인다.
 * 받았는지는 «결과 보기» 를 누를 때 NHN 에 묻는다.
 */
export function AlimtalkAutoSendsTab() {
  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAlimtalkAutoSends();
  const items = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="overflow-x-auto px-6 pb-6">
      <p className="text-muted-foreground pb-3 text-sm">
        출금 실패·해지처럼 일이 생기면 바로 나가는 알림톡입니다. 밤에 생긴 건은
        다음 날 아침 8시로 예약됩니다.
      </p>
      {isLoading && <Skeleton className="h-40 w-full" />}
      {isError && (
        <p className="text-destructive text-sm">
          자동 발송 기록을 불러오지 못했습니다.
        </p>
      )}
      {!isLoading && !isError && items.length === 0 && (
        <p className="text-muted-foreground text-sm">
          자동으로 나간 알림톡이 없습니다.
        </p>
      )}
      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">생긴 시각</TableHead>
              <TableHead>알림</TableHead>
              <TableHead className="w-48">받는 분</TableHead>
              <TableHead className="w-28">상태</TableHead>
              <TableHead className="w-32">예약</TableHead>
              <TableHead className="w-72">받았는지</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <AutoSendRow key={item.notificationId} item={item} />
            ))}
          </TableBody>
        </Table>
      )}
      {hasNextPage && (
        <div className="flex justify-center pt-3">
          <Button
            variant="outline"
            size="sm"
            disabled={isFetchingNextPage}
            onClick={() => fetchNextPage()}
          >
            {isFetchingNextPage ? '불러오는 중…' : '더 보기'}
          </Button>
        </div>
      )}
    </div>
  );
}

function AutoSendRow({ item }: { item: AlimtalkAutoSend }) {
  const [asked, setAsked] = useState(false);
  const result = useAlimtalkAutoSendResult(asked ? item.notificationId : null);

  return (
    <TableRow>
      <TableCell className="text-sm">{dateTime(item.createdAt)}</TableCell>
      <TableCell>
        <div className="font-medium">
          {item.eventName ?? item.eventKey ?? '-'}
        </div>
        <div className="text-muted-foreground text-xs">
          {item.templateCode ?? ''}
        </div>
      </TableCell>
      <TableCell>
        <div>{item.recipientName || '-'}</div>
        <div className="text-muted-foreground text-xs">{item.phone}</div>
      </TableCell>
      <TableCell>
        <Badge variant={item.status === 'FAILED' ? 'destructive' : 'outline'}>
          {autoSendStatusLabel(item.status)}
        </Badge>
        {item.error && (
          <div className="text-destructive pt-1 text-xs break-all">
            {item.error}
          </div>
        )}
      </TableCell>
      <TableCell className="text-sm">{item.scheduledFor ?? '-'}</TableCell>
      <TableCell className="text-sm">
        {!asked ? (
          <Button variant="outline" size="sm" onClick={() => setAsked(true)}>
            결과 보기
          </Button>
        ) : result.isLoading ? (
          <span className="text-muted-foreground">NHN 에 묻는 중…</span>
        ) : result.isError ? (
          <span className="text-destructive">결과를 불러오지 못했습니다</span>
        ) : result.data ? (
          <span>{autoSendOutcomeLabel(result.data)}</span>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
