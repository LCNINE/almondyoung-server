import { CustomError } from '@/lib/api/customError';
import {
  PERMISSION_CATALOG,
  PERMISSION_DOMAINS,
  withoutDependents,
  withRequirements,
} from '@permission-catalog';
import { mainMenus, type MainMenu, type MenuItem } from '@/lib/utils/menu';
import {
  canAccess,
  filterMenuItems,
  resolveScreenAccess,
  SCREEN_ACCESS,
} from './screen-access';

/** 역할 편집 화면의 계산. 화면 컴포넌트는 그리기만 하고, 규칙은 여기와 권한 목록(`@permission-catalog`)에 있다. */

export interface GridCell {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly dangerous: boolean;
  readonly deprecated: boolean;
}

type PlainAction = 'read' | 'write' | 'delete' | 'export';

export interface GridRow {
  readonly domain: string;
  readonly target: string;
  readonly title: string;
  readonly cells: Partial<Record<PlainAction, GridCell>>;
  readonly special: readonly GridCell[];
}

export interface GridDomain {
  readonly domain: string;
  readonly title: string;
  readonly rows: readonly GridRow[];
}

const PLAIN: readonly string[] = ['read', 'write', 'delete', 'export'];
const isPlain = (action: string): action is PlainAction =>
  PLAIN.includes(action);
const domainTitles: Readonly<Record<string, string>> = PERMISSION_DOMAINS;
const domainTitle = (domain: string) =>
  Object.hasOwn(domainTitles, domain) ? domainTitles[domain] : domain;

export function buildGrid(deprecatedHeld: readonly string[]): GridDomain[] {
  const live: GridCell[] = PERMISSION_CATALOG.filter((p) => !p.systemOnly).map(
    (p) => ({
      key: p.key,
      label: p.label,
      description: p.description,
      dangerous: p.dangerous,
      deprecated: false,
    })
  );
  const known = new Set(live.map((c) => c.key));
  const retired: GridCell[] = deprecatedHeld
    .filter((key) => !known.has(key))
    .map((key) => ({
      key,
      label: key,
      description: '더는 쓰지 않는 권한',
      dangerous: false,
      deprecated: true,
    }));

  const rows = new Map<
    string,
    {
      domain: string;
      target: string;
      title: string | null;
      cells: GridRow['cells'];
      special: GridCell[];
    }
  >();
  for (const cell of [...live, ...retired]) {
    const [domain, target, action] = cell.key.split('.');
    const id = `${domain}.${target}`;
    const row = rows.get(id) ?? {
      domain,
      target,
      title: null,
      cells: {},
      special: [],
    };
    if (isPlain(action)) row.cells[action] = cell;
    else row.special.push(cell);
    if (action === 'read') row.title = cell.label.replace(/ 조회$/, '');
    rows.set(id, row);
  }

  const byDomain = new Map<string, GridRow[]>();
  for (const row of rows.values()) {
    const first =
      row.cells.read ??
      row.cells.write ??
      row.cells.delete ??
      row.cells.export ??
      row.special[0];
    const done: GridRow = {
      ...row,
      title: row.title ?? first?.label ?? row.target,
    };
    byDomain.set(row.domain, [...(byDomain.get(row.domain) ?? []), done]);
  }
  return [...byDomain.entries()].map(([domain, list]) => ({
    domain,
    title: domainTitle(domain),
    rows: list,
  }));
}

/**
 * 켤 때는 «그 권한이» 기대는 조회를 함께 켜고, 끌 때는 그것에 기대는 것을 함께 끈다. 이번 조작과 무관한
 * 기존 누락은 건드리지 않는다 — 서버도 «새로 연 누락»만 막는다.
 */
export function toggle(
  current: ReadonlySet<string>,
  key: string,
  on: boolean
): Set<string> {
  return on
    ? new Set([...current, ...withRequirements([key])])
    : withoutDependents(current, key);
}

