import { recordPermissionDecisions, RequireScopes, ScopeGuard } from '@app/authorization';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { skillsFor } from '../../skills/registry';
import { AI_SCOPE } from './ai-scopes';
import { grantedAiScopes } from './granted-scopes';

class ChatRoutes {
  @RequireScopes(AI_SCOPE.ASSISTANT, AI_SCOPE.STOREFRONT)
  send(): void {}
}

/** 옛 판정 낙인은 ScopeGuard 를 실제로 통과시켜 만든다. */
const scopeStamped = async (roles: string[], mapped: string[]) => {
  const request = { user: { userId: 'u1', sub: 'u1', roles } };
  const context = new ExecutionContextHost([request, {}], ChatRoutes, ChatRoutes.prototype.send);
  context.setType('http');
  await new ScopeGuard(new Reflector(), { getScopesByRoles: async () => new Set(mapped) }).canActivate(context);
  return request;
};

const permissionStamped = (permissions: string[]) => {
  const request = {};
  recordPermissionDecisions(request, permissions);
  return request;
};

describe('grantedAiScopes', () => {
  it('grants the assistant tools from the permission stamp once enforced', () => {
    expect(grantedAiScopes(permissionStamped(['ai.assistant.use']), true)).toEqual([AI_SCOPE.ASSISTANT]);
  });

  it('grants nothing from a scope stamp once enforced', async () => {
    expect(grantedAiScopes(await scopeStamped(['admin'], [AI_SCOPE.ASSISTANT]), true)).toEqual([]);
  });

  it('keeps the scope stamp behaviour while off', async () => {
    expect(grantedAiScopes(await scopeStamped(['admin'], [AI_SCOPE.ASSISTANT]), false)).toEqual([AI_SCOPE.ASSISTANT]);
    expect(grantedAiScopes(permissionStamped(['ai.assistant.use']), false)).toEqual([]);
  });

  it('offers the same skills to master in both modes', async () => {
    const off = skillsFor(grantedAiScopes(await scopeStamped(['master'], []), false)).map((s) => s.name);
    const on = skillsFor(grantedAiScopes(permissionStamped(['ai.assistant.use']), true)).map((s) => s.name);
    expect(on).toEqual(off);
    expect(on.length).toBeGreaterThan(0);
  });
});
