import { type InferSelectModel } from 'drizzle-orm';
import { answers, questionMedia, questions } from '../db/schema';

export type QuestionEntity = InferSelectModel<typeof questions>;
export type QuestionMediaEntity = InferSelectModel<typeof questionMedia>;
export type AnswerEntity = InferSelectModel<typeof answers>;

export type QuestionWithDetailsEntity = QuestionEntity & {
  mediaFileIds: string[];
  answer: AnswerEntity | null;
};
