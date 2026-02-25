export const MAX_QUESTION_MEDIA_COUNT = 5;

export const QUESTION_STATUSES = ['active', 'answered', 'deleted'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];
