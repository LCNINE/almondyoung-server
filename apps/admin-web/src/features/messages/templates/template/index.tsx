'use client';

import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SmsTemplate } from '@/lib/api/domains/sms-gate';
import { useSmsTemplates } from '@/lib/services/sms-gate';
import { CategoryBadge } from '../../components/category-badge';
import { TemplateFormDialog } from '../components/template-form-dialog';

export default function SmsTemplatesTemplate() {
  const { data, isLoading, isError } = useSmsTemplates();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SmsTemplate | null>(null);

  return (
    <Container>
      <Header
        title="문자 템플릿"
        subtitle="개별 메시지 전송에서 불러 쓰는 문자 본문입니다. {{이름}} 은 받는 회원의 이름으로 바뀌어 발송됩니다."
        right={
          <Button variant="outline" onClick={() => setCreating(true)}>
            템플릿 만들기
          </Button>
        }
      />

      <div className="px-6 pb-6">
        {isLoading && <Skeleton className="h-40 w-full" />}
        {isError && <p className="text-destructive text-sm">템플릿을 불러오지 못했습니다.</p>}
        {data && data.length === 0 && <p className="text-muted-foreground text-sm">등록된 템플릿이 없습니다.</p>}
        {data && data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-48">이름</TableHead>
                <TableHead className="w-20">구분</TableHead>
                <TableHead>본문</TableHead>
                <TableHead className="w-28">만든 직원</TableHead>
                <TableHead className="w-28">수정일</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((template) => (
                <TableRow key={template.id} className="cursor-pointer" onClick={() => setEditing(template)}>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell>
                    <CategoryBadge category={template.category} />
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-0 truncate">{template.content}</TableCell>
                  <TableCell>{template.createdByName ?? '-'}</TableCell>
                  <TableCell>{new Date(template.updatedAt).toLocaleDateString('ko-KR')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <TemplateFormDialog open={creating} onOpenChange={setCreating} />
      <TemplateFormDialog
        open={editing !== null}
        template={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </Container>
  );
}
