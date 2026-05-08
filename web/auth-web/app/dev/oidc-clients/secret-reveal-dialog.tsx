"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type SecretRevealPayload = {
  clientId: string;
  clientSecret: string | null;
  context: "created" | "rotated";
};

type Props = {
  payload: SecretRevealPayload | null;
  onClose: () => void;
};

export function SecretRevealDialog({ payload, onClose }: Props) {
  return (
    <Dialog open={payload !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {payload?.context === "rotated"
              ? "client_secret 회전 완료"
              : "OIDC client 등록 완료"}
          </DialogTitle>
          <DialogDescription>
            아래 client_secret 은 <strong>이번 한 번만</strong> 표시됩니다. 즉시 RP 설정에 복사해 두세요.
            창을 닫으면 다시 조회할 수 없습니다.
          </DialogDescription>
        </DialogHeader>

        {payload && (
          <div className="space-y-4">
            <CopyField label="client_id" value={payload.clientId} />
            {payload.clientSecret ? (
              <CopyField label="client_secret" value={payload.clientSecret} mono />
            ) : (
              <Alert>
                <AlertTitle>public client</AlertTitle>
                <AlertDescription>
                  public client 는 client_secret 을 사용하지 않습니다 (PKCE only).
                </AlertDescription>
              </Alert>
            )}
            {payload.context === "rotated" && (
              <Alert>
                <AlertTitle>이전 secret 은 grace 기간 동안 함께 유효합니다</AlertTitle>
                <AlertDescription>
                  모든 RP 가 새 secret 으로 전환된 후, 행 액션의 <em>이전 secret 폐기</em> 를 눌러 grace 를 종료하세요.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          <Button onClick={onClose}>닫기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} 복사됨`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("클립보드 복사 실패");
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex items-stretch gap-2">
        <code
          className={`flex-1 break-all rounded-md border bg-muted px-3 py-2 text-sm ${
            mono ? "font-mono" : ""
          }`}
        >
          {value}
        </code>
        <Button type="button" variant="outline" size="icon" onClick={onCopy} aria-label={`${label} 복사`}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
