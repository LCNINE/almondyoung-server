'use client';

import type { SmsDeviceStatus, SmsGateMessageStatus } from '@/lib/api/domains/sms-gate';
import { useSmsGateMessages } from '@/lib/services/sms-gate';
import { cn } from '@/lib/utils/cn';
import { formatPhoneNumber } from '@/lib/utils/phone';

const STATUS_LABEL: Record<SmsGateMessageStatus, string> = {
  PENDING: '대기',
  PROCESSING: '발송 중',
  SENT: '접수 완료',
  FAILED: '실패',
  CANCELLED: '취소',
};

export function SendResults({ ids, devices }: { ids: string[]; devices: SmsDeviceStatus[] }) {
  const { data: messages } = useSmsGateMessages(ids);
  const deviceName = (deviceId: string | null) => devices.find((d) => d.deviceId === deviceId)?.name ?? deviceId;

  if (ids.length === 0) {
    return <p className="text-muted-foreground text-sm">전송하면 결과가 여기에 표시됩니다.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">
        접수 완료는 폰 중계 서버가 받았다는 뜻입니다. 고객 단말 도착 여부는 알 수 없습니다.
      </p>
      <ul className="rounded-md border">
        {(messages ?? []).map((m) => (
          <li key={m.notificationId} className="flex flex-col gap-0.5 border-b px-3 py-2 text-sm last:border-b-0">
            <div className="flex items-center justify-between">
              <span>
                {m.payload?.username} / {formatPhoneNumber(m.payload?.phoneNumber)}
              </span>
              <span
                className={cn(
                  'text-xs font-semibold',
                  m.status === 'SENT' && 'text-emerald-600',
                  m.status === 'FAILED' && 'text-destructive'
                )}
              >
                {STATUS_LABEL[m.status]}
              </span>
            </div>
            {m.metadata?.route === 'nhn' ? (
              <span className="text-muted-foreground text-xs">대표번호(NHN)</span>
            ) : (
              m.smsDeviceId && <span className="text-muted-foreground text-xs">{deviceName(m.smsDeviceId)}</span>
            )}
            {m.status === 'FAILED' && m.errorDetails?.message && (
              <span className="text-destructive text-xs">{m.errorDetails.message}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
