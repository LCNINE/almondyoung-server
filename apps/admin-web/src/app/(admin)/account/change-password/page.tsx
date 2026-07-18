'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useChangePassword } from '@/lib/services/users';

/**
 * 최초 로그인 강제 비밀번호 변경 페이지.
 *
 * 신규 관리자 계정은 서버가 랜덤 초기 비밀번호를 발급하고 `must_change_password` 플래그를
 * 세운다. 이 값이 OIDC access token claim 으로 흘러 middleware 가 이 경로 외 모든 진입을
 * 여기로 redirect 시킨다 (apps/admin-web/src/middleware.ts 참고).
 *
 * 변경 자체는 기존 self 엔드포인트(`POST /auth/change-password`, useChangePassword)를 그대로
 * 재사용한다 — 성공 시 서버가 DB 의 must_change_password 를 false 로 클리어한다.
 *
 * 단, 현재 브라우저가 들고 있는 accessToken 쿠키는 여전히 must_change_password=true 를 담고
 * 있으므로 (JWT 는 재발급 전까지 불변) 그대로 홈으로 이동하면 middleware 가 다시 이 페이지로
 * 튕긴다. `/api/auth/refresh` 는 client.ts 의 401 인터셉터가 이미 쓰고 있는, 세션 쿠키를
 * user-service 최신 상태로 다시 발급받는 경로이므로 그대로 재사용해 토큰을 교체한 뒤 이동한다.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const { mutateAsync: changePassword, isPending } = useChangePassword();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isRotating, setIsRotating] = useState(false);

  const submitting = isPending || isRotating;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('모든 항목을 입력해주세요.');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('새 비밀번호가 일치하지 않습니다.');
      return;
    }

    try {
      await changePassword({ currentPassword, newPassword });
    } catch {
      toast.error('비밀번호 변경에 실패했습니다. 현재 비밀번호를 확인해주세요.');
      return;
    }

    toast.success('비밀번호가 변경되었습니다.');

    // 서버는 이미 must_change_password 를 클리어했지만, 브라우저의 accessToken 쿠키는 아직
    // 옛 claim(true) 을 담고 있다. 토큰을 갱신하지 않고 이동하면 middleware 가 다시 이 페이지로
    // 되돌린다 — 반드시 /api/auth/refresh 로 최신 claim 을 담은 토큰을 먼저 받아온다.
    setIsRotating(true);
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`refresh failed: ${response.status}`);
      }
      router.replace('/');
    } catch {
      toast.error(
        '비밀번호는 변경되었지만 세션 갱신에 실패했습니다. 다시 로그인해주세요.'
      );
      setIsRotating(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>비밀번호 변경이 필요합니다</CardTitle>
          <CardDescription>
            최초 발급된 임시 비밀번호로 로그인했습니다. 계속 진행하려면 새
            비밀번호로 변경해주세요.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">현재(초기) 비밀번호</Label>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                placeholder="발급받은 초기 비밀번호 입력"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">새 비밀번호</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                placeholder="8자 이상 입력"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">새 비밀번호 확인</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                placeholder="새 비밀번호 재입력"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={submitting}
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? '변경 중…' : '비밀번호 변경'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
