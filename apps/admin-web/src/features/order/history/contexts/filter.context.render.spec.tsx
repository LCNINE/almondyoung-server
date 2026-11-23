/**
 * @jest-environment jsdom
 */
import { act, render, screen } from '@testing-library/react';
import {
  OrderHistoryFilterProvider,
  useOrderHistoryFilter,
} from './filter.context';

import FilterBox from '../components/filter-box';

let mockParams = new URLSearchParams();
const mockReplace = jest.fn((url: string) => {
  mockParams = new URLSearchParams(url.split('?')[1] ?? '');
  window.history.replaceState(null, '', url);
});

jest.mock('dayjs', () => ({
  __esModule: true,
  default: jest.requireActual('dayjs'),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/order/history',
  useSearchParams: () => mockParams,
}));

function Probe() {
  const { filter, page, setPage, searchToken } = useOrderHistoryFilter();
  return (
    <div>
      <p>
        {filter.type}|{filter.keywordType}|{filter.keyword ?? ''}|{page}|
        {searchToken}
      </p>
      <output aria-label="선택한 판매처">{filter.channels.join(',')}</output>
      <button onClick={() => setPage(2)}>3쪽</button>
      <button onClick={() => setPage(3)}>4쪽</button>
    </div>
  );
}

const view = () => (
  <OrderHistoryFilterProvider>
    <Probe />
  </OrderHistoryFilterProvider>
);

beforeEach(() => {
  mockReplace.mockClear();
  mockParams = new URLSearchParams();
  window.history.replaceState(null, '', '/order/history');
});

