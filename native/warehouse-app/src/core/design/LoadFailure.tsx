import { errorMessage } from '../data/errorMessage';
import { Button } from './Button';
import { cn } from './cn';

/**
 * 조회 실패 안내. 결과 없음과 구분되게 실패를 말하고 다시 확인할 수 있게 한다.
 * stale 이면 이미 보이는 목록을 남겨 두는 경우라, 그 목록이 마지막으로 불러온 상태라고 덧붙인다.
 */
export function LoadFailure({
  message,
  error,
  stale = false,
  retrying,
  onRetry,
  className,
}: {
  message: string;
  /** 다시 확인하는 동안은 비어 있을 수 있다 */
  error: unknown;
  stale?: boolean;
  retrying: boolean;
  onRetry(): void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-red-700',
        className
      )}
    >
      <p>
        {message}
        {error ? ` ${errorMessage(error)}` : ''}
        {stale ? ' 보이는 내용은 마지막으로 불러온 상태예요.' : ''}
      </p>
      <Button type="button" disabled={retrying} onClick={onRetry}>
        {retrying ? '확인하는 중…' : '다시 확인'}
      </Button>
    </div>
  );
}
