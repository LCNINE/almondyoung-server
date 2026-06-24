'use client';

import { useState } from 'react';
import { AxiosError } from 'axios';
import { ChevronLeft, ChevronRight, Coins, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePointsBalance, usePointsEvents } from '@/lib/services/wallet';
import { useEarnPoints } from '@/lib/services/wallet';
import { formatDateTime } from '@/lib/utils/date';

const PAGE_SIZE = 10;

// schema: point_event_type = EARN | REDEEM | EARN_CANCEL | REDEEM_CANCEL
const EVENT_LABEL: Record<string, { label: string; positive: boolean }> = {
  EARN: { label: '적립', positive: true },
  REDEEM: { label: '사용', positive: false },
  EARN_CANCEL: { label: '적립취소', positive: false },
  REDEEM_CANCEL: { label: '사용취소', positive: true },
};

function formatPoint(amount: number): string {
  const sign = amount > 0 ? '+' : '';
  return `${sign}${amount.toLocaleString()}P`;
}

function SummaryCard({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-md border border-gray-100 bg-gray-50 px-4 py-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div
        className={
          emphasize
            ? 'mt-1 text-xl font-bold text-indigo-600'
            : 'mt-1 text-lg font-semibold text-gray-800'
        }
      >
        {value.toLocaleString()}P
      </div>
    </div>
  );
}

/** 적립금 수동 지급 다이얼로그 */
function EarnPointsDialog({
  customerId,
  open,
  onClose,
}: {
  customerId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const { mutate, isPending } = useEarnPoints();

  const amountNum = Number(amount);
  const canSubmit = Number.isInteger(amountNum) && amountNum > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    mutate(
      {
        userId: customerId,
        amount: amountNum,
        reasonCode: reasonCode.trim() || undefined,
        // 만료일은 날짜 입력(YYYY-MM-DD) → 그날 끝 시각까지로 본다
        expiresAt: expiresAt ? `${expiresAt}T23:59:59.999Z` : undefined,
      },
      {
        onSuccess: () => {
          toast.success(`${amountNum.toLocaleString()}P를 지급했습니다.`);
          setAmount('');
          setReasonCode('');
          setExpiresAt('');
          onClose();
        },
        onError: (error) => {
          const message =
            error instanceof AxiosError
              ? (error.response?.data?.message ?? error.message)
              : '적립금 지급에 실패했습니다.';
          toast.error(message);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>적립금 지급</DialogTitle>
          <DialogDescription className="sr-only">
            회원에게 적립금을 수동으로 지급합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="earn-amount">지급 포인트</Label>
            <Input
              id="earn-amount"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              placeholder="예: 5000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="earn-reason">사유 (선택)</Label>
            <Input
              id="earn-reason"
              placeholder="예: 이벤트 보상"
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="earn-expires">만료일 (선택)</Label>
            <Input
              id="earn-expires"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
            <p className="text-xs text-gray-400">
              비워두면 만료 없이 영구 적립됩니다.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            type="button"
            disabled={!canSubmit || isPending}
            onClick={handleSubmit}
          >
            {isPending ? '지급 중…' : '지급'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PointsTab({ customerId }: { customerId: string }) {
  const [earnOpen, setEarnOpen] = useState(false);
  const [page, setPage] = useState(1);

  const { data: balance, isLoading: isBalanceLoading } =
    usePointsBalance(customerId);
  const {
    data: eventsRes,
    isLoading: isEventsLoading,
    isError,
  } = usePointsEvents(customerId, page, PAGE_SIZE);

  const events = eventsRes?.data ?? [];
  const total = eventsRes?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
        <Coins className="size-4 text-indigo-500" />
        적립금
        <Button
          type="button"
          size="sm"
          className="ml-auto h-7 px-3 text-xs"
          onClick={() => setEarnOpen(true)}
        >
          <Plus className="mr-1 size-3.5" />
          적립금 지급
        </Button>
      </div>

      {/* ── 잔액 요약 ── */}
      {isBalanceLoading ? (
        <Skeleton className="mb-4 h-20 w-full" />
      ) : (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <SummaryCard
            label="사용 가능"
            value={balance?.available ?? 0}
            emphasize
          />
          <SummaryCard label="적립 확정" value={balance?.confirmed ?? 0} />
          <SummaryCard label="사용 예약" value={balance?.reserved ?? 0} />
        </div>
      )}

      {/* ── 적립/사용 내역 ── */}
      {isEventsLoading ? (
        <div className="space-y-2 py-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : isError ? (
        <div className="py-8 text-center text-sm text-red-400">
          적립금 내역을 불러오지 못했습니다.
        </div>
      ) : events.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">
          적립금 내역이 없습니다.
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">일시</TableHead>
                <TableHead className="w-24">구분</TableHead>
                <TableHead className="text-right">포인트</TableHead>
                <TableHead>사유</TableHead>
                <TableHead className="w-40">만료일</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => {
                const meta = EVENT_LABEL[e.eventType] ?? {
                  label: e.eventType,
                  positive: e.amount > 0,
                };
                return (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs text-gray-600">
                      {formatDateTime(e.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={meta.positive ? 'default' : 'destructive'}
                      >
                        {meta.label}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium ${
                        e.amount > 0 ? 'text-indigo-600' : 'text-red-500'
                      }`}
                    >
                      {formatPoint(e.amount)}
                    </TableCell>
                    <TableCell className="text-sm text-gray-700">
                      {e.reasonCode ?? '-'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-gray-500">
                      {e.expiresAt ? formatDateTime(e.expiresAt) : '-'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-7"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                aria-label="이전 페이지"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-2 text-xs text-gray-600">
                {page} / {totalPages}
              </span>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-7"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                aria-label="다음 페이지"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </>
      )}

      {/* TODO: 쿠폰 내역 — 백엔드 쿠폰 API 확정 후 구현 */}

      <EarnPointsDialog
        customerId={customerId}
        open={earnOpen}
        onClose={() => setEarnOpen(false)}
      />
    </section>
  );
}
