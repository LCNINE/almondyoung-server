'use client';

import type { ReactNode } from 'react';
import type { FailureActionRow } from '@/lib/api/domains/events';
import { actionLabel } from '../display';

export function Fields({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-all font-mono">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto rounded bg-muted p-2 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function ErrorBlock({ text }: { text: string }) {
  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-red-50 p-2 text-xs text-red-800">
      {text}
    </pre>
  );
}

export function ActionLog({
  kind,
  actions,
}: {
  kind: 'dead_letter' | 'outbox';
  actions: FailureActionRow[];
}) {
  if (actions.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-xs">
      {actions.map((a) => (
        <li key={a.id} className="flex gap-2">
          <span className="text-muted-foreground">
            {new Date(a.createdAt).toLocaleString('ko-KR')}
          </span>
          <span>{actionLabel(kind, a.action, a.outcome)}</span>
          <span className="text-muted-foreground">{a.actor ?? '-'}</span>
          {a.note && <span className="break-all">{a.note}</span>}
        </li>
      ))}
    </ul>
  );
}
