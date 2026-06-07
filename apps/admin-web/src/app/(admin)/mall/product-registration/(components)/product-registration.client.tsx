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
          <h1 className="text-2xl font-semibold text-foreground">새 상품 초안 시작</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            계속하면 새 product master와 최초 draft version이 생성됩니다. 상품명, 이미지, 옵션, 가격 정책은 생성된
            draft 상세 화면에서 순서대로 작성합니다.
          </p>
        </header>

        <section className="rounded-md border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-6">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted-foreground">1</span>
                <p className="text-sm font-medium text-foreground">마스터 생성</p>
                <p className="text-sm leading-6 text-muted-foreground">서버 기본값으로 새 상품을 엽니다.</p>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted-foreground">2</span>
                <p className="text-sm font-medium text-foreground">초안 버전 생성</p>
                <p className="text-sm leading-6 text-muted-foreground">편집 가능한 draft version을 함께 만듭니다.</p>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted-foreground">3</span>
                <p className="text-sm font-medium text-foreground">상세 화면 이동</p>
                <p className="text-sm leading-6 text-muted-foreground">초안 상세에서 기본정보와 가격 정책을 완성합니다.</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">입력 필드 없이 초안을 생성합니다.</p>
                <p className="text-sm text-muted-foreground">
                  이 요청에는 가격, 구매조건, 옵션, 이미지, 상품 메타데이터를 보내지 않습니다.
                </p>
              </div>
              <Button
                icon={PlusCircle}
                loading={isPending}
                disabled={isPending}
                onClick={() => void handleCreate()}
              >
                {isPending ? '생성 중...' : '새 상품 생성하기'}
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
