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
import { ShellChromeContext } from './shellChrome';

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

  it('스테이션 셸 안에서는 홈(/)으로 가는 뒤로를 감춘다 — 탭 바가 홈이다', async () => {
    renderAt(
      <ShellChromeContext.Provider value={{ hidesHomeBack: true }}>
        <ScreenHeader title="실사" backTo="/" />
        <ScreenHeader title="입고내역" backTo="/inbound" />
      </ShellChromeContext.Provider>
    );
    expect(await screen.findByRole('heading', { name: '실사' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '뒤로' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: '뒤로' })).toHaveAttribute('href', '/inbound');
  });
});
