'use client';

import { Loader } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type {
  AlimtalkCampaignPreview,
  AlimtalkCampaignTarget,
  AlimtalkMemberAudience,
  AlimtalkVariableBinding,
  CreateAlimtalkCampaignDto,
} from '@/lib/api/domains/alimtalk';
import {
  useAlimtalkRecipientGroups,
  useAlimtalkTemplates,
  useCreateAlimtalkCampaign,
  usePreviewAlimtalkCampaign,
} from '@/lib/services/alimtalk';
import { cn } from '@/lib/utils/ui';
import { KakaoBubble } from '../components/kakao-bubble';
import {
  defaultBinding,
  parseManualRecipients,
  renderVariables,
} from '../lib/alimtalk';
import { SendConfirmDialog } from './send-confirm-dialog';

const MEMBER_OPTIONS: {
  value: AlimtalkMemberAudience;
  label: string;
  hint: string;
}[] = [
  {
    value: 'NONE',
    label: '회원은 넣지 않음',
    hint: '아래 그룹·직접 입력한 번호에만 보냅니다.',
  },
  {
    value: 'MEMBERSHIP',
    label: '멤버십 회원만',
    hint: '지금 멤버십을 이용 중인 회원 중 휴대폰 번호가 있는 분.',
  },
  {
    value: 'ALL',
    label: '회원 전체',
    hint: '휴대폰 번호가 있는 회원 전원 (탈퇴·휴면 제외).',
  },
];

const errorMessage = (error: unknown, fallback: string) =>
  (error instanceof Error && error.message) || fallback;

