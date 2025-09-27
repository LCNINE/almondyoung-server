import { ZodIssue } from 'zod';

export interface ParsedZodIssue {
  field: string;
  message: string;
  code: string;
  received?: unknown;
  expected?: unknown;
  options?: unknown;
}

/**
 * ZodError.issues → NestJS에서 응답으로 내보낼 수 있는 통일된 형식으로 변환
 */
export function formatZodIssues(issues: ZodIssue[]): ParsedZodIssue[] {
  return issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
    received: 'received' in issue ? (issue as any).received : undefined,
    expected: 'expected' in issue ? (issue as any).expected : undefined,
    options: 'options' in issue ? (issue as any).options : undefined,
  }));
}
