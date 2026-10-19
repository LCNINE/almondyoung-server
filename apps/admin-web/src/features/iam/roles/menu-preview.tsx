'use client';

import { previewMenu } from '@/lib/auth/role-editor';
import type { MenuItem } from '@/lib/utils/menu';

function Tree({ items }: { items: readonly MenuItem[] }) {
  return (
    <ul className="space-y-0.5 pl-3 text-sm">
      {items.map((item) => (
        <li key={item.id}>
          <span
            className={item.isComingSoon ? 'text-muted-foreground' : undefined}
          >
            {item.title}
          </span>
          {item.children && item.children.length > 0 && (
            <Tree items={item.children} />
          )}
        </li>
      ))}
    </ul>
  );
}

/** 편집 중인 권한으로 그린 사이드바 — 대리 로그인 없이 «이 역할이 보는 메뉴». */
export function MenuPreview({ held }: { held: ReadonlySet<string> }) {
  const menus = previewMenu(held);
  return (
    <section aria-label="메뉴 미리보기" className="rounded-md border p-3">
      <h3 className="mb-1 text-sm font-semibold">메뉴 미리보기</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        저장 전 체크 상태 기준
      </p>
      {menus.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          열 수 있는 메뉴가 없습니다.
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {menus.map((menu) => (
            <li key={menu.id}>
              <span className="font-medium">{menu.title}</span>
              <Tree items={menu.children} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
