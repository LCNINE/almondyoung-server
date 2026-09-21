'use client';

import { Loader } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { SmsCampaignPreview, SmsGateCategory } from '@/lib/api/domains/sms-gate';
import { composeSmsBody } from '../../lib/sms-body';
import { isLongSms, smsByteLength } from '../../lib/sms-bytes';

const formatInterval = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}분${rest > 0 ? ` ${rest}초` : ''}` : `${rest}초`;
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 border-b py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}

export function BulkConfirmDialog({
  preview,
  category,
  content,
  sendAt,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  preview: SmsCampaignPreview | null;
  category: SmsGateCategory;
  content: string;
  sendAt: string | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isMarketing = category === 'MARKETING';
  const finalBody = composeSmsBody(category, content);

  return (
    <Dialog open={preview !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>대량 발송을 시작할까요?</DialogTitle>
        </DialogHeader>
        {preview && (
          <div className="flex flex-col">
            <Row label="구분">{isMarketing ? '광고' : '정보'}</Row>
            <Row label="대상">
              {preview.recipients.toLocaleString()}명
              <span className="text-muted-foreground">
                {' '}
                (제외 {preview.excluded.toLocaleString()}명: 휴대폰 번호 없음
                {isMarketing ? ' · 마케팅 수신 미동의' : ''})
              </span>
            </Row>
            <Row label="경로">
              {preview.devices.length > 0
                ? `발송폰 ${preview.devices.map((d) => d.name).join(', ')}`
                : '지금 보낼 수 있는 발송폰이 없습니다'}
            </Row>
            <Row label="시간대·간격">
              <div>
                매일 {preview.window.start}~{preview.window.end}
              </div>
              {preview.devices.map((d) => (
                <div key={d.name} className="text-muted-foreground">
                  {d.name}: 하루 {d.dailyLimit}건 · {formatInterval(d.intervalSeconds)} 간격
                </div>
              ))}
            </Row>
            <Row label="앞 대기분">{preview.ahead.toLocaleString()}건</Row>
            <Row label="예상 일정">
              {preview.estimatedCompleteDate ? (
                <>
                  {sendAt && <div>예약 {new Date(sendAt).toLocaleString('ko-KR')}</div>}
                  <div>
                    {preview.estimatedStartDate} 시작 ~ {preview.estimatedCompleteDate} 완료
                  </div>
                  <div className="text-muted-foreground text-xs">
                    예상치입니다. 폰이 꺼지거나 개별 발송이 끼어들면 밀립니다.
                  </div>
                </>
              ) : (
                '계산할 수 없습니다 (보낼 수 있는 발송폰이 없음)'
              )}
            </Row>
            <Row label="최종 본문">
              <p className="rounded-md bg-neutral-50 p-2 whitespace-pre-wrap">{finalBody}</p>
              <p className="text-muted-foreground pt-1 text-xs">
                {smsByteLength(finalBody)} byte
                {isLongSms(finalBody) ? ' · 장문(여러 통으로 나뉘어 발송)' : ''} · {'{{이름}}'} 은 받는 회원
                이름으로 바뀝니다
              </p>
            </Row>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            취소
          </Button>
          <Button onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? <Loader className="animate-spin" /> : '발송 시작'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
