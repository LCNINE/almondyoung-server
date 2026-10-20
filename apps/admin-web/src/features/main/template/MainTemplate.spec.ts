import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MainTemplate from './MainTemplate';

// The unrelated carousel cannot render in the backend Jest CommonJS transform.
jest.mock('@/features/main/quick-actions/QuickActionsCard', () => ({
  QuickActionsCard: () => null,
}));

describe('admin home attendance placement', () => {
  it('renders the dashboard without a work card in the page structure at any viewport size', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });

    try {
      const html = renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client },
          createElement(MainTemplate)
        )
      );

      expect(html).toContain('오늘의 할 일');
      expect(html).not.toContain('오늘의 근무');
      expect(html).not.toContain('/attendance');
    } finally {
      client.clear();
    }
  });
});
