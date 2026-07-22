import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StockCell } from './StockCell';
import type { SkuSearchItem } from './types';

function item(over: Partial<SkuSearchItem>): SkuSearchItem {
  return { id: '1', code: 'C', name: 'N', currentStock: 0, safetyStock: 0, ...over };
}

describe('StockCell', () => {
  it('shows 품절 when stock is 0', () => {
    render(<StockCell item={item({ currentStock: 0, safetyStock: 10 })} />);
    expect(screen.getByText('품절')).toBeInTheDocument();
  });

  it('shows 부족 when stock is at or below safety stock', () => {
    render(<StockCell item={item({ currentStock: 5, safetyStock: 10 })} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('부족')).toBeInTheDocument();
  });

  it('shows no label when stock is healthy', () => {
    render(<StockCell item={item({ currentStock: 20, safetyStock: 10 })} />);
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.queryByText('부족')).toBeNull();
    expect(screen.queryByText('품절')).toBeNull();
  });

  it('does not flag 부족 when safety stock is 0', () => {
    render(<StockCell item={item({ currentStock: 5, safetyStock: 0 })} />);
    expect(screen.queryByText('부족')).toBeNull();
    expect(screen.queryByText('품절')).toBeNull();
  });
});
