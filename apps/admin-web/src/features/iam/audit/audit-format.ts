import { findPermission } from '@permission-catalog';
import type { IamAuditAction, IamAuditLog } from '@/lib/types/dto/iam';

export interface AuditLine {
  readonly kind: 'added' | 'removed' | 'changed';
  readonly text: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const label = (key: string) => findPermission(key)?.label ?? key;
const kstDate = (iso: string) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(
    new Date(iso)
  );
const until = (iso: string | null) => (iso ? kstDate(iso) : '무기한');

interface Held {
  readonly roleId: string;
  readonly name: string;
  readonly expiresAt: string | null;
}

const assignments = (v: unknown): Held[] =>
  Array.isArray(v)
    ? v.flatMap((x): Held[] =>
        isRecord(x) &&
        typeof x.roleId === 'string' &&
        typeof x.name === 'string'
          ? [
              {
                roleId: x.roleId,
                name: x.name,
                expiresAt: typeof x.expiresAt === 'string' ? x.expiresAt : null,
              },
            ]
          : []
      )
    : [];

const TITLES: Record<IamAuditAction, string> = {
  'role.create': '역할 만듦',
  'role.update': '역할 정보 변경',
  'role.delete': '역할 삭제',
  'role.permissions.replace': '권한 변경',
  'user.roles.replace': '역할 변경',
  'role.members.add': '역할 추가',
  'role.member.remove': '역할 회수',
  'admin_user.create': '관리자 계정 생성',
};

const FIELD_NAMES: Record<string, string> = {
  displayName: '표시 이름',
  description: '설명',
  landingPath: '첫 화면',
};
const show = (v: unknown) =>
  v === null || v === undefined || v === '' ? '없음' : String(v);

/** 이력 한 행을 사람이 읽는 줄로 — 전/후를 비교해 추가·회수·변경만 보인다. 모양이 다르면 줄 없이 둔다. */
export function describeAudit(log: IamAuditLog): {
  title: string;
  lines: AuditLine[];
} {
  const title = `${log.targetLabel} — ${TITLES[log.action] ?? log.action}`;
  const before = isRecord(log.before) ? log.before : {};
  const after = isRecord(log.after) ? log.after : {};

  if (
    log.action === 'role.permissions.replace' ||
    log.action === 'role.create'
  ) {
    const added = strings(
      log.action === 'role.create' ? after.permissions : after.added
    );
    const removed = strings(after.removed);
    return {
      title,
      lines: [
        ...added.map((k): AuditLine => ({ kind: 'added', text: label(k) })),
        ...removed.map((k): AuditLine => ({ kind: 'removed', text: label(k) })),
      ],
    };
  }
  if (log.action === 'role.delete') {
    return {
      title,
      lines: strings(before.permissions).map(
        (k): AuditLine => ({ kind: 'removed', text: label(k) })
      ),
    };
  }
  if (log.action === 'role.update') {
    return {
      title,
      lines: Object.keys(after)
        .filter((k) => k !== 'version')
        .map(
          (k): AuditLine => ({
            kind: 'changed',
            text: `${FIELD_NAMES[k] ?? k}: ${show(before[k])} → ${show(after[k])}`,
          })
        ),
    };
  }

  const was = new Map(assignments(log.before).map((a) => [a.roleId, a]));
  const now = new Map(assignments(log.after).map((a) => [a.roleId, a]));
  const lines: AuditLine[] = [];
  for (const [id, a] of now) {
    const prev = was.get(id);
    if (!prev)
      lines.push({ kind: 'added', text: `${a.name} (${until(a.expiresAt)})` });
    else if (prev.expiresAt !== a.expiresAt) {
      lines.push({
        kind: 'changed',
        text: `${a.name} 종료일: ${until(prev.expiresAt)} → ${until(a.expiresAt)}`,
      });
    }
  }
  for (const [id, a] of was)
    if (!now.has(id)) lines.push({ kind: 'removed', text: a.name });
  return { title, lines };
}
