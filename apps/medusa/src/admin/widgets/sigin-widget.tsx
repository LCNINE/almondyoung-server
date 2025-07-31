import { defineWidgetConfig } from '@medusajs/admin-sdk';
import { Button, Drawer, Input, Label, Text, Checkbox } from '@medusajs/ui';
import { useState, useEffect } from 'react';
import { sdk } from '../lib/sdk';

const USER_SERVICE_URL =
  import.meta.env.VITE_USER_SERVICE_URL || 'http://localhost:5000';

const STORAGE_KEY = 'almondyoung_saved_id';

const SigninWidget = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

  useEffect(() => {
    // 저장된 아이디가 있다면 불러오기
    const savedId = localStorage.getItem(STORAGE_KEY);
    if (savedId) {
      setLoginId(savedId);
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      // 아이디 저장 처리
      if (rememberMe) {
        localStorage.setItem(STORAGE_KEY, loginId);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }

      // 1. user-service 로그인
      const loginResponse = await fetch(`${USER_SERVICE_URL}/auth/signin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ loginId, password }),
        credentials: 'include',
      });

      if (!loginResponse.ok) {
        const errorData = await loginResponse.json();
        throw new Error(errorData.message || '로그인에 실패했습니다.');
      }

      const {
        data: { accessToken },
      } = await loginResponse.json();

      if (!accessToken) {
        throw new Error('로그인에 실패했습니다.');
      }

      const userResponse = await fetch(`${USER_SERVICE_URL}/users/me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        credentials: 'include',
      });

      const { data: userData } = await userResponse.json();

      await sdk.auth.login('user', 'my-auth', {
        email: userData?.email,
        password,
      });

      // 5. 메두사 어드민 페이지로 리다이렉트
      window.location.href = '/app/';
    } catch (error: any) {
      setError(error.message || '로그인 중 오류가 발생했습니다.');
      console.error('Login error:', error);
    }
  };

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        className="bg-[#FFA500] hover:bg-[#E08F00] text-white font-medium py-2 px-4 rounded transition-colors duration-200 w-full mb-4"
      >
        아몬드영 관리자 계정으로 로그인
      </Button>

      <hr className="my-4 border-gray-200" />

      <Drawer open={isOpen} onOpenChange={setIsOpen}>
        <Drawer.Content>
          <Drawer.Header>
            <Text className="text-xl font-semibold">
              아몬드영 관리자 로그인
            </Text>
          </Drawer.Header>

          <Drawer.Body>
            <form onSubmit={handleSubmit} className="space-y-4 p-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="id">아이디</Label>
                <Input
                  id="id"
                  type="text"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="아이디를 입력하세요"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">비밀번호</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호를 입력하세요"
                  required
                />
              </div>

              <div className="flex items-center">
                <Checkbox
                  checked={rememberMe}
                  onCheckedChange={(checked) =>
                    setRememberMe(checked as boolean)
                  }
                  id="remember-me"
                />
                <Label htmlFor="remember-me" className="ml-2 cursor-pointer">
                  아이디 저장
                </Label>
              </div>

              <Button type="submit" variant="primary" className="w-full mt-4">
                로그인
              </Button>
            </form>
          </Drawer.Body>
        </Drawer.Content>
      </Drawer>
    </>
  );
};

export const config = defineWidgetConfig({
  zone: 'login.before',
});

export default SigninWidget;
