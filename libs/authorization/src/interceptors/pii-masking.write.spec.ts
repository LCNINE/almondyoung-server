import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { lastValueFrom, of } from 'rxjs';
import { OPEN_WITH_RECIPIENT, PiiWrite } from '../decorators/pii-response.decorator';
import { PiiAccessRecord, PiiAccessRecorder } from '../services/pii-access-recorder';
import { PermissionAuthority } from '../services/permission-authority';
import { RouteRequirementResolver } from '../services/route-requirement.resolver';
import { PiiMaskingInterceptor } from './pii-masking.interceptor';

class Probe {
  @PiiWrite({ fields: ['username', 'phoneNumber', 'address'] })
  updateProfile(): void {}

  @PiiWrite({ fields: ['recipientSnapshot'], rawWith: OPEN_WITH_RECIPIENT })
  reviseRecipient(): void {}

  @PiiWrite({ fields: ['customer.name', 'customer.phone'] })
  updateOrder(): void {}

  plain(): void {}
}

class NoRecorder extends PiiAccessRecorder {
  async record(_entry: PiiAccessRecord): Promise<void> {}
}

const authority = (enforce: boolean) =>
  new PermissionAuthority(new RouteRequirementResolver(new Reflector()), {
    service: 'core',
    enforce,
    refreshIntervalMs: 30_000,
    retryBaseMs: 1_000,
    summaryIntervalMs: 300_000,
  });

const run = async (handler: keyof Probe, body: unknown, permissions: readonly string[] | null, enforce = true) => {
  const cache = { permissionsFor: () => (permissions === null ? null : new Set(permissions)) };
  const interceptor = new PiiMaskingInterceptor(
    new Reflector(),
    cache,
    new NoRecorder(),
    { service: 'core', revealRequired: false, envelope: 'none' },
    authority(enforce),
  );
  const request = { body, user: { userId: 'u1', sub: 'u1', roles: ['someone'] }, headers: {} };
  const context = new ExecutionContextHost([request, {}], Probe, Probe.prototype[handler]);
  context.setType('http');
  const handle = jest.fn(() => of({ ok: true }));
  const result = await lastValueFrom(interceptor.intercept(context, { handle }));
  return { result, handled: handle.mock.calls.length };
};

describe('PiiMaskingInterceptor write fields', () => {
  it('refuses a personal field from a writer who cannot see it', async () => {
    await expect(run('updateProfile', { username: '홍*동' }, ['customer.profile.write'])).rejects.toMatchObject({
      constructor: ForbiddenException,
      response: { requiredPermissions: ['customer.pii.read'] },
    });
  });

  it('lets a writer change the other fields without the personal permission', async () => {
    await expect(run('updateProfile', { nickname: 'n' }, ['customer.profile.write'])).resolves.toEqual({
      result: { ok: true },
      handled: 1,
    });
  });

  it('lets a writer who can see the field change it', async () => {
    const { handled } = await run('updateProfile', { phoneNumber: '+821012345678' }, ['customer.pii.read']);
    expect(handled).toBe(1);
  });

  it('opens the recipient fields with the recipient permission', async () => {
    const { handled } = await run('reviseRecipient', { recipientSnapshot: { name: '김' } }, ['fulfillment.recipient.read']);
    expect(handled).toBe(1);
  });

  it('treats a missing field as not sent', async () => {
    const { handled } = await run('updateProfile', { nickname: 'n', address: undefined }, []);
    expect(handled).toBe(1);
  });

  it('refuses clearing a personal field without the permission to see it', async () => {
    await expect(run('updateProfile', { username: '' }, ['customer.profile.write'])).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run('updateProfile', { address: null }, ['customer.profile.write'])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses clearing the object that holds a personal field', async () => {
    await expect(run('updateOrder', { customer: null }, ['order.order.write'])).rejects.toBeInstanceOf(ForbiddenException);
    const { handled } = await run('updateOrder', { customer: { id: 'c1' } }, ['order.order.write']);
    expect(handled).toBe(1);
  });

  it('cannot judge without a permission snapshot once enforced and says so', async () => {
    await expect(run('updateProfile', { username: '홍길동' }, null)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('lets a write through while the snapshot is missing in shadow mode', async () => {
    const { handled } = await run('updateProfile', { username: '홍길동' }, null, false);
    expect(handled).toBe(1);
  });

  it('still refuses a writer without the permission in shadow mode', async () => {
    await expect(run('updateProfile', { username: '홍*동' }, ['customer.profile.write'], false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('leaves undeclared routes alone', async () => {
    const { handled } = await run('plain', { username: '홍*동' }, []);
    expect(handled).toBe(1);
  });
});
