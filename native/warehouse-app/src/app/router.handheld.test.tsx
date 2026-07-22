import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from '@tanstack/react-router';
import { SessionProvider } from './session-context';
import { ScanProvider } from '../core/hardware/scan/ScanProvider';
import { createAppRouter } from './router';
import type { Session } from '../core/auth/session';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'android' }));

function stub(): Session {
  return {
    bootstrap: async () => {},
    isAuthenticated: () => true,
    getAccessToken: async () => 'tok',
    login: async () => {},
    logout: async () => {},
    subscribe: () => () => {},
  } satisfies Session;
}

describe('handheld hub navigation', () => {
  it('shows handheld tiles and drills into a placeholder workflow', async () => {
    const session = stub();
    const user = userEvent.setup();
    render(
      <SessionProvider session={session}>
        <ScanProvider>
          <RouterProvider router={createAppRouter(session)} />
        </ScanProvider>
      </SessionProvider>
    );

    expect(await screen.findByRole('link', { name: /실사/ })).toBeInTheDocument();
    await act(async () => {
      await user.click(screen.getByRole('link', { name: /실사/ }));
    });
    expect(await screen.findByRole('heading', { name: '실사' })).toBeInTheDocument();
    await act(async () => {
      await user.click(screen.getByRole('link', { name: /홈/ }));
    });
    expect(await screen.findByRole('link', { name: /재고조회/ })).toBeInTheDocument();
  });
});
