import {
  defaultHistoryFilter,
  historyParams,
  historyStateFromParams,
} from './history-url';

const TODAY = '2026-03-10';
const read = (query: string, isDemo = false) =>
  historyStateFromParams(new URLSearchParams(query), TODAY, isDemo);

describe('주문내역 주소', () => {
  it('주소가 비면 오늘·주문 미확정으로 연다', () => {
    expect(read('')).toEqual({ filter: defaultHistoryFilter(TODAY), page: 0 });
  });

  it('남긴 조건과 쪽을 그대로 되살린다', () => {
    const filter = {
      ...defaultHistoryFilter(TODAY),
      type: 'all' as const,
      excludeTerminal: false,
      channelCategory: '자사몰',
      channel: 'medusa',
      quickDate: 'week' as const,
      dateFrom: '2026-03-04',
      dateTo: '2026-03-10',
      keywordType: '수령자' as const,
      keyword: '홍길동',
    };

    const query = historyParams(filter, 2).toString();

    expect(read(query)).toEqual({ filter, page: 2 });
  });

  it('기본값은 주소에 적지 않는다', () => {
    expect(historyParams(defaultHistoryFilter(TODAY), 0).toString()).toBe(
      'range=today&from=2026-03-10&to=2026-03-10'
    );
  });

  it('공유받은 날이 달라 빠른 선택의 기간과 어긋나면 그 기간을 임의기간으로 연다', () => {
    const { filter } = read('range=today&from=2026-03-02&to=2026-03-02');

    expect(filter).toMatchObject({
      quickDate: 'custom',
      dateFrom: '2026-03-02',
      dateTo: '2026-03-02',
    });
  });

  it('지목한 주문번호(?orderNo=)는 그 주문번호 검색으로 연다', () => {
    expect(read('orderNo=%20A-1%20&type=all&page=3')).toEqual({
      filter: {
        ...defaultHistoryFilter(TODAY),
        keywordType: '주문번호',
        keyword: 'A-1',
      },
      page: 0,
    });
  });

  it('모르는 값은 기본값으로 둔다', () => {
    const { filter, page } = read(
      'type=nope&kt=nope&from=03-02&to=x&page=-1&range=nope'
    );

    expect(filter).toEqual(defaultHistoryFilter(TODAY));
    expect(page).toBe(0);
  });
});
