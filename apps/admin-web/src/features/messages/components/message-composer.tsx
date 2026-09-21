'use client';

import { useRef, type ReactNode } from 'react';
import type { SmsGateCategory } from '@/lib/api/domains/sms-gate';
import { MARKETING_FOOTER, MARKETING_PREFIX, composeSmsBody } from '../lib/sms-body';
import { isLongSms, smsByteLength } from '../lib/sms-bytes';
import { NameVariableButton } from './name-variable-button';
import { PhoneFrame } from './phone-frame';

export function MessageComposer({
  category,
  content,
  onChange,
  children,
}: {
  category: SmsGateCategory;
  content: string;
  onChange: (content: string) => void;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const isMarketing = category === 'MARKETING';
  const finalBody = composeSmsBody(category, content);

  return (
    <PhoneFrame screenClassName="bg-white p-3">
      {isMarketing && <div className="pb-1 text-sm text-neutral-900">{MARKETING_PREFIX}</div>}
      <textarea
        ref={contentRef}
        value={content}
        onChange={(e) => onChange(e.target.value)}
        placeholder="메시지를 입력해 주세요"
        className="flex-1 resize-none rounded-md border p-2 text-sm text-neutral-900 outline-none"
      />
      {isMarketing && <div className="pt-1 text-xs text-neutral-700">{MARKETING_FOOTER}</div>}
      <div className="pt-1">
        <NameVariableButton textareaRef={contentRef} value={content} onChange={onChange} />
      </div>
      <div className="py-1 text-right text-xs text-neutral-500">
        {smsByteLength(finalBody)} byte
        {isLongSms(finalBody) ? ' · 장문(여러 통으로 나뉘어 발송)' : ''}
      </div>
      {children}
    </PhoneFrame>
  );
}
