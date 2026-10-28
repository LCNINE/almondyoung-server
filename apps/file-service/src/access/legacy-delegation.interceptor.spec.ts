import { CallHandler, Logger } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { of } from 'rxjs';
import { JwtPayload } from '../shared/types/jwt-payload.interface';
import { LegacyDelegationInterceptor } from './legacy-delegation.interceptor';

const httpContext = (user?: JwtPayload) => new ExecutionContextHost([{ user }, {}, () => undefined]);
const next: CallHandler = { handle: () => of('ok') };

describe('LegacyDelegationInterceptor', () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());

  it('notes each request made with the legacy master-scope delegation token', () => {
    new LegacyDelegationInterceptor().intercept(
      httpContext({ userId: '00000000-0000-4000-8000-000000a1d001', email: '', roles: [], scopes: ['master'] }),
      next,
    );
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: 'authz_legacy_delegation', service: 'file-service', delegate: 'ugc-service' }),
    );
  });

  it('stays silent for standard delegation, people and anonymous requests', () => {
    const interceptor = new LegacyDelegationInterceptor();
    interceptor.intercept(
      httpContext({ userId: 'u1', email: '', roles: [], act: { sub: 'core' }, aud: 'file-service' }),
      next,
    );
    interceptor.intercept(httpContext({ userId: 'u1', email: '', roles: ['admin'] }), next);
    interceptor.intercept(httpContext(undefined), next);
    expect(log).not.toHaveBeenCalled();
  });
});
