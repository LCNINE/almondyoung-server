import Medusa from '@medusajs/js-sdk';

export const sdk = (accessToken?: string) =>
  new Medusa({
    baseUrl: import.meta.env.VITE_MEDUSA_URL || '/',
    debug: import.meta.env.DEV,
    auth: {
      type: 'session',
    },
    globalHeaders: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
