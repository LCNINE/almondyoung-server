'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { TwoColumnPage } from '@/components/admin-ui-experimental/layout';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe, useMyRoles } from '@/lib/services/users';
import { useUpdateMyProfile, useChangePassword } from '@/lib/services/users';
import type { User, UserRolesResponseDto } from '@/lib/types';
import { formatDate, formatDateTime } from '@/lib/utils/date';
import { CheckCircle, Lock, Shield, XCircle } from 'lucide-react';

const profileSchema = z.object({
  username: z
    .string()
    .min(2, '이름은 최소 2자 이상이어야 합니다.')
    .max(8, '이름은 최대 8자 이하여야 합니다.'),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, '현재 비밀번호를 입력해주세요.'),
    newPassword: z
      .string()
      .min(8, '새 비밀번호는 최소 8자 이상이어야 합니다.')
      .max(100, '비밀번호가 너무 깁니다.'),
    confirmPassword: z.string().min(1, '비밀번호 확인을 입력해주세요.'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: '새 비밀번호가 일치하지 않습니다.',
    path: ['confirmPassword'],
  });

type ProfileForm = z.infer<typeof profileSchema>;
type PasswordForm = z.infer<typeof passwordSchema>;

const ROLE_COLOR: Record<string, string> = {
  MASTER: 'bg-purple-100 text-purple-700 border-purple-200',
  ADMIN: 'bg-blue-100 text-blue-700 border-blue-200',
};

const ROLE_LABEL: Record<string, string> = {
  MASTER: '마스터 관리자',
  ADMIN: '관리자',
};

function getRoleColor(name: string) {
  return ROLE_COLOR[name.toUpperCase()] ?? 'bg-gray-100 text-gray-700';
}

function getRoleLabel(name: string) {
  return ROLE_LABEL[name.toUpperCase()] ?? name;
}

type GroupedRole = {
  role: { id: string; name: string };
  scopes: { scope_name: string; description: string }[];
};

function groupRoles(roles: UserRolesResponseDto['roles']): GroupedRole[] {
  const map = new Map<string, GroupedRole>();
  for (const { role, scopes } of roles) {
    if (!map.has(role.id)) {
      map.set(role.id, { role, scopes: [] });
    }
    const entry = map.get(role.id)!;
    const scopeList = Array.isArray(scopes) ? scopes : scopes ? [scopes as { scope_name: string; description: string }] : [];
    entry.scopes.push(...scopeList);
  }
  return Array.from(map.values());
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-2 py-3">
      <span className="text-sm text-muted-foreground font-medium">{label}</span>
      <span className="text-sm text-foreground">{value ?? '-'}</span>
    </div>
  );
}

interface MeProps {
  me: User | undefined;
  isLoading: boolean;
}

interface RolesProps {
  myRoles: UserRolesResponseDto | undefined;
  isLoading: boolean;
}

function ProfileHeader({
  me,
  myRoles,
  isLoading,
  isRolesLoading,
}: MeProps & { myRoles: UserRolesResponseDto | undefined; isRolesLoading: boolean }) {
  const initials = me?.username?.slice(0, 2).toUpperCase() ?? '?';

  return (
    <div className="bg-white rounded-lg shadow-[0px_0px_0px_2px_rgba(0,0,0,0.12)] p-6">
      <div className="flex items-center gap-5">
        <Avatar className="w-16 h-16 shrink-0">
          <AvatarFallback className="bg-primary text-primary-foreground text-xl font-bold">
            {isLoading ? '?' : initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-foreground">{me?.username}</h1>
                {!isRolesLoading &&
                  myRoles?.roles &&
                  groupRoles(myRoles.roles).map(({ role }) => (
                    <Badge key={role.id} variant="outline" className={getRoleColor(role.name)}>
                      {getRoleLabel(role.name)}
                    </Badge>
                  ))}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
                <span>@{me?.loginId}</span>
                <span>{me?.email}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                가입일 {formatDate(me?.createdAt)}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileInfoSection({ me, isLoading }: MeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const { mutateAsync: updateProfile, isPending } = useUpdateMyProfile();

  const form = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    values: { username: me?.username ?? '' },
  });

  const onSubmit = async (values: ProfileForm) => {
    try {
      await updateProfile({ username: values.username });
      toast.success('기본 정보가 저장되었습니다.');
      setIsEditing(false);
    } catch {
      toast.error('저장에 실패했습니다. 다시 시도해주세요.');
    }
  };

  return (
    <Container className="divide-y">
      <Header
        title="기본 정보"
        right={
          !isEditing ? (
            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
              편집
            </Button>
          ) : null
        }
      />
      <div className="px-6 py-2">
        {isLoading ? (
          <div className="space-y-3 py-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : isEditing ? (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="py-2 space-y-4">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm text-muted-foreground font-medium">
                      이름
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="이름을 입력하세요" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground font-medium">이메일</p>
                <p className="text-sm text-muted-foreground">{me?.email}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground font-medium">로그인 ID</p>
                <p className="text-sm text-muted-foreground">{me?.loginId}</p>
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? '저장 중…' : '저장'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    form.reset();
                    setIsEditing(false);
                  }}
                >
                  취소
                </Button>
              </div>
            </form>
          </Form>
        ) : (
          <>
            <InfoRow label="이름" value={me?.username} />
            <Separator />
            <InfoRow label="이메일" value={me?.email} />
            <Separator />
            <InfoRow label="로그인 ID" value={me?.loginId} />
            <Separator />
            <InfoRow label="가입일" value={formatDate(me?.createdAt)} />
            <Separator />
            <InfoRow
              label="최근 활동일"
              value={me?.lastActivityAt ? formatDateTime(me.lastActivityAt) : '-'}
            />
          </>
        )}
      </div>
    </Container>
  );
}

