'use client';

import { X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { classifyLookupMatches } from '@/features/mall/marketing/coupons/lib/classify-lookup-matches';
import { customerApi } from '@/lib/api/domains/customer';
import { formatPhoneNumber } from '@/lib/utils/phone';

export interface Recipient {
  userId: string;
  name: string;
  phoneNumber: string | null;
}

export function RecipientList({
  recipients,
  onChange,
}: {
  recipients: Recipient[];
  onChange: (recipients: Recipient[]) => void;
}) {
  const [input, setInput] = useState('');
  const [isResolving, setIsResolving] = useState(false);

  const handleAdd = async () => {
    const query = input.trim();
    if (!query) return;
    setIsResolving(true);
    try {
      const users = await customerApi.getCustomersWithPagination({ q: query, limit: 10, status: 'active' });
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
      if (outcome.kind === 'ambiguous') {
        toast.error('두 명 이상 일치합니다. 아이디나 이메일로 입력해 주세요.');
        return;
      }
      const user = outcome.match;
      if (!user.phoneNumber) {
        toast.error(`${user.username} 회원은 휴대폰 번호가 없습니다.`);
        return;
      }
      if (recipients.some((r) => r.userId === user.id)) {
        toast.info('이미 추가된 회원입니다.');
        return;
      }
      onChange([...recipients, { userId: user.id, name: user.username, phoneNumber: user.phoneNumber }]);
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

      <div className="text-muted-foreground text-xs">받는 번호 {recipients.length}건</div>

      <ul className="min-h-[320px] flex-1 overflow-y-auto rounded-md border">
        {recipients.map((r) => (
          <li key={r.userId} className="flex items-center justify-between border-b px-3 py-2 text-sm last:border-b-0">
            <span>
              {r.name} / {formatPhoneNumber(r.phoneNumber)}
            </span>
            <button
              type="button"
              aria-label={`${r.name} 삭제`}
              onClick={() => onChange(recipients.filter((x) => x.userId !== r.userId))}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      <Button type="button" variant="outline" onClick={() => onChange([])} disabled={recipients.length === 0}>
        전체 삭제
      </Button>
    </div>
  );
}
