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
  it('mounts and shows the diagnostics sections + logout', () => {
    render(
      <SessionProvider session={stub}>
        <ScanProvider>
          <DiagnosticsScreen />
        </ScanProvider>
      </SessionProvider>
    );
    expect(screen.getByText('Diagnostics')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /camera scan/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /test print/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^logout$/i })
    ).toBeInTheDocument();
  });
});
