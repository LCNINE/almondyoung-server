'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { skuFieldCaptureClient } from '@/lib/api/domains/inventory/sku-field-capture.client';
import { skusClient } from '@/lib/api/domains/inventory/skus.client';
import type { FieldCaptureSkuSummaryDto } from '@/lib/types/dto/inventory';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { BarcodeScanInput } from '@/features/inventory/sku-field-capture/components/barcode-scan-input';
import {
  completedByText,
  errorMessageOf,
  fieldCaptureKeys,
  reworkNotice,
  scanInputValue,
} from '@/features/inventory/sku-field-capture/field-capture-model';

const BASE = '/mobile/sku-field-capture';

export default function SkuFieldCapturePage() {
  return (
    <Suspense fallback={null}>
      <FieldCaptureEntry />
    </Suspense>
  );
}

function FieldCaptureEntry() {
  const router = useRouter();
  const position = useSearchParams().get('position');
  const openPosition = (code: string) => router.push(`${BASE}?position=${encodeURIComponent(code)}`);
  const openSku = (skuId: string) => router.push(`${BASE}/${encodeURIComponent(skuId)}`);

  if (position) {
    return <ShelfList code={position} onBack={() => router.push(BASE)} onOpenSku={openSku} />;
  }

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-bold text-gray-900">실측 작업</h1>
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <BarcodeScanInput
          label="선반 바코드 찍기"
          placeholder="위치 직접 입력 (예: T-01-20)"
          onScan={openPosition}
          autoFocus
          prominent
        />
      </section>
      <MyToday />
      <NameSearch onOpenSku={openSku} />
    </div>
  );
}

// 오늘 내가 끝낸 수 — 못 불러오면 아무것도 그리지 않는다(작업을 막지 않는다)
function MyToday() {
  const { data } = useQuery({
    queryKey: fieldCaptureKeys.myToday,
    queryFn: () => skuFieldCaptureClient.getMyToday(),
    staleTime: 0, // 전역 5분을 물려받지 않는다 — 다른 화면에서 끝낸 수도 돌아오면 바로 센다
  });
  if (!data) return null;
  return <p className="text-center text-sm text-gray-600">오늘 내가 끝낸 상품 {data.today}개</p>;
}

// ② 선반의 상품 목록
function ShelfList({
  code,
  onBack,
  onOpenSku,
}: {
  code: string;
  onBack: () => void;
  onOpenSku: (skuId: string) => void;
}) {
  const [confirm, setConfirm] = useState<{ sku: FieldCaptureSkuSummaryDto; notice: string } | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: fieldCaptureKeys.position(code),
    queryFn: () => skuFieldCaptureClient.getPosition(code),
    // 전역 5분을 물려받으면 다른 작업자가 방금 끝낸 상품이 「미완료」로 보여 재작업 확인을 건너뛴다
    staleTime: 0,
  });

  const pick = (sku: FieldCaptureSkuSummaryDto) => {
    const notice = reworkNotice(sku);
    if (notice) setConfirm({ sku, notice });
    else onOpenSku(sku.skuId);
  };

  return (
    <div className="space-y-3 p-4">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-gray-600">
        <ChevronLeft className="h-4 w-4" />
        다른 선반 찍기
      </button>
      <h1 className="text-lg font-bold text-gray-900">선반 {data?.positionCode ?? code}</h1>

      {isLoading && <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />}
      {error && <p className="text-sm text-red-600">{errorMessageOf(error, '선반을 불러오지 못했어요')}</p>}

      {data && data.skus.length === 0 && (
        <>
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            이 칸엔 등록된 상품이 없어요 — 이름·코드로 찾아 주세요
          </p>
          <NameSearch onOpenSku={onOpenSku} />
        </>
      )}

      {data && data.skus.length > 0 && (
        <ul className="space-y-2">
          {data.skus.map((sku) => (
            <li key={sku.skuId}>
              <button
                type="button"
                onClick={() => pick(sku)}
                className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 text-left"
              >
                <SkuThumb src={resolvePublicFileUrl(sku.imageUrl)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-gray-900">{sku.name}</p>
                  <p className="text-xs text-gray-500">{sku.code}</p>
                  {sku.completion ? (
                    <p className="mt-1 text-xs font-medium text-green-700">{completedByText(sku.completion)}</p>
                  ) : (
                    <p className="mt-1 text-xs font-medium text-orange-600">미완료</p>
                  )}
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-gray-400" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>다시 작업할까요?</AlertDialogTitle>
            <AlertDialogDescription className="text-base font-semibold text-green-700">
              {confirm?.notice}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && onOpenSku(confirm.sku.skuId)}>다시 작업</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SkuThumb({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-[10px] text-gray-400">
        사진 없음
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 셀메이트 외부 이미지, next/image 도메인 설정 밖
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className="h-16 w-16 shrink-0 rounded-lg border border-gray-200 object-cover"
    />
  );
}

// 이름·코드로 찾기 — 선반 바코드가 없거나 목록에 없을 때
function NameSearch({ onOpenSku }: { onOpenSku: (skuId: string) => void }) {
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const { data, isFetching, error } = useQuery({
    queryKey: fieldCaptureKeys.search(term),
    queryFn: () => skusClient.searchAdvanced({ search: term, limit: 20 }),
    enabled: term !== '',
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = scanInputValue(text);
    if (value !== null) setTerm(value.trim());
  };

  return (
    <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-700">이름·코드로 찾기</h2>
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="상품명 또는 코드"
          enterKeyHint="search"
          className="h-11 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-base"
        />
        <button
          type="submit"
          aria-label="찾기"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gray-800 text-white"
        >
          <Search className="h-5 w-5" />
        </button>
      </form>
      {isFetching && <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" />}
      {error && <p className="text-sm text-red-600">{errorMessageOf(error, '찾지 못했어요')}</p>}
      {data && !isFetching && data.items.length === 0 && <p className="text-sm text-gray-500">찾는 상품이 없어요</p>}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {data.items.map((sku) => (
            <li key={sku.id}>
              <button
                type="button"
                onClick={() => onOpenSku(sku.id)}
                className="flex w-full items-center justify-between gap-2 py-2.5 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-gray-900">{sku.name}</span>
                  <span className="block text-xs text-gray-500">{sku.code}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
