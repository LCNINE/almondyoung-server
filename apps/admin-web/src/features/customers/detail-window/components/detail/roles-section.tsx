'use client';

import { useEffect, useState } from 'react';
import { AxiosError } from 'axios';
import { Pencil, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useSetUserRoles, useUserRoles } from '@/lib/services/customers';
import { useAdminRoles } from '@/lib/services/roles';
import { SectionCard } from './_ui';

function errMessage(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    return error.response?.data?.message || fallback;
  }
  return fallback;
}

export function RolesSection({ userId }: { userId: string }) {
  const { data: allRoles, isLoading: rolesLoading } = useAdminRoles();
  const { data: userRoles, isLoading: userRolesLoading } = useUserRoles(userId);
  const setRoles = useSetUserRoles(userId);

  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const currentIds = (userRoles ?? []).map((r) => r.roleId);

  useEffect(() => {
    if (!editing) setSelected(new Set(currentIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRoles, editing]);

  const toggle = (roleId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  };

  const handleSave = async () => {
    try {
      await setRoles.mutateAsync([...selected]);
      toast.success('역할이 변경되었습니다.');
      setEditing(false);
    } catch (error) {
      toast.error(errMessage(error, '역할 변경에 실패했습니다.'));
    }
  };

  return (
    <SectionCard
      title="회원등급 / 역할"
      icon={<ShieldCheck className="size-4 text-amber-500" />}
      action={
        !editing ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditing(true)}
          >
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
              disabled={setRoles.isPending}
            >
              취소
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={setRoles.isPending}
            >
              {setRoles.isPending ? '저장중...' : '저장'}
            </Button>
          </div>
        )
      }
    >
      {rolesLoading || userRolesLoading ? (
        <div className="text-sm text-gray-400">불러오는 중…</div>
      ) : !editing ? (
        <div className="flex flex-wrap gap-1.5">
          {currentIds.length === 0 ? (
            <span className="text-sm text-gray-400">부여된 역할 없음</span>
          ) : (
            (userRoles ?? []).map((r) => (
              <Badge key={r.roleId} variant="secondary">
                {r.name}
              </Badge>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {(allRoles ?? []).map((r) => (
            <label
              key={r.roleId}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <Checkbox
                checked={selected.has(r.roleId)}
                onCheckedChange={() => toggle(r.roleId)}
              />
              <span className="text-gray-900">{r.name}</span>
              {r.description && (
                <span className="text-xs text-gray-400">{r.description}</span>
              )}
            </label>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
