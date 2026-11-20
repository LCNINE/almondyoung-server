import Link from 'next/link';
import type { NeedsInfoIssue } from '@/lib/types/dto/fulfillment';
import { needsInfoClosing, needsInfoCopy } from '../blocked-copy';

/** 정보 부족 문제마다 무엇이 비었는지·어느 상품인지·고치는 곳 */
export function NeedsInfoList({
  issues,
  place = 'list',
}: {
  issues: NeedsInfoIssue[];
  place?: 'list' | 'detail';
}) {
  const closing = needsInfoClosing(issues);

  return (
    <ul role="list" className="space-y-1.5">
      {issues.map((issue) => {
        const copy = needsInfoCopy(issue, place);

        return (
          <li key={issue.kind} className="break-keep">
            <span className="block font-medium text-foreground">
              {copy.problem}
              {copy.skus.length > 0 && ': '}
              {copy.skus.map((sku, index) => (
                <span key={`${sku.label}-${index}`}>
                  {index > 0 && ', '}
                  {sku.href ? (
                    <Link
                      href={sku.href}
                      className="underline underline-offset-2"
                    >
                      {sku.label}
                    </Link>
                  ) : (
                    sku.label
                  )}
                </span>
              ))}
            </span>
            <span className="block">{copy.fix}</span>
          </li>
        );
      })}
      {closing && <li className="break-keep">{closing}</li>}
    </ul>
  );
}
