'use client';

import { useEffect } from 'react';
import { installBrowserObservability } from '@packages/web-observability/browser';

export function ObservabilityProvider() {
  useEffect(() => {
    installBrowserObservability({
      serviceName: process.env.NEXT_PUBLIC_OTEL_SERVICE_NAME ?? 'wallet-web',
      component: 'wallet-web.browser',
    });
  }, []);

  return null;
}
