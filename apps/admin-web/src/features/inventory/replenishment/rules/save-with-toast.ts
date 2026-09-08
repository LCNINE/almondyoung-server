'use client';

import { toast } from 'sonner';
import { failureMessage } from '../rules-model';

/**
 * 규칙 화면의 저장 · 삭제 여덟 곳이 쓰던 `try/catch` + 토스트 보일러플레이트를 한 곳으로 모은 것.
 *
 * `onSuccess` 는 **성공했을 때만** 부른다 — `save(...).then(reset)` 은 mutateAsync 가 던져도
 * (400 · 409 등) 리셋이 돌아가 사람이 방금 친 입력을 전부 지운다.
 */
export async function runWithToast(options: {
  run: () => Promise<unknown>;
  success: string;
  failure: string;
  onSuccess?: () => void;
}): Promise<void> {
  try {
    await options.run();
  } catch (error) {
    toast.error(failureMessage(error, options.failure));
    return;
  }
  // `try` **밖**이다 — 안에 두면 상태 갱신이 던졌을 때 이미 성공한 저장이
  // 「저장에 실패했습니다」로 뒤집히고, 사람이 다시 눌러 중복 저장을 하게 된다.
  toast.success(options.success);
  options.onSuccess?.();
}
