'use client';

import { Loader } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { SmsCampaignPreview, SmsGateCategory } from '@/lib/api/domains/sms-gate';
import { useCreateSmsCampaign, usePreviewSmsCampaign, useSmsAudience } from '@/lib/services/sms-gate';
import { CategoryRadio } from '../../components/category-radio';
import { MessageComposer } from '../../components/message-composer';
import { TemplatePanel } from '../../send/components/template-panel';
import { BulkConfirmDialog } from '../components/bulk-confirm-dialog';

export default function SmsBulkTemplate() {
  const router = useRouter();
  const { data: audience } = useSmsAudience();
  const previewCampaign = usePreviewSmsCampaign();
  const createCampaign = useCreateSmsCampaign();
  const [category, setCategory] = useState<SmsGateCategory>('INFORMATIONAL');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [scheduled, setScheduled] = useState(false);
  const [sendAtLocal, setSendAtLocal] = useState('');
  const [preview, setPreview] = useState<SmsCampaignPreview | null>(null);

  const isMarketing = category === 'MARKETING';
  const sendAt = scheduled && sendAtLocal ? new Date(sendAtLocal).toISOString() : null;
  const canSubmit =
    name.trim().length > 0 && content.trim().length > 0 && (!scheduled || sendAt !== null) && !previewCampaign.isPending;

  const handleOpenConfirm = () => {
    previewCampaign.mutate(
      { category, sendAt: sendAt ?? undefined },
      {
        onSuccess: setPreview,
        onError: (error) => toast.error(error.message || '발송 예상치를 불러오지 못했습니다.'),
      }
    );
  };

  const handleConfirm = () => {
    createCampaign.mutate(
      { name, category, content, sendAt: sendAt ?? undefined },
      {
        onSuccess: (result) => {
          toast.success(`${result.recipients.toLocaleString()}명에게 보낼 대량 발송을 만들었습니다.`);
          router.push('/messages/campaigns');
        },
        onError: (error) => toast.error(error.message || '대량 발송을 만들지 못했습니다.'),
      }
    );
  };

  return (
    <Container>
      <Header
        title="대량 메시지 전송"
        subtitle="활성 회원 전체에게 발송폰으로 문자를 보냅니다. 폰 한도만큼 하루하루 나가다가 전원에게 나가면 끝납니다."
      />

      <div className="flex flex-col gap-6 px-6 pb-6">
        <div className="flex flex-col gap-3 rounded-md border px-4 py-3">
          <div className="flex items-center gap-4">
            <Label className="w-28 shrink-0">구분</Label>
            <CategoryRadio value={category} onChange={setCategory} />
            {isMarketing && (
              <span className="text-muted-foreground text-xs">마케팅 수신 동의 회원에게만 발송됩니다.</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <Label htmlFor="campaign-name" className="w-28 shrink-0">
              발송 이름
            </Label>
            <Input
              id="campaign-name"
              className="w-80"
              placeholder="예: 추석 연휴 배송 안내"
              maxLength={255}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-4">
            <Label htmlFor="campaign-scheduled" className="w-28 shrink-0">
              예약 발송
            </Label>
            <Switch id="campaign-scheduled" checked={scheduled} onCheckedChange={setScheduled} />
            {scheduled && (
              <Input
                type="datetime-local"
                className="w-60"
                value={sendAtLocal}
                onChange={(e) => setSendAtLocal(e.target.value)}
              />
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr_280px]">
          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">메시지 작성</h3>
            <MessageComposer category={category} content={content} onChange={setContent}>
              <Button type="button" onClick={handleOpenConfirm} disabled={!canSubmit}>
                {previewCampaign.isPending ? <Loader className="animate-spin" /> : '발송하기'}
              </Button>
            </MessageComposer>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">대상</h3>
            <div className="flex flex-col gap-2 rounded-md border p-4 text-sm">
              {audience ? (
                <>
                  <p className="text-base font-semibold">
                    활성 회원 {audience.active.toLocaleString()}명 / 동의자 {audience.consented.toLocaleString()}명
                  </p>
                  <p className="text-muted-foreground">
                    휴대폰 번호가 있는 회원 {audience.withPhone.toLocaleString()}명 중{' '}
                    {isMarketing ? '마케팅 수신 동의자' : '전원'}에게 보냅니다. 같은 번호를 쓰는 계정은 한 통만
                    받습니다.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">대상 인원을 불러오는 중...</p>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">템플릿</h3>
            <TemplatePanel
              onSelect={(template) => {
                setContent(template.content);
                setCategory(template.category);
              }}
            />
          </section>
        </div>
      </div>

      <BulkConfirmDialog
        preview={preview}
        category={category}
        content={content}
        sendAt={sendAt}
        isSubmitting={createCampaign.isPending}
        onCancel={() => setPreview(null)}
        onConfirm={handleConfirm}
      />
    </Container>
  );
}
