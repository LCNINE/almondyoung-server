import { PermissionCheckpoints } from '@app/authorization';
import { ForbiddenError, NotFoundError } from '@app/shared';
import { authenticatedWarehouseActor, type WarehouseActor } from '../core/services/warehouse-operation-contract';

export type WorkshopActor = { userId: string; label: string; canManage: boolean; canPublish: boolean };

export type WorkshopUser = NonNullable<WarehouseActor> & {
  roles?: string[];
  email?: string;
  login_id?: string;
  name?: string;
};

export function workshopActorOf(user: WorkshopUser, checkpoints: PermissionCheckpoints): WorkshopActor {
  const userId = authenticatedWarehouseActor(user);
  const subject = { roles: user.roles ?? [] };

  return {
    userId,
    label: user.name || user.login_id || user.email || userId,
    canManage: checkpoints.check('sku_3d_workshop.manage', subject, ['inventory.model_workshop.manage']),
    canPublish: checkpoints.check('sku_3d_workshop.publish', subject, ['inventory.model_workshop.publish']),
  };
}

// 남의 작업실은 있는지조차 알리지 않는다
export function assertCanView(workshop: { ownerId: string }, actor: WorkshopActor): void {
  if (workshop.ownerId !== actor.userId && !actor.canManage) {
    throw new NotFoundError('3D 작업실을 찾을 수 없어요');
  }
}

export function assertOwner(workshop: { ownerId: string }, actor: WorkshopActor): void {
  assertCanView(workshop, actor);

  if (workshop.ownerId !== actor.userId) {
    throw new ForbiddenError('작업실 주인만 할 수 있어요');
  }
}
