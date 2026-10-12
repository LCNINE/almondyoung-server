'use client';

import { Loader } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import type { AlimtalkTemplate } from '@/lib/api/domains/alimtalk';
import {
  useAddAlimtalkComment,
  useAlimtalkTestSend,
} from '@/lib/services/alimtalk';
import { COMMENT_STATUS_LABEL, renderVariables } from '../lib/alimtalk';
import { AutoNoticeLink } from './auto-notice-link';
import { KakaoBubble } from './kakao-bubble';
import { StatusBadge } from './status-badge';

const errorMessage = (error: unknown, fallback: string) =>
  (error instanceof Error && error.message) || fallback;

export function AlimtalkTemplateDetailSheet({
  template,
  onClose,
  onEdit,
}: {
  template: AlimtalkTemplate | null;
  onClose: () => void;
  onEdit: (template: AlimtalkTemplate) => void;
}) {
  return (
    <Sheet open={template !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {template && (
          <DetailBody
            key={template.templateCode}
            template={template}
            onEdit={onEdit}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({
  template,
  onEdit,
}: {
  template: AlimtalkTemplate;
  onEdit: (template: AlimtalkTemplate) => void;
}) {
  const [comment, setComment] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const addComment = useAddAlimtalkComment();
  const testSend = useAlimtalkTestSend();
  const approved = template.status === 'TSC03';
  const rejected = template.status === 'TSC04';
  const canTest =
    approved && template.variables.every((name) => values[name]?.trim());

  const submitComment = () =>
    addComment.mutate(
      { templateCode: template.templateCode, comment },
      {
        onSuccess: () => {
          toast.success(
            rejected
              ? '문의를 남겼습니다. 다시 검수 중으로 바뀝니다.'
              : '문의를 남겼습니다.'
          );
          setComment('');
        },
        onError: (error) =>
          toast.error(errorMessage(error, '문의를 남기지 못했습니다.')),
      }
    );

  const submitTest = () =>
    testSend.mutate(
      {
        templateCode: template.templateCode,
        variables: template.variables.map((name) => ({
          name,
          value: values[name] ?? '',
        })),
      },
      {
        onSuccess: (result) =>
          toast.success(`${result.sentTo} (내 번호)로 보냈습니다.`),
        onError: (error) =>
          toast.error(errorMessage(error, '시험 발송을 하지 못했습니다.')),
      }
    );

  return (
    <div className="flex flex-col gap-5 px-4 pb-6">
      <SheetHeader className="px-0">
        <SheetTitle className="flex flex-wrap items-center gap-2">
          {template.templateName}
          <StatusBadge status={template.status} label={template.statusName} />
        </SheetTitle>
        <SheetDescription>
          코드 {template.templateCode}
          {template.updateDate && ` · 최근 수정 ${template.updateDate}`}
        </SheetDescription>
      </SheetHeader>

      <KakaoBubble
        body={renderVariables(template.templateContent, values)}
        buttons={template.buttons}
      />

      <AutoNoticeLink template={template} />

      <section className="flex flex-col gap-2 text-sm">
        <h4 className="font-semibold">심사 기록</h4>
        {template.comments.length === 0 && (
          <p className="text-muted-foreground text-xs">
            아직 심사 의견이 없습니다.
          </p>
        )}
        {template.comments.map((c) => (
          <div
            key={c.id}
            className={`rounded-md border px-3 py-2 ${c.status === 'REJ' ? 'border-destructive/40 bg-destructive/5' : ''}`}
          >
            <div className="text-muted-foreground flex justify-between gap-2 text-xs">
              <span>
                {COMMENT_STATUS_LABEL[c.status] ?? c.status}
                {c.userName && ` · ${c.userName}`}
              </span>
              <span>{c.createdAt}</span>
            </div>
            <p className="pt-1 whitespace-pre-wrap">{c.content}</p>
          </div>
        ))}
        <Textarea
          rows={3}
          maxLength={1000}
          placeholder={
            rejected
              ? '반려 사유에 대해 설명하거나 다시 검토를 요청하는 글을 남깁니다'
              : '카카오 심사 담당자에게 문의'
          }
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onEdit(template)}
          >
            {rejected ? '고쳐서 다시 요청' : '수정 요청'}
          </Button>
          <Button
            type="button"
            disabled={!comment.trim() || addComment.isPending}
            onClick={submitComment}
          >
            {addComment.isPending ? (
              <Loader className="animate-spin" />
            ) : (
              '문의 남기기'
            )}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2 text-sm">
        <h4 className="font-semibold">시험 발송</h4>
        {!approved ? (
          <p className="text-muted-foreground text-xs">
            승인된 뒤에 시험 발송을 할 수 있습니다.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground text-xs">
              로그인한 내 계정의 휴대폰 번호로만 보냅니다.
            </p>
            {template.variables.map((name) => (
              <div key={name} className="flex items-center gap-2">
                <Label
                  htmlFor={`test-${name}`}
                  className="w-28 shrink-0 truncate font-mono text-xs"
                >
                  #&#123;{name}&#125;
                </Label>
                <Input
                  id={`test-${name}`}
                  value={values[name] ?? ''}
                  onChange={(e) =>
                    setValues({ ...values, [name]: e.target.value })
                  }
                />
              </div>
            ))}
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={!canTest || testSend.isPending}
                onClick={submitTest}
              >
                {testSend.isPending ? (
                  <Loader className="animate-spin" />
                ) : (
                  '내 번호로 보내기'
                )}
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
