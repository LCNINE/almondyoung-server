import { BadRequestError } from '@app/shared';
import { IamEscalationError, RoleNameTakenError } from '../iam.errors';
import { assertGrantable, assertPermissionSet, assertRoleName, isCustomerRole, isSystemRole } from './iam-rules';

const states = new Map([
  ['order.order.read', { systemOnly: false, deprecated: false }],
  ['order.order.write', { systemOnly: false, deprecated: false }],
  ['catalog.product.read', { systemOnly: false, deprecated: false }],
  ['catalog.price.write', { systemOnly: false, deprecated: false }],
  ['fulfillment.tracking.ingest', { systemOnly: true, deprecated: false }],
  ['old.thing.read', { systemOnly: false, deprecated: true }],
]);

describe('iam rules', () => {
  it('accepts a lowercase slug and rejects anything else', () => {
    expect(() => assertRoleName('cs_team')).not.toThrow();
    for (const bad of ['CS', 'a', 'has space', '팀', 'x'.repeat(51)]) {
      expect(() => assertRoleName(bad)).toThrow(BadRequestError);
    }
  });

  it('never lets a new role take the system or a customer role name', () => {
    expect(() => assertRoleName('master')).toThrow(RoleNameTakenError);
    expect(() => assertRoleName('user')).toThrow(RoleNameTakenError);
  });

  it('knows the system and customer roles only through the constants', () => {
    expect(isSystemRole('master')).toBe(true);
    expect(isCustomerRole('membership')).toBe(true);
    expect(isSystemRole('admin')).toBe(false);
  });

  it('rejects unknown and system-only permissions', () => {
    expect(() => assertPermissionSet(['nope.nope.read'], [], states)).toThrow(BadRequestError);
    expect(() => assertPermissionSet(['fulfillment.tracking.ingest'], [], states)).toThrow(BadRequestError);
  });

  it('rejects a set that opens a missing requirement', () => {
    expect(() => assertPermissionSet(['order.order.write'], [], states)).toThrow(/order\.order\.read/);
  });

  it('does not hold an old gap against an unrelated change', () => {
    // 이미 열려 있던 누락(가격 수정 → 상품 조회)은 이번 저장이 만든 게 아니다.
    expect(() =>
      assertPermissionSet(['catalog.price.write', 'order.order.read'], ['catalog.price.write'], states),
    ).not.toThrow();
  });

  it('keeps a retired permission the role already had but refuses to add it', () => {
    expect(() => assertPermissionSet(['old.thing.read'], ['old.thing.read'], states)).not.toThrow();
    expect(() => assertPermissionSet(['old.thing.read'], [], states)).toThrow(BadRequestError);
  });

  it('refuses to hand out a live permission the actor does not hold, with a 403', () => {
    let thrown: unknown;
    try {
      assertGrantable(new Set(['order.order.read']), ['order.order.read', 'order.order.write'], states, '권한 범위');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(IamEscalationError);
    expect(thrown instanceof IamEscalationError && thrown.getHttpStatus()).toBe(403);
    expect(thrown instanceof IamEscalationError && thrown.getErrorCode()).toBe('IAM_ESCALATION');
  });

  it('does not ask the actor to hold a retired permission nobody can hold', () => {
    expect(() =>
      assertGrantable(new Set(['order.order.read']), ['order.order.read', 'old.thing.read'], states, 'x'),
    ).not.toThrow();
  });

  it('keeps a system-only permission the role already had but refuses to add it', () => {
    // 카탈로그 동기화가 기존 부여를 둔 채 시스템 전용으로 바꾼 권한 — 무관한 저장까지 막지 않는다.
    expect(() =>
      assertPermissionSet(['fulfillment.tracking.ingest', 'order.order.read'], ['fulfillment.tracking.ingest'], states),
    ).not.toThrow();
    expect(() => assertPermissionSet(['fulfillment.tracking.ingest'], [], states)).toThrow(BadRequestError);
  });

  it('does not ask the actor to hold a system-only permission nobody can hold', () => {
    expect(() =>
      assertGrantable(new Set(['order.order.read']), ['order.order.read', 'fulfillment.tracking.ingest'], states, 'x'),
    ).not.toThrow();
  });
});
