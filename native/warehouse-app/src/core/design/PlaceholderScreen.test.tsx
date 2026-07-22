import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createMemoryHistory,
} from '@tanstack/react-router';
import { PlaceholderScreen } from './PlaceholderScreen';

function renderInRouter(node: React.ReactNode) {
  const root = createRootRoute({ component: () => node });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(<RouterProvider router={router} />);
}

describe('PlaceholderScreen', () => {
  it('shows the title, note and a home link', async () => {
    renderInRouter(<PlaceholderScreen title="실사" note="Phase 1에서 구현됩니다." />);
    expect(
      await screen.findByRole('heading', { name: '실사' })
    ).toBeInTheDocument();
    expect(screen.getByText('Phase 1에서 구현됩니다.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /홈/ })).toBeInTheDocument();
  });
});
