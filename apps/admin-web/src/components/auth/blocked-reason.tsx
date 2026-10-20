'use client';

import { useId } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type BlockedControlProps = { 'aria-disabled'?: true; 'aria-describedby'?: string };

/**
 * 현재 값을 보여 주는 컨트롤(상태 스위치·체크박스 등)을 막을 때. 네이티브 `disabled` 대신 `aria-disabled` 를 써서
 * 키보드·스크린리더가 컨트롤에 닿고, 이유는 포커스·마우스 모두로 열리는 툴팁과 `aria-describedby` 로 전한다.
 * 막힌 동안 변경 핸들러는 호출하는 쪽이 넘기지 않는다: `onCheckedChange={reason ? undefined : handle}`.
 */
export function BlockedReason({ reason, children }: { reason: string | null; children: (props: BlockedControlProps) => React.ReactNode }) {
  const id = useId();
  if (reason === null) return <>{children({})}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children({ 'aria-disabled': true, 'aria-describedby': id })}</span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
      <span id={id} className="sr-only">
        {reason}
      </span>
    </Tooltip>
  );
}
