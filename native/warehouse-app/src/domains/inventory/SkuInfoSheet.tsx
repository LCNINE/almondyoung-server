import { useEffect, useRef, useState } from 'react';
import { filePublicBaseUrl } from '../../app/config';
import { Button } from '../../core/design/Button';
import { LoadFailure } from '../../core/design/LoadFailure';
import { publicFileUrl } from '../../core/data/publicFileUrl';
import { preventScanEnterActivation } from '../../core/hardware/scan/hidScanBoundary';
import { useScanObserver } from '../../core/hardware/scan/useScanner';
import { useSkuDetail } from './useSkuDetail';
import type { SkuSearchItem } from './types';

export function skuImageUrls(fileIds: readonly string[] | undefined): string[] {
  return (fileIds ?? [])
    .map((fileId) => publicFileUrl(filePublicBaseUrl, fileId))
    .filter((url): url is string => url !== null);
}

export function SkuThumbnail({
  fileIds,
  className,
}: {
  fileIds?: string[];
  className: string;
}) {
  const [src] = skuImageUrls(fileIds);
  const [failed, setFailed] = useState<string | null>(null);

  if (!src || failed === src) {
    return (
      <div
        aria-hidden="true"
        data-testid="sku-thumbnail-empty"
        className={`${className} rounded bg-gray-100`}
      />
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(src)}
      className={`${className} rounded border object-cover`}
    />
  );
}

function ImageViewer({ name, fileIds }: { name: string; fileIds?: string[] }) {
  const urls = skuImageUrls(fileIds);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const current = urls[Math.min(index, urls.length - 1)];

  return (
    <div className="space-y-2">
      {current && !failed.has(current) ? (
        <img
          src={current}
          alt={`${name} 사진`}
          onError={() => setFailed((prev) => new Set(prev).add(current))}
          className="aspect-square w-full rounded-lg border object-contain"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-gray-100 text-sm text-gray-500">
          사진이 없어요
        </div>
      )}
      {urls.length > 1 && (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            className="border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
            disabled={index === 0}
            onClick={() => setIndex((value) => Math.max(0, value - 1))}
          >
            이전 사진
          </Button>
          <span className="text-sm tabular-nums text-gray-600">
            {index + 1} / {urls.length}
          </span>
          <Button
            type="button"
            className="border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
            disabled={index >= urls.length - 1}
            onClick={() =>
              setIndex((value) => Math.min(urls.length - 1, value + 1))
            }
          >
            다음 사진
          </Button>
        </div>
      )}
    </div>
  );
}

/** 상품 검색 결과 줄을 누르면 뜨는 상품 정보 창. 사진으로 비슷한 상품을 구분하고 여기서도 담는다. */
export function SkuInfoSheet({
  sku,
  canSelect,
  onSelect,
  onClose,
}: {
  sku: SkuSearchItem;
  canSelect: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const mouseDownOnBackdrop = useRef(false);
  const detail = useSkuDetail(sku.id);
  const imageFileIds = detail.data?.imageFileIds ?? sku.imageFileIds;
  const currentStock = detail.data?.currentStock ?? sku.currentStock;
  const barcodes = detail.data?.barcodes ?? [];

  // 창을 띄운 채 바코드를 찍으면 창을 닫고 그 스캔은 화면이 평소대로 받는다
  useScanObserver(onClose);

  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    panelRef.current?.focus();

    return () => previous?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onMouseDown={(event) => {
        mouseDownOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const startedOnBackdrop = mouseDownOnBackdrop.current;
        mouseDownOnBackdrop.current = false;

        if (startedOnBackdrop && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${sku.name} 상품 정보`}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();

            return;
          }

          preventScanEnterActivation(event.nativeEvent);
        }}
        className="max-h-[90vh] w-full max-w-sm space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-lg outline-none"
      >
        <ImageViewer
          key={(imageFileIds ?? []).join(',')}
          name={sku.name}
          fileIds={imageFileIds}
        />

        <div>
          <div className="font-semibold text-gray-800">{sku.name}</div>
          <div className="font-mono text-xs text-gray-500">{sku.code}</div>
          {sku.optionKey ? (
            <div className="text-sm text-gray-600">옵션 {sku.optionKey}</div>
          ) : null}
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-gray-500">현재고</dt>
          <dd className="tabular-nums">
            {(currentStock ?? 0).toLocaleString('ko-KR')}개
          </dd>
          <dt className="text-gray-500">바코드</dt>
          <dd className="font-mono">
            {detail.isPending ? (
              <span className="font-sans text-gray-500">불러오는 중</span>
            ) : barcodes.length > 0 ? (
              <ul>
                {barcodes.map((barcode) => (
                  <li key={barcode.id}>{barcode.barcode}</li>
                ))}
              </ul>
            ) : (
              <span className="font-sans text-gray-500">없음</span>
            )}
          </dd>
        </dl>

        {detail.isError && (
          <LoadFailure
            message="상품 정보를 다 불러오지 못했어요."
            error={detail.error}
            retrying={detail.isFetching}
            onRetry={() => void detail.refetch()}
          />
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            className="flex-1 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
            onClick={onClose}
          >
            닫기
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={!canSelect}
            onClick={onSelect}
          >
            선택
          </Button>
        </div>
      </div>
    </div>
  );
}
