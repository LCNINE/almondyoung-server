import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authQueryKeys } from '@/lib/services/auth/query-keys';
import { usersQueryKeys } from '@/lib/services/users/query-keys';
import { useAssigneeOptions, withCurrentAssignee } from './ZeroHitTable';

function Probe() {
  const { options, blockedReason } = useAssigneeOptions();
  return createElement('p', null, `${options.map((option) => option.label).join('|')}#${blockedReason ?? ''}`);
}

const render = (permissions: readonly string[]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  client.setQueryData(authQueryKeys.myPermissions(), {
    roles: [{ name: 'custom', displayName: '맞춤 역할' }],
    permissions: new Set(permissions),
    version: 'v1',
    landingPath: null,
  });
  // 권한이 있을 때 받아 둔 계정 목록 캐시
  client.setQueryData(usersQueryKeys.list({ roleName: 'admin,master', limit: 100 }), {
    data: [{ id: 'u-1', username: '김담당', loginId: 'kim' }],
  });
  try {
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Probe)));
  } finally {
    client.clear();
  }
};

describe('assignee choices', () => {
  it('offers accounts only to a viewer who reads them', () => {
    expect(render(['customer.profile.read'])).toContain('김담당 (kim)#<');
  });

  it('does not offer a cached account list without the permission and says why', () => {
    const html = render(['analytics.report.read']);
    expect(html).not.toContain('김담당');
    expect(html).toContain('권한이 있어야 담당자를 바꿀 수 있습니다');
  });

  it('keeps the current assignee when the list is not available', () => {
    expect(withCurrentAssignee([], 'u-9', '박담당')).toEqual([{ value: 'u-9', name: '박담당', label: '박담당' }]);
    expect(withCurrentAssignee([{ value: 'u-9', name: '박담당', label: '박담당 (park)' }], 'u-9', '박담당')).toHaveLength(1);
  });
});
