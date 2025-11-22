import { ScopeDefinition } from '@app/authorization';

export const FILE_SERVICE_SCOPES: ScopeDefinition[] = [
  {
    key: 'file:read',
    category: 'file',
    description: 'Read and download files (admin only)',
  },
];

