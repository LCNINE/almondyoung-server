import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { SessionProvider } from '../../app/session-context';
import { DiagnosticsScreen } from './DiagnosticsScreen';
import type { Session } from '../../core/auth/session';

const stub: Session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

describe('DiagnosticsScreen', () => {
  it('hides diagnostics unless developer mode is explicitly enabled', () => {
    render(
      <SessionProvider session={stub}>
        <ScanProvider>
          <DiagnosticsScreen />
        </ScanProvider>
      </SessionProvider>
    );
    expect(screen.getByText(/관리자 권한이 필요해요/)).toBeInTheDocument();
    expect(screen.queryByText('Diagnostics')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /camera scan/i })
    ).not.toBeInTheDocument();
  });
});
