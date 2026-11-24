'use client';

import { toast } from 'sonner';
import { isMaskedText } from '@/lib/api/domains/orders/order-cs.shape';
import { cn } from '@/lib/utils/ui';

export async function copyToClipboard(value: string, done: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(done);
  } catch {
    toast.error('복사하지 못했어요. 글자를 직접 선택해 복사해 주세요.');
  }
}

/** 누르면 복사되는 값. 가려진 값은 글자로만 보인다. */
export function CopyText(props: {
  value: string;
  what: string;
  className?: string;
}) {
  if (isMaskedText(props.value))
    return <span className={props.className}>{props.value}</span>;
  return (
    <button
      type="button"
      title={`${props.what} 복사`}
      aria-label={`${props.what} ${props.value} 복사`}
      className={cn(
        'whitespace-nowrap tabular-nums underline decoration-dotted underline-offset-2 hover:decoration-solid',
        props.className
      )}
      onClick={() => void copyToClipboard(props.value, `${props.what} 복사됨`)}
    >
      {props.value}
    </button>
  );
}
