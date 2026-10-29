import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { userApi } from '@/lib/api/domains/users';
import { authQueryKeys } from '@/lib/services/auth/query-keys';
import { usersQueryKeys } from '@/lib/services/users/query-keys';
import { STAFF_CANDIDATE_LIMIT } from '@/lib/services/users/queries';
import { AssigneeOptionItems, useAssigneeOptions, withCurrentAssignee } from './ZeroHitTable';

// 서버 렌더는 effect 를 돌리지 않아 요청이 나가지 않는다 — enabled 가 켜진 계정 질의는 queryFn 을 부르게 해 요청 여부를 본다.
jest.mock('@tanstack/react-query', () => {
  const actual = jest.requireActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (options: { enabled?: boolean; queryKey: readonly unknown[]; queryFn?: () => unknown }) => {
      if (options.enabled !== false && options.queryKey[0] === 'users') void options.queryFn?.();
      return actual.useQuery(options);
    },
  };
});

function Probe() {
  const { options, blockedReason } = useAssigneeOptions();
  return createElement('p', null, `${options.map((option) => option.label).join('|')}#${blockedReason ?? ''}`);
}

const KEY = { audience: 'staff', holding: 'analytics.keyword.write', limit: STAFF_CANDIDATE_LIMIT } as const;
const USERS = [
  { id: 'u-0', username: '이타직', loginId: 'lee', holdsPermission: false },
  { id: 'u-1', username: '김담당', loginId: 'kim', holdsPermission: true },
];

const render = (permissions: readonly string[]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  client.setQueryData(authQueryKeys.myPermissions(), {
    roles: [{ name: 'custom', displayName: '맞춤 역할' }],
    permissions: new Set(permissions),
    version: 'v1',
    landingPath: null,
  });
  // 권한이 있을 때 받아 둔 계정 목록 캐시
  client.setQueryData(usersQueryKeys.list(KEY), { data: USERS });
  try {
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Probe)));
  } finally {
    client.clear();
  }
};

describe('assignee choices', () => {
  const spy = jest.spyOn(userApi, 'getAdminUsers');
  beforeEach(() => {
    spy.mockReset().mockResolvedValue({ data: [], total: 0, page: 1, limit: 0 });
  });
  afterAll(() => spy.mockRestore());

  it('offers accounts only to a viewer who reads them', () => {
    expect(render(['customer.profile.read'])).toContain('김담당 (kim)|이타직 (lee)#<');
  });

  it('does not offer a cached account list without the permission and says why', () => {
    const html = render(['analytics.report.read']);
    expect(html).not.toContain('김담당');
    expect(html).toContain('권한이 있어야 담당자를 바꿀 수 있습니다');
  });

  it('sends no request for accounts without the permission', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(authQueryKeys.myPermissions(), {
      roles: [],
      permissions: new Set(['analytics.report.read']),
      version: 'v1',
      landingPath: null,
    });
    try {
      renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Probe)));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      client.clear();
    }
  });

  it('asks for staff with the keyword permission', () => {
    expect(render(['customer.profile.read'])).toContain('김담당');
  });

  it('lists permission holders before other staff', () => {
    expect(render(['customer.profile.read'])).toContain('김담당 (kim)|이타직 (lee)#');
  });

  it('puts other staff under their own label', () => {
    const html = renderToStaticMarkup(
      createElement(AssigneeOptionItems, {
        options: [
          { value: 'a', name: 'A', label: 'A (a)', group: 'holder' },
          { value: 'b', name: 'B', label: 'B (b)', group: 'other' },
        ],
      }),
    );
    expect(html).toBe(
      '<option value="a">A (a)</option><optgroup label="다른 직원"><option value="b">B (b)</option></optgroup>',
    );
  });

  it('keeps the current assignee when the list is not available', () => {
    expect(withCurrentAssignee([], 'u-9', '박담당')).toEqual([{ value: 'u-9', name: '박담당', label: '박담당' }]);
    expect(withCurrentAssignee([{ value: 'u-9', name: '박담당', label: '박담당 (park)' }], 'u-9', '박담당')).toHaveLength(1);
  });
});
