'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { differenceInCalendarDays, format, subDays } from 'date-fns';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils/ui';
import { formatDateTime } from '@/lib/utils/date';
import {
  notificationApi,
  type MessageChannel,
  type NotificationStatus,
  type UserMessageHistoryItem,
} from '@/lib/api/domains/notification';

const PAGE_SIZE = 20;
const MAX_RANGE_DAYS = 30;

const CHANNEL_TABS: { key: MessageChannel; label: string; notice: string }[] = [
  { key: 'SMS', label: 'SMS', notice: 'SMS는' },
  { key: 'KAKAO', label: '카카오톡 메시지', notice: '카카오알림톡은' },
];

const PRESETS = [
  { label: '오늘', days: 0 },
  { label: '3일', days: 3 },
  { label: '7일', days: 7 },
  { label: '30일', days: 30 },
];

const STATUS_LABEL: Record<NotificationStatus, string> = {
  PENDING: '대기',
  PROCESSING: '대기',
  RETRYING: '대기',
  SENT: '접수',
  DELIVERED: '전달',
  FAILED: '실패',
  CANCELLED: '취소',
};

const today = () => format(new Date(), 'yyyy-MM-dd');
const daysAgo = (days: number) => format(subDays(new Date(), days), 'yyyy-MM-dd');

function routeLabel(item: UserMessageHistoryItem): string {
  if (item.route === 'NHN') return '대표번호(NHN)';
  return item.deviceName ? `발송폰 · ${item.deviceName}` : '발송폰';
}

const th = 'border-b border-r border-gray-200 last:border-r-0 bg-gray-50 px-3 py-2 text-center font-normal text-gray-700';
const td = 'border-b border-r border-gray-200 last:border-r-0 px-3 py-2 text-center text-gray-800';

export function MessagesTab({ customerId }: { customerId: string }) {
  const [channel, setChannel] = useState<MessageChannel>('SMS');
  const [preset, setPreset] = useState<number | null>(0);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState({ from: today(), to: today() });
  const [page, setPage] = useState(1);
  const [opened, setOpened] = useState<UserMessageHistoryItem | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['customer-messages', customerId, channel, query, page],
    queryFn: () =>
      notificationApi.getUserMessages(customerId, {
        channel,
        ...query,
        page,
        limit: PAGE_SIZE,
      }),
  });

  const applyPreset = (days: number) => {
    setPreset(days);
    setFrom(daysAgo(days));
    setTo(today());
  };

  const search = () => {
    const diff = differenceInCalendarDays(new Date(to), new Date(from));
    if (diff < 0) return toast.error('종료일이 시작일보다 앞설 수 없습니다.');
    if (diff > MAX_RANGE_DAYS) return toast.error(`한 번에 최대 ${MAX_RANGE_DAYS}일까지만 조회할 수 있습니다.`);
    setQuery({ from, to });
    setPage(1);
  };

  const switchChannel = (next: MessageChannel) => {
    setChannel(next);
    setPage(1);
  };

  const isSms = channel === 'SMS';
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const notice = CHANNEL_TABS.find((t) => t.key === channel)?.notice;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-gray-900">메시지 발송내역</h2>

      <div className="flex border border-gray-200 bg-gray-50">
        {CHANNEL_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => switchChannel(t.key)}
            className={cn(
              'border-t-2 px-4 py-2.5 text-sm',
              channel === t.key
                ? 'border-t-blue-600 bg-white font-semibold text-blue-600'
                : 'border-t-transparent text-gray-500 hover:text-gray-800'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="text-sm text-gray-700">
        - {notice} 한번에 최대 {MAX_RANGE_DAYS}일까지의 발송내역만 확인할 수 있습니다.
      </p>

      <div className="flex border border-gray-200 bg-white text-sm">
        <div className="flex w-36 shrink-0 items-center bg-gray-50 px-3 text-gray-700">검색기간</div>
        <div className="flex flex-wrap items-center gap-1 px-2 py-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p.days)}
              className={cn(
                'h-8 border px-3',
                preset === p.days
                  ? 'border-blue-500 text-blue-600'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              )}
            >
              {p.label}
            </button>
          ))}
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => {
              setFrom(e.target.value);
              setPreset(null);
            }}
            className="h-8 border border-gray-300 px-2"
          />
          <span className="text-gray-500">~</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => {
              setTo(e.target.value);
              setPreset(null);
            }}
            className="h-8 border border-gray-300 px-2"
          />
          <button
            type="button"
            onClick={search}
            className="h-8 bg-gray-700 px-3 text-white hover:bg-gray-800"
          >
            검색
          </button>
        </div>
      </div>

      <h3 className="pt-2 text-base font-bold text-gray-900">메시지 발송결과</h3>

      <div className="border border-gray-200 bg-white text-sm">
        <div className="px-3 py-2.5 text-gray-700">
          검색결과 <span className="font-semibold text-blue-600">{isError ? '-' : (data?.total ?? 0)}</span>건
        </div>
        <table className="w-full border-t border-gray-200">
          <thead>
            <tr>
              <th className={cn(th, 'w-24')}>발송타입</th>
              <th className={cn(th, 'w-44')}>발송일시</th>
              {isSms && <th className={cn(th, 'w-40')}>발송경로</th>}
              <th className={th}>메시지</th>
              <th className={cn(th, 'w-24')}>발송결과</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={isSms ? 5 : 4} className="p-3">
                  <Skeleton className="h-6 w-full" />
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={isSms ? 5 : 4} className="py-10 text-center text-red-600">
                  발송내역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
                </td>
              </tr>
            ) : data?.items.length ? (
              data.items.map((item) => (
                <tr key={item.notificationId}>
                  <td className={td}>{item.sendType === 'MANUAL' ? '수동발송' : '자동발송'}</td>
                  <td className={td}>{formatDateTime(item.sentAt)}</td>
                  {isSms && <td className={td}>{routeLabel(item)}</td>}
                  <td className={cn(td, 'max-w-0 text-left')}>
                    <button
                      type="button"
                      onClick={() => setOpened(item)}
                      className="block w-full truncate text-left underline underline-offset-2 hover:text-blue-600"
                    >
                      {item.subject || item.body || '-'}
                    </button>
                  </td>
                  <td className={cn(td, item.status === 'FAILED' && 'text-red-600')}>
                    {STATUS_LABEL[item.status]}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={isSms ? 5 : 4} className="py-10 text-center text-gray-500">
                  발송내역이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-center gap-1">
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setPage(n)}
            className={cn(
              'h-6 min-w-6 px-1 text-sm',
              n === page ? 'bg-blue-600 font-semibold text-white' : 'text-gray-600 hover:bg-gray-100'
            )}
          >
            {n}
          </button>
        ))}
      </div>

      <Dialog open={opened !== null} onOpenChange={(open) => !open && setOpened(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{opened?.subject || '메시지 내용'}</DialogTitle>
            <DialogDescription>
              {opened && formatDateTime(opened.sentAt)}
              {opened?.phoneNumber && ` · ${opened.phoneNumber}`}
              {opened && isSms && ` · ${routeLabel(opened)}`}
            </DialogDescription>
          </DialogHeader>
          <p className="whitespace-pre-wrap text-sm text-gray-800">{opened?.body}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
