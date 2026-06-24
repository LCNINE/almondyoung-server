'use client';

import { useState } from 'react';
import { AxiosError } from 'axios';
import { Pencil, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CustomerProfile } from '@/lib/types/dto/customers';
import { useUpdateUser } from '@/lib/services/customers';
import { formatDate } from '@/lib/utils/date';
import { formatPhoneNumber, toE164 } from '@/lib/utils/phone';
import { Field, SectionCard } from './_ui';

function errMessage(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    return error.response?.data?.message || fallback;
  }
  return fallback;
}

export function BasicInfoSection({
  userId,
  customer,
}: {
  userId: string;
  customer: CustomerProfile;
}) {
  const profile = customer.profile;
  const update = useUpdateUser(userId);

  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState(customer.username ?? '');
  const [nickname, setNickname] = useState(customer.nickname ?? '');
  const [phone, setPhone] = useState(profile?.phoneNumber ?? '');
  const [birthDate, setBirthDate] = useState(
    profile?.birthDate ? profile.birthDate.slice(0, 10) : ''
  );

  const startEdit = () => {
    setUsername(customer.username ?? '');
    setNickname(customer.nickname ?? '');
    setPhone(profile?.phoneNumber ?? '');
    setBirthDate(profile?.birthDate ? profile.birthDate.slice(0, 10) : '');
    setEditing(true);
  };

  const handleSave = async () => {
    try {
      await update.mutateAsync({
        username: username.trim() || undefined,
        nickname: nickname.trim() || undefined,
        phoneNumber: phone ? toE164(phone) : undefined,
        birthDate: birthDate || undefined,
      });
      toast.success('기본정보가 수정되었습니다.');
      setEditing(false);
    } catch (error) {
      toast.error(errMessage(error, '기본정보 수정에 실패했습니다.'));
    }
  };

  return (
    <SectionCard
      title="기본정보"
      icon={<User className="size-4 text-indigo-500" />}
      action={
        !editing ? (
          <Button type="button" size="sm" variant="outline" onClick={startEdit}>
            <Pencil className="mr-1 h-3.5 w-3.5" />
            수정
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditing(false)}
              disabled={update.isPending}
            >
              취소
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={update.isPending}
            >
              {update.isPending ? '저장중...' : '저장'}
            </Button>
          </div>
        )
      }
    >
      {!editing ? (
        <div className="grid grid-cols-2 gap-x-8">
          <div>
            <Field label="아이디" value={customer.loginId} />
            <Field label="이름" value={customer.username} />
            <Field label="닉네임" value={customer.nickname} />
            <Field
              label="휴대폰"
              value={
                profile?.phoneNumber
                  ? formatPhoneNumber(profile.phoneNumber)
                  : null
              }
            />
          </div>
          <div>
            <Field label="Email" value={customer.email} />
            <Field
              label="이메일 인증"
              value={customer.isEmailVerified ? '인증완료' : '미인증'}
            />
            <Field label="생년월일" value={formatDate(profile?.birthDate)} />
            <Field label="주소" value={profile?.address} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-500">이름</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="이름"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-500">닉네임</Label>
            <Input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="닉네임"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-500">휴대폰</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01012345678"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-500">생년월일</Label>
            <Input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
            />
          </div>
        </div>
      )}
    </SectionCard>
  );
}
