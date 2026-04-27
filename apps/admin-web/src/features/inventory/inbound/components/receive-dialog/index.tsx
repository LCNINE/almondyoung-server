'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SimpleMode } from './simple-mode';
import { FullscanMode } from './fullscan-mode';
import { IndividualMode } from './individual-mode';

type ReceiveMode = 'simple' | 'fullscan' | 'individual';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string;
};

export function ReceiveDialog({ open, onOpenChange, warehouseId }: Props) {
  const [mode, setMode] = useState<ReceiveMode>('simple');

  const handleSuccess = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>입고 처리</DialogTitle>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as ReceiveMode)}>
          <TabsList className="w-full">
            <TabsTrigger value="simple" className="flex-1">간편입고</TabsTrigger>
            <TabsTrigger value="fullscan" className="flex-1">전수조사</TabsTrigger>
            <TabsTrigger value="individual" className="flex-1">개별입고</TabsTrigger>
          </TabsList>
          <TabsContent value="simple" className="pt-4">
            {open && <SimpleMode warehouseId={warehouseId} onSuccess={handleSuccess} />}
          </TabsContent>
          <TabsContent value="fullscan" className="pt-4">
            {open && <FullscanMode warehouseId={warehouseId} onSuccess={handleSuccess} />}
          </TabsContent>
          <TabsContent value="individual" className="pt-4">
            {open && <IndividualMode warehouseId={warehouseId} onSuccess={handleSuccess} />}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
