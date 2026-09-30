'use client';

import { Loader } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  AlimtalkButton,
  AlimtalkCampaignPreview,
  CreateAlimtalkCampaignDto,
} from '@/lib/api/domains/alimtalk';
import { KakaoBubble } from '../components/kakao-bubble';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-2 border-b py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SendConfirmDialog({
  state,
  buttons,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  state: {
    preview: AlimtalkCampaignPreview;
    request: CreateAlimtalkCampaignDto;
    targetNames: string[];
  } | null;
  buttons: AlimtalkButton[];
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const preview = state?.preview;
  const blocked =
    !preview || preview.recipients === 0 || preview.missingVariables.length > 0;

  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>알림톡을 보낼까요?</DialogTitle>
        </DialogHeader>
        {state && preview && (
          <div className="flex flex-col">
            <Row label="템플릿">
              {preview.templateName}{' '}
              <span className="text-muted-foreground font-mono text-xs">
                {preview.templateCode}
              </span>
            </Row>
            <Row label="받는 사람">
              <div>{state.targetNames.join(' + ')}</div>
              <div className="font-semibold">
                {preview.recipients.toLocaleString()}명
              </div>
              <div className="text-muted-foreground text-xs">
                {preview.duplicates > 0 &&
                  `겹치는 번호 ${preview.duplicates.toLocaleString()}개는 한 통으로 · `}
                {preview.invalid > 0 &&
                  `휴대폰이 아닌 번호 ${preview.invalid.toLocaleString()}개 제외 · `}
                카카오에 {preview.batches.toLocaleString()}번에 나눠 요청합니다
              </div>
            </Row>
            <Row label="보내는 때">
              {state.request.sendAt
                ? `예약 ${new Date(state.request.sendAt).toLocaleString('ko-KR')}`
                : '지금 바로 (몇 분 안에 나갑니다)'}
            </Row>
            {preview.missingVariables.length > 0 && (
              <Row label="빠진 값">
                <span className="text-destructive">
                  {preview.missingVariables.map((v) => `#{${v}}`).join(', ')}{' '}
                  값을 정하세요
                </span>
              </Row>
            )}
            <Row label="첫 번째 분">
              {preview.sample ? (
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs">
                    {preview.sample.name} 님이 받는 모양
                  </span>
                  <KakaoBubble body={preview.sample.body} buttons={buttons} />
                </div>
              ) : (
                '보낼 대상이 없습니다'
              )}
            </Row>
            <Row label="요금">
              <span className="text-xs">
                알림톡 {preview.recipients.toLocaleString()}건. 카카오톡으로 못
                받는 분께는 문자로 대신 가며 문자 요금이 따로 듭니다(본문이 길면
                장문 요금).
              </span>
            </Row>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            취소
          </Button>
          <Button onClick={onConfirm} disabled={blocked || isSubmitting}>
            {isSubmitting ? <Loader className="animate-spin" /> : '보내기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
