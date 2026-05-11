"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Trash2 } from "lucide-react";

import { removeAccountAction, selectAccountAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import type { StoredAccount } from "@/lib/account-store";

type Props = {
  accounts: StoredAccount[];
  activeUserId: string | null;
  redirectTo: string;
  editing: boolean;
};

export function AccountList({
  accounts,
  activeUserId,
  redirectTo,
  editing,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (accounts.length === 0) {
    return (
      <Empty>
        <EmptyTitle>저장된 계정이 없습니다</EmptyTitle>
      </Empty>
    );
  }

  const handleSelect = (userId: string) => {
    startTransition(async () => {
      const res = await selectAccountAction(userId, redirectTo);
      if (res && !res.ok) alert(res.error);
    });
  };

  const handleRemove = (userId: string) => {
    startTransition(async () => {
      await removeAccountAction(userId);
      router.refresh();
    });
  };

  return (
    <ul className="flex flex-col gap-2">
      {accounts.map((acct) => {
        const isActive = acct.userId === activeUserId;
        const expired = !acct.hasValidRefreshToken;
        const info = (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">
                {acct.nickname || acct.username}
              </span>
              {isActive && <Badge variant="secondary">현재 로그인</Badge>}
              {expired && !isActive && (
                <Badge variant="outline">재로그인 필요</Badge>
              )}
            </div>
            <span className="truncate text-xs text-muted-foreground">
              {acct.email}
            </span>
          </div>
        );

        // 편집 모드는 의도적 삭제 컨텍스트 — 카드 통클릭 대신 우측 trash 아이콘만 타겟.
        if (editing) {
          return (
            <li
              key={acct.userId}
              className="flex items-center gap-3 rounded-lg border p-3"
            >
              {info}
              <Button
                variant="ghost"
                size="icon"
                disabled={pending}
                onClick={() => handleRemove(acct.userId)}
                aria-label="삭제"
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          );
        }

        const actionLabel = isActive
          ? "현재 계정으로 계속"
          : expired
            ? "재로그인"
            : "이 계정으로 로그인";
        return (
          <li key={acct.userId}>
            <button
              type="button"
              disabled={pending}
              onClick={() => handleSelect(acct.userId)}
              aria-label={actionLabel}
              className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              {info}
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
