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
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  AlimtalkCampaign,
  AlimtalkCampaignState,
} from '@/lib/api/domains/alimtalk';
import {
  useAlimtalkCampaigns,
  useStopAlimtalkCampaign,
} from '@/lib/services/alimtalk';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlimtalkAutoSendsTab } from './auto-sends-tab';
import { CampaignResultsDialog } from './campaign-results-dialog';

const STATE_LABEL: Record<AlimtalkCampaignState, string> = {
  SCHEDULED: '예약',
  PROCESSING: '보내는 중',
  COMPLETED: '끝남',
  CANCELLED: '중지',
};

const isStoppable = (state: AlimtalkCampaignState) =>
  state === 'SCHEDULED' || state === 'PROCESSING';

export default function AlimtalkCampaignsTemplate() {
  const { data, isLoading, isError } = useAlimtalkCampaigns();
  const stopCampaign = useStopAlimtalkCampaign();
  const [stopping, setStopping] = useState<AlimtalkCampaign | null>(null);
  const [viewing, setViewing] = useState<AlimtalkCampaign | null>(null);

  const handleStop = () => {
    if (!stopping) return;
    stopCampaign.mutate(stopping.campaignId, {
      onSuccess: (result) => {
        toast.success(
          `남은 ${result.cancelled.toLocaleString()}건을 취소했습니다.`
        );
        setStopping(null);
      },
      onError: (error) => toast.error(error.message || '중지하지 못했습니다.'),
    });
  };

  return (
    <Container>
      <Header
        title="알림톡 발송 목록"
        subtitle="«카카오 접수» 는 카카오(NHN)가 발송 요청을 받은 수입니다. 실제로 받았는지는 «결과 보기» 에서 확인합니다."
      />

      <Tabs defaultValue="campaigns">
        <div className="px-6 pb-3">
          <TabsList>
            <TabsTrigger value="campaigns">직접 보낸 캠페인</TabsTrigger>
            <TabsTrigger value="auto">자동 발송</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="auto">
          <AlimtalkAutoSendsTab />
        </TabsContent>
        <TabsContent value="campaigns">
          <div className="overflow-x-auto px-6 pb-6">
            {isLoading && <Skeleton className="h-40 w-full" />}
            {isError && (
              <p className="text-destructive text-sm">
                발송 목록을 불러오지 못했습니다.
              </p>
            )}
            {data && data.length === 0 && (
              <p className="text-muted-foreground text-sm">
                알림톡 발송이 없습니다.
              </p>
            )}
            {data && data.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>이름</TableHead>
                    <TableHead className="w-24">상태</TableHead>
                    <TableHead className="w-64">진행</TableHead>
                    <TableHead className="w-40">예약</TableHead>
                    <TableHead className="w-24">보낸 사람</TableHead>
                    <TableHead className="w-28">만든 날</TableHead>
                    <TableHead className="w-40" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((campaign) => {
                    const { total, accepted, failed, cancelled } =
                      campaign.counts;
                    const done = accepted + failed;
                    return (
                      <TableRow key={campaign.campaignId}>
                        <TableCell>
                          <div className="font-medium">{campaign.name}</div>
                          <div className="text-muted-foreground text-xs">
                            {campaign.templateName}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              campaign.state === 'PROCESSING'
                                ? 'default'
                                : 'outline'
                            }
                          >
                            {STATE_LABEL[campaign.state]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Progress
                            value={total > 0 ? (done / total) * 100 : 0}
                          />
                          <div className="text-muted-foreground pt-1 text-xs">
                            카카오 접수 {accepted.toLocaleString()} /{' '}
                            {total.toLocaleString()}
                            {failed > 0 &&
                              ` · 접수 실패 ${failed.toLocaleString()}`}
                            {cancelled > 0 &&
                              ` · 취소 ${cancelled.toLocaleString()}`}
                          </div>
                        </TableCell>
                        <TableCell>
                          {campaign.sendAt
                            ? new Date(campaign.sendAt).toLocaleString('ko-KR')
                            : '-'}
                        </TableCell>
                        <TableCell>{campaign.createdByName ?? '-'}</TableCell>
                        <TableCell>
                          {new Date(campaign.createdAt).toLocaleDateString(
                            'ko-KR'
                          )}
                        </TableCell>
                        <TableCell className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setViewing(campaign)}
                          >
                            결과 보기
                          </Button>
                          {isStoppable(campaign.state) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setStopping(campaign)}
                            >
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
        </TabsContent>
      </Tabs>

      <CampaignResultsDialog
        campaign={viewing}
        onClose={() => setViewing(null)}
      />

      <AlertDialog
        open={stopping !== null}
        onOpenChange={(open) => !open && setStopping(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>알림톡 발송을 중지할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              &apos;{stopping?.name}&apos; 의 아직 나가지 않은{' '}
              {stopping?.counts.pending.toLocaleString()}건이 취소됩니다. 이미
              카카오에 넘긴 건은 되돌릴 수 없고, 중지한 발송은 다시 시작할 수
              없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleStop}
              disabled={stopCampaign.isPending}
            >
              중지
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Container>
  );
}
