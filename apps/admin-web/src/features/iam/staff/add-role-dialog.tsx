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
import { useAddRoleMembers, useAdminRoles } from '@/lib/services/roles';

function StaffRoleChoices({
  roleId,
  onChange,
}: {
  roleId: string;
  onChange: (roleId: string) => void;
}) {
  const { data: roles } = useAdminRoles();
  return (
    <RadioGroup value={roleId} onValueChange={onChange} aria-label="더할 역할">
      {roles
        .filter((r) => r.audience === 'staff')
        .map((r) => (
          <div key={r.roleId} className="flex items-start gap-2">
            <RadioGroupItem
              id={`add-role-${r.roleId}`}
              value={r.roleId}
              className="mt-1"
            />
            <Label htmlFor={`add-role-${r.roleId}`} className="font-normal">
              <span className="font-medium">{r.displayName}</span>
              {r.description && (
                <span className="block text-xs text-muted-foreground">
                  {r.description}
                </span>
              )}
            </Label>
          </div>
        ))}
    </RadioGroup>
  );
}

/** 선택한 사람들에게 역할 하나를 «더한다». 이미 가진 역할은 그대로 두고, 이미 이 역할이 있으면 종료일만 바뀐다. */
export function AddRoleDialog({
  open,
  onOpenChange,
  userIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  onDone?: () => void;
}) {
  const [roleId, setRoleId] = useState('');
  const [until, setUntil] = useState('');
  const add = useAddRoleMembers(roleId);

  const close = () => {
    setRoleId('');
    setUntil('');
    onOpenChange(false);
  };

  const submit = () =>
    add.mutate(
      { userIds, expiresAt: until === '' ? null : until },
      {
        onSuccess: () => {
          toast.success(`${userIds.length}명에게 역할을 더했습니다.`);
          close();
          onDone?.();
        },
        onError: (e) => toast.error(e.message || '역할을 더하지 못했습니다.'),
      }
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>역할 추가</DialogTitle>
          <DialogDescription>
            선택한 {userIds.length}명에게 역할을 더합니다. 이미 가진 다른 역할은
            그대로 둡니다.
          </DialogDescription>
        </DialogHeader>
        <Suspense fallback={<Spinner />}>
          <StaffRoleChoices roleId={roleId} onChange={setRoleId} />
        </Suspense>
        <div className="space-y-1">
          <Label htmlFor="add-role-until">종료일(비우면 무기한)</Label>
          <Input
            id="add-role-until"
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            그날 자정(한국 시각)까지 유효합니다.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            취소
          </Button>
          <Button onClick={submit} disabled={roleId === '' || add.isPending}>
            {add.isPending ? '적용 중…' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
