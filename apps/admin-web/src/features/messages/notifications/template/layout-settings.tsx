'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Loader } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_EMAIL_LAYOUT, type EmailLayoutSettings } from '@packages/email-layout';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useEmailLayout, useUpdateEmailLayout } from '@/lib/services/notification';
import { MessagePreview } from '../components/message-preview';
import { MailImageUploadButton } from '../components/mail-image-upload-button';

const SAMPLE_BODY = [
  '## 주문이 접수되었습니다',
  '',
  '{{name}}님, 결제가 확인되어 주문이 정상 접수되었습니다.',
  '',
  '| 주문번호 | 결제금액 |',
  '| --- | --- |',
  '| {{orderNumber}} | {{total}}원 |',
  '',
  '[주문 내역 보기](https://almondyoung.com/kr/mypage/order/list)',
].join('\n');

const COLOR_FIELDS: { key: keyof EmailLayoutSettings; label: string }[] = [
  { key: 'brandColor', label: '강조색 (로고·링크)' },
  { key: 'textColor', label: '글자색' },
  { key: 'backgroundColor', label: '바깥 배경색' },
];

export default function EmailLayoutSettingsTemplate() {
  const layout = useEmailLayout();
  const updateLayout = useUpdateEmailLayout();
  const [draft, setDraft] = useState<EmailLayoutSettings>(DEFAULT_EMAIL_LAYOUT);

  useEffect(() => {
    if (layout.data) setDraft(layout.data);
  }, [layout.data]);

  if (layout.isLoading) {
    return (
      <Container>
        <Skeleton className="m-6 h-96" />
      </Container>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(layout.data ?? DEFAULT_EMAIL_LAYOUT);
  const set = (values: Partial<EmailLayoutSettings>) => setDraft((current) => ({ ...current, ...values }));

  const save = () =>
    updateLayout.mutate(draft, {
      onSuccess: () => toast.success('저장했습니다. 다음 발송부터 모든 메일에 적용됩니다.'),
      onError: (error) => toast.error(error.message || '저장하지 못했습니다.'),
    });

  return (
    <Container>
      <Header
        title="메일 양식"
        subtitle="로고·색·푸터처럼 모든 알림 메일에 똑같이 들어가는 부분입니다. 여기서 바꾸면 전체 메일에 한 번에 적용됩니다."
        right={
          <Button asChild variant="outline" size="sm">
            <Link href="/mall/marketing/messages">
              <ChevronLeft className="size-4" />
              목록으로
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 px-6 pb-6 lg:grid-cols-2">
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="logo-url">로고 이미지 주소</Label>
              <MailImageUploadButton onInsert={(_markdown, url) => set({ logoUrl: url })} />
            </div>
            <Input
              id="logo-url"
              value={draft.logoUrl ?? ''}
              placeholder="비우면 상호를 글자로 넣습니다"
              onChange={(e) => set({ logoUrl: e.target.value.trim() || null })}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            {COLOR_FIELDS.map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-2">
                <Label htmlFor={`color-${key}`}>{label}</Label>
                <div className="flex items-center gap-2">
                  <input
                    id={`color-${key}`}
                    type="color"
                    value={String(draft[key] ?? '#000000')}
                    onChange={(e) =>
                      set({
                        [key]: e.target.value,
                      } as Partial<EmailLayoutSettings>)
                    }
                    className="size-9 shrink-0 rounded border"
                  />
                  <Input
                    value={String(draft[key] ?? '')}
                    onChange={(e) =>
                      set({
                        [key]: e.target.value,
                      } as Partial<EmailLayoutSettings>)
                    }
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="footer-contact">푸터 · 문의 줄 (마크다운)</Label>
            <Input
              id="footer-contact"
              value={draft.footerContact}
              onChange={(e) => set({ footerContact: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="footer-business">푸터 · 사업자 정보</Label>
            <Textarea
              id="footer-business"
              value={draft.footerBusiness}
              onChange={(e) => set({ footerBusiness: e.target.value })}
              className="min-h-24 text-xs"
            />
            <p className="text-muted-foreground text-xs">
              줄바꿈 한 번이 한 줄입니다. 광고 메일에는 수신거부 안내가 자동으로 더 붙습니다.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={updateLayout.isPending}
              onClick={() => setDraft(DEFAULT_EMAIL_LAYOUT)}
            >
              기본값으로
            </Button>
            <Button type="button" disabled={!dirty || updateLayout.isPending} onClick={save}>
              {updateLayout.isPending ? <Loader className="animate-spin" /> : '저장'}
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="font-semibold">미리보기</h3>
          <MessagePreview
            channel="EMAIL"
            subject="[아몬드영] 주문이 접수되었습니다"
            body={SAMPLE_BODY}
            settings={draft}
          />
          <p className="text-muted-foreground text-xs">본문은 예시입니다. 실제 본문은 알림별 메시지 수정에서 씁니다.</p>
        </section>
      </div>
    </Container>
  );
}
