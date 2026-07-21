import { createRouter, createMemoryHistory } from '@tanstack/react-router';
import type { Session } from '../core/auth/session';
import { routeTree } from './routeTree';

export function createAppRouter(session: Session) {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { session },
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
