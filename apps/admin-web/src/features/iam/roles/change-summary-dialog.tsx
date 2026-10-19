'use client';

import { findPermission } from '@permission-catalog';
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

const label = (key: string) => findPermission(key)?.label ?? key;

export interface ChangeSummary {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly dangerousAdded: readonly string[];
}

/** 저장 전 변경 요약 — 추가·회수·위험을 이름으로 보이고 확인을 받는다. */
export function ChangeSummaryDialog({
  open,
  summary,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  summary: ChangeSummary;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>권한 변경 확인</AlertDialogTitle>
          <AlertDialogDescription>
            추가 {summary.added.length} · 회수 {summary.removed.length} · 위험{' '}
            {summary.dangerousAdded.length}. 저장하면 30초 안에 모든 서비스가
            따라오고, 이 역할을 가진 사람의 화면은 다음에 권한을 다시 받을 때
            바뀝니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {summary.dangerousAdded.length > 0 && (
          <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-sm">
            <p className="font-medium text-destructive">위험 권한을 켭니다</p>
            <ul className="list-disc pl-5">
              {summary.dangerousAdded.map((k) => (
                <li key={k}>{label(k)}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="font-medium">추가</p>
            <ul className="list-disc pl-5">
              {summary.added.map((k) => (
                <li key={k}>{label(k)}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-medium">회수</p>
            <ul className="list-disc pl-5">
              {summary.removed.map((k) => (
                <li key={k}>{label(k)}</li>
              ))}
            </ul>
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>취소</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={pending}>
            저장
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
