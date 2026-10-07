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
import type { CreateSmsCampaignDto, SmsCampaignPreview, SmsGateCategory } from '@/lib/api/domains/sms-gate';
import {
  useCreateSmsCampaign,
  usePreviewSmsCampaign,
  useSmsAudience,
  useSmsRecipientGroups,
} from '@/lib/services/sms-gate';
import { HelpSheet } from '../../components/help-sheet';
import { OfflineBanner } from '../../components/offline-banner';
import { CategoryRadio } from '../../components/category-radio';
import { MessageComposer } from '../../components/message-composer';
import { TemplatePanel } from '../../send/components/template-panel';
import { BulkConfirmDialog } from '../components/bulk-confirm-dialog';
import { TargetPicker, type TargetSelection } from '../components/target-picker';

export default function SmsBulkTemplate() {
  const router = useRouter();
  const { data: audience } = useSmsAudience();
  const { data: groups } = useSmsRecipientGroups();
  const previewCampaign = usePreviewSmsCampaign();
  const createCampaign = useCreateSmsCampaign();
  const [category, setCategory] = useState<SmsGateCategory>('INFORMATIONAL');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [scheduled, setScheduled] = useState(false);
  const [sendAtLocal, setSendAtLocal] = useState('');
  // 확인창이 보여준 대상·구분·시각 그대로 발송한다. 미리보기 응답을 기다리는 사이 화면 값이 바뀌어도 새지 않는다.
  const [preview, setPreview] = useState<{
    result: SmsCampaignPreview;
    request: CreateSmsCampaignDto;
    targetNames: string[];
  } | null>(null);
  const [target, setTarget] = useState<TargetSelection>({ includeMembers: true, groupIds: [] });

  const isMarketing = category === 'MARKETING';
  // 목록에서 찾은 값이 아니라 선택값을 보낸다. 그룹이 사라져도 다른 대상으로 새지 않고 서버가 404 로 막는다.
  const selectedGroups = target.groupIds.map((id) => groups?.find((g) => g.id === id));
  const hasTarget = target.includeMembers || target.groupIds.length > 0;
  const sendAt = scheduled && sendAtLocal ? new Date(sendAtLocal).toISOString() : null;
  const canSubmit =
    name.trim().length > 0 &&
    content.trim().length > 0 &&
    (!scheduled || sendAt !== null) &&
    hasTarget &&
    selectedGroups.every(Boolean) &&
    !previewCampaign.isPending;

  const handleOpenConfirm = () => {
    const request: CreateSmsCampaignDto = {
      name,
      category,
      content,
      sendAt: sendAt ?? undefined,
      includeMembers: target.includeMembers,
      groupIds: target.groupIds,
    };
    const targetNames = [
      ...(target.includeMembers ? ['아몬드영 회원 전체'] : []),
      ...selectedGroups.map((g) => `${g?.name} 그룹`),
    ];
    previewCampaign.mutate(
      {
        category: request.category,
        sendAt: request.sendAt,
        includeMembers: request.includeMembers,
        groupIds: request.groupIds,
      },
      {
        onSuccess: (result) => setPreview({ result, request, targetNames }),
        onError: (error) => toast.error(error.message || '발송 예상치를 불러오지 못했습니다.'),
      }
    );
  };

  const handleConfirm = () => {
    if (!preview) return;
    createCampaign.mutate(
      preview.request,
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
        titleAside={<HelpSheet />}
        subtitle="아몬드영 회원 전체나 수신자 그룹에게 발송폰으로 문자를 보냅니다. 폰 한도만큼 하루하루 나가다가 전원에게 나가면 끝납니다."
      />

      <OfflineBanner />

      <div className="flex flex-col gap-6 px-6 pb-6">
        <div className="flex flex-col gap-3 rounded-md border px-4 py-3">
          <div className="flex items-center gap-4">
            <Label className="w-28 shrink-0">구분</Label>
            <CategoryRadio value={category} onChange={setCategory} />
            {isMarketing && (
              <span className="text-muted-foreground text-xs">
                마케팅 수신 동의 회원과, 수신거부하지 않은 그룹 번호에만 발송됩니다.
              </span>
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
            <MessageComposer category={category} content={content} onChange={setContent} trackedLinks>
              <Button type="button" onClick={handleOpenConfirm} disabled={!canSubmit}>
                {previewCampaign.isPending ? <Loader className="animate-spin" /> : '발송하기'}
              </Button>
            </MessageComposer>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">받는 사람</h3>
            <TargetPicker
              value={target}
              onChange={setTarget}
              audience={audience}
              groups={groups}
              isMarketing={isMarketing}
            />
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
        preview={preview?.result ?? null}
        targetNames={preview?.targetNames ?? []}
        category={preview?.request.category ?? category}
        content={preview?.request.content ?? content}
        sendAt={preview?.request.sendAt ?? null}
        isSubmitting={createCampaign.isPending}
        onCancel={() => setPreview(null)}
        onConfirm={handleConfirm}
      />
    </Container>
  );
}
