import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Search } from 'lucide-react';
import { HubTile, TileGrid } from './HubTile';

describe('HubTile / TileGrid', () => {
  it('renders label and icon inside a grid', () => {
    render(
      <TileGrid>
        <HubTile icon={Search} label="재고조회" />
      </TileGrid>
    );
    expect(screen.getByText('재고조회')).toBeInTheDocument();
  });
});
