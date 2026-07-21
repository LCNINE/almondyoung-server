import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Bootstrap } from './Bootstrap';
import type { Session } from '../core/auth/session';

function stub(bootstrap: () => Promise<void>): Session {
  return {
    bootstrap,
    isAuthenticated: () => false,
    getAccessToken: async () => 'tok',
    login: async () => {},
    logout: async () => {},
    subscribe: () => () => {},
  } satisfies Session;
}

describe('Bootstrap', () => {
  it('shows a splash, then renders children once bootstrap resolves', async () => {
    let resolve!: () => void;
    const gate = new Promise<void>((r) => {
      resolve = r;
    });
    render(
      <Bootstrap session={stub(() => gate)}>
        <div>ready-content</div>
      </Bootstrap>
    );
    expect(screen.getByText(/almond wms/i)).toBeInTheDocument();
    expect(screen.queryByText('ready-content')).not.toBeInTheDocument();
    resolve();
    expect(await screen.findByText('ready-content')).toBeInTheDocument();
  });
});
