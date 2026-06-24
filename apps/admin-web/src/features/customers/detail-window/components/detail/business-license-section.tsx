'use client';

import { useState } from 'react';
import { AxiosError } from 'axios';
import { BadgeCheck, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBusinessLicenseByUser, useUpdateBusinessLicense } from '@/lib/services/customers';
import { Field, SectionCard } from './_ui';

function errMessage(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    return error.response?.data?.message || fallback;
  }
  return fallback;
}

export function BusinessLicenseSection({ userId }: { userId: string }) {
  const { data: license, isLoading } = useBusinessLicenseByUser(userId);
  const update = useUpdateBusinessLicense(userId);

  const [editing, setEditing] = useState(false);
  const [businessNumber, setBusinessNumber] = useState('');
  const [representativeName, setRepresentativeName] = useState('');

  const startEdit = () => {
    if (!license) return;
    setBusinessNumber(license.businessNumber ?? '');
    setRepresentativeName(license.representativeName ?? '');
    setEditing(true);
  };

  const handleSave = async () => {
    if (!license) return;
    try {
      await update.mutateAsync({
        businessId: license.id,
        dto: {
          userId,
          businessNumber: businessNumber.trim(),
          representativeName: representativeName.trim(),
        },
      });
      toast.success('사업자 정보가 수정되었습니다.');
      setEditing(false);
    } catch (error) {
      toast.error(errMessage(error, '사업자 정보 수정에 실패했습니다.'));
    }
  };

  return (
    <SectionCard
      title="사업자정보"
      icon={<BadgeCheck className="size-4 text-emerald-500" />}
      action={
        license && !editing ? (
          <Button type="button" size="sm" variant="outline" onClick={startEdit}>
            <Pencil className="mr-1 h-3.5 w-3.5" />
            수정
          </Button>
        ) : license && editing ? (
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
        ) : null
      }
    >
      {isLoading ? (
        <div className="text-sm text-gray-400">불러오는 중…</div>
      ) : !license ? (
        <div className="py-6 text-center text-sm text-gray-400">
          등록된 사업자 정보가 없습니다.
        </div>
      ) : !editing ? (
        <div>
          <Field label="사업자번호" value={license.businessNumber} />
          <Field label="대표자명" value={license.representativeName} />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-500">사업자번호</Label>
            <Input
              value={businessNumber}
              onChange={(e) => setBusinessNumber(e.target.value)}
              placeholder="사업자번호"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-500">대표자명</Label>
            <Input
              value={representativeName}
              onChange={(e) => setRepresentativeName(e.target.value)}
              placeholder="대표자명"
            />
          </div>
        </div>
      )}
    </SectionCard>
  );
}
