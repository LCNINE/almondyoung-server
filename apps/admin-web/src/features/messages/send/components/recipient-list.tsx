'use client';

import { X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SmsGateCategory } from '@/lib/api/domains/sms-gate';
import { cn } from '@/lib/utils/cn';
import {
  classifyLookupMatches,
  normalizePhone,
} from '@/features/mall/marketing/coupons/lib/classify-lookup-matches';
import { customerApi } from '@/lib/api/domains/customer';
import { formatPhoneNumber } from '@/lib/utils/phone';

export interface Recipient {
  userId: string;
  name: string;
  phoneNumber: string | null;
  marketingConsent: boolean;
}

export function RecipientList({
  recipients,
  onChange,
  category,
}: {
  recipients: Recipient[];
  onChange: (recipients: Recipient[]) => void;
  category: SmsGateCategory;
}) {
  const [input, setInput] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [hideNonConsented, setHideNonConsented] = useState(false);
  const isMarketing = category === 'MARKETING';
  const nonConsentedCount = recipients.filter(
    (r) => !r.marketingConsent
  ).length;
  const visible =
    isMarketing && hideNonConsented
      ? recipients.filter((r) => r.marketingConsent)
      : recipients;

  const handleAdd = async () => {
    const query = input.trim();
    if (!query) return;
    setIsResolving(true);
    try {
      const users = await customerApi.getCustomersWithPagination({
        q: query,
        limit: 10,
        status: 'active',
      });
      const outcome = classifyLookupMatches(
        query,
        users.data ?? [],
        (u) => [u.loginId, u.email, u.username, u.nickname],
        (u) => u.phoneNumber
      );
      if (outcome.kind === 'not_found') {
        toast.error('회원을 찾을 수 없습니다. 회원에게만 보낼 수 있습니다.');
        return;
      }
      let user;
      if (outcome.kind === 'ambiguous') {
        const phones = new Set(
          outcome.matches.map((m) => normalizePhone(m.phoneNumber))
        );
        if (phones.size !== 1 || phones.has('')) {
          toast.error('두 명 이상 일치합니다. 아이디나 이메일로 입력해 주세요.');
          return;
        }
        user =
          outcome.matches.find((m) => m.marketingConsent) ?? outcome.matches[0];
      } else {
        user = outcome.match;
      }
      if (!user.phoneNumber) {
        toast.error(`${user.username} 회원은 휴대폰 번호가 없습니다.`);
        return;
      }
      if (isMarketing && !user.marketingConsent) {
        toast.warning(
          `${user.username} 회원은 마케팅 수신에 동의하지 않아 광고 문자를 받을 수 없습니다.`
        );
        return;
      }
      const entry: Recipient = {
        userId: user.id,
        name: user.username,
        phoneNumber: user.phoneNumber,
        marketingConsent: user.marketingConsent,
      };
      const samePhone = recipients.find(
        (r) =>
          r.userId === user.id ||
          normalizePhone(r.phoneNumber) === normalizePhone(user.phoneNumber)
      );
      if (samePhone) {
        if (!samePhone.marketingConsent && user.marketingConsent) {
          onChange(recipients.map((r) => (r === samePhone ? entry : r)));
          setInput('');
          return;
        }
        toast.info('이미 추가된 회원입니다.');
        return;
      }
      onChange([...recipients, entry]);
      setInput('');
    } catch {
      toast.error('회원 조회에 실패했습니다.');
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex gap-2">
        <Input
          placeholder="휴대폰 번호 · 아이디 · 이메일"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <Button type="button" onClick={handleAdd} disabled={isResolving}>
          등록
        </Button>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          받는 번호 {recipients.length}건
          {isMarketing &&
            nonConsentedCount > 0 &&
            ` · 비동의 ${nonConsentedCount}건은 발송에서 제외`}
        </span>
        {isMarketing && (
          <div className="flex items-center gap-1.5">
            <Checkbox
              id="hide-non-consented"
              checked={hideNonConsented}
              onCheckedChange={(checked) =>
                setHideNonConsented(checked === true)
              }
            />
            <Label htmlFor="hide-non-consented" className="text-xs font-normal">
              비동의자 숨기기
            </Label>
          </div>
        )}
      </div>

      <ul className="min-h-[320px] flex-1 overflow-y-auto rounded-md border">
        {visible.map((r) => (
          <li
            key={r.userId}
            className={cn(
              'flex items-center justify-between border-b px-3 py-2 text-sm last:border-b-0',
              isMarketing && !r.marketingConsent && 'text-muted-foreground'
            )}
          >
            <span className="flex items-center gap-2">
              {r.name} / {formatPhoneNumber(r.phoneNumber)}
              {isMarketing && !r.marketingConsent && (
                <Badge variant="outline">비동의</Badge>
              )}
            </span>
            <button
              type="button"
              aria-label={`${r.name} 삭제`}
              onClick={() =>
                onChange(recipients.filter((x) => x.userId !== r.userId))
              }
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      <Button
        type="button"
        variant="outline"
        onClick={() => onChange([])}
        disabled={recipients.length === 0}
      >
        전체 삭제
      </Button>
    </div>
  );
}
