import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import './index.css';
import { queryClient } from './core/data/queryClient';
import { ApiClientProvider } from './core/data/ApiClientProvider';
import { ScanProvider } from './core/hardware/scan/ScanProvider';
import { SessionProvider } from './app/session-context';
import { Bootstrap } from './app/Bootstrap';
import { createSession } from './core/auth/session';
import { createTokenManager } from './core/auth/tokenManager';
import { createStrongholdTokenStore } from './core/auth/tokenStore';
import {
  loginWithLoopback,
  refreshTokens,
  discoverEndpoints,
} from './core/auth/login';
import { createAppRouter } from './app/router';

const store = createStrongholdTokenStore();
const manager = createTokenManager({
  store,
  refresh: async (refreshToken) => {
    const eps = await discoverEndpoints();
    return refreshTokens({ tokenEndpoint: eps.token_endpoint, refreshToken });
  },
});
const session = createSession({
  manager,
  runLogin: (m, onStep) => loginWithLoopback({ manager: m, onStep }),
});
const router = createAppRouter(session);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider session={session}>
        <ApiClientProvider>
          <ScanProvider>
            <Bootstrap session={session}>
              <RouterProvider router={router} />
            </Bootstrap>
          </ScanProvider>
        </ApiClientProvider>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>
);
