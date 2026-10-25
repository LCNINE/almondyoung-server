'use client';

import { useReducer } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Can } from '@/components/auth/can';
import { getServerDenyMessage } from '@/lib/api/server-error';
import { useApplySupplierUpload, usePreviewSupplierUpload } from '@/lib/services/orders';
import { INITIAL_UPLOAD_STATE, uploadReducer } from '../../lib/upload-state';
import { rowErrorText, verdictLabel } from '../../lib/upload-verdict-text';
import {
  PREVIEW_STALE_MESSAGE,
  applyGate,
  appliedSummaryText,
  isPreviewStaleError,
  previewRowsErrorsFirst,
  verdictCountsText,
} from '../../lib/upload-view';

/** 「올리기」 — 입점사가 송장·못 보냄 사유를 채운 시트를 미리보기 → 적용(N10) */
export function UploadPanel({ supplierId }: { supplierId: string }) {
  const [state, dispatch] = useReducer(uploadReducer, INITIAL_UPLOAD_STATE);
  const preview = usePreviewSupplierUpload();
  const apply = useApplySupplierUpload();
  const busy = preview.isPending || apply.isPending;

  const runPreview = async () => {
    const file = state.file;
    if (!file) return;
    try {
      const res = await preview.mutateAsync({ supplierId, file });
      dispatch({ type: 'previewed', file, preview: res });
    } catch (error) {
      toast.error(getServerDenyMessage(error, '미리보기에 실패했습니다.'));
    }
  };

  const runApply = async () => {
    if (!state.file || !state.preview) return;
    try {
      const result = await apply.mutateAsync({
        supplierId,
        file: state.file,
        previewToken: state.preview.token,
      });
      dispatch({ type: 'applied', result });
    } catch (error) {
      if (isPreviewStaleError(error)) dispatch({ type: 'staleRejected' });
      else toast.error(getServerDenyMessage(error, '적용에 실패했습니다.'));
    }
  };

  const gate = state.preview ? applyGate(state.preview.counts) : null;

  return (
    <Can run={usePreviewSupplierUpload}>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="file"
            accept=".xlsx"
            className="max-w-sm"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) dispatch({ type: 'fileChosen', file });
              // 같은 파일을 다시 골라도 onChange 가 오게 비운다
              e.target.value = '';
            }}
          />
          {state.file && <span className="text-sm">{state.file.name}</span>}
          <Button size="sm" variant="outline" onClick={runPreview} disabled={!state.file || busy}>
            미리보기
          </Button>
          {state.preview && gate && (
            <Can run={useApplySupplierUpload}>
              <Button size="sm" onClick={runApply} disabled={gate.disabled || busy}>
                적용
              </Button>
              {gate.errorNote && <span className="text-sm text-destructive">{gate.errorNote}</span>}
            </Can>
          )}
        </div>

        {state.stale && (
          <Alert variant="destructive">
            <AlertDescription>{PREVIEW_STALE_MESSAGE}</AlertDescription>
          </Alert>
        )}

        {state.result && (
          <Alert>
            <AlertDescription>
              <span className="font-semibold">{appliedSummaryText(state.result)}</span>
              {verdictCountsText(state.result.counts) && (
                <span className="ml-2">{verdictCountsText(state.result.counts)}</span>
              )}
            </AlertDescription>
          </Alert>
        )}

        {state.preview && (
          <>
            <p className="text-sm">{verdictCountsText(state.preview.counts)}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">행</TableHead>
                  <TableHead>주문번호</TableHead>
                  <TableHead>판정</TableHead>
                  <TableHead>오류</TableHead>
                  <TableHead>택배사</TableHead>
                  <TableHead>송장번호</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewRowsErrorsFirst(state.preview.rows).map((r) => (
                  <TableRow
                    key={`${r.rowNumber}-${r.rowKey}`}
                    className={r.verdict === 'error' ? 'bg-red-50 dark:bg-red-950/30' : undefined}
                  >
                    <TableCell className="text-right">{r.rowNumber}</TableCell>
                    <TableCell>{r.orderNo}</TableCell>
                    <TableCell>{verdictLabel(r.verdict)}</TableCell>
                    <TableCell>{r.code ? rowErrorText(r.code) : ''}</TableCell>
                    <TableCell>{r.carrier ?? ''}</TableCell>
                    <TableCell className="font-mono text-xs">{r.trackingNo ?? ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </div>
    </Can>
  );
}
