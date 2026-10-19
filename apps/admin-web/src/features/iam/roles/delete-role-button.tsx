'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { BlockedReason } from '@/components/auth/blocked-reason';
import { Can } from '@/components/auth/can';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useDeleteRole } from '@/lib/services/roles';
import type { RoleDetail } from '@/lib/types/dto/iam';

/** 가진 사람이 있으면 지울 수 없다 — 먼저 회수하게 안내한다(서버도 같은 규칙으로 거절한다). */
export function DeleteRoleButton({ role }: { role: RoleDetail }) {
  const router = useRouter();
  const remove = useDeleteRole();
  const reason =
    role.memberCount > 0
      ? `이 역할을 가진 관리자 ${role.memberCount}명이 있습니다. 먼저 역할을 회수하세요.`
      : null;

  const confirm = () =>
    remove.mutate(
      { roleId: role.roleId, version: role.version },
      {
        onSuccess: () => {
          toast.success('역할을 지웠습니다.');
          router.push('/users/roles');
        },
        onError: (e) => toast.error(e.message || '역할을 지우지 못했습니다.'),
      }
    );

  return (
    <Can run={useDeleteRole}>
      <AlertDialog>
        <BlockedReason reason={reason}>
          {(blocked) =>
            reason ? (
              <Button
                variant="outline"
                className="text-destructive"
                {...blocked}
              >
                역할 삭제
              </Button>
            ) : (
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive">
                  역할 삭제
                </Button>
              </AlertDialogTrigger>
            )
          }
        </BlockedReason>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              «{role.displayName}» 역할을 지울까요?
            </AlertDialogTitle>
            <AlertDialogDescription>
              되돌릴 수 없습니다. 이 역할의 권한 목록은 변경 이력에 남습니다.
              기간이 지난 부여 기록이 남아 있으면 서버가 삭제를 거절합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              취소
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirm} disabled={remove.isPending}>
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Can>
  );
}
