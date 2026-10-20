'use client';

import { ArrowLeft, Copy, Home, RotateCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function ForbiddenActions({ permissionKeys, retry = false }: { permissionKeys: string[]; retry?: boolean }) {
  const router = useRouter();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(permissionKeys.join(', '));
      toast.success('권한 이름을 복사했습니다.');
    } catch {
      toast.error('복사하지 못했습니다.');
    }
  };
  return (
    <div className="flex flex-col space-y-2">
      {retry && (
        <Button onClick={() => router.refresh()} className="w-full">
          <RotateCw className="mr-2 h-4 w-4" />
          다시 시도
        </Button>
      )}
      {permissionKeys.length > 0 && (
        <Button variant="outline" onClick={copy} className="w-full">
          <Copy className="mr-2 h-4 w-4" />
          권한 이름 복사 ({permissionKeys.join(', ')})
        </Button>
      )}
      <Button variant="outline" onClick={() => router.push('/')} className="w-full">
        <Home className="mr-2 h-4 w-4" />
        첫 화면으로
      </Button>
      <Button variant="ghost" onClick={() => router.back()} className="w-full">
        <ArrowLeft className="mr-2 h-4 w-4" />
        이전 페이지로
      </Button>
    </div>
  );
}
