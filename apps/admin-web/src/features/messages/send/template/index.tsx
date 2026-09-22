'use client';

import { Loader } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NHN_ROUTE_VALUE, smsGateApi, type SmsGateCategory } from '@/lib/api/domains/sms-gate';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSendSmsGateMessage, useSmsDevices } from '@/lib/services/sms-gate';
import { HelpSheet } from '../../components/help-sheet';
import { OfflineBanner } from '../../components/offline-banner';
import { CategoryRadio } from '../../components/category-radio';
import { MessageComposer } from '../../components/message-composer';
import { NhnFallbackDialog } from '../components/nhn-fallback-dialog';
import { Recipient, RecipientList } from '../components/recipient-list';
import { SendResults } from '../components/send-results';
import { TemplatePanel } from '../components/template-panel';

const AUTO = 'auto';

export default function SmsSendTemplate() {
  const { data: deviceData } = useSmsDevices();
  const devices = (deviceData?.devices ?? []).filter((d) => d.enabled);
  const send = useSendSmsGateMessage();
  const [deviceId, setDeviceId] = useState(AUTO);
  const [category, setCategory] = useState<SmsGateCategory>('INFORMATIONAL');
  const [content, setContent] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [sentIds, setSentIds] = useState<string[]>([]);
  const [overflow, setOverflow] = useState<number | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const isMarketing = category === 'MARKETING';
  const isNhn = deviceId === NHN_ROUTE_VALUE;
  const selectedDeviceId = deviceId === AUTO || isNhn ? undefined : deviceId;

  const changeCategory = (next: SmsGateCategory) => {
    setCategory(next);
    if (next === 'MARKETING' && isNhn) setDeviceId(AUTO);
  };
  const targets = isMarketing
    ? recipients.filter((r) => r.marketingConsent)
    : recipients;
  const canSend =
    content.trim().length > 0 && targets.length > 0 && !send.isPending && !isChecking;

  const submit = (nhnFallback: boolean) => {
    setOverflow(null);
    send.mutate(
      {
        userIds: targets.map((r) => r.userId),
        content,
        category,
        deviceId: selectedDeviceId,
        route: isNhn ? 'NHN' : undefined,
        nhnFallback,
      },
      {
        onSuccess: (result) => {
          setSentIds(result.queued.map((q) => q.notificationId));
          setRecipients([]);
          if (result.skipped.length > 0) {
            toast.warning(
              `${result.skipped.length}명은 보내지 못했습니다: ${result.skipped[0].reason}`
            );
          }
          toast.success(
            `${result.queued.length}건을 발송 대기열에 넣었습니다.`
          );
        },
        onError: (error) =>
          toast.error(error.message || '발송에 실패했습니다.'),
      }
    );
  };

  const handleSend = async () => {
    if (isMarketing || isNhn) return submit(false);
    setIsChecking(true);
    try {
      const { remaining } = await smsGateApi.getCapacity(selectedDeviceId);
      if (remaining < targets.length) setOverflow(targets.length - remaining);
      else submit(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '발송폰 한도를 확인하지 못했습니다.');
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <Container>
      <Header
        title="개별 메시지 전송"
        titleAside={<HelpSheet />}
        subtitle="발송폰(SMS Gate) 또는 대표번호(NHN)로 회원에게 문자를 보냅니다."
      />

      <OfflineBanner />

      <div className="flex flex-col gap-6 px-6 pb-6">
        <div className="flex flex-col gap-3 rounded-md border px-4 py-3">
          <div className="flex items-center gap-4">
            <Label className="w-28 shrink-0">구분</Label>
            <CategoryRadio value={category} onChange={changeCategory} />
            {isMarketing && (
              <span className="text-muted-foreground text-xs">
                마케팅 수신 동의 회원에게만 발송되며, 21시~08시에는 보내지 않고
                대기합니다. 폰 한도가 소진되면 다음 날로 넘어갑니다.
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <Label className="w-28 shrink-0">보내는 번호</Label>
            <Select value={deviceId} onValueChange={setDeviceId}>
              <SelectTrigger className="w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value={AUTO}>자동 (한도가 남은 폰)</SelectItem>
                <SelectItem value={NHN_ROUTE_VALUE} disabled={isMarketing}>
                  대표번호 (NHN){isMarketing ? ' · 광고는 발송폰만' : ''}
                </SelectItem>
                {devices.map((d) => (
                  <SelectItem key={d.deviceId} value={d.deviceId}>
                    {d.name} · 잔여 {Math.max(0, d.dailyLimit - d.sentToday)}건
                    {d.online ? '' : ' · 오프라인'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr_1fr_280px]">
          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">메시지 작성</h3>
            <MessageComposer category={category} content={content} onChange={setContent}>
              <Button type="button" onClick={handleSend} disabled={!canSend}>
                {send.isPending || isChecking ? <Loader className="animate-spin" /> : '전송'}
              </Button>
            </MessageComposer>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">받는 번호 리스트</h3>
            <RecipientList
              recipients={recipients}
              onChange={setRecipients}
              category={category}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">전송 결과</h3>
            <SendResults ids={sentIds} devices={deviceData?.devices ?? []} />
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">템플릿</h3>
            <TemplatePanel
              onSelect={(template) => {
                setContent(template.content);
                changeCategory(template.category);
              }}
            />
          </section>
        </div>
      </div>

      <NhnFallbackDialog overflow={overflow} onCancel={() => setOverflow(null)} onConfirm={() => submit(true)} />
    </Container>
  );
}
