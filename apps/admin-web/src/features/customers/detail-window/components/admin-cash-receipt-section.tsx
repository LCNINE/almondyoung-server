'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { walletApi } from '@/lib/api/domains/wallet';
import type { AdminCashReceiptType } from '@/lib/types/dto/wallet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';

const TYPE_LABEL: Record<AdminCashReceiptType, string> = {
  소득공제: '소득공제 (개인)',
  지출증빙: '지출증빙 (사업자)',
};

const STATUS_LABEL: Record<string, string> = {
  ISSUED: '발급완료',
  CANCELED: '취소됨',
  FAILED: '발급실패',
};

/**
 * 주문 상세 다이얼로그 안의 현금영수증 섹션 (관리자).
 * 발급 내역 조회 + 미발급 시 관리자 직접 발급. 무통장입금·결제완료 건만 발급 가능(백엔드 검증).
 */
export function AdminCashReceiptSection({ intentId }: { intentId?: string }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<AdminCashReceiptType>('소득공제');
  const [identityNumber, setIdentityNumber] = useState('');

  const queryKey = ['admin-cash-receipts', intentId];
  const { data: receipts, isLoading } = useQuery({
    queryKey,
    queryFn: () => walletApi.getCashReceipts(intentId!),
    enabled: !!intentId,
  });

  const issueMutation = useMutation({
    mutationFn: () =>
      walletApi.issueCashReceipt({
        intentId: intentId!,
        type,
        customerIdentityNumber: identityNumber.replace(/[^0-9]/g, ''),
      }),
    onSuccess: () => {
      toast.success('현금영수증이 발급되었습니다.');
      setIdentityNumber('');
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? '현금영수증 발급에 실패했습니다.';
      toast.error(message);
    },
  });

  const issued = (receipts ?? []).filter((r) => r.status === 'ISSUED');
  const canIssue = !!intentId && issued.length === 0;

  function handleIssue() {
    const digits = identityNumber.replace(/[^0-9]/g, '');
    if (type === '소득공제' && (digits.length < 10 || digits.length > 11)) {
      toast.error('휴대폰번호를 정확히 입력해주세요.');
      return;
    }
    if (type === '지출증빙' && digits.length !== 10) {
      toast.error('사업자등록번호 10자리를 정확히 입력해주세요.');
      return;
    }
    issueMutation.mutate();
  }

  return (
    <section className="rounded-md border border-gray-100 bg-gray-50 px-3 py-3">
      <div className="mb-2 text-sm font-semibold text-gray-800">현금영수증</div>

      {!intentId ? (
        <p className="text-xs text-gray-400">
          결제 정보(intent)를 찾을 수 없어 현금영수증을 조회할 수 없습니다.
        </p>
      ) : isLoading ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : (
        <>
          {/* 발급 내역 */}
          {issued.length > 0 ? (
            <ul className="space-y-2">
              {issued.map((r) => (
                <li
                  key={r.id}
                  className="rounded border border-gray-200 bg-white px-3 py-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-gray-500">종류</span>
                    <span className="text-gray-900">{TYPE_LABEL[r.type]}</span>
                    <span className="text-gray-500">상태</span>
                    <span className="font-medium text-emerald-600">
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </div>
                  {r.issueNumber && (
                    <div className="mt-1 text-gray-600">
                      발급번호: {r.issueNumber}
                    </div>
                  )}
                  {r.receiptUrl && (
                    <a
                      href={r.receiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block font-medium text-blue-600 underline underline-offset-2"
                    >
                      영수증 보기
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-400">발급된 현금영수증이 없습니다.</p>
          )}

          {/* 관리자 발급 폼 (미발급 시) */}
          {canIssue && (
            <div className="mt-3 space-y-2 border-t border-gray-200 pt-3">
              <div className="flex items-center gap-2">
                <Select
                  value={type}
                  onValueChange={(v) => setType(v as AdminCashReceiptType)}
                >
                  <SelectTrigger className="h-8 w-[140px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="소득공제">소득공제 (개인)</SelectItem>
                    <SelectItem value="지출증빙">지출증빙 (사업자)</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={identityNumber}
                  onChange={(e) => setIdentityNumber(e.target.value)}
                  placeholder={
                    type === '소득공제' ? '휴대폰번호' : '사업자등록번호(10자리)'
                  }
                  inputMode="numeric"
                  className="h-8 flex-1 text-xs"
                />
                <Button
                  size="sm"
                  className="h-8"
                  disabled={issueMutation.isPending}
                  onClick={handleIssue}
                >
                  {issueMutation.isPending ? '발급 중…' : '발급'}
                </Button>
              </div>
              <p className="text-[11px] text-gray-400">
                무통장입금·결제완료 주문만 발급됩니다.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
