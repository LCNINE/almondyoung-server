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
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SmsCampaign, SmsCampaignState } from '@/lib/api/domains/sms-gate';
import { useSmsCampaignClicks, useSmsCampaigns, useStopSmsCampaign } from '@/lib/services/sms-gate';
import { formatPhoneNumber } from '@/lib/utils/phone';
import { HelpSheet } from '../../components/help-sheet';
import { CategoryBadge } from '../../components/category-badge';

const STATE_LABEL: Record<SmsCampaignState, string> = {
  SCHEDULED: '예약',
  PROCESSING: '진행 중',
  COMPLETED: '완료',
  CANCELLED: '중지',
};

const isStoppable = (state: SmsCampaignState) => state === 'SCHEDULED' || state === 'PROCESSING';

export default function SmsCampaignsTemplate() {
  const { data, isLoading, isError } = useSmsCampaigns();
  const stopCampaign = useStopSmsCampaign();
  const [stopping, setStopping] = useState<SmsCampaign | null>(null);
  const [viewingClicks, setViewingClicks] = useState<SmsCampaign | null>(null);

  const handleStop = () => {
    if (!stopping) return;
    stopCampaign.mutate(stopping.campaignId, {
      onSuccess: (result) => {
        toast.success(`남은 ${result.cancelled.toLocaleString()}건을 취소했습니다.`);
        setStopping(null);
      },
      onError: (error) => toast.error(error.message || '중지하지 못했습니다.'),
    });
  };

  return (
    <Container>
      <Header
        title="발송 목록"
        titleAside={<HelpSheet />}
        subtitle="대량 발송의 진행률과 예상 완료일입니다. 예상 완료일은 폰 한도로 계산한 예상치입니다."
      />

      <div className="px-6 pb-6">
        {isLoading && <Skeleton className="h-40 w-full" />}
        {isError && <p className="text-destructive text-sm">발송 목록을 불러오지 못했습니다.</p>}
        {data && data.length === 0 && <p className="text-muted-foreground text-sm">대량 발송이 없습니다.</p>}
        {data && data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead className="w-20">구분</TableHead>
                <TableHead className="w-20">상태</TableHead>
                <TableHead className="w-64">진행률</TableHead>
                <TableHead className="w-28">링크 클릭</TableHead>
                <TableHead className="w-40">예약</TableHead>
                <TableHead className="w-28">예상 완료일</TableHead>
                <TableHead className="w-28">보낸 사람</TableHead>
                <TableHead className="w-28">만든 날</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((campaign) => {
                const { total, sent, failed, cancelled } = campaign.counts;
                const done = sent + failed;
                return (
                  <TableRow key={campaign.campaignId}>
                    <TableCell>
                      <div className="font-medium">{campaign.name}</div>
                      <div className="text-muted-foreground max-w-80 truncate text-xs">{campaign.content}</div>
                    </TableCell>
                    <TableCell>
                      <CategoryBadge category={campaign.category} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={campaign.state === 'PROCESSING' ? 'default' : 'outline'}>
                        {STATE_LABEL[campaign.state]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Progress value={total > 0 ? (done / total) * 100 : 0} />
                      <div className="text-muted-foreground pt-1 text-xs">
                        {done.toLocaleString()} / {total.toLocaleString()}
                        {failed > 0 && ` · 실패 ${failed.toLocaleString()}`}
                        {cancelled > 0 && ` · 취소 ${cancelled.toLocaleString()}`}
                      </div>
                    </TableCell>
                    <TableCell>
                      {campaign.clicked > 0 ? (
                        <Button variant="link" className="h-auto p-0" onClick={() => setViewingClicks(campaign)}>
                          {campaign.clicked.toLocaleString()}명
                          {sent > 0 && ` (${Math.round((campaign.clicked / sent) * 100)}%)`}
                        </Button>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>{campaign.sendAt ? new Date(campaign.sendAt).toLocaleString('ko-KR') : '-'}</TableCell>
                    <TableCell>
                      {isStoppable(campaign.state) ? (campaign.estimatedCompleteDate ?? '계산 불가') : '-'}
                    </TableCell>
                    <TableCell>{campaign.createdByName ?? '-'}</TableCell>
                    <TableCell>{new Date(campaign.createdAt).toLocaleDateString('ko-KR')}</TableCell>
                    <TableCell>
                      {isStoppable(campaign.state) && (
                        <Button variant="outline" size="sm" onClick={() => setStopping(campaign)}>
                          중지
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <CampaignClicksDialog campaign={viewingClicks} onClose={() => setViewingClicks(null)} />

      <AlertDialog open={stopping !== null} onOpenChange={(open) => !open && setStopping(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>대량 발송을 중지할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              &apos;{stopping?.name}&apos; 의 남은 {stopping?.counts.pending.toLocaleString()}건이 취소됩니다. 이미
              나간 문자는 되돌릴 수 없고, 중지한 발송은 다시 시작할 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleStop} disabled={stopCampaign.isPending}>
              중지
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Container>
  );
}

function CampaignClicksDialog({ campaign, onClose }: { campaign: SmsCampaign | null; onClose: () => void }) {
  const { data, isLoading, isError } = useSmsCampaignClicks(campaign?.campaignId ?? null);

  return (
    <Dialog open={campaign !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>링크를 누른 사람</DialogTitle>
          <DialogDescription>
            &apos;{campaign?.name}&apos; 문자 속 링크를 누른 사람입니다. 문자는 열람 여부를 알 수 없어 링크 클릭만
            셉니다.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading && <Skeleton className="h-40 w-full" />}
          {isError && <p className="text-destructive text-sm">클릭 목록을 불러오지 못했습니다.</p>}
          {data && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>번호</TableHead>
                  <TableHead>링크</TableHead>
                  <TableHead className="w-16">횟수</TableHead>
                  <TableHead className="w-40">처음 누른 시각</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((click) => (
                  <TableRow key={`${click.notificationId}-${click.url}`}>
                    <TableCell>{click.name ?? '-'}</TableCell>
                    <TableCell>{formatPhoneNumber(click.phoneNumber)}</TableCell>
                    <TableCell className="max-w-56 truncate text-xs">{click.url}</TableCell>
                    <TableCell>{click.clickCount}</TableCell>
                    <TableCell>{new Date(click.firstClickedAt).toLocaleString('ko-KR')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
