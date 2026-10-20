import { findPermission } from '@permission-catalog';
import type { IamAuditLog } from '@/lib/types/dto/iam';
import { describeAudit } from './audit-format';

const base: Omit<IamAuditLog, 'action' | 'before' | 'after'> = {
  id: '1',
  occurredAt: '2026-10-13T00:00:00Z',
  actorUserId: 'u',
  actorLoginId: 'boss',
  targetType: 'role',
  targetId: 'r',
  targetLabel: '인턴',
  ip: null,
  userAgent: null,
  requestId: null,
};
const label = (key: string) => findPermission(key)?.label ?? key;

describe('describeAudit', () => {
  it('names added and removed permissions by their labels', () => {
    const d = describeAudit({
      ...base,
      action: 'role.permissions.replace',
      before: { version: 1, permissions: ['order.order.read'] },
      after: {
        version: 2,
        permissions: ['order.order.write'],
        added: ['order.order.write'],
        removed: ['order.order.read'],
      },
    });
    expect(d.title).toBe('인턴 — 권한 변경');
    expect(d.lines).toEqual([
      { kind: 'added', text: label('order.order.write') },
      { kind: 'removed', text: label('order.order.read') },
    ]);
  });

  it('shows assignment changes with their end dates in Korean days', () => {
    const d = describeAudit({
      ...base,
      targetType: 'user',
      targetLabel: 'kim',
      action: 'user.roles.replace',
      before: [{ roleId: 'a', name: 'intern', expiresAt: null }],
      after: [
        { roleId: 'a', name: 'intern', expiresAt: '2026-10-31T14:59:59.999Z' },
        { roleId: 'b', name: 'cs_team', expiresAt: null },
      ],
    });
    expect(d.lines).toEqual([
      { kind: 'changed', text: 'intern 종료일: 무기한 → 2026-10-31' },
      { kind: 'added', text: 'cs_team (무기한)' },
    ]);
  });

  it('lists the permissions a deleted role had', () => {
    const d = describeAudit({
      ...base,
      action: 'role.delete',
      before: { permissions: ['order.order.read'] },
      after: null,
    });
    expect(d.lines).toEqual([
      { kind: 'removed', text: label('order.order.read') },
    ]);
  });

  it('shows the fields of a role update side by side', () => {
    const d = describeAudit({
      ...base,
      action: 'role.update',
      before: { version: 1, displayName: '인턴', landingPath: null },
      after: {
        version: 2,
        displayName: '인턴(여름)',
        landingPath: '/order/history',
      },
    });
    expect(d.lines).toEqual([
      { kind: 'changed', text: '표시 이름: 인턴 → 인턴(여름)' },
      { kind: 'changed', text: '첫 화면: 없음 → /order/history' },
    ]);
  });

  it('falls back to the raw key for a permission that no longer exists and survives a malformed row', () => {
    expect(
      describeAudit({
        ...base,
        action: 'role.permissions.replace',
        before: {},
        after: { added: ['gone.thing.read'] },
      }).lines
    ).toEqual([{ kind: 'added', text: 'gone.thing.read' }]);
    expect(
      describeAudit({
        ...base,
        action: 'user.roles.replace',
        before: 'x',
        after: 7,
      }).lines
    ).toEqual([]);
  });
});
