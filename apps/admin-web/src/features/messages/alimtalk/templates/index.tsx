'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
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
import type { AlimtalkTemplate } from '@/lib/api/domains/alimtalk';
import { useAlimtalkTemplates } from '@/lib/services/alimtalk';
import { AlimtalkTemplateDetailSheet } from '../components/template-detail-sheet';
import { AlimtalkTemplateFormDialog } from '../components/template-form-dialog';
import { StatusBadge } from '../components/status-badge';

export default function AlimtalkTemplatesTemplate() {
  const { data, isLoading, isError, error, refetch, isFetching } =
    useAlimtalkTemplates();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AlimtalkTemplate | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  // 목록을 다시 받아도 열린 상세가 새 심사 상태를 보이도록 코드로 찾는다.
  const selected = data?.find((t) => t.templateCode === selectedCode) ?? null;

  return (
    <Container>
      <Header
        title="알림톡 템플릿"
        subtitle="카카오 심사를 받은 템플릿으로만 알림톡을 보낼 수 있습니다. 심사 상태와 반려 사유는 카카오(NHN)에서 바로 가져옵니다."
        right={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              심사 상태 새로고침
            </Button>
            <Button onClick={() => setCreating(true)}>템플릿 만들기</Button>
          </div>
        }
      />

      <div className="flex flex-col gap-3 px-6 pb-6">
        {isLoading && <Skeleton className="h-40 w-full" />}
        {isError && (
          <p className="text-destructive text-sm">
            템플릿을 불러오지 못했습니다.{' '}
            {error instanceof Error ? error.message : ''}
          </p>
        )}
        {data && data.length === 0 && (
          <p className="text-muted-foreground text-sm">
            등록된 알림톡 템플릿이 없습니다.
          </p>
        )}
        {data && data.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-48">이름</TableHead>
                  <TableHead className="w-24">상태</TableHead>
                  <TableHead>본문</TableHead>
                  <TableHead className="w-44">쓰는 자동 알림</TableHead>
                  <TableHead className="w-32">최근 수정</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((template) => {
                  const lastRejection = [...template.comments]
                    .reverse()
                    .find((c) => c.status === 'REJ');
                  return (
                    <TableRow
                      key={template.templateCode}
                      className="cursor-pointer"
                      onClick={() => setSelectedCode(template.templateCode)}
                    >
                      <TableCell>
                        <div className="font-medium">
                          {template.templateName}
                        </div>
                        <div className="text-muted-foreground font-mono text-xs">
                          {template.templateCode}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={template.status}
                          label={template.statusName}
                        />
                      </TableCell>
                      <TableCell className="max-w-0">
                        <div className="text-muted-foreground truncate">
                          {template.templateContent}
                        </div>
                        {template.status === 'TSC04' && lastRejection && (
                          <div className="text-destructive truncate text-xs">
                            반려 사유: {lastRejection.content}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {template.linkedEvents.length > 0
                          ? template.linkedEvents.map((e) => e.name).join(', ')
                          : '-'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {template.updateDate ?? '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-muted-foreground text-xs">
          승인된 템플릿으로 여러 명에게 보내려면{' '}
          <Link
            href="/messages/alimtalk/send"
            className="underline underline-offset-2"
          >
            알림톡 보내기
          </Link>
          를 쓰세요.
        </p>
      </div>

      <AlimtalkTemplateDetailSheet
        template={selected}
        onClose={() => setSelectedCode(null)}
        onEdit={(template) => {
          setSelectedCode(null);
          setEditing(template);
        }}
      />
      <AlimtalkTemplateFormDialog open={creating} onOpenChange={setCreating} />
      <AlimtalkTemplateFormDialog
        open={editing !== null}
        template={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </Container>
  );
}
