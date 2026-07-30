'use client';

import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { useImportSession, usePublishSession } from '@/lib/services/products';
import { getServerDenyMessage } from '@/lib/api/server-error';

interface Props {
  sessionId: string;
}

export function SessionDetail({ sessionId }: Props) {
  const { data: session, isLoading } = useImportSession(sessionId);
  const publish = usePublishSession();

  function handlePublish() {
    publish.mutate(sessionId, {
      onSuccess: (res) => {
        toast.info(`${res.targetCount}건 게시를 접수했습니다.`);
      },
      onError: (error) => {
        toast.error(getServerDenyMessage(error, '게시 접수 중 오류가 발생했습니다.'));
      },
    });
  }

  if (isLoading || !session) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        불러오는 중...
      </div>
    );
  }

  const commitRunning = session.commitStatus === 'queued' || session.commitStatus === 'running';
  const publishRunning = session.publishStatus === 'queued' || session.publishStatus === 'running';

  return (
    <div className="flex flex-col gap-y-4">
      <Container>
        <Header
          title="대량등록 세션 상세"
          subtitle={`${session.fileName ?? '(파일명 없음)'} · 생성 ${session.createdCount}/${session.totalRows} (실패 ${session.failedCount}) · 게시 ${session.publishedCount} (실패 ${session.publishFailedCount})`}
          right={
            <Button onClick={handlePublish} disabled={publish.isPending || commitRunning || publishRunning}>
              {commitRunning ? '생성 중...' : publishRunning ? '게시 중...' : '세션 일괄 게시'}
            </Button>
          }
        />

        {(session.commitError || session.publishError) && (
          <div className="mx-6 mb-2 space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {session.commitError && <p>생성 잡 오류: {session.commitError}</p>}
            {session.publishError && <p>게시 잡 오류: {session.publishError}</p>}
          </div>
        )}

        <div className="p-6 pt-2">
          <div className="overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-2">행</th>
                  <th className="p-2">productKey</th>
                  <th className="p-2">생성</th>
                  <th className="p-2">게시</th>
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
                      ) : i.status === 'pending' ? (
                        <span className="text-muted-foreground">대기</span>
                      ) : (
                        <span className="text-destructive">실패</span>
                      )}
                    </td>
                    <td className="p-2">
                      {i.publishStatus === 'published' ? (
                        <span className="text-green-600">게시</span>
                      ) : i.publishStatus === 'failed' ? (
                        <span className="text-destructive" title={i.publishError}>
                          실패
                        </span>
                      ) : i.publishStatus === 'skipped' ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="text-muted-foreground">대기</span>
                      )}
                    </td>
                    <td className="p-2">
                      {i.status === 'created' && i.masterId ? (
                        <div className="flex flex-col gap-y-1">
                          <Link
                            href={`/mall/products-list/${i.masterId}`}
                            className="text-primary underline"
                          >
                            상품 상세
                          </Link>
                          {i.publishError && (
                            <span className="text-xs text-destructive">{i.publishError}</span>
                          )}
                        </div>
                      ) : i.status === 'pending' ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="text-destructive">{i.errorMessage}</span>
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
