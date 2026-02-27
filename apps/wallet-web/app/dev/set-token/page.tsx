'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SetTokenPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');

  function handleSet() {
    if (!token.trim()) {
      setMessage('토큰을 입력하세요.');
      return;
    }
    // accessToken 쿠키 설정 (100년 = 3153600000초)
    document.cookie = `accessToken=${token.trim()}; path=/; max-age=3153600000; SameSite=Lax`;
    setMessage('✅ accessToken 쿠키가 설정됐습니다.');
  }

  function handleClear() {
    document.cookie = 'accessToken=; path=/; max-age=0';
    setMessage('🗑 accessToken 쿠키가 삭제됐습니다.');
    setToken('');
  }

  return (
    <div className="max-w-xl mx-auto mt-16 p-6 space-y-4 border rounded-lg">
      <h1 className="text-lg font-semibold">Dev: accessToken 설정</h1>
      <p className="text-sm text-muted-foreground">
        테스트용 JWT를 붙여넣으면 <code>accessToken</code> 쿠키로 저장됩니다.
      </p>
      <textarea
        className="w-full h-32 p-2 text-xs font-mono border rounded resize-none"
        placeholder="eyJhbGci..."
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          onClick={handleSet}
          className="flex-1 py-2 px-4 bg-primary text-primary-foreground rounded-md text-sm"
        >
          쿠키 설정
        </button>
        <button
          onClick={handleClear}
          className="py-2 px-4 border rounded-md text-sm"
        >
          삭제
        </button>
        <button
          onClick={() => router.push('/dev/store')}
          className="py-2 px-4 border rounded-md text-sm"
        >
          → store
        </button>
      </div>
      {message && (
        <p className="text-sm font-medium">{message}</p>
      )}
    </div>
  );
}
