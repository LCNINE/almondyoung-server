'use client';

import { useState, useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SkuLinkState } from '@/lib/types/ui/matching';

interface SkuLookupSectionProps {
  links: SkuLinkState[];
  onChange: (links: SkuLinkState[]) => void;
}

export function SkuLookupSection({ links, onChange }: SkuLookupSectionProps) {
  const [newSkuId, setNewSkuId] = useState('');
  const [newQty, setNewQty] = useState('1');

  const addLink = useCallback(() => {
    const skuId = newSkuId.trim();
    if (!skuId) return;
    if (links.some((l) => l.skuId === skuId)) return;
    onChange([...links, { skuId, quantity: Number(newQty) || 1 }]);
    setNewSkuId('');
    setNewQty('1');
  }, [links, newSkuId, newQty, onChange]);

  const removeLink = (skuId: string) => {
    onChange(links.filter((l) => l.skuId !== skuId));
  };

  const updateQty = (skuId: string, qty: number) => {
    onChange(links.map((l) => (l.skuId === skuId ? { ...l, quantity: qty } : l)));
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">SKU 매핑</p>

      {links.length > 0 && (
        <div className="space-y-1.5">
          {links.map((link) => (
            <div key={link.skuId} className="flex items-center gap-2 rounded-md border px-3 py-1.5">
              <span className="flex-1 font-mono text-xs">{link.skuId}</span>
              <Input
                type="number"
                min={1}
                value={link.quantity}
                onChange={(e) => updateQty(link.skuId, Number(e.target.value) || 1)}
                className="h-7 w-16 text-xs"
              />
              <span className="text-xs text-muted-foreground">개</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive hover:text-destructive"
                onClick={() => removeLink(link.skuId)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          placeholder="SKU ID 입력"
          value={newSkuId}
          onChange={(e) => setNewSkuId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addLink();
            }
          }}
          className="h-8 text-xs"
        />
        <Input
          type="number"
          min={1}
          value={newQty}
          onChange={(e) => setNewQty(e.target.value)}
          className="h-8 w-16 text-xs"
          placeholder="수량"
        />
        <Button variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={addLink}>
          <Plus className="h-3.5 w-3.5" />
          추가
        </Button>
      </div>
    </div>
  );
}
