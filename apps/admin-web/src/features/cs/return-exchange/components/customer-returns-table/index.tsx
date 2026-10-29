'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCustomerReturns } from '@/lib/services/customer-returns';
import type { CustomerReturnBucket } from '@/lib/types/dto/customer-returns';
import {
  RETURN_ATTENTION_LABELS,
  RETURN_KIND_LABELS,
  RETURN_REASON_LABELS,
  statusLabel,
} from '../../customer-return-labels';
import { formatKstDate } from '../format';
import { CustomerReturnSheet } from '../customer-return-sheet';

const PAGE_SIZE = 20;

interface Props {
  bucket: CustomerReturnBucket;
  q: string;
  onBucketChange: (bucket: CustomerReturnBucket) => void;
  onSearch: (q: string) => void;
}

export function CustomerReturnsTable({ bucket, q, onBucketChange, onSearch }: Props) {
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState(q);
  const [selected, setSelected] = useState<{ id: string; customerName: string | null } | null>(null);

  const query = { bucket, q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
  const { data, isLoading, isError } = useCustomerReturns(query);

  const items = data?.items ?? [];
  const attentionCount = data?.attentionCount ?? 0;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  const changeBucket = (next: CustomerReturnBucket) => {
    setPage(1);
    onBucketChange(next);
  };
  const submitSearch = () => {
    setPage(1);
    onSearch(draft.trim());
  };

  const buckets: Array<{ value: CustomerReturnBucket; label: string }> = [
    { value: 'open', label: '진행 중' },
    { value: 'attention', label: attentionCount > 0 ? `확인 필요(${attentionCount})` : '확인 필요' },
    { value: 'closed', label: '끝남' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {buckets.map((b) => (
            <Button
              key={b.value}
              size="sm"
              variant={bucket === b.value ? 'default' : 'outline'}
              onClick={() => changeBucket(b.value)}
            >
              {b.label}
            </Button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submitSearch();
          }}
        >
          <Input
            className="w-[240px]"
            value={draft}
            maxLength={64}
            placeholder="주문번호 · 고객명"
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit" size="sm" variant="outline">
            검색
          </Button>
        </form>
      </div>

      {isError ? (
        <p className="text-sm text-red-600">반품·교환 목록을 불러오지 못했습니다.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>주문번호</TableHead>
              <TableHead>종류</TableHead>
              <TableHead>고객</TableHead>
              <TableHead>품목</TableHead>
              <TableHead>사유</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>요청일</TableHead>
              <TableHead>처리 기한</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  불러오는 중
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  반품·교환이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              items.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected({ id: r.id, customerName: r.customerName })}>
                  <TableCell>{r.orderNo}</TableCell>
                  <TableCell>{RETURN_KIND_LABELS[r.kind]}</TableCell>
                  <TableCell>{r.customerName ?? '-'}</TableCell>
                  <TableCell>
                    {r.productSummary} · {r.quantity}개
                  </TableCell>
                  <TableCell>{RETURN_REASON_LABELS[r.reason as keyof typeof RETURN_REASON_LABELS] ?? r.reason}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <span>{statusLabel(r.kind, r.status)}</span>
                      {r.attention.map((a) => (
                        <Badge key={a} variant="destructive">
                          {RETURN_ATTENTION_LABELS[a]}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{formatKstDate(r.requestedAt)}</TableCell>
                  <TableCell
                    className={
                      r.attention.includes('refund_overdue') || r.attention.includes('exchange_overdue')
                        ? 'font-medium text-red-600'
                        : undefined
                    }
                  >
                    {r.arrivedAt ? formatKstDate(r.refundDueAt) : '-'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            이전
          </Button>
          <span className="self-center">
            {page} / {totalPages}
          </span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            다음
          </Button>
        </div>
      )}

      <CustomerReturnSheet
        id={selected?.id ?? null}
        customerName={selected?.customerName ?? null}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
