'use client';

import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AdminRecurringBillingRow } from '@/lib/types/dto/wallet';
import { AdminRecurringContractSummary } from '@/lib/types/dto/membership';

type Props = {
  row: AdminRecurringBillingRow | null;
  contract?: AdminRecurringContractSummary;
  open: boolean;
  onClose: () => void;
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <span className="flex-1 break-all">{value ?? '-'}</span>
    </div>
  );
}

function CopyableId({ id }: { id: string | undefined | null }) {
  if (!id) return <span className="text-muted-foreground">-</span>;
  const short = id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-6)}` : id;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-xs">{short}</span>
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground"
        onClick={() => navigator.clipboard.writeText(id)}
        title="복사"
      >
        복사
      </button>
    </span>
  );
}

function providerTypeLabel(type: string | undefined): string {
  if (!type) return '-';
  const map: Record<string, string> = {
    CMS_BATCH: '자동이체(CMS)',
    TOSS_BILLING: '토스 빌링',
    NICEPAY_BILLING: '나이스페이 빌링',
  };
  return map[type] ?? type;
}

function cmsMemberStatusLabel(status: string | undefined): string {
  if (!status) return '-';
  const map: Record<string, string> = {
    PENDING: '심사 중',
    REGISTERED: '사용 가능',
    FAILED: '심사 실패',
    DELETED: '삭제됨',
  };
  return map[status] ?? status;
}

function withdrawalStatusLabel(status: string | undefined): string {
  if (!status) return '-';
  const map: Record<string, string> = {
    REQUESTED: '출금 예약',
    PROCESSING: '출금 처리 중',
    SUCCEEDED: '출금 성공',
    FAILED: '출금 실패',
    DELETED: '출금 취소',
  };
  return map[status] ?? status;
}

function intentStatusLabel(status: string | undefined): string {
  if (!status) return '-';
  const map: Record<string, string> = {
    PENDING_SETTLEMENT: '출금 결과 대기',
    AUTHORIZED: '결제 완료',
    CAPTURED: '결제 완료',
    FAILED: '결제 실패',
  };
  return map[status] ?? status;
}

function formatDate(str: string | null | undefined): string {
  if (!str) return '-';
  // CMS paymentDate is YYYYMMDD; ISO strings contain '-' or 'T'
  const date =
    /^\d{8}$/.test(str)
      ? new Date(`${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`)
      : new Date(str);
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function RecurringBillingDetailDialog({ row, contract, open, onClose }: Props) {
  if (!row) return null;

  const ps = row.providerState;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg overflow-y-auto max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>정기결제 상세</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">고객 정보</h3>
            <InfoRow
              label="고객 ID"
              value={
                <span className="inline-flex items-center gap-1">
                  <span className="font-mono text-xs">{row.userId}</span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => navigator.clipboard.writeText(row.userId ?? '')}
                    title="복사"
                  >
                    복사
                  </button>
                </span>
              }
            />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">멤버십 계약</h3>
            {contract ? (
              <>
                <InfoRow label="계약 ID" value={<CopyableId id={contract.contractId} />} />
                <InfoRow label="티어" value={contract.tierCode} />
                <InfoRow label="상태" value={contract.status} />
                <InfoRow label="자동 갱신" value={contract.autoRenewal ? '활성화' : '비활성화'} />
                <InfoRow label="다음 결제일" value={formatDate(contract.nextBillingDate)} />
                <InfoRow label="시작일" value={formatDate(contract.startsAt)} />
                <InfoRow label="종료일" value={formatDate(contract.endsAt)} />
              </>
            ) : (
              <Badge variant="outline">계약 정보 없음</Badge>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">결제수단</h3>
            <InfoRow label="제공사" value={providerTypeLabel(row.providerType)} />
            <InfoRow label="CMS 회원 ID" value={ps?.cmsMemberId} />
            <InfoRow label="심사 상태" value={cmsMemberStatusLabel(ps?.cmsMemberStatus)} />
            <InfoRow label="동의 상태" value={ps?.agreementStatus} />
          </section>

          {ps?.withdrawalId && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">출금 정보</h3>
              <InfoRow label="거래 ID" value={<CopyableId id={ps.transactionId} />} />
              <InfoRow label="출금일" value={formatDate(ps.paymentDate)} />
              <InfoRow
                label="출금 금액"
                value={row.amount != null ? `${row.amount.toLocaleString()}원` : '-'}
              />
              <InfoRow
                label="실제 출금액"
                value={row.actualAmount != null ? `${row.actualAmount.toLocaleString()}원` : '-'}
              />
              <InfoRow label="출금 상태" value={withdrawalStatusLabel(ps.withdrawalStatus)} />
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">결제 정보</h3>
            <InfoRow label="결제 의도 ID" value={<CopyableId id={row.paymentIntentId} />} />
            <InfoRow label="청구 ID" value={<CopyableId id={row.chargeId} />} />
            <InfoRow label="결제 상태" value={intentStatusLabel(row.paymentIntentStatus)} />
            <InfoRow label="청구 상태" value={row.chargeStatus} />
          </section>

          {(ps?.resultCode || ps?.resultMessage) && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">실패 사유</h3>
              {ps.resultCode && <InfoRow label="결과 코드" value={ps.resultCode} />}
              {ps.resultMessage && <InfoRow label="결과 메시지" value={ps.resultMessage} />}
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">빠른 이동</h3>
            <div className="flex flex-wrap gap-2">
              {row.userId && (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/membership/members?q=${row.userId}`} target="_blank">
                    멤버십 회원 조회
                  </Link>
                </Button>
              )}
              {row.paymentIntentId && (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/payments/${row.paymentIntentId}`} target="_blank">
                    결제 상세
                  </Link>
                </Button>
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
