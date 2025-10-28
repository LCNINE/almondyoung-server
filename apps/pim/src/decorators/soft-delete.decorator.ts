import { SetMetadata } from '@nestjs/common';

export const SOFT_DELETE_KEY = 'softDelete';
export const SoftDelete = () => SetMetadata(SOFT_DELETE_KEY, true);

