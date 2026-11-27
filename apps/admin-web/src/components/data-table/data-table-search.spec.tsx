/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTableSearch } from './data-table-search';

const replace = jest.fn();
let search = '';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => '/inventory/skus',
  useRouter: () => ({ replace }),
}));

beforeEach(() => {
  replace.mockReset();
  search = '';
});

describe('DataTableSearch', () => {
  it('submitOnEnter 이면 스캐너의 Enter 로 바로 검색하고 글자를 골라 둔다', async () => {
    const user = userEvent.setup();
    render(<DataTableSearch placeholder="검색" submitOnEnter />);

    const input = screen.getByLabelText('검색') as HTMLInputElement;
    await user.type(input, '880900000027{Enter}');

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/inventory/skus?q=880900000027');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('880900000027'.length);
  });

  it('Enter 로 이미 보낸 검색어는 늦게 끝나는 타이머가 다시 보내지 않는다', async () => {
    jest.useFakeTimers();
    try {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<DataTableSearch placeholder="검색" submitOnEnter />);

      await user.type(screen.getByLabelText('검색'), 'SKU-1{Enter}');
      jest.advanceTimersByTime(1000);

      expect(replace).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('앞 검색어 주소가 늦게 와도 이어 찍는 다음 스캔을 덮지 않는다', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DataTableSearch placeholder="검색" submitOnEnter />
    );
    const input = screen.getByLabelText('검색') as HTMLInputElement;

    await user.type(input, '1111{Enter}');
    await user.keyboard('22');

    search = 'q=1111';
    rerender(<DataTableSearch placeholder="검색" submitOnEnter />);

    expect(input.value).toBe('22');
  });

  it('앞 주소가 늦게 와 칸이 바뀌어도 글자를 골라 둬 다음 스캔이 덮어쓴다', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DataTableSearch placeholder="검색" submitOnEnter />
    );
    const input = screen.getByLabelText('검색') as HTMLInputElement;

    await user.type(input, '1111{Enter}2222{Enter}');
    search = 'q=1111';
    rerender(<DataTableSearch placeholder="검색" submitOnEnter />);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);

    search = 'q=2222';
    rerender(<DataTableSearch placeholder="검색" submitOnEnter />);
    expect(input.value).toBe('2222');
    expect(input.selectionEnd).toBe(4);
  });

  it('다른 곳에서 바뀐 주소 검색어는 입력칸에 따른다', () => {
    const { rerender } = render(
      <DataTableSearch placeholder="검색" submitOnEnter />
    );

    search = 'q=outside';
    rerender(<DataTableSearch placeholder="검색" submitOnEnter />);

    expect((screen.getByLabelText('검색') as HTMLInputElement).value).toBe(
      'outside'
    );
  });

  it('submitOnEnter 가 없으면 Enter 로 바로 보내지 않는다', async () => {
    const user = userEvent.setup();
    render(<DataTableSearch placeholder="검색" />);

    await user.type(screen.getByLabelText('검색'), 'abc{Enter}');

    expect(replace).not.toHaveBeenCalled();
  });
});