export default function AlimtalkSendTemplate() {
  const router = useRouter();
  const templates = useAlimtalkTemplates();
  const groups = useAlimtalkRecipientGroups();
  const previewCampaign = usePreviewAlimtalkCampaign();
  const createCampaign = useCreateAlimtalkCampaign();

  const [templateCode, setTemplateCode] = useState('');
  const [bindings, setBindings] = useState<AlimtalkVariableBinding[]>([]);
  const [members, setMembers] = useState<AlimtalkMemberAudience>('NONE');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [manualText, setManualText] = useState('');
  const [name, setName] = useState('');
  const [scheduled, setScheduled] = useState(false);
  const [sendAtLocal, setSendAtLocal] = useState('');
  const [informational, setInformational] = useState(false);
  // 확인창이 보여준 요청 그대로 보낸다. id 는 확인창을 열 때 한 번 만들어, 두 번 눌러도 한 번만 만들어진다.
  const [confirming, setConfirming] = useState<{
    preview: AlimtalkCampaignPreview;
    request: CreateAlimtalkCampaignDto;
    targetNames: string[];
  } | null>(null);

  const approved = templates.data?.filter((t) => t.status === 'TSC03') ?? [];
  const template = approved.find((t) => t.templateCode === templateCode);

  // 효과가 아니라 고를 때 채운다 — 목록을 다시 받을 때마다(창 포커스 등) 입력한 값이 지워지지 않게.
  const chooseTemplate = (code: string) => {
    setTemplateCode(code);
    setBindings(
      approved
        .find((t) => t.templateCode === code)
        ?.variables.map(defaultBinding) ?? []
    );
  };

  const manual = parseManualRecipients(manualText);
  const sendAt =
    scheduled && sendAtLocal ? new Date(sendAtLocal).toISOString() : undefined;
  const hasTarget =
    members !== 'NONE' || groupIds.length > 0 || manual.length > 0;
  const bindingsFilled = bindings.every(
    (b) => b.source === 'RECIPIENT_NAME' || b.value.trim()
  );
  const canSubmit =
    !!template &&
    bindingsFilled &&
    hasTarget &&
    name.trim() &&
    (!scheduled || !!sendAt) &&
    informational &&
    !previewCampaign.isPending;
  const sampleValues = Object.fromEntries(
    bindings.map((b) => [
      b.name,
      b.source === 'RECIPIENT_NAME' ? '(받는 분 이름)' : b.value,
    ])
  );

  const toggleGroup = (id: string) =>
    setGroupIds(
      groupIds.includes(id)
        ? groupIds.filter((g) => g !== id)
        : [...groupIds, id]
    );

  const setBinding = (index: number, next: AlimtalkVariableBinding) =>
    setBindings(bindings.map((b, i) => (i === index ? next : b)));

  const openConfirm = () => {
    if (!template) return;
    const target: AlimtalkCampaignTarget = {
      templateCode: template.templateCode,
      members,
      groupIds,
      manual,
      variables: bindings,
    };
    const targetNames = [
      ...(members === 'ALL'
        ? ['회원 전체']
        : members === 'MEMBERSHIP'
          ? ['멤버십 회원']
          : []),
      ...groupIds.map(
        (id) =>
          `${groups.data?.find((g) => g.id === id)?.name ?? '(사라진 그룹)'} 그룹`
      ),
      ...(manual.length > 0 ? [`직접 입력 ${manual.length}명`] : []),
    ];
    previewCampaign.mutate(target, {
      onSuccess: (preview) =>
        setConfirming({
          preview,
          targetNames,
          request: {
            ...target,
            campaignId: crypto.randomUUID(),
            name: name.trim(),
            sendAt,
            confirmInformational: true,
          },
        }),
      onError: (error) =>
        toast.error(errorMessage(error, '받는 사람을 확인하지 못했습니다.')),
    });
  };

  const confirm = () => {
    if (!confirming) return;
    createCampaign.mutate(confirming.request, {
      onSuccess: (result) => {
        toast.success(
          result.created
            ? `${result.recipients.toLocaleString()}명에게 보낼 알림톡을 만들었습니다.`
            : '이미 만든 발송입니다. 발송 목록에서 확인하세요.'
        );
        router.push('/messages/alimtalk/campaigns');
      },
      onError: (error) =>
        toast.error(errorMessage(error, '알림톡 발송을 만들지 못했습니다.')),
    });
  };

  return (
    <Container>
      <Header
        title="알림톡 보내기"
        subtitle="승인된 알림톡 템플릿으로 고른 분들께 보냅니다. 카카오톡으로 못 받는 분께는 같은 내용이 문자로 대신 갑니다."
      />

      <div className="grid grid-cols-1 gap-6 px-6 pb-6 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-3 rounded-md border px-4 py-3">
            <h3 className="font-semibold">1. 템플릿</h3>
            <Select value={templateCode} onValueChange={chooseTemplate}>
              <SelectTrigger className="w-full sm:w-96">
                <SelectValue
                  placeholder={
                    templates.isLoading
                      ? '불러오는 중...'
                      : '승인된 템플릿을 고르세요'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {approved.map((t) => (
                  <SelectItem key={t.templateCode} value={t.templateCode}>
                    {t.templateName} ({t.templateCode})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {templates.data && approved.length === 0 && (
              <p className="text-muted-foreground text-xs">
                승인된 템플릿이 없습니다.{' '}
                <Link
                  href="/messages/alimtalk/templates"
                  className="underline underline-offset-2"
                >
                  템플릿 만들기
                </Link>
              </p>
            )}
            {templates.isError && (
              <p className="text-destructive text-xs">
                템플릿을 불러오지 못했습니다.
              </p>
            )}
          </section>

          {template && bindings.length > 0 && (
            <section className="flex flex-col gap-3 rounded-md border px-4 py-3">
              <h3 className="font-semibold">2. 바뀌는 자리 채우기</h3>
              {bindings.map((binding, i) => (
                <div
                  key={binding.name}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center"
                >
                  <span className="w-32 shrink-0 truncate font-mono text-xs">
                    #&#123;{binding.name}&#125;
                  </span>
                  <Select
                    value={binding.source}
                    onValueChange={(source) =>
                      setBinding(
                        i,
                        source === 'RECIPIENT_NAME'
                          ? { name: binding.name, source: 'RECIPIENT_NAME' }
                          : { name: binding.name, source: 'FIXED', value: '' }
                      )
                    }
                  >
                    <SelectTrigger className="sm:w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RECIPIENT_NAME">
                        받는 분 이름
                      </SelectItem>
                      <SelectItem value="FIXED">모두 같은 값</SelectItem>
                    </SelectContent>
                  </Select>
                  {binding.source === 'FIXED' && (
                    <Input
                      aria-label={`${binding.name} 값`}
                      placeholder="모두에게 같은 값"
                      maxLength={500}
                      value={binding.value}
                      onChange={(e) =>
                        setBinding(i, { ...binding, value: e.target.value })
                      }
                    />
                  )}
                </div>
              ))}
              <p className="text-muted-foreground text-xs">
                받는 분 이름은 회원은 회원 이름, 그룹은 그룹에 넣은 이름, 직접
                입력은 적은 이름(없으면 번호 뒤 4자리)입니다.
              </p>
            </section>
          )}

          <section className="flex flex-col gap-3 rounded-md border px-4 py-3">
            <h3 className="font-semibold">3. 받는 사람</h3>
            <RadioGroup
              value={members}
              onValueChange={(v) => setMembers(v as AlimtalkMemberAudience)}
              className="gap-2"
            >
              {MEMBER_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex items-start gap-2 text-sm"
                >
                  <RadioGroupItem value={option.value} className="mt-0.5" />
                  <span>
                    {option.label}
                    <span className="text-muted-foreground block text-xs">
                      {option.hint}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>

            <p className="text-muted-foreground mt-2 text-xs font-medium">
              수신자 그룹 (여러 개 고를 수 있음)
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {groups.data?.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  role="checkbox"
                  aria-checked={groupIds.includes(group.id)}
                  disabled={!group.allowed}
                  onClick={() => toggleGroup(group.id)}
                  className={cn(
                    'rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    groupIds.includes(group.id)
                      ? 'border-foreground bg-muted/60 ring-foreground ring-1'
                      : 'hover:bg-muted/40'
                  )}
                >
                  <span className="font-medium">{group.name}</span>{' '}
                  {group.recipients.toLocaleString()}명
                  {!group.allowed && (
                    <span className="text-muted-foreground block text-xs">
                      크롤링한 업소 번호라 알림톡으로 보낼 수 없습니다
                    </span>
                  )}
                </button>
              ))}
            </div>
            {groups.data?.length === 0 && (
              <p className="text-muted-foreground text-xs">
                만든 수신자 그룹이 없습니다.
              </p>
            )}

            <Label htmlFor="alimtalk-manual" className="mt-2">
              번호 직접 입력
            </Label>
            <Textarea
              id="alimtalk-manual"
              rows={4}
              placeholder={'한 줄에 한 명씩: 010-1234-5678, 홍길동'}
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {manual.length > 0 && `${manual.length.toLocaleString()}줄 · `}
              겹치는 번호는 한 통만, 휴대폰이 아닌 번호는 빼고 보냅니다.
            </p>
          </section>

          <section className="flex flex-col gap-3 rounded-md border px-4 py-3">
            <h3 className="font-semibold">4. 발송</h3>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Label htmlFor="alimtalk-name" className="w-24 shrink-0">
                발송 이름
              </Label>
              <Input
                id="alimtalk-name"
                className="sm:w-80"
                maxLength={255}
                placeholder="예: 10월 약관 변경 안내"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="alimtalk-scheduled" className="w-24 shrink-0">
                예약 발송
              </Label>
              <Switch
                id="alimtalk-scheduled"
                checked={scheduled}
                onCheckedChange={setScheduled}
              />
              {scheduled && (
                <Input
                  type="datetime-local"
                  className="w-60"
                  value={sendAtLocal}
                  onChange={(e) => setSendAtLocal(e.target.value)}
                />
              )}
            </div>
            <label className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <Checkbox
                checked={informational}
                onCheckedChange={(v) => setInformational(v === true)}
                className="mt-0.5"
              />
              <span>
                받는 분 모두에게 해당하는 <b>거래·계약 정보</b>
                (주문·결제·멤버십·약관 안내 등)이고 광고가 아닙니다. 우리와
                거래가 없는 번호에 보내거나 광고로 쓰면 카카오 정책 위반으로
                발송이 막힐 수 있습니다.
              </span>
            </label>
            <div className="flex justify-end">
              <Button type="button" onClick={openConfirm} disabled={!canSubmit}>
                {previewCampaign.isPending ? (
                  <Loader className="animate-spin" />
                ) : (
                  '확인하고 보내기'
                )}
              </Button>
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-2">
          <h3 className="font-semibold">미리보기</h3>
          {template ? (
            <KakaoBubble
              body={renderVariables(template.templateContent, sampleValues)}
              buttons={template.buttons}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              템플릿을 고르면 여기에 보입니다.
            </p>
          )}
        </aside>
      </div>

      <SendConfirmDialog
        state={confirming}
        buttons={template?.buttons ?? []}
        isSubmitting={createCampaign.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={confirm}
      />
    </Container>
  );
}
