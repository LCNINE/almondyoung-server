'use client';

import { Loader, Send, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
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
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { smsGateApi } from '@/lib/api/domains/sms-gate';
import {
  useDeleteSmsConversation,
  useReplySmsConversation,
  useSmsConversation,
  useSmsDevices,
} from '@/lib/services/sms-gate';
import { formatPhoneNumber } from '@/lib/utils/phone';
import { NhnFallbackDialog } from '../../send/components/nhn-fallback-dialog';
import { MessageBubble } from './message-bubble';

export function ConversationPanel({
  phoneNumber,
  onDeleted,
}: {
  phoneNumber: string | null;
  onDeleted: () => void;
}) {
  const { data, isLoading, isError } = useSmsConversation(phoneNumber);
  const { data: deviceData } = useSmsDevices();
  const reply = useReplySmsConversation();
  const deleteConversation = useDeleteSmsConversation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [text, setText] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [overflow, setOverflow] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageCount = data?.messages.length ?? 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [phoneNumber, messageCount]);

  if (!phoneNumber) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border text-center">
        <p className="text-sm font-medium">대화를 선택하세요.</p>
        <p className="text-muted-foreground text-sm">왼쪽 목록에서 번호를 고르면 주고받은 문자를 볼 수 있습니다.</p>
      </div>
    );
  }

  const devices = deviceData?.devices ?? [];
  const deviceName = (deviceId: string) => devices.find((d) => d.deviceId === deviceId)?.name ?? deviceId;
  const canReply = !!data?.userId && !!data.deviceId;
  const busy = reply.isPending || isChecking;

  const submit = (nhnFallback: boolean) => {
    setOverflow(null);
    reply.mutate(
      { phoneNumber, content: text.trim(), nhnFallback },
      {
        onSuccess: (result) => {
          if (result.skipped.length > 0) toast.warning(`보내지 못했습니다: ${result.skipped[0].reason}`);
          else setText('');
        },
        onError: (error) => toast.error(error.message || '답장을 보내지 못했습니다.'),
      }
    );
  };

  const handleDelete = () => {
    deleteConversation.mutate(phoneNumber, {
      onSuccess: () => {
        toast.success('대화를 삭제했습니다.');
        onDeleted();
      },
      onError: (error) => toast.error(error.message || '대화를 삭제하지 못했습니다.'),
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!data?.deviceId || !text.trim() || busy) return;
    setIsChecking(true);
    try {
      const { remaining } = await smsGateApi.getCapacity(data.deviceId);
      if (remaining < 1) setOverflow(1);
      else submit(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '발송폰 한도를 확인하지 못했습니다.');
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold">{data?.name ?? formatPhoneNumber(phoneNumber)}</span>
          <span className="text-muted-foreground truncate text-sm">
            {formatPhoneNumber(phoneNumber)}
            {data?.deviceId && ` · 받은 폰 ${deviceName(data.deviceId)}`}
          </span>
        </div>
        <Button variant="ghost" size="icon" aria-label="대화 삭제" onClick={() => setConfirmingDelete(true)}>
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="bg-muted/20 min-h-0 flex-1">
        {isLoading && (
          <div className="text-muted-foreground flex h-full items-center justify-center">
            <Loader className="animate-spin" />
          </div>
        )}
        {isError && (
          <div className="text-destructive flex h-full items-center justify-center text-sm">
            대화를 불러오지 못했습니다.
          </div>
        )}
        {data && (
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-2 p-4">
              {data.messages.map((message) => (
                <MessageBubble key={message.id} message={message} deviceName={deviceName} />
              ))}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t p-3">
        {data && !data.userId && (
          <p className="text-muted-foreground text-xs">회원이 아닌 번호로는 답장할 수 없습니다.</p>
        )}
        <form className="flex items-center gap-2" onSubmit={handleSubmit}>
          <Input
            value={text}
            placeholder={canReply && data?.deviceId ? `메시지를 입력하세요. ${deviceName(data.deviceId)}에서 보냅니다.` : ''}
            disabled={!canReply || busy}
            maxLength={2000}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" size="icon" aria-label="답장 보내기" disabled={!canReply || busy || !text.trim()}>
            {busy ? <Loader className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </form>
      </div>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>대화를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              메시지함 목록에서 사라집니다. 이 번호로 새 문자가 오면 그 문자부터 다시 표시됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteConversation.isPending}>
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <NhnFallbackDialog overflow={overflow} onCancel={() => setOverflow(null)} onConfirm={() => submit(true)} />
    </div>
  );
}
