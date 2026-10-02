'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
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
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { SmsRecipientGroup } from '@/lib/api/domains/sms-gate';
import {
  useDeleteSmsRecipientGroup,
  useSmsRecipientGroups,
} from '@/lib/services/sms-gate';
import { ExcelUploadDialog } from '../components/excel-upload-dialog';
import { SupabaseImportDialog } from '../components/supabase-import-dialog';

export default function SmsRecipientGroupsTemplate() {
  const { data, isLoading, isError } = useSmsRecipientGroups();
  const deleteGroup = useDeleteSmsRecipientGroup();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [appendTo, setAppendTo] = useState<SmsRecipientGroup | null>(null);
  const [deleting, setDeleting] = useState<SmsRecipientGroup | null>(null);

  const handleDelete = () => {
    if (!deleting) return;
    deleteGroup.mutate(deleting.id, {
      onSuccess: () => toast.success(`'${deleting.name}' 그룹을 지웠습니다.`),
      onError: (error) =>
        toast.error(error.message || '그룹을 지우지 못했습니다.'),
      onSettled: () => setDeleting(null),
    });
  };

  return (
    <Container>
      <Header
        title="수신자 그룹"
        subtitle="회원이 아닌 번호를 모아 두는 곳입니다. 대량 메시지 전송에서 대상으로 고를 수 있습니다."
        right={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImporting(true)}>
              네이버 플레이스에서 가져오기
            </Button>
            <Button variant="outline" onClick={() => setCreating(true)}>
              엑셀로 만들기
            </Button>
          </div>
        }
      />

      <div className="px-6 pb-6">
        {isLoading && <Skeleton className="h-40 w-full" />}
        {isError && (
          <p className="text-destructive text-sm">
            그룹을 불러오지 못했습니다.
          </p>
        )}
        {data && data.length === 0 && (
          <p className="text-muted-foreground text-sm">만든 그룹이 없습니다.</p>
        )}
        {data && data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead className="w-28 text-right">인원</TableHead>
                <TableHead className="w-28">수정일</TableHead>
                <TableHead className="w-48" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((group) => (
                <TableRow key={group.id}>
                  <TableCell className="font-medium">{group.name}</TableCell>
                  <TableCell className="text-right">
                    {group.recipients.toLocaleString()}명
                  </TableCell>
                  <TableCell>
                    {new Date(group.updatedAt).toLocaleDateString('ko-KR')}
                  </TableCell>
                  <TableCell className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAppendTo(group)}
                    >
                      엑셀 추가
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDeleting(group)}
                    >
                      삭제
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <ExcelUploadDialog open={creating} onOpenChange={setCreating} />
      <ExcelUploadDialog
        open={appendTo !== null}
        group={appendTo}
        onOpenChange={(open) => {
          if (!open) setAppendTo(null);
        }}
      />
      <SupabaseImportDialog open={importing} onOpenChange={setImporting} />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              &apos;{deleting?.name}&apos; 그룹을 지울까요?
            </AlertDialogTitle>
            <AlertDialogDescription>
              그룹과 번호 {deleting?.recipients.toLocaleString()}개가
              지워집니다. 이미 만든 대량 발송은 그대로 나갑니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Container>
  );
}
