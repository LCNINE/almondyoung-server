import { type InferSelectModel } from 'drizzle-orm';
import { almondFonts } from '../../db/schema';

export type AlmondFontEntity = InferSelectModel<typeof almondFonts>;
