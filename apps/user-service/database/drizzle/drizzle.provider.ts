import { db } from '../client';

export const DrizzleProvider = {
  provide: 'DRIZZLE',
  useValue: db,
};
