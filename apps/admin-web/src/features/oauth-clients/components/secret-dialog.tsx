'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

export function SecretDisplayDialog({
  clientId,
  clientSecret,
  onClose,
}: {
  clientId: string | null;
  clientSecret: string | null;
  onClose: () => void;
}) {
  const open = !!clientId && !!clientSecret;

  const handleCopy = async () => {
    if (!clientSecret) return;
    try {
      await navigator.clipboard.writeText(clientSecret);
      toast.success('clientSecret을 클립보드에 복사했어요.');
    } catch {
      toast.error('복사에 실패했어요. 직접 선택해서 복사해 주세요.');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>clientSecret 발급됨</DialogTitle>
          <DialogDescription>
            이 secret 은 지금 한 번만 노출됩니다. 이 창을 닫으면 다시 확인할 수 없으니, 안전한 곳에 저장하세요.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">clientId</p>
            <p className="font-mono text-sm">{clientId}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">clientSecret</p>
            <pre className="rounded border bg-muted p-3 text-xs break-all whitespace-pre-wrap">
              {clientSecret}
            </pre>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCopy}>
            복사
          </Button>
          <Button onClick={onClose}>저장 완료</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
