import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { ScreenHeader } from './ScreenHeader';

function renderAt(ui: React.ReactNode) {
  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{ui}</>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  // 테스트 전용 라우터라 앱의 Register 타입과 다르다.
  return render(<RouterProvider router={router as never} />);
}

describe('ScreenHeader', () => {
  it('제목과 뒤로 링크를 렌더한다', async () => {
    renderAt(<ScreenHeader title="재고 조정" backTo="/inventory" />);
    expect(await screen.findByRole('heading', { name: '재고 조정' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '뒤로' })).toHaveAttribute('href', '/inventory');
  });

  it('right 슬롯을 렌더한다', async () => {
    renderAt(<ScreenHeader title="실사" backTo="/" right={<span>17 / 42</span>} />);
    expect(await screen.findByText('17 / 42')).toBeInTheDocument();
  });
});
