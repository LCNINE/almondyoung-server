'use client';

import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useSmsDevices } from '@/lib/services/sms-gate';

export function OfflineBanner() {
  const { data } = useSmsDevices();
  if (!data) return null;
  const enabled = data.devices.filter((d) => d.enabled);
  const offline = enabled.filter((d) => !d.online);
  if (enabled.length > 0 && offline.length === 0) return null;

  return (
    <div className="mx-6 mb-4 flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-800">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>
        {enabled.length === 0
          ? '활성화된 발송폰이 없어 문자가 나가지 않습니다.'
          : `${offline.map((d) => d.name).join(', ')} 이(가) 오프라인입니다. 폰에서 SMS Gate 앱을 열어 연결을 확인하세요. 그동안 문자는 발송 대기로 쌓입니다.`}{' '}
        <Link href="/messages/devices" className="font-medium underline">
          발송폰 디바이스
        </Link>
      </span>
    </div>
  );
}
