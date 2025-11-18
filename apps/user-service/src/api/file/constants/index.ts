export const S3_FOLDER_NAMES = {
  business: 'business',
  avatar: 'avatar',
} as const;

export type S3FolderName = keyof typeof S3_FOLDER_NAMES;
