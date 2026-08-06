'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DEFAULT_AREA_TEMPLATE_CODE,
  type ShippingAreaTemplate,
} from '@/lib/api/domains/medusa/shipping-groups';
import {
  useDeleteShippingAreaTemplate,
  useShippingAreaTemplates,
  useUpsertShippingAreaTemplate,
} from '@/lib/services/medusa-shipping-groups';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;

function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 0;
  const parsed = Number(trimmed.replace(/,/g, ''));
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function TemplateDialog({
  open,
  onOpenChange,
  template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: ShippingAreaTemplate | null;
}) {
  const isEdit = !!template;
  const upsert = useUpsertShippingAreaTemplate();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [jejuText, setJejuText] = useState('');
  const [islandText, setIslandText] = useState('');

  useEffect(() => {
    if (!open) return;
    setCode(template?.code ?? '');
    setName(template?.name ?? '');
    setJejuText(template ? String(template.jejuExtraFee) : '');
    setIslandText(template ? String(template.islandExtraFee) : '');
  }, [open, template]);

  const handleSubmit = async () => {
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    const jejuExtraFee = parseAmount(jejuText);
    const islandExtraFee = parseAmount(islandText);

    if (!trimmedName) return toast.error('템플릿 이름을 입력해 주세요.');
    if (!/^[a-z0-9][a-z0-9-]{0,49}$/.test(trimmedCode))
      return toast.error('템플릿 코드는 영소문자·숫자·하이픈 50자 이내입니다.');
    if (jejuExtraFee === null || islandExtraFee === null)
      return toast.error('금액은 0 이상의 정수로 입력해 주세요.');

    try {
      const saved = await upsert.mutateAsync({
        code: trimmedCode,
        name: trimmedName,
        jejuExtraFee,
        islandExtraFee,
      });
      toast.success(`'${saved.name}' 템플릿을 저장했어요.`);
      onOpenChange(false);
    } catch {
      toast.error('템플릿 저장에 실패했어요.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? '지역별 배송비 템플릿 수정' : '지역별 배송비 템플릿 추가'}</DialogTitle>
          <DialogDescription>
            제주·도서산간 추가 배송비입니다. 배송비가 무료로 떨어져도 별도로 부과됩니다. 금액을 고치면
            이 템플릿을 쓰는 배송비 그룹에 바로 반영됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="area-template-name">템플릿 이름</Label>
              <Input
                id="area-template-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="기본 템플릿"
                disabled={upsert.isPending}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="area-template-code">템플릿 코드</Label>
              <Input
                id="area-template-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="default"
                disabled={upsert.isPending || isEdit}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="area-template-jeju">제주 추가 배송비</Label>
              <Input
                id="area-template-jeju"
                inputMode="numeric"
                value={jejuText}
                onChange={(event) => setJejuText(event.target.value)}
                placeholder="5000"
                disabled={upsert.isPending}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="area-template-island">도서산간 추가 배송비</Label>
              <Input
                id="area-template-island"
                inputMode="numeric"
                value={islandText}
                onChange={(event) => setIslandText(event.target.value)}
                placeholder="0"
                disabled={upsert.isPending}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={upsert.isPending}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={upsert.isPending}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AreaTemplateSection() {
  const { data: templates, isLoading } = useShippingAreaTemplates();
  const deleteMutation = useDeleteShippingAreaTemplate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ShippingAreaTemplate | null>(null);

  const handleDelete = async (template: ShippingAreaTemplate) => {
    try {
      await deleteMutation.mutateAsync(template.code);
      toast.success(`'${template.name}' 템플릿을 삭제했어요.`);
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        '템플릿 삭제에 실패했어요.';
      toast.error(message);
    }
  };

  return (
    <section className="mt-8 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">지역별 배송비 템플릿</h2>
          <p className="text-sm text-muted-foreground">
            제주·도서산간 추가 배송비를 모아둔 묶음입니다. 배송비 그룹이 템플릿을 골라 씁니다.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setEditTarget(null);
            setDialogOpen(true);
          }}
        >
          템플릿 추가
        </Button>
      </div>

      {/* 컬럼이 4개뿐이라 전체 폭으로 늘리면 사이가 텅 빈다. */}
      <div className="max-w-3xl">
        <Table>
        <TableHeader>
          <TableRow>
            <TableHead>템플릿</TableHead>
            <TableHead>코드</TableHead>
            <TableHead className="text-right">제주</TableHead>
            <TableHead className="text-right">도서산간</TableHead>
            <TableHead className="w-[120px] text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                불러오는 중...
              </TableCell>
            </TableRow>
          )}
          {(templates ?? []).map((template) => {
            const isDefault = template.code === DEFAULT_AREA_TEMPLATE_CODE;
            return (
              <TableRow key={template.code}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {template.name}
                    {isDefault && <Badge variant="secondary">기본</Badge>}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-sm">{template.code}</TableCell>
                <TableCell className="text-right">{won(template.jejuExtraFee)}</TableCell>
                <TableCell className="text-right">{won(template.islandExtraFee)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditTarget(template);
                      setDialogOpen(true);
                    }}
                  >
                    수정
                  </Button>
                  {!isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(template)}
                      disabled={deleteMutation.isPending}
                    >
                      삭제
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        </Table>
      </div>

      <TemplateDialog open={dialogOpen} onOpenChange={setDialogOpen} template={editTarget} />
    </section>
  );
}
