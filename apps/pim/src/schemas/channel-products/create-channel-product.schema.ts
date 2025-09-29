import { z } from 'zod';

export const CreateChannelProductSchema = z.object({
  masterId: z.string().uuid(),
  channelId: z.string().uuid(),
  name: z.string().max(255).optional(),
  isActive: z.boolean().default(true),
  channelSpecificData: z.record(z.string(), z.unknown()).optional(),
});

export type CreateChannelProductDto = z.infer<
  typeof CreateChannelProductSchema
>;
