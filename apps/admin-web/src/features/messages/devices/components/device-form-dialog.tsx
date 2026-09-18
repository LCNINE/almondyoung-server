'use client';

import { Loader } from 'lucide-react';
import { useState } from 'react';
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
import { Switch } from '@/components/ui/switch';
import type { SmsDeviceFormValues, SmsDeviceStatus } from '@/lib/api/domains/sms-gate';
import { useCreateSmsDevice, useDeleteSmsDevice, useUpdateSmsDevice } from '@/lib/services/sms-gate';

const DEFAULT_FORM: SmsDeviceFormValues = { deviceId: '', name: '', dailyLimit: 150, enabled: true };

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message) || fallback;

export function DeviceFormDialog({
  open,
  onOpenChange,
  device,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  device?: SmsDeviceStatus | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{device ? '디바이스 편집' : '디바이스 등록'}</DialogTitle>
        </DialogHeader>
        <DeviceFormBody key={device?.id ?? 'create'} device={device ?? null} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function DeviceFormBody({ device, onClose }: { device: SmsDeviceStatus | null; onClose: () => void }) {
  const [form, setForm] = useState<SmsDeviceFormValues>(() =>
    device
      ? { deviceId: device.deviceId, name: device.name, dailyLimit: device.dailyLimit, enabled: device.enabled }
      : DEFAULT_FORM
  );
  const createDevice = useCreateSmsDevice();
  const updateDevice = useUpdateSmsDevice();
  const deleteDevice = useDeleteSmsDevice();
  const isSubmitting = createDevice.isPending || updateDevice.isPending;

  const handleSubmit = () => {
    if (device) {
      const { deviceId: _, ...values } = form;
      updateDevice.mutate(
        { id: device.id, values },
        {
          onSuccess: () => {
            toast.success('디바이스를 수정했습니다.');
            onClose();
          },
          onError: (error) => toast.error(errorMessage(error, '디바이스 수정에 실패했습니다.')),
        }
      );
      return;
    }
    createDevice.mutate(form, {
      onSuccess: () => {
        toast.success('디바이스를 등록했습니다.');
        onClose();
      },
      onError: (error) => toast.error(errorMessage(error, '디바이스 등록에 실패했습니다.')),
    });
  };

  const handleDelete = () => {
    if (!device) return;
    deleteDevice.mutate(device.id, {
      onSuccess: () => {
        toast.success('디바이스를 삭제했습니다.');
        onClose();
      },
      onError: (error) => toast.error(errorMessage(error, '디바이스 삭제에 실패했습니다.')),
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
        <Label htmlFor="deviceId">Device ID</Label>
        <Input
          id="deviceId"
          placeholder="SMS Gate 앱에 표시된 device ID"
          value={form.deviceId}
          onChange={(event) => setForm({ ...form, deviceId: event.target.value })}
          disabled={device !== null}
          required
        />
        {device && (
          <p className="text-muted-foreground text-xs">Device ID 는 발송 기록의 기준이라 바꿀 수 없습니다.</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">이름</Label>
        <Input
          id="name"
          placeholder="예: 업무폰A"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dailyLimit">일일 발송 한도</Label>
        <Input
          id="dailyLimit"
          type="number"
          min={1}
          max={1000}
          value={form.dailyLimit}
          onChange={(event) => setForm({ ...form, dailyLimit: Number(event.target.value) })}
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="enabled">활성화</Label>
        <Switch id="enabled" checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} />
      </div>

      <div className="flex items-center gap-2 pt-2">
        {device && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive">
                삭제
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>디바이스를 삭제할까요?</AlertDialogTitle>
                <AlertDialogDescription>
                  &apos;{device.name}&apos; 디바이스가 삭제됩니다. 이미 보낸 발송 기록은 남습니다.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} disabled={deleteDevice.isPending}>
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
            {isSubmitting ? <Loader className="animate-spin" /> : device ? '저장' : '등록'}
          </Button>
        </div>
      </div>
    </form>
  );
}
