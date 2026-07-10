'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { useImportSession, usePublishSession } from '@/lib/services/products';
import type { PublishResultDto } from '@/lib/types/dto/product-import';

interface Props {
  sessionId: string;
}

export function SessionDetail({ sessionId }: Props) {
  const { data: session, isLoading } = useImportSession(sessionId);
  const publish = usePublishSession();
  const [publishResult, setPublishResult] = useState<PublishResultDto | null>(
    null
  );

  function handlePublish() {
    publish.mutate(sessionId, {
      onSuccess: (res) => {
        setPublishResult(res);
        if (res.failed.length === 0) {
          toast.success(`${res.published}건이 게시되었습니다.`);
        } else {
          toast.warning(
            `${res.published}건 게시, ${res.failed.length}건 실패했습니다.`
          );
        }
      },
      onError: () => toast.error('게시 중 오류가 발생했습니다.'),
    });
  }

  if (isLoading || !session) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        불러오는 중...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-y-4">
      <Container className="divide-y-0">
        <Header
          title="대량등록 세션 상세"
          subtitle={`${session.fileName ?? '(파일명 없음)'} · 시도 ${session.totalRows} · 성공 ${session.createdCount} · 실패 ${session.failedCount}`}
          right={
            <Button
              onClick={handlePublish}
              disabled={publish.isPending}
            >
              {publish.isPending
                ? '게시 중...'
                : publishResult
                  ? '다시 게시'
                  : '세션 일괄 게시'}
            </Button>
          }
        />

        {publishResult && (
          <div className="mx-6 mb-2 rounded-md border p-3 text-sm">
            <p>
              게시 성공{' '}
              <strong className="text-green-600">
                {publishResult.published}
              </strong>{' '}
              · 실패{' '}
              <strong className="text-destructive">
                {publishResult.failed.length}
              </strong>
            </p>
            {publishResult.failed.length > 0 && (
              <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                {publishResult.failed.map((f) => (
                  <li key={f.masterId}>
                    {f.masterId} — {f.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="p-6 pt-2">
          <div className="overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-2">행</th>
                  <th className="p-2">productKey</th>
                  <th className="p-2">상태</th>
                  <th className="p-2">상품 / 오류</th>
                </tr>
              </thead>
              <tbody>
                {session.items.map((i) => (
                  <tr key={i.rowNumber} className="border-t align-top">
                    <td className="p-2">{i.rowNumber}</td>
                    <td className="p-2">{i.productKey}</td>
                    <td className="p-2">
                      {i.status === 'created' ? (
                        <span className="text-green-600">생성</span>
                      ) : (
                        <span className="text-destructive">실패</span>
                      )}
                    </td>
                    <td className="p-2">
                      {i.status === 'created' && i.masterId ? (
                        <Link
                          href={`/mall/products-list/${i.masterId}`}
                          className="text-primary underline"
                        >
                          상품 상세
                        </Link>
                      ) : (
                        <span className="text-destructive">
                          {i.errorMessage}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Container>
    </div>
  );
}
