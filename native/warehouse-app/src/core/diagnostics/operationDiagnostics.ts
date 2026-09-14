import type { StoredOperation } from '../operations/operationStore';
const key = 'warehouse-operation-diagnostics-v2';
export interface DiagnosticEvent {
  operationId: string;
  kind: string;
  status: string;
  attempts: number;
  elapsedMs: number;
  errorCode?: string;
  at: number;
}
export function operationDiagnostic(
  op: StoredOperation,
  now = Date.now()
): DiagnosticEvent {
  return {
    operationId: op.id,
    kind: op.path.split('/').filter(Boolean)[0],
    status: op.status,
    attempts: op.attempts,
    elapsedMs: Math.max(0, now - op.createdAt),
    errorCode: op.errorCode,
    at: now,
  };
}
export function readDiagnostics(now = Date.now()): DiagnosticEvent[] {
  try {
    const rows = JSON.parse(
      localStorage.getItem(key) ?? '[]'
    ) as DiagnosticEvent[];
    return rows.filter((row) => row.at > now - 86400000).slice(-1000);
  } catch {
    return [];
  }
}
export function recordDiagnostic(op: StoredOperation) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify(
        [...readDiagnostics(), operationDiagnostic(op)].slice(-1000)
      )
    );
  } catch {
    /* Diagnostics must never affect inventory processing. */
  }
}
