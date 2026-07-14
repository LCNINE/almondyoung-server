'use client';

import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/ui/spinner';
import { useAdminRoles } from '@/lib/services/roles';
import { useCreateAdminAccount } from '@/lib/services/users';
import type { CreateAdminAccountResult } from '@/lib/types/dto/user';

/**
 * 역할 라디오 그룹만 별도 컴포넌트로 분리한 이유: useAdminRoles() 는
 * useSuspenseQuery 라서, 이 부분만 로컬 Suspense 로 감싸야 다이얼로그 전체
 * (혹은 상위 페이지)가 role 목록 fetch 중에 fallback 으로 대체되지 않는다.
 */
function RoleRadioGroup({
  roleId,
  onChange,
}: {
  roleId: string;
  onChange: (roleId: string) => void;
}) {
  const { data: allRoles } = useAdminRoles();

  return (
    <RadioGroup value={roleId} onValueChange={onChange}>
      {(allRoles ?? []).map((role) => (
        <div key={role.roleId} className="flex items-start gap-2">
          <RadioGroupItem
            id={`admin-role-${role.roleId}`}
            value={role.roleId}
            className="mt-1"
          />
          <Label htmlFor={`admin-role-${role.roleId}`} className="font-normal">
            {role.name}
            {role.description && (
              <span className="ml-1 text-xs text-muted-foreground">
                {role.description}
              </span>
            )}
          </Label>
        </div>
      ))}
    </RadioGroup>
  );
}

export function CreateAdminDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [username, setUsername] = useState('');
  const [loginId, setLoginId] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [issued, setIssued] = useState<CreateAdminAccountResult | null>(null);

  const createMutation = useCreateAdminAccount();

  const reset = () => {
    setUsername('');
    setLoginId('');
    setEmail('');
    setRoleId('');
    setIssued(null);
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    const trimmedUsername = username.trim();
    const trimmedLoginId = loginId.trim();
    const trimmedEmail = email.trim();

    if (!trimmedUsername) {
      toast.error('이름을 입력하세요.');
      return;
    }
    if (!trimmedLoginId) {
      toast.error('로그인 ID를 입력하세요.');
      return;
    }
    if (!trimmedEmail) {
      toast.error('이메일을 입력하세요.');
      return;
    }
    if (!roleId) {
      toast.error('역할을 선택하세요.');
      return;
    }

    try {
      const res = await createMutation.mutateAsync({
        username: trimmedUsername,
        nickname: trimmedUsername,
        loginId: trimmedLoginId,
        email: trimmedEmail,
        roleId,
      });
      setIssued(res);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : '관리자 계정 생성에 실패했어요.'
      );
    }
  };

  const handleCopy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.initialPassword);
      toast.success('초기 비밀번호를 클립보드에 복사했어요.');
    } catch {
      toast.error('복사에 실패했어요. 직접 선택해서 복사해 주세요.');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          handleClose();
        } else {
          onOpenChange(o);
        }
      }}
    >
      <DialogContent>
        {issued ? (
          <>
            <DialogHeader>
              <DialogTitle>관리자 계정이 생성되었어요</DialogTitle>
              <DialogDescription>
                초기 비밀번호는 지금만 표시됩니다. 첫 로그인 시 변경해야 합니다.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="issued-login-id">로그인 ID</Label>
                <Input id="issued-login-id" value={issued.user.loginId} readOnly />
              </div>
              <div className="space-y-2">
                <Label htmlFor="issued-password">초기 비밀번호</Label>
                <div className="flex gap-2">
                  <Input
                    id="issued-password"
                    value={issued.initialPassword}
                    readOnly
                    className="font-mono"
                  />
                  <Button type="button" variant="outline" onClick={handleCopy}>
                    복사
                  </Button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleClose}>닫기</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>관리자 추가</DialogTitle>
              <DialogDescription>
                초기 비밀번호는 서버가 자동 생성합니다. 생성 후 1회에 한해 화면에
                노출됩니다.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="admin-username">이름</Label>
                <Input
                  id="admin-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="홍길동"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-login-id">로그인 ID</Label>
                <Input
                  id="admin-login-id"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="admin01"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-email">이메일</Label>
                <Input
                  id="admin-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label>역할</Label>
                <Suspense
                  fallback={
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Spinner size="sm" />
                      역할 불러오는 중...
                    </div>
                  }
                >
                  <RoleRadioGroup roleId={roleId} onChange={setRoleId} />
                </Suspense>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={createMutation.isPending}
              >
                취소
              </Button>
              <Button onClick={handleSubmit} disabled={createMutation.isPending}>
                {createMutation.isPending ? '생성 중...' : '생성'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
