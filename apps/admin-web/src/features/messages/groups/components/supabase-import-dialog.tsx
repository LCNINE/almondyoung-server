'use client';

import { Loader } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useImportSupabaseSmsGroup } from '@/lib/services/sms-gate';
import { resultMessage } from '../lib/result-message';

// canonical_places.category. 크롤러가 새 업종을 돌리면 여기에 한 줄 더한다.
const CATEGORIES = [
  { value: 'hair_shops', label: '헤어샵' },
  { value: 'lash_shops', label: '속눈썹샵' },
  { value: 'nail_shops', label: '네일샵' },
  { value: 'tattoo_shops', label: '타투샵' },
  { value: 'coin_laundry', label: '코인빨래방' },
];

export function SupabaseImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>네이버 플레이스에서 그룹 만들기</DialogTitle>
          <DialogDescription>
            네이버 플레이스에 등록된 업종별 매장 중 휴대폰 번호가 있는 곳만 가져옵니다. 0507 안심번호·유선번호는 문자를
            받을 수 없어 빠집니다.
          </DialogDescription>
        </DialogHeader>
        {open && <SupabaseImportBody onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function SupabaseImportBody({ onClose }: { onClose: () => void }) {
  const importGroup = useImportSupabaseSmsGroup();
  const [category, setCategory] = useState('');
  const [name, setName] = useState('');

  const handleCategory = (value: string) => {
    setCategory(value);
    if (!name) setName(CATEGORIES.find((c) => c.value === value)?.label ?? '');
  };

  const handleSubmit = () => {
    importGroup.mutate(
      { name: name.trim(), category },
      {
        onSuccess: (result) => {
          toast.success(resultMessage(result));
          onClose();
        },
        onError: (error) =>
          toast.error(error.message || '가져오지 못했습니다.'),
      }
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>업종</Label>
        <Select value={category} onValueChange={handleCategory}>
          <SelectTrigger>
            <SelectValue placeholder="업종을 고르세요" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="supabase-group-name">그룹 이름</Label>
        <Input
          id="supabase-group-name"
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          취소
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!category || !name.trim() || importGroup.isPending}
        >
          {importGroup.isPending ? (
            <Loader className="animate-spin" />
          ) : (
            '가져오기'
          )}
        </Button>
      </div>
    </div>
  );
}
