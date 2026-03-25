import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { fileContexts } from './schema';

export type FileContext = InferSelectModel<typeof fileContexts>;
export type NewFileContext = InferInsertModel<typeof fileContexts>;
export type UpdateFileContext = Partial<Omit<NewFileContext, 'id' | 'createdAt'>>;
