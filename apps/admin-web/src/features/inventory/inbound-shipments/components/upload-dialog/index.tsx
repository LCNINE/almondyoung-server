'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWarehouses } from '@/lib/services/inventory/queries';
import { useUploadInboundShipment } from '@/lib/services/inventory/inbound-shipment-mutations';
import {
  readInboundShipmentWorkbook,
  WorkbookReadError,
  type ReadWorkbookResult,
} from '../../lib/read-workbook';
import {
  defaultShipmentName,
  defaultWarehouseId,
  MAX_SHIPMENT_NAME_LENGTH,
} from '../../lib/shipment-rules';
import { OriginalUploadFailedError } from '../../lib/upload-flow';
import { uploadErrorMessage } from '../../lib/upload-error-message';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UploadDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const { data: warehouses = [] } = useWarehouses();
  const upload = useUploadInboundShipment();
  /** 읽기 토큰 — 마지막으로 고른 파일의 읽기 결과만 반영한다. */
  const readToken = useRef(0);

  const [file, setFile] = useState<File | null>(null);
  const [read, setRead] = useState<ReadWorkbookResult | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [name, setName] = useState('');
  const [expectedArrival, setExpectedArrival] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** 원본 보관이 실패해 «원본 없이 올릴까요?» 를 묻는 중 */
  const [askWithoutOriginal, setAskWithoutOriginal] = useState(false);

  useEffect(() => {
    if (open) return;
    readToken.current += 1;
    setFile(null);
    setRead(null);
    setReadError(null);
    setWarehouseId('');
    setName('');
    setExpectedArrival('');
    setError(null);
    setAskWithoutOriginal(false);
  }, [open]);

  useEffect(() => {
    if (!open || warehouseId || warehouses.length === 0) return;
    setWarehouseId(defaultWarehouseId(warehouses) ?? '');
  }, [open, warehouses, warehouseId]);

  const handleFile = async (picked: File | undefined) => {
    const token = ++readToken.current;
    setError(null);
    setAskWithoutOriginal(false);
    setRead(null);
    setReadError(null);
    setFile(picked ?? null);
    if (!picked) return;
    setName(defaultShipmentName(picked.name));
    try {
      const result = readInboundShipmentWorkbook(await picked.arrayBuffer());
      if (token === readToken.current) setRead(result);
    } catch (e) {
      if (token !== readToken.current) return;
      setReadError(
        e instanceof WorkbookReadError
          ? e.message
          : '엑셀 파일을 읽지 못했습니다.'
      );
    }
  };

  const canSubmit =
    !!file &&
    !!read &&
    !!warehouseId &&
    name.trim().length > 0 &&
    !upload.isPending;

  const submit = (allowWithoutOriginal: boolean) => {
    if (!file || !read) return;
    setError(null);
    upload.mutate(
      {
        file,
        read,
        warehouseId,
        name: name.trim(),
        ...(expectedArrival ? { expectedArrival } : {}),
        allowWithoutOriginal,
      },
      {
        onSuccess: ({ shipmentId }) => {
          onOpenChange(false);
          router.push(`/inventory/inbound-shipments/${shipmentId}`);
        },
        onError: (e) => {
          if (e instanceof OriginalUploadFailedError) {
            setAskWithoutOriginal(true);
            setError(
              `원본 파일을 보관하지 못했습니다. ${uploadErrorMessage(e.cause)}`
            );
          } else {
            setAskWithoutOriginal(false);
            setError(uploadErrorMessage(e));
          }
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>입고리스트 올리기</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="shipment-file">파일</Label>
            <Input
              id="shipment-file"
              type="file"
              accept=".xlsx"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            {read && (
              <p className="text-xs text-muted-foreground">
                {read.dataRowCount}줄 읽음
              </p>
            )}
            {readError && (
              <p className="text-xs text-destructive">{readError}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label>창고</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="창고 선택" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="shipment-name">이름</Label>
            <Input
              id="shipment-name"
              value={name}
              maxLength={MAX_SHIPMENT_NAME_LENGTH}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="shipment-eta">도착 예정일 (선택)</Label>
            <Input
              id="shipment-eta"
              type="date"
              value={expectedArrival}
              onChange={(e) => setExpectedArrival(e.target.value)}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
          {askWithoutOriginal ? (
            <Button disabled={!canSubmit} onClick={() => submit(true)}>
              원본 없이 올리기
            </Button>
          ) : (
            <Button disabled={!canSubmit} onClick={() => submit(false)}>
              {upload.isPending ? '올리는 중…' : '올리기'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
