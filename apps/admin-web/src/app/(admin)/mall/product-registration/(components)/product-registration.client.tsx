'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlusCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { useCreateMaster } from '@/lib/services/products/mutations';

export default function ProductRegistrationClient() {
  const router = useRouter();
  const createMaster = useCreateMaster();
  const [localError, setLocalError] = useState<string | null>(null);

  const handleCreate = async () => {
    setLocalError(null);

    try {
      const created = await createMaster.mutateAsync();

      if (!created.masterId || !created.id) {
        const message = '상품 초안 생성 응답에 masterId 또는 versionId가 없습니다.';
        setLocalError(message);
        toast.error(message);
        return;
      }

      router.push(`/mall/products-list/${created.masterId}?versionId=${created.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '상품 초안 생성 중 오류가 발생했습니다.';
      setLocalError(message);
      toast.error('상품 초안 생성에 실패했습니다.');
    }
  };

  const isPending = createMaster.isPending;
  const errorMessage =
    localError ?? (createMaster.error instanceof Error ? createMaster.error.message : null);

  return (
    <main className="min-h-screen bg-background p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">상품 등록</p>
          <h1 className="text-2xl font-semibold text-foreground">새 상품 등록</h1>
        </header>

        <section className="rounded-md border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-6">
            <div className="flex justify-start">
              <Button
                icon={PlusCircle}
                loading={isPending}
                disabled={isPending}
                onClick={() => void handleCreate()}
              >
                {isPending ? '생성 중...' : '상품 생성하고 편집 페이지로 이동'}
              </Button>
            </div>

            {isPending && (
              <p role="status" className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
                새 상품 master와 draft version을 생성하고 있습니다.
              </p>
            )}

            {errorMessage && (
              <p role="alert" className="rounded-md border border-destructive/30 px-4 py-3 text-sm text-destructive">
                {errorMessage}
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
