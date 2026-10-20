'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { useCreateRole } from '@/lib/services/roles';

const ROLE_ID = /^[a-z][a-z0-9_]{1,49}$/;

/** 새 역할(빈 권한) 또는 복제(지금 권한을 그대로 복사 — 복사한 뒤엔 원래 역할과 따로 움직인다). */
export function CreateRoleDialog({
  open,
  copyFrom,
  onOpenChange,
}: {
  open: boolean;
  copyFrom: { roleId: string; displayName: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const create = useCreateRole();
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const nameOk = ROLE_ID.test(name);

  const close = () => {
    setName('');
    setDisplayName('');
    setDescription('');
    onOpenChange(false);
  };

  const submit = () =>
    create.mutate(
      {
        name,
        displayName: displayName.trim(),
        description: description.trim() === '' ? undefined : description.trim(),
        copyFromRoleId: copyFrom?.roleId,
      },
      {
        onSuccess: (role) => {
          toast.success(
            copyFrom
              ? '역할을 복제했습니다.'
              : '역할을 만들었습니다. 권한을 켜세요.'
          );
          close();
          router.push(`/users/roles/${role.roleId}`);
        },
        onError: (e) => toast.error(e.message || '역할을 만들지 못했습니다.'),
      }
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {copyFrom ? `«${copyFrom.displayName}» 복제` : '새 역할'}
          </DialogTitle>
          <DialogDescription>
            {copyFrom
              ? '지금 이 역할이 가진 권한을 그대로 복사합니다. 복사한 뒤에는 원래 역할과 따로 움직입니다.'
              : '권한이 없는 빈 역할을 만들고, 다음 화면에서 권한을 켭니다.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="role-display">표시 이름</Label>
            <Input
              id="role-display"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="role-name">역할 ID</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-describedby="role-name-hint"
              aria-invalid={name !== '' && !nameOk}
              autoComplete="off"
            />
            <p id="role-name-hint" className="text-xs text-muted-foreground">
              영문 소문자로 시작하고 소문자·숫자·밑줄 2~50자. 만든 뒤에는 바꿀
              수 없습니다.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="role-desc">설명</Label>
            <Textarea
              id="role-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            취소
          </Button>
          <Button
            onClick={submit}
            disabled={!nameOk || displayName.trim() === '' || create.isPending}
          >
            {copyFrom ? '복제' : '만들기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
