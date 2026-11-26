import type { PermissionCheckpoints } from '@app/authorization';
import { workshopActorOf } from './workshop-access';

// 역할마다 가진 권한을 흉내 낸다 — 현장 작업자는 3D 공개는 되지만 재고 기준정보 관리는 없다
const held: Record<string, string[]> = {
  logistics_worker: [
    'inventory.model_workshop.read',
    'inventory.model_workshop.write',
    'inventory.model_workshop.publish',
  ],
  viewer: ['inventory.model_workshop.read'],
};
const checkpoints = {
  check: (_name: string, subject: { roles: string[] }, required: string[]) =>
    subject.roles.some((role) => required.some((key) => held[role]?.includes(key))),
} as unknown as PermissionCheckpoints;

describe('workshopActorOf', () => {
  it('lets a field worker publish with the 3D publish permission alone', () => {
    const actor = workshopActorOf({ userId: 'u1', roles: ['logistics_worker'] }, checkpoints);

    expect(actor).toMatchObject({ userId: 'u1', canPublish: true, canManage: false });
  });

  it('does not let a reader publish', () => {
    expect(workshopActorOf({ userId: 'u2', roles: ['viewer'] }, checkpoints).canPublish).toBe(false);
  });
});
