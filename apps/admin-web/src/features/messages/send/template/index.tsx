'use client';

import { Loader } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { SmsGateCategory } from '@/lib/api/domains/sms-gate';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSendSmsGateMessage, useSmsDevices } from '@/lib/services/sms-gate';
import { PhoneFrame } from '../../components/phone-frame';
import {
  MARKETING_FOOTER,
  MARKETING_PREFIX,
  composeSmsBody,
} from '../../lib/sms-body';
import { isLongSms, smsByteLength } from '../../lib/sms-bytes';
import { Recipient, RecipientList } from '../components/recipient-list';
import { SendResults } from '../components/send-results';

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

  const isMarketing = category === 'MARKETING';
  const finalBody = composeSmsBody(category, content);
  const bytes = smsByteLength(finalBody);
  const targets = isMarketing
    ? recipients.filter((r) => r.marketingConsent)
    : recipients;
  const canSend =
    content.trim().length > 0 && targets.length > 0 && !send.isPending;

  const handleSend = () => {
    send.mutate(
      {
        userIds: targets.map((r) => r.userId),
        content,
        category,
        deviceId: deviceId === AUTO ? undefined : deviceId,
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

  return (
    <Container>
      <Header
        title="개별 메시지 전송"
        subtitle="발송폰(SMS Gate)으로 회원에게 문자를 보냅니다."
      />

      <div className="flex flex-col gap-6 px-6 pb-6">
        <div className="flex flex-col gap-3 rounded-md border px-4 py-3">
          <div className="flex items-center gap-4">
            <Label className="w-28 shrink-0">구분</Label>
            <RadioGroup
              value={category}
              onValueChange={(value) => setCategory(value as SmsGateCategory)}
              className="flex gap-6"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="INFORMATIONAL" id="category-info" />
                <Label htmlFor="category-info" className="font-normal">
                  정보
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="MARKETING" id="category-marketing" />
                <Label htmlFor="category-marketing" className="font-normal">
                  광고
                </Label>
              </div>
            </RadioGroup>
            {isMarketing && (
              <span className="text-muted-foreground text-xs">
                마케팅 수신 동의 회원에게만 발송되며, 21시~08시에는 보내지 않고
                대기합니다.
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

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr_1fr]">
          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">메시지 작성</h3>
            <PhoneFrame screenClassName="bg-white p-3">
              {isMarketing && (
                <div className="pb-1 text-sm text-neutral-900">
                  {MARKETING_PREFIX}
                </div>
              )}
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="메시지를 입력해 주세요"
                className="flex-1 resize-none rounded-md border p-2 text-sm text-neutral-900 outline-none"
              />
              {isMarketing && (
                <div className="pt-1 text-xs text-neutral-700">
                  {MARKETING_FOOTER}
                </div>
              )}
              <div className="py-1 text-right text-xs text-neutral-500">
                {bytes} byte
                {isLongSms(content) ? ' · 장문(여러 통으로 나뉘어 발송)' : ''}
              </div>
              <Button type="button" onClick={handleSend} disabled={!canSend}>
                {send.isPending ? <Loader className="animate-spin" /> : '전송'}
              </Button>
            </PhoneFrame>
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
        </div>
      </div>
    </Container>
  );
}
