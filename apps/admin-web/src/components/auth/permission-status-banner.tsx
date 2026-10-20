'use client';

import { PERMISSION_LOOKUP_FAILED_MESSAGE } from '@/lib/auth/permission-check';
import { useMyPermissions } from '@/lib/services/users';

/** 내 권한을 불러오지 못하면 쓰기 버튼이 숨는다 — 그 이유와 다시 시도를 화면 위에 알린다. */
export function PermissionStatusBanner() {
  const { isError, refetch, isFetching } = useMyPermissions();
  if (!isError) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 bg-amber-100 px-5 py-2 text-sm text-amber-950">
      <span>{PERMISSION_LOOKUP_FAILED_MESSAGE} 그동안 작업 버튼이 보이지 않습니다.</span>
      <button type="button" className="shrink-0 whitespace-nowrap font-semibold underline disabled:opacity-50" disabled={isFetching} onClick={() => void refetch()}>
        다시 시도
      </button>
    </div>
  );
}
