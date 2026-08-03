'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { useCancelBulkSession } from '@/lib/services/products/bulk-session';
import type { BulkSessionProgress } from '@/lib/types/dto/bulk-session';
import { notifySessionMutationError } from '../lib/session-mutation-error';
import { phaseBadgeVariant, phaseLabel } from '../lib/session-labels';

export function BulkSessionHeader({
  sessionId,
  progress,
}: {
  sessionId: string;
  progress: BulkSessionProgress;
}) {
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const cancel = useCancelBulkSession(sessionId);

  const canCancel =
    progress.phase !== 'published' && progress.phase !== 'canceled';

  function handleCancel() {
    cancel.mutate(undefined, {
      onSuccess: () => {
        setCancelOpen(false);
        toast.success('세션을 취소했습니다.');
      },
      onError: (error) => {
        setCancelOpen(false);
        notifySessionMutationError(error, qc, sessionId);
      },
    });
  }

  return (
    <Container>
      <Header
        title="일괄 세션 상세"
        subtitle={sessionId}
        right={
          <>
            <Badge variant={phaseBadgeVariant(progress.phase)}>
              {phaseLabel(progress.phase)}
            </Badge>
            {canCancel && (
              <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={cancel.isPending}
                  onClick={() => setCancelOpen(true)}
                >
                  {cancel.isPending && (
                    <Spinner size="sm" data-icon="inline-start" />
                  )}
                  세션 취소
                </Button>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>세션 취소</AlertDialogTitle>
                    <AlertDialogDescription>
                      취소하면 재개할 수 없습니다. 이미 만들어진 임시 버전은
                      남으며, 취소 후 이 화면에서 정리할 수 있습니다.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={cancel.isPending}>
                      닫기
                    </AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-white hover:bg-destructive/90"
                      disabled={cancel.isPending}
                      onClick={(event) => {
                        event.preventDefault();
                        handleCancel();
                      }}
                    >
                      {cancel.isPending && <Spinner size="sm" />}
                      세션 취소
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </>
        }
      />

      {progress.phaseError && (
        <div className="px-6 pb-6">
          <Alert variant="destructive">
            <AlertDescription>{progress.phaseError}</AlertDescription>
          </Alert>
        </div>
      )}
    </Container>
  );
}
