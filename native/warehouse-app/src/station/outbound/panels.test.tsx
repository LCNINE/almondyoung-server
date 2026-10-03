import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LineTable } from './panels';

const row = (patch: Partial<Parameters<typeof LineTable>[0]['rows'][number]>) => ({
  shipmentLineId: 'l',
  name: '상품',
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
