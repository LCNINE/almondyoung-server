'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { canCommit } from './can-commit';
import type { ValidatePreviewDto } from '@/lib/types/dto/product-import';

interface Props {
  preview: ValidatePreviewDto | null;
  isLoading: boolean;
  committing: boolean;
  onReupload: () => void;
  onCommit: () => void;
}

export function ValidateStep({
  preview,
  isLoading,
  committing,
  onReupload,
  onCommit,
}: Props) {
  const [onlyErrors, setOnlyErrors] = useState(false);

  if (isLoading || !preview) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        검증 중...
      </div>
    );
  }

  const rows = onlyErrors
    ? preview.rows.filter((r) => r.status === 'invalid')
    : preview.rows;
  const commitEnabled = canCommit(preview);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 text-sm font-semibold">2. 검증 프리뷰</h3>
        <p className="text-xs text-muted-foreground">
          총 {preview.totalRows}건 · 유효{' '}
          <strong className="text-green-600">{preview.validCount}</strong> · 오류{' '}
          <strong className="text-destructive">{preview.invalidCount}</strong>
        </p>
      </div>

      {!commitEnabled && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {preview.totalRows === 0
            ? '등록할 유효한 행이 없습니다. 파일을 확인하세요.'
            : `오류 ${preview.invalidCount}건을 수정한 뒤 파일을 다시 업로드해 재검증하세요.`}
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={onlyErrors}
          onChange={(e) => setOnlyErrors(e.target.checked)}
        />
        오류 행만 보기
      </label>

      <div className="max-h-[420px] overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/50">
            <tr className="text-left">
              <th className="p-2">행</th>
              <th className="p-2">productKey</th>
              <th className="p-2">상태</th>
              <th className="p-2">상품명</th>
              <th className="p-2">카테고리</th>
              <th className="p-2">변형 수</th>
              <th className="p-2">오류</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rowNumber} className="border-t align-top">
                <td className="p-2">{r.rowNumber}</td>
                <td className="p-2">{r.productKey}</td>
                <td className="p-2">
                  {r.status === 'valid' ? (
                    <span className="text-green-600">유효</span>
                  ) : (
                    <span className="text-destructive">오류</span>
                  )}
                </td>
                <td className="p-2">{r.resolved.name}</td>
                <td className="p-2">{r.resolved.categoryNames.join(' > ')}</td>
                <td className="p-2">{r.resolved.variantCount}</td>
                <td className="p-2 text-destructive">
                  {r.errors.join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={onReupload} disabled={committing}>
          파일 다시 업로드
        </Button>
        <Button onClick={onCommit} disabled={!commitEnabled || committing}>
          {committing ? '커밋 중...' : `커밋 (${preview.validCount}건 등록)`}
        </Button>
      </div>
    </div>
  );
}
