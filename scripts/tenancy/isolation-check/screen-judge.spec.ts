import {
  concretePath,
  crossRefusal,
  forbiddenHits,
  foreignSanNames,
  notFoundProblem,
  offListRequests,
  openProblem,
  outsidePaths,
  tenantOneUpstreamCalls,
  type ScreenVisit,
} from './screen-judge';

describe('forbiddenHits — 흔적 0', () => {
  it('대소문자를 가리지 않고 어디서 나왔는지 적는다', () => {
    expect(
      forbiddenHits(
        [
          { where: '/inventory/skus 탭 제목', text: 'Acme Console' },
          { where: '/mall/tags 보이는 글자', text: '태그 · acme 제공' },
        ],
        ['ACME'],
      ),
    ).toEqual(['/inventory/skus 탭 제목 «ACME»', '/mall/tags 보이는 글자 «ACME»']);
  });

  it('금지어가 없으면 비어 있다', () => {
    expect(forbiddenHits([{ where: '/', text: '창고 관리' }], ['acme'])).toEqual([]);
  });
});

describe('offListRequests — 네트워크 호스트 = 테넌트 도메인 + 테넌트 2 버킷', () => {
  const allowed = {
    hosts: ['two.example:8002', 'two-auth.example:8001'],
    prefixes: ['https://two-public.s3.ap-northeast-2.amazonaws.com/', 'http://localhost:3060/files/local/two-public/'],
  };

  it('테넌트 도메인(포트까지)과 버킷 접두사는 통과, 그 밖은 호스트로 묶어 센다', () => {
    expect(
      offListRequests(
        [
          'http://two.example:8002/inventory/skus',
          'http://two-auth.example:8001/signin',
          'https://two-public.s3.ap-northeast-2.amazonaws.com/products/a.png',
          'http://localhost:3060/files/local/two-public/a.png',
          'http://localhost:3060/files/local/a.png',
          'http://localhost:3060/files/local/b.png',
          'https://one-bucket.s3.ap-northeast-2.amazonaws.com/x.png',
          'http://two.example:9999/x',
        ],
        allowed,
      ),
    ).toEqual([
      'localhost:3060 (2건, 예: http://localhost:3060/files/local/a.png)',
      'one-bucket.s3.ap-northeast-2.amazonaws.com (1건, 예: https://one-bucket.s3.ap-northeast-2.amazonaws.com/x.png)',
      'two.example:9999 (1건, 예: http://two.example:9999/x)',
    ]);
  });

  it('주소가 없는 요청(data:·blob:)은 셀 것이 아니다', () => {
    expect(offListRequests(['data:,', 'blob:http://two.example:8002/abc', 'about:blank'], allowed)).toEqual([]);
  });
});

describe('tenantOneUpstreamCalls — 테넌트 셸이 테넌트 1 만 섬기는 업스트림을 부르지 않는다', () => {
  it('브라우저 프록시 경로(/proxy/…·/api/proxy/…)와 채널 디스패치를 센다, core·file 프록시는 아니다', () => {
    expect(
      tenantOneUpstreamCalls([
        'http://two.example:8002/proxy/medusa/admin/shipping-options?limit=50',
        'http://two.example:8002/api/proxy/channel/adapter/x',
        'http://two.example:8002/api/fulfillment/channel-dispatch',
        'http://two.example:8002/proxy/api/masters',
        'http://two.example:8002/api/proxy/file/files/1',
        'http://two.example:8002/proxy/medusa-like/x',
      ]),
    ).toEqual([
      'http://two.example:8002/proxy/medusa/admin/shipping-options?limit=50',
      'http://two.example:8002/api/proxy/channel/adapter/x',
      'http://two.example:8002/api/fulfillment/channel-dispatch',
    ]);
  });
});

describe('foreignSanNames — 인증서 SAN 에 테넌트 도메인만', () => {
  const hosts = ['admin.two.example', 'auth.two.example'];

  it('테넌트 도메인과 그것을 덮는 와일드카드는 통과', () => {
    expect(foreignSanNames('DNS:admin.two.example, DNS:auth.two.example', hosts)).toEqual([]);
    expect(foreignSanNames('DNS:*.two.example', hosts)).toEqual([]);
  });

  it('다른 이름(같이 실린 다른 회사 주소, 테넌트 도메인을 안 덮는 와일드카드)은 나온다', () => {
    expect(foreignSanNames('DNS:admin.two.example, DNS:admin.one.example, DNS:*.one.example', hosts)).toEqual([
      'admin.one.example',
      '*.one.example',
    ]);
  });

  it('DNS 가 아닌 항목(IP)도 테넌트 도메인이 아니다', () => {
    expect(foreignSanNames('DNS:admin.two.example, IP Address:10.0.0.1', hosts)).toEqual(['IP Address:10.0.0.1']);
  });

  it('비어 있으면 SAN 이 없다는 것 자체가 문제다', () => {
    expect(foreignSanNames('', hosts)).toEqual(['(SAN 없음)']);
  });
});

