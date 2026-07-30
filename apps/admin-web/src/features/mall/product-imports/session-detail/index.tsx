'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { useImportSession, usePublishSession, useCancelSession } from '@/lib/services/products';
import { getServerDenyMessage } from '@/lib/api/server-error';

interface Props {
  sessionId: string;
}

export function SessionDetail({ sessionId }: Props) {
  const { data: session, isLoading } = useImportSession(sessionId);
  const publish = usePublishSession();
  const cancel = useCancelSession();
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  function handleCancel() {
    setConfirmOpen(false);
    cancel.mutate(sessionId, {
      onSuccess: () => {
        toast.info('세션을 취소했습니다. 이미 생성된 상품은 그대로 남습니다.');
      },
      onError: (error) => {
        toast.error(getServerDenyMessage(error, '취소 중 오류가 발생했습니다.'));
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
  // `!== null` 이 아니라 Boolean() 인 이유: 롤링 배포 중 옛 core 태스크는 이 키를
  // 아예 안 실어 보낸다(undefined). `undefined !== null` 은 true 라, 그 창에서 정상
  // 세션이 전부 취소된 것으로 보이고 게시 버튼이 잠긴다.
  // 백엔드의 renewLease 도 같은 이유로 Boolean(row.cancelRequestedAt) 를 쓴다.
  const canceled = Boolean(session.cancelRequestedAt);
  // 취소는 진행 중인 레인이 있을 때만 의미가 있다 — 서버도 같은 조건으로 409 를 던진다.
  const cancellable = !canceled && (commitRunning || publishRunning);

  return (
    <div className="flex flex-col gap-y-4">
      <Container className="divide-y-0">
        <Header
          title="대량등록 세션 상세"
          subtitle={
            `${session.fileName ?? '(파일명 없음)'} · 생성 ${session.createdCount}/${session.totalRows}` +
            // invalidCount 가 null 인 옛 세션은 두 종류가 섞인 failedCount 만 보여준다(폴백).
            // `== null` 은 의도적이다 — 컬럼 도입 이전 세션(null)과 롤링 배포 중 옛
            // 태스크의 응답(undefined)을 함께 현행 표시로 폴백시킨다.
            // (eqeqeq 는 이 저장소 admin-web 설정에서 이 줄을 잡지 않는다 — 확인됨)
            (session.invalidCount == null
              ? ` (실패 ${session.failedCount})`
              : ` (검증실패 ${session.invalidCount} · 생성실패 ${session.failedCount - session.invalidCount})`) +
            ` · 게시 ${session.publishedCount} (실패 ${session.publishFailedCount})`
          }
          right={
            <div className="flex items-center gap-2">
              {cancellable && (
                <Button variant="outline" onClick={() => setConfirmOpen(true)} disabled={cancel.isPending}>
                  {cancel.isPending ? '취소하는 중...' : '작업 취소'}
                </Button>
              )}
              <Button
                onClick={handlePublish}
                disabled={publish.isPending || commitRunning || publishRunning || canceled}
              >
                {canceled
                  ? '취소됨'
                  : commitRunning
                    ? '생성 중...'
                    : publishRunning
                      ? '게시 중...'
                      : '세션 일괄 게시'}
              </Button>
            </div>
          }
        />

        {canceled && (
          <div className="mx-6 mb-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700">
            <p>
              {new Date(session.cancelRequestedAt!).toLocaleString('ko-KR')} 에 취소된 세션입니다. 이미
              생성·게시된 상품은 되돌아오지 않으니 아래 목록에서 확인 후 직접 정리해 주세요.
            </p>
            <p className="mt-1">다시 등록하려면 워크북을 새로 업로드해 주세요 — 취소된 세션은 재개되지 않습니다.</p>
          </div>
        )}

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

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이 세션의 작업을 멈출까요?</AlertDialogTitle>
            <AlertDialogDescription>
              진행 중인 상품 생성·게시가 멈춥니다. <strong>이미 생성되거나 게시된 상품은 되돌아오지 않습니다.</strong>{' '}
              취소한 세션은 다시 이어서 진행할 수 없고, 다시 등록하려면 워크북을 새로 올려야 합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>닫기</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel}>작업 취소</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