function SecuritySection() {
  const { mutateAsync: changePassword, isPending } = useChangePassword();

  const form = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = async (values: PasswordForm) => {
    try {
      await changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast.success('비밀번호가 변경되었습니다.');
      form.reset();
    } catch {
      toast.error('비밀번호 변경에 실패했습니다. 현재 비밀번호를 확인해주세요.');
    }
  };

  return (
    <Container className="divide-y">
      <Header
        title="보안 설정"
        subtitle="비밀번호를 주기적으로 변경하면 계정을 안전하게 유지할 수 있습니다."
      />
      <div className="px-6 py-4">
        <div className="flex items-center gap-2 mb-4">
          <Lock className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">비밀번호 변경</span>
        </div>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 max-w-sm">
            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>현재 비밀번호</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="현재 비밀번호 입력" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>새 비밀번호</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="8자 이상 입력" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>새 비밀번호 확인</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="새 비밀번호 재입력" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? '변경 중…' : '비밀번호 변경'}
            </Button>
          </form>
        </Form>
      </div>
    </Container>
  );
}

function RolesSection({ myRoles, isLoading }: RolesProps) {
  return (
    <Container className="divide-y">
      <Header title="역할 & 권한" />
      <div className="px-6 py-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : !myRoles?.roles?.length ? (
          <p className="text-sm text-muted-foreground">할당된 역할이 없습니다.</p>
        ) : (
          <div className="space-y-4">
            {groupRoles(myRoles.roles).map(({ role, scopes }) => (
              <div key={role.id}>
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-muted-foreground" />
                  <Badge variant="outline" className={getRoleColor(role.name)}>
                    {getRoleLabel(role.name)}
                  </Badge>
                </div>
                {scopes.length > 0 && (
                  <div className="ml-6 flex flex-wrap gap-1.5">
                    {scopes.map((s) => (
                      <span
                        key={s.scope_name}
                        title={s.description || undefined}
                        className="text-xs font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded"
                      >
                        {s.scope_name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Container>
  );
}

function AccountStatusSection({ me, isLoading }: MeProps) {
  return (
    <Container className="divide-y">
      <Header title="계정 상태" />
      <div className="px-6 py-2">
        {isLoading ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
          </div>
        ) : (
          <>
            <InfoRow
              label="이메일 인증"
              value={
                me?.isEmailVerified ? (
                  <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                    <CheckCircle className="w-4 h-4" />
                    인증 완료
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-red-500 font-medium">
                    <XCircle className="w-4 h-4" />
                    미인증
                  </span>
                )
              }
            />
            <Separator />
            <InfoRow
              label="계정 상태"
              value={
                me?.deletedAt ? (
                  <span className="inline-flex items-center gap-1 text-red-500 font-medium">
                    <XCircle className="w-4 h-4" />
                    비활성
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                    <CheckCircle className="w-4 h-4" />
                    활성
                  </span>
                )
              }
            />
          </>
        )}
      </div>
    </Container>
  );
}

export function MyAccountTemplate() {
  const { data: me, isLoading: isMeLoading } = useMe();
  const { data: myRoles, isLoading: isRolesLoading } = useMyRoles();

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">내 계정</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          내 계정 정보를 확인하고 관리합니다.
        </p>
      </div>

      <ProfileHeader
        me={me}
        isLoading={isMeLoading}
        myRoles={myRoles}
        isRolesLoading={isRolesLoading}
      />

      <TwoColumnPage>
        <TwoColumnPage.Main>
          <ProfileInfoSection me={me} isLoading={isMeLoading} />
          <SecuritySection />
        </TwoColumnPage.Main>
        <TwoColumnPage.Sidebar>
          <RolesSection myRoles={myRoles} isLoading={isRolesLoading} />
          <AccountStatusSection me={me} isLoading={isMeLoading} />
        </TwoColumnPage.Sidebar>
      </TwoColumnPage>
    </div>
  );
}
