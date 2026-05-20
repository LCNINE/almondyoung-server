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
      toast.success('문의가 삭제되었습니다.');
      router.push('/cs/qna');
    } catch {
      toast.error('문의 삭제에 실패했습니다.');
    } finally {
      setOpen(false);
    }
  };

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={deleteQuestion.isPending}
      >
        <Trash2 className="h-4 w-4" />
        삭제
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>문의 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              이 문의를 삭제하시겠습니까? 삭제된 문의는 사용자에게 더 이상
              노출되지 않습니다.
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