describe('openProblem — 화면이 열렸나', () => {
  const visit = (over: Partial<ScreenVisit>): ScreenVisit => ({
    path: '/inventory/skus',
    status: 200,
    finalUrl: 'http://two.example:8002/inventory/skus',
    title: '테넌트',
    text: 'SKU 마스터 관리',
    ...over,
  });

  it('200 이고 그 경로에 머물고 거절 화면이 아니면 열렸다', () => {
    expect(openProblem(visit({}))).toBeNull();
    expect(openProblem(visit({ finalUrl: 'http://two.example:8002/inventory/skus?page=1' }))).toBeNull();
  });

  it('상태가 200 이 아니거나 다른 경로로 갔으면 그걸 적는다', () => {
    expect(openProblem(visit({ status: 404 }))).toBe('404');
    expect(openProblem(visit({ status: null }))).toBe('문서 응답 없음');
    expect(openProblem(visit({ finalUrl: 'http://two.example:8002/wrong-account' }))).toBe(
      '→ http://two.example:8002/wrong-account',
    );
  });

  it('200 이라도 권한 거절·오류 화면이면 열린 게 아니다', () => {
    expect(openProblem(visit({ text: '접근 권한이 없습니다\n이 화면에는 …' }))).toBe('«접근 권한이 없습니다»');
    expect(openProblem(visit({ text: 'Application error: a client-side exception has occurred' }))).toBe(
      '«Application error»',
    );
  });
});

describe('notFoundProblem — 목록 밖은 404', () => {
  it('404 면 통과, 아니면 상태와 간 곳', () => {
    const base: ScreenVisit = {
      path: '/order/history',
      status: 404,
      finalUrl: 'http://two.example:8002/order/history',
      title: '',
      text: '',
    };
    expect(notFoundProblem(base)).toBeNull();
    expect(notFoundProblem({ ...base, status: 200 })).toBe('200');
    expect(notFoundProblem({ ...base, status: 200, finalUrl: 'http://two.example:8002/login' })).toBe(
      '200 → http://two.example:8002/login',
    );
  });
});

describe('outsidePaths — 목록 밖 대표 경로', () => {
  const screens = [
    '/',
    '/wrong-account',
    '/inventory/skus',
    '/inventory/status',
    '/inventory/receiving/[id]',
    '/order/history',
    '/order/[id]',
    '/company/my-account',
  ];

  it('허용 화면이 있는 영역은 목록 밖 화면 전부(동적 세그먼트는 아무 값), 다른 영역은 첫 화면 하나', () => {
    expect(outsidePaths(screens, ['/inventory/skus'])).toEqual([
      '/inventory/status',
      '/inventory/receiving/0',
      '/order/history',
      '/company/my-account',
    ]);
  });
});

describe('concretePath — 허용 목록의 동적 화면을 실제 행으로', () => {
  it('세그먼트 이름으로 값을 채우고, 값이 없으면 null', () => {
    expect(concretePath('/mall/products-list/[masterId]/versions', { masterId: 'm1' })).toBe(
      '/mall/products-list/m1/versions',
    );
    expect(concretePath('/mall/bulk-sessions/[id]', { masterId: 'm1' })).toBeNull();
    expect(concretePath('/mall/tags', {})).toBe('/mall/tags');
  });
});

describe('crossRefusal — 주소 교차는 «알아본 거절»이어야 한다', () => {
  const at = (over: Partial<ScreenVisit>): ScreenVisit => ({
    path: '/inventory/warehouses',
    status: 200,
    finalUrl: 'http://one.example/inventory/warehouses',
    title: '',
    text: '',
    ...over,
  });

  it('셸의 계정 거절·권한 거절 화면, 또는 로그인 화면의 오류 문구면 거절이다', () => {
    expect(
      crossRefusal(
        at({ finalUrl: 'http://one.example/wrong-account', text: '이 주소에서 쓸 수 없는 계정입니다' }),
        null,
      ),
    ).toBeNull();
    expect(crossRefusal(at({ text: '접근 권한이 없습니다\n…' }), null)).toBeNull();
    expect(crossRefusal(at({ finalUrl: 'http://auth.example/signin' }), '쓸 수 없는 계정입니다')).toBeNull();
  });

  it('화면이 열리면 «열렸다»', () => {
    expect(crossRefusal(at({ text: '창고 관리' }), null)).toBe('열렸다 — http://one.example/inventory/warehouses');
  });

  it('500·오류 화면처럼 알아보지 못한 결과는 거절로 세지 않는다', () => {
    expect(crossRefusal(at({ status: 500 }), null)).toBe('거절이 아니다 — 500');
    expect(crossRefusal(at({ text: 'Application error: …' }), null)).toBe('거절이 아니다 — «Application error»');
  });
});
