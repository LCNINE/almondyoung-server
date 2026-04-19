"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { removeAccountAction, selectAccountAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
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
        <EmptyDescription>
          아래 버튼을 눌러 로그인하거나 새로 가입하세요.
        </EmptyDescription>
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
        return (
          <li
            key={acct.userId}
            className="flex items-center gap-3 rounded-lg border p-3"
          >
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
            {editing ? (
              <Button
                variant="ghost"
                size="icon"
                disabled={pending}
                onClick={() => handleRemove(acct.userId)}
                aria-label="삭제"
              >
                <Trash2 className="size-4" />
              </Button>
            ) : (
              <Button
                variant={isActive ? "secondary" : "default"}
                size="sm"
                disabled={pending || expired}
                onClick={() => handleSelect(acct.userId)}
              >
                {isActive ? "계속" : "선택"}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