const domainReads = (domain: string) =>
  PERMISSION_CATALOG.filter(
    (p) =>
      !p.systemOnly && p.key.startsWith(`${domain}.`) && p.key.endsWith('.read')
  ).map((p) => p.key);

export function domainReadState(
  current: ReadonlySet<string>,
  domain: string
): boolean | 'indeterminate' {
  const reads = domainReads(domain);
  const on = reads.filter((k) => current.has(k)).length;
  if (on === 0) return false;
  return on === reads.length ? true : 'indeterminate';
}

export function toggleDomainReads(
  current: ReadonlySet<string>,
  domain: string,
  on: boolean
): Set<string> {
  let next = new Set(current);
  for (const key of domainReads(domain)) next = toggle(next, key, on);
  return next;
}

export function summarize(before: Iterable<string>, after: Iterable<string>) {
  const was = new Set(before);
  const now = new Set(after);
  const dangerous = new Set<string>(
    PERMISSION_CATALOG.filter((p) => p.dangerous).map((p) => p.key)
  );
  const added = [...now].filter((k) => !was.has(k)).sort();
  return {
    added,
    removed: [...was].filter((k) => !now.has(k)).sort(),
    dangerousAdded: added.filter((k) => dangerous.has(k)),
  };
}

/** 이 권한으로 열리는 화면(경로 권한표 역색인). 버튼·동작 권한은 화면을 열지 않으므로 비어 있을 수 있다. */
export function screensOpenedBy(key: string): string[] {
  return Object.entries(SCREEN_ACCESS)
    .filter(
      ([, access]) =>
        access.kind === 'permission' && access.anyOf.some((k) => k === key)
    )
    .map(([path]) => path)
    .sort();
}

const leaves = (
  items: readonly MenuItem[]
): { path: string; title: string }[] =>
  items.flatMap((item) => [
    ...(item.path && !item.isComingSoon
      ? [{ path: item.path, title: item.title }]
      : []),
    ...leaves(item.children ?? []),
  ]);

/** 첫 화면 후보 — 그 권한으로 열 수 있는 메뉴 화면(로그인만 요구하는 화면은 뺀다). */
export function landingCandidates(
  held: ReadonlySet<string>
): { path: string; title: string }[] {
  return leaves(mainMenus.flatMap((m) => m.children)).filter(({ path }) => {
    const access = resolveScreenAccess(path);
    return access?.kind === 'permission' && canAccess(access, held);
  });
}

/** 편집 중인 권한으로 그린 사이드바 — 대리 로그인 없이 «이 역할이 보는 메뉴». */
export function previewMenu(held: ReadonlySet<string>): MainMenu[] {
  return mainMenus
    .map((menu) => ({
      ...menu,
      children: filterMenuItems(menu.children, held),
    }))
    .filter((menu) => menu.children.length > 0);
}

/** 서버가 규칙으로 거절한 변경의 code(`ROLE_VERSION_STALE` 등). 화면은 이걸로 사유를 나눈다. */
export function iamErrorCode(error: unknown): string | null {
  if (!(error instanceof CustomError)) return null;
  const body: unknown = error.response;
  if (typeof body !== 'object' || body === null || !('code' in body))
    return null;
  return typeof body.code === 'string' ? body.code : null;
}

/**
 * 시스템 역할을 기간 없이 가진, 로그인할 수 있는 사람이 한 명뿐이면 그 사람 — 회수하면 0명이 된다
 * (서버도 같은 기준으로 거절한다: 탈퇴·휴면·기간 부여는 «남는 사람»으로 세지 않는다).
 */
export function lastPermanentHolder(
  members: readonly {
    userId: string;
    expiresAt: string | null;
    canSignIn: boolean;
  }[]
): string | null {
  const permanent = members.filter((m) => m.expiresAt === null && m.canSignIn);
  return permanent.length === 1 ? permanent[0].userId : null;
}
