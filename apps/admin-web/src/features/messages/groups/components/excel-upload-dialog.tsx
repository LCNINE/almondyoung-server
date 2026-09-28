'use client';

import { Loader } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  SmsGroupRecipientInput,
  SmsRecipientGroup,
} from '@/lib/api/domains/sms-gate';
import { useUploadSmsGroupRecipients } from '@/lib/services/sms-gate';
import { toRecipientInputs } from '../lib/recipient-sheet';
import { resultMessage } from '../lib/result-message';

async function readSheet(file: File): Promise<SmsGroupRecipientInput[]> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return toRecipientInputs(
    XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
  );
}

/** group 이 있으면 그 그룹에 추가, 없으면 새 그룹을 만든다. */
export function ExcelUploadDialog({
  open,
  onOpenChange,
  group,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group?: SmsRecipientGroup | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {group ? `'${group.name}'에 엑셀로 추가` : '엑셀로 그룹 만들기'}
          </DialogTitle>
          <DialogDescription>
            첫 행은 머리글입니다. &quot;전화번호&quot;(또는 휴대폰·연락처) 열은
            필수이고 &quot;이름&quot;(또는 상호) 열은 선택입니다. 휴대폰 번호만
            들어가고, 같은 번호는 한 번만 들어갑니다.
          </DialogDescription>
        </DialogHeader>
        <ExcelUploadBody
          key={group?.id ?? 'create'}
          group={group ?? null}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ExcelUploadBody({
  group,
  onClose,
}: {
  group: SmsRecipientGroup | null;
  onClose: () => void;
}) {
  const upload = useUploadSmsGroupRecipients();
  const [name, setName] = useState('');
  const [rows, setRows] = useState<SmsGroupRecipientInput[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    setRows(null);
    setFileError(null);
    if (!file) return;
    try {
      setRows(await readSheet(file));
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : '파일을 읽지 못했습니다.'
      );
    }
  };

  const canSubmit =
    !!rows &&
    rows.length > 0 &&
    (!!group || name.trim().length > 0) &&
    !upload.isPending;

  const handleSubmit = () => {
    if (!rows) return;
    upload.mutate(
      { groupId: group?.id, name: name.trim(), recipients: rows },
      {
        onSuccess: (result) => {
          toast.success(resultMessage(result));
          onClose();
        },
        onError: (error) =>
          toast.error(error.message || '엑셀을 올리지 못했습니다.'),
      }
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {!group && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="group-name">그룹 이름</Label>
          <Input
            id="group-name"
            placeholder="예: 2026 박람회 방문 원장님"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="group-file">엑셀 파일</Label>
        <Input
          id="group-file"
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {fileError && <p className="text-destructive text-sm">{fileError}</p>}
        {rows && (
          <p className="text-muted-foreground text-sm">
            번호가 있는 행 {rows.length.toLocaleString()}개
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          취소
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          {upload.isPending ? (
            <Loader className="animate-spin" />
          ) : group ? (
            '추가하기'
          ) : (
            '그룹 만들기'
          )}
        </Button>
      </div>
    </div>
  );
}
