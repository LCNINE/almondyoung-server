import { SpellCorrectionService } from './spell-correction.service';
import { OpenSearchService } from './opensearch.service';

// 상품명 몇 개로 사전을 만들고, 실제 라이브에서 관찰된 오타를 넣어본다.
function makeService(names: string[]) {
  let called = false;
  const client = {
    search: jest.fn().mockImplementation(() => {
      // 두 번째 호출은 빈 페이지를 줘 스캔을 끝낸다.
      const hits = called ? [] : names.map((name, i) => ({ _source: { name }, sort: [String(i)] }));
      called = true;
      return Promise.resolve({ body: { hits: { hits } } });
    }),
  };
  const openSearch = {
    getClient: () => client,
    getProductsIndex: () => 'test-index',
  } as unknown as OpenSearchService;
  return new SpellCorrectionService(openSearch);
}

const CATALOG = [
  '롤리킹 글루',
  '니치반 스팟 SGS25 테이프',
  '헤나 HENA',
  '퍼마 말라드 Mallard',
  '일자형 네일 클리퍼 손톱깎이',
  '래쉬몬스터 하이드로겔 아이패치',
  '속눈썹 롯드 보관함 30구',
];

describe('SpellCorrectionService', () => {
  let service: SpellCorrectionService;

  beforeEach(async () => {
    service = makeService(CATALOG);
    await service.buildDictionary();
  });

  it('라이브에서 관찰된 오타를 상품명의 단어로 되돌린다', async () => {
    // "나찌반"↔"니치반"은 자모 편집 거리 2 — 동영님이 지적한 바로 그 케이스다.
    expect(service.suggest('나찌반')).toBe('니치반');
    expect(service.suggest('헨나')).toBe('헤나');
    expect(service.suggest('아이패티')).toBe('아이패치');
  });

  // 한글 입력기는 글자를 조합하다 만 상태로 엔터를 받으면 낱자를 그대로 남긴다.
  // 라이브 90일 로그에 "롤리ㅣㅇ" 20회, "명함콪이" 21회처럼 실제로 쌓여 있었다.
  it('조합하다 만 낱자가 섞여도 되돌린다', () => {
    expect(service.suggest('롤리ㅣㅇ')).toBe('롤리킹');
    expect(service.suggest('롤리킹ㅇ')).toBe('롤리킹');
  });

  it('상품명에 그대로 있는 말은 교정하지 않는다', () => {
    expect(service.suggest('니치반')).toBeNull();
    expect(service.suggest('헤나')).toBeNull();
    expect(service.suggest('롯드')).toBeNull();
  });

  it('닮은 말이 없으면 null 을 준다 — 억지로 끌어다 붙이지 않는다', () => {
    expect(service.suggest('습도계')).toBeNull();
    expect(service.suggest('바리깡')).toBeNull();
  });

  it('한 글자 검색어는 교정하지 않는다 — 편집 거리 1 이 곧 다른 글자다', () => {
    expect(service.suggest('헤')).toBeNull();
  });

  it('사전 구축 전에는 조용히 null 을 준다', () => {
    expect(makeService(CATALOG).suggest('나찌반')).toBeNull();
  });

  it('사전 구축이 실패해도 던지지 않는다 — 검색은 교정 없이 계속 간다', async () => {
    const openSearch = {
      getClient: () => ({ search: jest.fn().mockRejectedValue(new Error('opensearch down')) }),
      getProductsIndex: () => 'test-index',
    } as unknown as OpenSearchService;
    const failing = new SpellCorrectionService(openSearch);

    await expect(failing.buildDictionary()).resolves.toBeUndefined();
    expect(failing.suggest('나찌반')).toBeNull();
  });
});