describe('주문내역 조건과 주소', () => {
  it('여러 판매처를 토글하고 검색할 때 적용하며 전체는 선택을 비운다', () => {
    render(
      <OrderHistoryFilterProvider>
        <FilterBox />
        <Probe />
      </OrderHistoryFilterProvider>
    );

    expect(screen.getByRole('checkbox', { name: '전체' })).toHaveProperty(
      'checked',
      true
    );
    expect(
      screen
        .getAllByRole('checkbox')
        .slice(0, 5)
        .map((input) => input.parentElement?.textContent)
    ).toEqual(['전체', '자사몰', '네이버 스마트스토어', '쿠팡', '수기·기타']);

    act(() =>
      screen.getByRole('checkbox', { name: '네이버 스마트스토어' }).click()
    );
    act(() => screen.getByRole('checkbox', { name: '쿠팡' }).click());

    expect(screen.getByRole('checkbox', { name: '전체' })).toHaveProperty(
      'checked',
      false
    );
    expect(screen.getByLabelText('선택한 판매처').textContent).toBe('');

    act(() => screen.getByRole('button', { name: '검색' }).click());

    expect(screen.getByLabelText('선택한 판매처').textContent).toBe(
      'naver,coupang'
    );
    expect(mockParams.get('channels')).toBe('naver,coupang');

    act(() =>
      screen.getByRole('checkbox', { name: '네이버 스마트스토어' }).click()
    );
    act(() => screen.getByRole('button', { name: '검색' }).click());

    expect(mockParams.get('channels')).toBe('coupang');

    act(() => screen.getByRole('checkbox', { name: '전체' }).click());
    act(() => screen.getByRole('button', { name: '검색' }).click());

    expect(screen.getByRole('checkbox', { name: '전체' })).toHaveProperty(
      'checked',
      true
    );
    expect(screen.getByRole('checkbox', { name: '쿠팡' })).toHaveProperty(
      'checked',
      false
    );
    expect(mockParams.has('channels')).toBe(false);
  });

  it('주소의 다중 판매처를 복원하고 외부 주소 변경도 입력칸에 반영한다', () => {
    mockParams = new URLSearchParams('channels=naver,coupang');
    const content = (
      <OrderHistoryFilterProvider>
        <FilterBox />
        <Probe />
      </OrderHistoryFilterProvider>
    );
    const { rerender } = render(content);

    expect(screen.getByLabelText('선택한 판매처').textContent).toBe(
      'naver,coupang'
    );
    expect(
      screen.getByRole('checkbox', { name: '네이버 스마트스토어' })
    ).toHaveProperty('checked', true);
    expect(screen.getByRole('checkbox', { name: '쿠팡' })).toHaveProperty(
      'checked',
      true
    );

    mockParams = new URLSearchParams('channels=medusa,3pl');
    rerender(
      <OrderHistoryFilterProvider>
        <FilterBox />
        <Probe />
      </OrderHistoryFilterProvider>
    );

    expect(screen.getByLabelText('선택한 판매처').textContent).toBe(
      'medusa,3pl'
    );
    expect(
      screen.getByRole('checkbox', { name: '네이버 스마트스토어' })
    ).toHaveProperty('checked', false);
    expect(screen.getByRole('checkbox', { name: '자사몰' })).toHaveProperty(
      'checked',
      true
    );
    expect(screen.getByRole('checkbox', { name: '수기·기타' })).toHaveProperty(
      'checked',
      true
    );
  });

  it('주소의 조건과 쪽으로 시작하고, 쪽을 옮기면 주소에 남긴다', () => {
    mockParams = new URLSearchParams(
      'range=today&from=2026-03-10&to=2026-03-10&type=all&page=2'
    );
    render(view());

    expect(screen.getByText(/^all\|/).textContent).toContain('|1|');

    act(() => screen.getByText('3쪽').click());

    expect(mockReplace).toHaveBeenLastCalledWith(
      expect.stringContaining('page=3'),
      { scroll: false }
    );
  });

  it('떠 있는 채로 다른 화면이 주문을 지목한 주소로 오면 그 주문번호 검색으로 바꾼다', () => {
    const { rerender } = render(view());
    mockReplace.mockClear();

    mockParams = new URLSearchParams('orderNo=A-1');
    rerender(view());

    expect(screen.getByText(/주문번호\|A-1\|0\|/)).toBeTruthy();
    expect(mockReplace).toHaveBeenLastCalledWith(
      expect.stringContaining('q=A-1'),
      { scroll: false }
    );
  });

  it('이 화면이 쓴 주소로는 조건을 다시 정하지 않는다', () => {
    const { rerender } = render(view());
    const before = screen.getByText(/\|/).textContent;

    rerender(view());

    expect(screen.getByText(/\|/).textContent).toBe(before);
  });

  it('이 화면이 쓴 주소가 늦게 와도 그사이 옮긴 쪽을 되돌리지 않는다', () => {
    const replaceWithoutUrl = jest.fn();
    mockReplace.mockImplementation(replaceWithoutUrl);
    try {
      const { rerender } = render(view());
      act(() => screen.getByText('3쪽').click());
      const third = replaceWithoutUrl.mock.lastCall?.[0] as string;
      act(() => screen.getByText('4쪽').click());

      // 3쪽 주소가 4쪽으로 옮긴 뒤에 반영된다
      mockParams = new URLSearchParams(third.split('?')[1]);
      rerender(view());

      expect(screen.getByText(/\|/).textContent).toContain('|3|');
    } finally {
      mockReplace.mockImplementation((url: string) => {
        mockParams = new URLSearchParams(url.split('?')[1] ?? '');
        window.history.replaceState(null, '', url);
      });
    }
  });

  it('예전에 이 화면이 쓴 주소와 같은 링크로 다시 들어와도 그 주소를 따른다', () => {
    const { rerender } = render(view());
    act(() => screen.getByText('3쪽').click());
    rerender(view());
    const third = mockParams.toString();
    act(() => screen.getByText('4쪽').click());
    rerender(view());

    mockParams = new URLSearchParams(third);
    rerender(view());

    expect(screen.getByText(/\|/).textContent).toContain('|2|');
  });

  it('쪽을 오가는 사이 앞선 주소가 버려져도, 나중에 들어온 링크를 따른다', () => {
    const replaceWithoutUrl = jest.fn();
    mockReplace.mockImplementation(replaceWithoutUrl);
    try {
      const { rerender } = render(view());
      act(() => screen.getByText('3쪽').click());
      const third = replaceWithoutUrl.mock.lastCall?.[0] as string;
      act(() => screen.getByText('4쪽').click());
      const fourth = replaceWithoutUrl.mock.lastCall?.[0] as string;
      act(() => screen.getByText('3쪽').click());

      // 마지막 3쪽 주소만 반영된다
      mockParams = new URLSearchParams(third.split('?')[1]);
      rerender(view());
      // 다른 화면에서 4쪽 링크로 들어온다
      mockParams = new URLSearchParams(fourth.split('?')[1]);
      rerender(view());

      expect(screen.getByText(/\|/).textContent).toContain('|3|');
    } finally {
      mockReplace.mockImplementation((url: string) => {
        mockParams = new URLSearchParams(url.split('?')[1] ?? '');
        window.history.replaceState(null, '', url);
      });
    }
  });
});
