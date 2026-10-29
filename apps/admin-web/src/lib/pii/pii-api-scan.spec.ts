import { importGraphOf, type ImportGraph } from '../auth/mutation-guard-graph';
import { piiPath, scanPiiApis } from './pii-api-scan';

const API = 'lib/api/x.ts';
const PAGE = 'app/p/page.tsx';

function graphWith(apiSource: string): ImportGraph {
  const files = new Map([
    [API, apiSource],
    [
      PAGE,
      `import { api } from '@/lib/api/x';\nexport default function P() {\n  api.get('1');\n}\n`,
    ],
  ]);
  return {
    files,
    importsOf: (rel) => (rel === PAGE ? [API] : []),
    valueImportsOf: (rel) =>
      rel === PAGE ? [{ local: 'api', file: API, name: 'api' }] : [],
    resolveModule: () => null,
    moduleImportsOf: (rel) => (rel === PAGE ? [API] : []),
  };
}

const reached = (call: string) =>
  scanPiiApis({
    graph: graphWith(
      `export const api = {\n  get: (id: string) => client.get(${call}),\n};\n`
    ),
    paths: ['/admin/users/:userId', '/sales-orders/:id/amendments'].map(
      piiPath
    ),
    isApiFile: (rel) => rel.startsWith('lib/'),
    isException: () => false,
  }).reachedFrom(PAGE);

describe('scanPiiApis — 경로 모양', () => {
  it('템플릿의 ${…} 조각', () => {
    expect(reached('`/admin/users/${id}`')).toEqual([`${API}#api.get`]);
  });

  it('매개변수 자리에 고정 값을 쓴 호출', () => {
    expect(reached("'/admin/users/fixed-id'")).toEqual([`${API}#api.get`]);
  });

  it('문자열 잇기(+)로 만든 경로', () => {
    expect(reached("'/sales-orders/' + id + '/amendments'")).toEqual([
      `${API}#api.get`,
    ]);
    expect(reached("'/admin/users/' + id")).toEqual([`${API}#api.get`]);
  });

  it('하위 경로는 같은 머리여도 아니다', () => {
    expect(reached('`/admin/users/${id}/roles`')).toEqual([]);
  });
});

describe('scanPiiApis — 이름을 바꾸는 re-export', () => {
  it('barrel 이 export { a as b } from 으로 내보낸 이름을 원래 선언에 잇는다', () => {
    const graph = importGraphOf(
      '/src',
      new Map([
        [
          'lib/api/x.ts',
          'export const api = {\n  get: (id: string) => client.get(`/admin/users/${id}`),\n};\n',
        ],
        ['lib/api/index.ts', "export { api as renamedApi } from './x';\n"],
        [
          PAGE,
          "import { renamedApi } from '@/lib/api';\nexport default function P() {\n  renamedApi.get('1');\n}\n",
        ],
      ])
    );
    const scan = scanPiiApis({
      graph,
      paths: [piiPath('/admin/users/:userId')],
      isApiFile: (rel) => rel.startsWith('lib/'),
      isException: () => false,
    });
    expect(scan.reachedFrom(PAGE)).toEqual(['lib/api/x.ts#api.get']);
  });
});
