'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useBusinessLicense,
  useUpdateBusinessLicense,
  useDeleteBusinessLicense,
} from '@/lib/services/business-licenses';
import {
  BusinessLicenseStatus,
  BUSINESS_LICENSE_STATUS_LABELS,
} from '@/lib/types/dto/business-licenses';
import { getFileSignedUrlFromFileService } from '@/lib/api/domains/files/upload.client';
import {
  ExternalLink,
  FileIcon,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

function statusVariant(
  status: BusinessLicenseStatus
): 'default' | 'secondary' | 'destructive' {
  if (status === 'approved') return 'default';
  if (status === 'under_review') return 'secondary';
  return 'destructive';
}

function extractFileIdFromFileUrl(fileUrl: string): string | null {
  const match = fileUrl.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  return match?.[0] ?? null;
}

function BusinessLicenseDetailContent({ id }: { id: string }) {
  const { data } = useBusinessLicense(id);
  const updateMutation = useUpdateBusinessLicense(id);

  const [rejectComment, setRejectComment] = useState(data.reviewComment ?? '');
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadingSignedUrl, setLoadingSignedUrl] = useState(false);
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [isImageFile, setIsImageFile] = useState(true);

  useEffect(() => {
    if (!data.fileUrl) return;

    const loadSignedUrl = async () => {
      setLoadingSignedUrl(true);
      try {
        const fileId = extractFileIdFromFileUrl(data.fileUrl!);
        if (!fileId) {
          setSignedUrl(data.fileUrl!);
          return;
        }
        const { signedUrl } = await getFileSignedUrlFromFileService(fileId);
        setSignedUrl(signedUrl);
      } catch {
        toast.error('파일 URL 생성 중 오류가 발생했습니다.');
      } finally {
        setLoadingSignedUrl(false);
      }
    };

    loadSignedUrl();
  }, [data.fileUrl]);

  const handleStatusUpdate = async (
    status: BusinessLicenseStatus,
    comment?: string
  ) => {
    try {
      await updateMutation.mutateAsync({
        userId: data.userId,
        status,
        reviewComment: comment || undefined,
      });
      toast.success(
        status === 'approved'
          ? '승인 처리되었습니다.'
          : status === 'rejected'
            ? '반려 처리되었습니다.'
            : '심사중으로 변경되었습니다.'
      );
    } catch {
      toast.error('처리 중 오류가 발생했습니다.');
    }
  };

  const isUpdating = updateMutation.isPending;

  const rows: { key: string; value: React.ReactNode }[] = [
    { key: 'ID', value: <span className="font-mono text-xs">{data.id}</span> },
    {
      key: '사용자 ID',
      value: <span className="font-mono text-xs">{data.userId}</span>,
    },
    {
      key: '사업자등록번호',
      value: <span className="font-mono">{data.businessNumber ?? '-'}</span>,
    },
    { key: '대표자명', value: data.representativeName ?? '-' },
    {
      key: '상태',
      value: (
        <Badge variant={statusVariant(data.status)}>
          {BUSINESS_LICENSE_STATUS_LABELS[data.status]}
        </Badge>
      ),
    },
    {
      key: '신청일',
      value: new Date(data.createdAt).toLocaleString('ko-KR'),
    },
    {
      key: '검토일',
      value: data.reviewedAt
        ? new Date(data.reviewedAt).toLocaleString('ko-KR')
        : '-',
    },
    {
      key: '승인일',
      value: data.verifiedAt
        ? new Date(data.verifiedAt).toLocaleString('ko-KR')
        : '-',
    },
  ];

  return (
    <div className="divide-y">
      <dl>
        {rows.map(({ key, value }) => (
          <div key={key} className="grid grid-cols-3 p-3">
            <dt className="text-sm font-medium text-gray-500">{key}</dt>
            <dd className="col-span-2 text-sm">{value ?? '-'}</dd>
          </div>
        ))}
      </dl>

      {data.fileUrl && (
        <section className="p-4 space-y-2">
          <h3 className="text-sm font-medium text-gray-500">사업자등록증</h3>
          {loadingSignedUrl ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Spinner className="w-4 h-4" />
              <span>파일 불러오는 중...</span>
            </div>
          ) : signedUrl ? (
            isImageFile ? (
              <button
                type="button"
                onClick={() => setFileModalOpen(true)}
                className="block overflow-hidden transition-colors border border-gray-200 rounded-md cursor-zoom-in hover:border-blue-400"
              >
                <img
                  src={signedUrl}
                  alt="사업자등록증"
                  className="object-contain w-auto max-h-48"
                  onError={() => setIsImageFile(false)}
                />
              </button>
            ) : (
              <a
                href={signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline"
              >
                <FileIcon className="w-4 h-4" />
                파일 보기
                <ExternalLink className="w-3 h-3" />
              </a>
            )
          ) : null}
        </section>
      )}

      <Dialog open={fileModalOpen} onOpenChange={setFileModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>사업자등록증</DialogTitle>
          </DialogHeader>
          {signedUrl && (
            <div className="flex justify-center">
              <img
                src={signedUrl}
                alt="사업자등록증 확대"
                className="max-h-[70vh] w-auto object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <section className="p-4">
        <div className="flex items-center justify-between">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={isUpdating}
                className="text-gray-600"
              >
                <Clock className="mr-1.5 h-4 w-4" />
                심사중으로 되돌리기
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>심사중으로 변경</AlertDialogTitle>
                <AlertDialogDescription>
                  상태를 심사중으로 변경합니다.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => handleStatusUpdate('under_review')}
                >
                  확인
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="flex gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={isUpdating}>
                  <XCircle className="mr-1.5 h-4 w-4" />
                  반려
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>반려 처리</AlertDialogTitle>
                  <AlertDialogDescription>
                    반려 사유를 입력해주세요. 입력한 내용이 사용자에게
                    전달됩니다.
                  </AlertDialogDescription>
                </AlertDialogHeader>

                <Textarea
                  placeholder="반려 사유를 입력하세요..."
                  value={rejectComment}
                  onChange={(e) => setRejectComment(e.target.value)}
                  rows={4}
                />

                <AlertDialogFooter>
                  <AlertDialogCancel>취소</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      if (!rejectComment) {
                        const ok = window.confirm(
                          '반려 사유 코멘트를 입력하지 않았습니다. 계속하시겠습니까?'
                        );
                        if (!ok) {
                          e.preventDefault();
                          return;
                        }
                      }
                      handleStatusUpdate('rejected', rejectComment);
                    }}
                  >
                    반려 처리
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" disabled={isUpdating}>
                  {isUpdating ? (
                    <Spinner className="w-4 h-4" />
                  ) : (
                    <>
                      <CheckCircle2 className="mr-1.5 h-4 w-4" />
                      승인
                    </>
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>승인 처리</AlertDialogTitle>
                  <AlertDialogDescription>
                    해당 사업자 인증 신청을 승인 처리합니다.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>취소</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => handleStatusUpdate('approved')}
                  >
                    승인 처리
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </section>
    </div>
  );
}

function DeleteButton({ id }: { id: string }) {
  const deleteMutation = useDeleteBusinessLicense(id);
  const router = useRouter();

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync();
      toast.success('삭제되었습니다.');
      router.push('/cs/business-licenses');
    } catch {
      toast.error('삭제 중 오류가 발생했습니다.');
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          삭제
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>삭제</AlertDialogTitle>
          <AlertDialogDescription>
            해당 사업자 인증 정보를 삭제하시겠습니까? 이 작업은 되돌릴 수
            없습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete}>삭제</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function BusinessLicenseDetail({ id }: { id: string }) {
  return (
    <Container className="divide-y">
      <Header title="사업자 인증 상세" right={<DeleteButton id={id} />} />
      <Suspense
        fallback={
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        }
      >
        <BusinessLicenseDetailContent id={id} />
      </Suspense>
    </Container>
  );
}
