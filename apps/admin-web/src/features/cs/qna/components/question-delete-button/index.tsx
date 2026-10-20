'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
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
import { useDeleteQuestion } from '@/lib/services/qna';

export function QuestionDeleteButton({ questionId }: { questionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const deleteQuestion = useDeleteQuestion(questionId);

  const handleConfirm = async () => {
    try {
      await deleteQuestion.mutateAsync();
      toast.success('문의를 삭제했어요');
      router.push('/cs/qna');
    } catch {
      toast.error('문의를 삭제하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setOpen(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => setOpen(true)}
        disabled={deleteQuestion.isPending}
      >
        <Trash2 className="h-4 w-4" />
        문의 삭제
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이 문의를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              삭제하면 고객에게 더 이상 보이지 않아요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
