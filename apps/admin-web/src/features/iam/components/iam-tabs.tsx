'use client';

import Link from 'next/link';
import { useCanOpen } from '@/hooks/use-permission';
import type { CanState } from '@/lib/auth/permission-check';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'staff', label: '관리자', href: '/users' },
  { id: 'roles', label: '역할', href: '/users/roles' },
  { id: 'audit', label: '변경 이력', href: '/users/audit-log' },
] as const;

export type IamTab = (typeof TABS)[number]['id'];

const open = (state: CanState) => state.status === 'ready' && state.allowed;

/** 탭은 열 수 있는 화면만 보인다(경로 권한표가 정본). */
export function IamTabs({ current }: { current: IamTab }) {
  const visible: Record<IamTab, boolean> = {
    staff: open(useCanOpen('/users')),
    roles: open(useCanOpen('/users/roles')),
    audit: open(useCanOpen('/users/audit-log')),
  };
  return (
    <nav aria-label="관리자·권한" className="flex gap-1 border-b px-3">
      {TABS.filter((t) => visible[t.id] || t.id === current).map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={current === t.id ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm',
            current === t.id
              ? 'border-primary font-medium'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
