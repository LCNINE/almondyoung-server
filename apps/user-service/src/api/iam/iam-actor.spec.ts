import type { JwtPayload } from '@app/authorization';
import type { FastifyRequest } from 'fastify';
import { actorFrom } from './iam-actor';

const request = (user: JwtPayload, headers: Record<string, string | string[]>): FastifyRequest & { user: JwtPayload } =>
  Object.assign(Object.create(null), { user, headers });

describe('actorFrom', () => {
  it('takes who from the token and the request id and agent from the headers', () => {
    const actor = actorFrom(
      request(
        { id: 'u-1', email: 'a@b.c', roles: ['master'], login_id: 'boss' },
        { 'user-agent': 'ua', 'x-request-id': 'r-1' },
      ),
    );
    expect(actor).toEqual({ userId: 'u-1', loginId: 'boss', roles: ['master'], userAgent: 'ua', requestId: 'r-1', ip: null });
  });

  it('leaves out what the request did not carry and ignores repeated headers', () => {
    const actor = actorFrom(request({ id: 'u-1', email: 'a@b.c', roles: [] }, { 'x-request-id': ['a', 'b'] }));
    expect(actor).toEqual({ userId: 'u-1', loginId: null, roles: [], userAgent: null, requestId: null, ip: null });
  });

  it('fills the audit ip from the proxy header', () => {
    const actor = actorFrom(request({ id: 'u-1', email: 'a@b.c', roles: [] }, { 'x-staff-client-ip': '203.0.113.7' }));
    expect(actor.ip).toBe('203.0.113.7');
  });

  it('caps a very long header', () => {
    const actor = actorFrom(request({ id: 'u-1', email: 'a@b.c', roles: [] }, { 'user-agent': 'x'.repeat(2000) }));
    expect(actor.userAgent).toHaveLength(500);
  });
});
