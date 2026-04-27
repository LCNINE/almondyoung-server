'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { InspectionSessionDrawer } from '../inspection-session-drawer';
import type { InspectionSession } from '@/lib/types/dto/fulfillment';
import { useStartInspection } from '@/lib/services/orders/mutations';

export function InspectionSessionStarter() {
  const [foId, setFoId] = useState('');
  const [inspectorUserId, setInspectorUserId] = useState('');
  const [session, setSession] = useState<InspectionSession | null>(null);

  const startMutation = useStartInspection();

  const handleStart = async () => {
    const trimmedFoId = foId.trim();
    const trimmedInspector = inspectorUserId.trim();
    if (!trimmedFoId || !trimmedInspector) {
      toast.error('주문처리 ID와 검사자 ID를 입력해주세요.');
      return;
    }
    try {
      const result = await startMutation.mutateAsync({
        fulfillmentOrderId: trimmedFoId,
        type: 'individual',
        inspectorUserId: trimmedInspector,
      });
      setSession(result);
      toast.success('검수 세션이 시작되었습니다.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '검수 시작에 실패했습니다.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="inspection-fo-id">주문처리 ID</Label>
          <Input
            id="inspection-fo-id"
            placeholder="Fulfillment Order ID"
            value={foId}
            onChange={(e) => setFoId(e.target.value)}
            className="w-64"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="inspector-id">검사자 ID</Label>
          <Input
            id="inspector-id"
            placeholder="Inspector User ID"
            value={inspectorUserId}
            onChange={(e) => setInspectorUserId(e.target.value)}
            className="w-48"
          />
        </div>
        <Button onClick={handleStart} disabled={startMutation.isPending || !foId.trim() || !inspectorUserId.trim()}>
          <Search className="mr-2 h-4 w-4" />
          {startMutation.isPending ? '시작 중…' : '검수 시작'}
        </Button>
      </div>

      {session && (
        <InspectionSessionDrawer
          session={session}
          foId={foId.trim()}
          onClose={() => setSession(null)}
        />
      )}
    </div>
  );
}
