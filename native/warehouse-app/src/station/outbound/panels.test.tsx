import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BoxCard, LineTable } from './panels';

vi.mock('../../app/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../app/config')>()),
  filePublicBaseUrl: 'https://file.tenant-2.example',
}));

const row = (patch: Partial<Parameters<typeof LineTable>[0]['rows'][number]>) => ({
  shipmentLineId: 'l',
  name: '상품',
  imageFileIds: [],
  locations: [],
  ordered: 1,
  scanned: 0,
  done: false,
  ...patch,
});

describe('품목 표 위치 칸', () => {
  it('두 위치에 나뉜 줄은 위치마다 한 줄씩, 위치별 수량과 함께 — 위치 하나면 코드만', () => {
    render(
      <LineTable
        currentLineId={null}
        rows={[
          row({ shipmentLineId: 'a', name: '컬러크림', locations: [{ code: 'A-01-01', qty: 1 }] }),
          row({
            shipmentLineId: 'b',
            name: '헤어롤',
            ordered: 3,
            locations: [
              { code: 'A-01-05', qty: 2 },
              { code: 'A-01-06', qty: 1 },
            ],
          }),
        ]}
      />
    );
    const [, single, split] = screen.getAllByRole('row');
    expect(within(single).getByText('A-01-01')).toBeInTheDocument();
    expect(within(single).queryByText(/×/)).toBeNull();
    const cells = within(split).getAllByRole('listitem');
    expect(cells.map((cell) => cell.textContent)).toEqual(['A-01-05 ×2', 'A-01-06 ×1']);
  });

  it('위치가 없으면(옛 core) 대시', () => {
    render(<LineTable currentLineId={null} rows={[row({ locations: [] })]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('품목 표 사진', () => {
  it('사진이 있는 줄은 대표 사진을, 없는 줄은 회색 자리표시를 보인다', () => {
    render(
      <LineTable
        currentLineId={null}
        rows={[
          row({ shipmentLineId: 'a', name: '컬러크림', imageFileIds: ['main-file', 'extra-file'] }),
          row({ shipmentLineId: 'b', name: '헤어롤' }),
        ]}
      />
    );
    const [, withImage, without] = screen.getAllByRole('row');

    expect(withImage.querySelector('img')?.getAttribute('src')).toBe('https://file.tenant-2.example/files/public/main-file');
    expect(within(withImage).queryByTestId('line-thumb-empty')).toBeNull();
    expect(without.querySelector('img')).toBeNull();
    expect(within(without).getByTestId('line-thumb-empty')).toBeInTheDocument();
  });
});

describe('박스 카드 화주', () => {
  it('위탁 업체 박스면 3PL 배지를, 자사 박스면 아무것도 보이지 않는다', () => {
    const { rerender } = render(<BoxCard trackingNo="123412341234" recipient="홍*동" ownerName="업체" />);

    expect(screen.getByText('3PL · 업체')).toBeTruthy();

    rerender(<BoxCard trackingNo="123412341234" recipient="홍*동" ownerName={null} />);

    expect(screen.queryByText(/3PL/)).toBeNull();
  });
});
