"use client";

// 임시 배너 (almondyoung.com 도메인 컷오버 전환기 안내).
// 컷오버로 기존 세션이 무효화돼 재로그인이 필요한 사용자를 안심시킨다.
// 전환기(배포 후 약 2~4주) 후 제거: 이 파일 + app/page.tsx·app/signin/page.tsx 의
// <ReloginNotice /> 삽입 2곳만 지우면 됨.

import { useSyncExternalStore } from "react";
import { Info, X } from "lucide-react";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "almondyoung:relogin-notice:dismissed";

// localStorage(클라이언트 전용)를 외부 스토어로 구독해 hydration mismatch·setState-in-effect
// 없이 "닫음" 상태를 읽는다. 같은 탭에서 닫아도 즉시 반영되도록 수동 리스너를 둔다.
const listeners = new Set<() => void>();
let dismissedInMemory = false; // localStorage 저장 실패(프라이빗 모드) 시 세션 폴백.

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getDismissed() {
  if (dismissedInMemory) return true;
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function dismiss() {
  dismissedInMemory = true;
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // 저장 실패해도 dismissedInMemory 로 이번 세션에선 닫힌다.
  }
  listeners.forEach((notify) => notify());
}

export function ReloginNotice() {
  const dismissed = useSyncExternalStore(
    subscribe,
    getDismissed, // 클라이언트: 실제 localStorage 값
    () => true, // 서버: 숨김(하이드레이션 후 미닫음이면 노출 — flash-and-vanish 방지)
  );

  if (dismissed) return null;

  return (
    <Alert>
      <Info />
      <AlertTitle>재로그인이 필요해요</AlertTitle>
      <AlertDescription>
        도메인 변경으로 자동 로그아웃되었어요. 계정 정보는 그대로예요.
      </AlertDescription>
      <AlertAction>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="안내 닫기"
          onClick={dismiss}
        >
          <X />
        </Button>
      </AlertAction>
    </Alert>
  );
}
