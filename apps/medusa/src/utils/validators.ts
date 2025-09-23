import { z } from 'zod';

export const createSelectParams = () => {
  return z.object({
    fields: z.string().optional(),
  });
};
