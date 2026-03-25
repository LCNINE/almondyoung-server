export const FILE_STATUSES = {
  ACTIVE: 'active',
  DELETED: 'deleted',
} as const;

export type FileStatus = (typeof FILE_STATUSES)[keyof typeof FILE_STATUSES];
