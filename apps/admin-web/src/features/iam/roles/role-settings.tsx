'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Can } from '@/components/auth/can';
import { PermissionReadOnly } from '@/components/auth/permission-read-only';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { iamErrorCode, landingCandidates } from '@/lib/auth/role-editor';
import { useUpdateRole } from '@/lib/services/roles';
import { IAM_ERROR_CODES, type RoleDetail } from '@/lib/types/dto/iam';

const NONE = '__none__';

/** 표시 이름·설명·로그인 첫 화면. 역할 ID 는 바꾸지 않는다. */
export function RoleSettings({ role }: { role: RoleDetail }) {
  const update = useUpdateRole(role.roleId);
  const [displayName, setDisplayName] = useState(role.displayName);
  const [description, setDescription] = useState(role.description ?? '');
  const [landing, setLanding] = useState(role.landingPath ?? NONE);
  // 저장된 권한 기준 — 저장하지 않은 권한으로 고른 첫 화면은 저장 뒤 열리지 않을 수 있다.
  const candidates = landingCandidates(new Set(role.permissions));
  const locked = role.isSystem || role.audience === 'customer';

  const save = () =>
    update.mutate(
      {
        displayName: displayName.trim(),
        description: description.trim(),
        landingPath: landing === NONE ? null : landing,
        version: role.version,
      },
      {
        onSuccess: () => toast.success('설정을 저장했습니다.'),
        onError: (e) =>
          toast.error(
            iamErrorCode(e) === IAM_ERROR_CODES.versionStale
              ? '다른 사람이 먼저 이 역할을 바꿨습니다. 최신 내용을 불러왔으니 다시 확인하세요.'
              : e.message || '설정을 저장하지 못했습니다.'
          ),
      }
    );

  return (
    <PermissionReadOnly run={useUpdateRole}>
      <div className="max-w-lg space-y-4 py-2">
        <div className="space-y-1">
          <Label htmlFor="rs-id">역할 ID</Label>
          <Input
            id="rs-id"
            value={role.name}
            readOnly
            aria-describedby="rs-id-hint"
          />
          <p id="rs-id-hint" className="text-xs text-muted-foreground">
            로그인 토큰에 실리는 값이라 바꿀 수 없습니다.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="rs-display">표시 이름</Label>
          <Input
            id="rs-display"
            value={displayName}
            readOnly={locked}
            maxLength={100}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rs-desc">설명</Label>
          <Textarea
            id="rs-desc"
            value={description}
            readOnly={locked}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rs-landing">로그인 첫 화면</Label>
          <Select
            value={landing}
            onValueChange={locked ? undefined : setLanding}
            disabled={locked}
          >
            <SelectTrigger id="rs-landing">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>
                지정 안 함(권한으로 갈 수 있는 첫 메뉴)
              </SelectItem>
              {candidates.map((c) => (
                <SelectItem key={c.path} value={c.path}>
                  {c.title} ({c.path})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            로그인 직후 기본 화면으로 갈 때만 적용됩니다. 역할을 여럿 가진
            사람은 먼저 만들어진 역할의 첫 화면으로 갑니다.
          </p>
        </div>
        {!locked && (
          <Can run={useUpdateRole}>
            <Button
              onClick={save}
              disabled={update.isPending || displayName.trim() === ''}
            >
              저장
            </Button>
          </Can>
        )}
      </div>
    </PermissionReadOnly>
  );
}
