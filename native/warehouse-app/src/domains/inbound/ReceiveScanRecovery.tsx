import { Button } from '../../core/design/Button';

export interface ReceiveScanRecoveryProps {
  message: string;
  busy: boolean;
  canRetry: boolean;
  canExclude: boolean;
  onRetry: () => void;
  onExclude: () => void;
}

export function ReceiveScanRecovery({
  message,
  busy,
  canRetry,
  canExclude,
  onRetry,
  onExclude,
}: ReceiveScanRecoveryProps) {
  return (
    <section className="space-y-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
      <p role="alert">{message}</p>
      {canRetry || canExclude ? (
        <div className="flex gap-2">
          {canRetry ? (
            <Button type="button" disabled={busy} onClick={onRetry}>
              다시 확인
            </Button>
          ) : null}
          {canExclude ? (
            <Button type="button" disabled={busy} onClick={onExclude}>
              이 스캔 제외
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
