'use client';

import { LockIcon, MessageSquareIcon, PencilIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SmsDeviceStatus } from '@/lib/api/domains/sms-gate';
import { cn } from '@/lib/utils/cn';
import { PhoneFrame } from '../../components/phone-frame';
import { formatDisconnectedSince } from '../../lib/device-status';

const timeFormat = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
const dateFormat = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function DeviceCard({ device, onEdit }: { device: SmsDeviceStatus; onEdit: () => void }) {
  const now = useNow();
  const remaining = Math.max(0, device.dailyLimit - device.sentToday);

  return (
    <PhoneFrame screenClassName="bg-[linear-gradient(160deg,#818cf8,#4f46e5_45%,#1e293b)] text-white">
      <div className="flex items-center justify-between px-5 pt-2.5 text-[11px] font-light">
        <span className="truncate">{device.name}</span>
        <span className="flex items-center gap-1">
          <span className={cn('h-2 w-2 rounded-full', device.online ? 'bg-emerald-400' : 'bg-red-400')} />
          {device.online ? '온라인' : '오프라인'}
        </span>
      </div>

      <div className="mt-3 flex flex-col items-center">
        <LockIcon className="mb-1.5 h-3.5 w-3.5" strokeWidth={2} />
        <div className="text-[52px] leading-none font-thin tracking-tight">{timeFormat.format(now)}</div>
        <div className="mt-1 text-[13px] font-light">{dateFormat.format(now)}</div>
      </div>

      <div className="mt-6 px-2.5">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`${device.name} 디바이스 편집`}
          className="group block w-full cursor-pointer rounded-xl bg-white/60 px-2.5 py-2 text-left text-[#212426] shadow-sm backdrop-blur-sm transition hover:bg-white/85 hover:shadow-md hover:ring-2 hover:ring-white/80"
        >
          <div className="flex items-center gap-1.5">
            <div className="flex h-3.5 w-3.5 items-center justify-center rounded-[4px] bg-gradient-to-b from-[#66ca3b] to-[#07bf38]">
              <MessageSquareIcon className="h-2.5 w-2.5 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-[8px] font-light tracking-wide text-[#45505c] uppercase">Messages</span>
            <PencilIcon
              className="ml-auto h-3 w-3 text-[#45505c] opacity-0 transition-opacity group-hover:opacity-100"
              strokeWidth={2}
            />
          </div>
          <div className="mt-1 truncate text-[12px] font-bold">{device.name}</div>
          <div className="text-[11px] leading-snug font-light">
            <div>
              오늘 {device.sentToday.toLocaleString()} / {device.dailyLimit.toLocaleString()}건 · 잔여{' '}
              {remaining.toLocaleString()}건
            </div>
            {!device.online && <div>{formatDisconnectedSince(device.lastSeen, now)}</div>}
            {!device.enabled && <div className="font-bold text-red-600">비활성</div>}
          </div>
        </button>
      </div>

      <div className="absolute inset-x-0 bottom-3 truncate px-4 text-center text-[10px] text-white/70">
        {device.deviceId}
      </div>
    </PhoneFrame>
  );
}
