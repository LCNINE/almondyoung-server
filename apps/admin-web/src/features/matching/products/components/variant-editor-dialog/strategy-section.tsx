'use client';

import type {
  MatchingStrategy,
  MatchingPriority,
} from '@/lib/types/dto/matching';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface StrategySectionProps {
  strategy: MatchingStrategy;
  priority: MatchingPriority;
  onStrategyChange: (strategy: MatchingStrategy) => void;
  onPriorityChange: (priority: MatchingPriority) => void;
}

export function StrategySection({
  strategy,
  priority,
  onStrategyChange,
  onPriorityChange,
}: StrategySectionProps) {
  return (
    <div className="flex gap-4">
      <div className="flex-1 space-y-1.5">
        <Label className="text-xs text-muted-foreground">상품매칭 전략</Label>
        <Select
          value={strategy}
          onValueChange={(v) => onStrategyChange(v as MatchingStrategy)}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="variant">SKU 구성 매칭</SelectItem>
            <SelectItem value="void">재고상품 비매칭</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1 space-y-1.5">
        <Label className="text-xs text-muted-foreground">우선순위</Label>
        <Select
          value={priority}
          onValueChange={(v) => onPriorityChange(v as MatchingPriority)}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="normal">일반</SelectItem>
            <SelectItem value="high">높음</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
