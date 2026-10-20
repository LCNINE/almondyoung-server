'use client';

import { formatPhoneNumber } from '@/lib/utils/phone';

export interface QnaAuthorInfo {
  username: string;
  loginId: string;
  email: string;
  phoneNumber: string | null;
}

// 고객 목록의 행 클릭(DataTable openInNewWindow)과 같은 크기의 팝업으로 연다
export function openCustomerWindow(userId: string) {
  const href = `/customer-window/${userId}`;
  window.open(
    href,
    href,
    'width=1200,height=650,menubar=no,toolbar=no,location=no,status=no'
  );
}

export function QnaAuthor({
  userId,
  nickname,
  user,
}: {
  userId: string;
  nickname: string;
  user: QnaAuthorInfo | undefined;
}) {
  if (!user) {
    return (
      <div className="space-y-0.5 text-sm">
        <p className="font-medium">{nickname || '-'}</p>
        <p className="text-muted-foreground text-xs">회원 정보 없음</p>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-0.5 text-sm">
      <button
        type="button"
        className="cursor-pointer font-medium hover:underline"
        onClick={(event) => {
          event.stopPropagation();
          openCustomerWindow(userId);
        }}
      >
        {user.username || nickname}
      </button>
      <p className="text-muted-foreground truncate text-xs">
        {user.loginId} · {user.email}
      </p>
      <p className="text-muted-foreground text-xs tabular-nums">
        {user.phoneNumber
          ? formatPhoneNumber(user.phoneNumber)
          : '연락처 없음'}
      </p>
    </div>
  );
}
