'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Balance {
  confirmed: number;
  reserved: number;
  available: number;
}

interface PointEvent {
  id: string;
  eventType: string;
  amount: number;
  originalEventId: string | null;
  reasonCode: string | null;
  createdAt: string;
}

function formatAmount(amount: number) {
  const abs = Math.abs(amount).toLocaleString('ko-KR');
  return amount >= 0 ? `+${abs}` : `-${abs}`;
}

function EventTypeBadge({ type }: { type: string }) {
  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    EARN: 'default',
    REDEEM: 'destructive',
    EARN_CANCEL: 'secondary',
    REDEEM_CANCEL: 'outline',
  };
  return <Badge variant={variants[type] ?? 'outline'}>{type}</Badge>;
}

export default function DevPointsPage() {
  const [userId, setUserId] = useState('dev-user-1');
  const [balance, setBalance] = useState<Balance | null>(null);
  const [events, setEvents] = useState<PointEvent[]>([]);
  const [loadingFetch, setLoadingFetch] = useState(false);

  const [earnAmount, setEarnAmount] = useState<number | ''>('');
  const [earnReason, setEarnReason] = useState('');
  const [loadingEarn, setLoadingEarn] = useState(false);

  const [cancelingId, setCancelingId] = useState<string | null>(null);

  async function fetchData() {
    if (!userId.trim()) {
      toast.error('userId를 입력하세요');
      return;
    }
    setLoadingFetch(true);
    try {
      const [balRes, eventsRes] = await Promise.all([
        fetch(`/api/dev/points/balance?user_id=${encodeURIComponent(userId.trim())}`),
        fetch(`/api/dev/points/events?user_id=${encodeURIComponent(userId.trim())}&limit=20`),
      ]);

      if (!balRes.ok) {
        const err = await balRes.json().catch(() => ({}));
        toast.error(err?.message ?? '잔액 조회 실패');
        return;
      }
      if (!eventsRes.ok) {
        const err = await eventsRes.json().catch(() => ({}));
        toast.error(err?.message ?? '이벤트 조회 실패');
        return;
      }

      const [bal, evs] = await Promise.all([balRes.json(), eventsRes.json()]);
      setBalance(bal);
      setEvents(evs);
    } catch {
      toast.error('네트워크 오류가 발생했습니다');
    } finally {
      setLoadingFetch(false);
    }
  }

  async function handleEarn() {
    if (!earnAmount || earnAmount <= 0) {
      toast.error('적립 금액을 입력하세요');
      return;
    }
    setLoadingEarn(true);
    try {
      const res = await fetch('/api/dev/points/earn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId.trim(),
          amount: earnAmount,
          ...(earnReason.trim() ? { reasonCode: earnReason.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.message ?? '포인트 적립 실패');
        return;
      }
      toast.success(`포인트 적립 완료 (${earnAmount.toLocaleString('ko-KR')}원)`);
      setEarnAmount('');
      setEarnReason('');
      await fetchData();
    } catch {
      toast.error('네트워크 오류가 발생했습니다');
    } finally {
      setLoadingEarn(false);
    }
  }

  async function handleEarnCancel(earnEventId: string) {
    setCancelingId(earnEventId);
    try {
      const res = await fetch('/api/dev/points/earn-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId.trim(),
          earnEventId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.message ?? '취소 실패');
        return;
      }
      toast.success('적립 취소 완료');
      await fetchData();
    } catch {
      toast.error('네트워크 오류가 발생했습니다');
    } finally {
      setCancelingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">포인트 관리</h1>
        <p className="text-sm text-muted-foreground mt-1">포인트 적립 및 잔액·내역 조회</p>
      </div>

      {/* User ID + 조회 */}
      <div className="flex items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="userId">User ID</Label>
          <Input
            id="userId"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="dev-user-1"
            className="w-56"
            onKeyDown={(e) => e.key === 'Enter' && fetchData()}
          />
        </div>
        <Button onClick={fetchData} disabled={loadingFetch}>
          {loadingFetch ? '조회 중...' : '조회'}
        </Button>
      </div>

      {/* 잔액 카드 */}
      {balance && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">확정</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{balance.confirmed.toLocaleString('ko-KR')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">예약</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{balance.reserved.toLocaleString('ko-KR')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">사용가능</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-primary">
                {balance.available.toLocaleString('ko-KR')}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 포인트 적립 폼 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">포인트 적립</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 items-end">
          <div className="space-y-2">
            <Label htmlFor="earnAmount">금액</Label>
            <Input
              id="earnAmount"
              type="number"
              min={1}
              value={earnAmount}
              onChange={(e) => setEarnAmount(e.target.value ? Number(e.target.value) : '')}
              placeholder="예: 5000"
              className="w-36"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="earnReason">사유 (선택)</Label>
            <Input
              id="earnReason"
              value={earnReason}
              onChange={(e) => setEarnReason(e.target.value)}
              placeholder="ADMIN_TEST"
              className="w-40"
            />
          </div>
          <Button onClick={handleEarn} disabled={loadingEarn || !earnAmount}>
            {loadingEarn ? '적립 중...' : '적립'}
          </Button>
        </CardContent>
      </Card>

      {/* 이벤트 테이블 */}
      {events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">최근 이벤트</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>일시</TableHead>
                  <TableHead>유형</TableHead>
                  <TableHead className="text-right">금액</TableHead>
                  <TableHead>사유</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(ev.createdAt).toLocaleString('ko-KR')}
                    </TableCell>
                    <TableCell>
                      <EventTypeBadge type={ev.eventType} />
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono font-medium ${ev.amount > 0 ? 'text-green-600' : 'text-red-500'}`}
                    >
                      {formatAmount(ev.amount)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {ev.reasonCode ?? '-'}
                    </TableCell>
                    <TableCell>
                      {ev.eventType === 'EARN' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          disabled={cancelingId === ev.id}
                          onClick={() => handleEarnCancel(ev.id)}
                        >
                          {cancelingId === ev.id ? '취소 중...' : '취소'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {events.length === 0 && balance && (
        <p className="text-sm text-muted-foreground text-center py-8">이벤트가 없습니다.</p>
      )}
    </div>
  );
}
