'use client';

import { Loader } from 'lucide-react';
import { useRef, useState } from 'react';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import type { SmsGateCategory, SmsTemplate, SmsTemplateFormValues } from '@/lib/api/domains/sms-gate';
import { useCreateSmsTemplate, useDeleteSmsTemplate, useUpdateSmsTemplate } from '@/lib/services/sms-gate';
import { NameVariableButton } from '../../components/name-variable-button';
import { smsByteLength } from '../../lib/sms-bytes';

const DEFAULT_FORM: SmsTemplateFormValues = { name: '', category: 'INFORMATIONAL', content: '' };

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message) || fallback;

export function TemplateFormDialog({
  open,
  onOpenChange,
  template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: SmsTemplate | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{template ? '템플릿 수정' : '템플릿 만들기'}</DialogTitle>
        </DialogHeader>
        <TemplateFormBody
          key={template?.id ?? 'create'}
          template={template ?? null}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function TemplateFormBody({ template, onClose }: { template: SmsTemplate | null; onClose: () => void }) {
  const [form, setForm] = useState<SmsTemplateFormValues>(() =>
    template ? { name: template.name, category: template.category, content: template.content } : DEFAULT_FORM
  );
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const createTemplate = useCreateSmsTemplate();
  const updateTemplate = useUpdateSmsTemplate();
  const deleteTemplate = useDeleteSmsTemplate();
  const isSubmitting = createTemplate.isPending || updateTemplate.isPending;

  const handleSubmit = () => {
    const callbacks = (done: string, failed: string) => ({
      onSuccess: () => {
        toast.success(done);
        onClose();
      },
      onError: (error: unknown) => toast.error(errorMessage(error, failed)),
    });
    if (template) {
      updateTemplate.mutate(
        { id: template.id, values: form },
        callbacks('템플릿을 수정했습니다.', '템플릿 수정에 실패했습니다.')
      );
      return;
    }
    createTemplate.mutate(form, callbacks('템플릿을 만들었습니다.', '템플릿 생성에 실패했습니다.'));
  };

  const handleDelete = () => {
    if (!template) return;
    deleteTemplate.mutate(template.id, {
      onSuccess: () => {
        toast.success('템플릿을 삭제했습니다.');
        onClose();
      },
      onError: (error) => toast.error(errorMessage(error, '템플릿 삭제에 실패했습니다.')),
    });
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-name">이름</Label>
        <Input
          id="template-name"
          placeholder="예: 배송 지연 안내"
          maxLength={100}
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>구분</Label>
        <RadioGroup
          value={form.category}
          onValueChange={(value) => setForm({ ...form, category: value as SmsGateCategory })}
          className="flex gap-6"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="INFORMATIONAL" id="template-category-info" />
            <Label htmlFor="template-category-info" className="font-normal">
              정보
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="MARKETING" id="template-category-marketing" />
            <Label htmlFor="template-category-marketing" className="font-normal">
              광고
            </Label>
          </div>
        </RadioGroup>
        {form.category === 'MARKETING' && (
          <p className="text-muted-foreground text-xs">
            (광고) 표기와 수신거부 안내는 발송할 때 자동으로 붙으니 본문에 넣지 않아도 됩니다.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="template-content">본문</Label>
          <NameVariableButton
            textareaRef={contentRef}
            value={form.content}
            onChange={(content) => setForm({ ...form, content })}
          />
        </div>
        <Textarea
          id="template-content"
          ref={contentRef}
          rows={8}
          maxLength={2000}
          value={form.content}
          onChange={(event) => setForm({ ...form, content: event.target.value })}
          required
        />
        <p className="text-muted-foreground text-right text-xs">{smsByteLength(form.content)} byte</p>
      </div>

      <div className="flex items-center gap-2 pt-2">
        {template && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive">
                삭제
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>템플릿을 삭제할까요?</AlertDialogTitle>
                <AlertDialogDescription>
                  &apos;{template.name}&apos; 템플릿이 삭제됩니다. 이미 보낸 문자에는 영향이 없습니다.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} disabled={deleteTemplate.isPending}>
                  삭제
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Loader className="animate-spin" /> : template ? '저장' : '만들기'}
          </Button>
        </div>
      </div>
    </form>
  );
}
