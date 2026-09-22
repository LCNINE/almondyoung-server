'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SmsTemplate } from '@/lib/api/domains/sms-gate';
import { useSmsTemplates } from '@/lib/services/sms-gate';
import { cn } from '@/lib/utils/cn';
import { CategoryBadge } from '../../components/category-badge';

export function TemplatePanel({ onSelect }: { onSelect: (template: SmsTemplate) => void }) {
  const { data = [], isLoading } = useSmsTemplates();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const keyword = query.trim();
  const filtered = keyword ? data.filter((t) => t.name.includes(keyword) || t.content.includes(keyword)) : data;
  const selected = data.find((t) => t.id === selectedId);

  if (!isLoading && data.length === 0) {
    return (
      <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed px-3 py-8 text-center">
        <FileText className="text-muted-foreground size-6" />
        <p className="text-sm font-medium">저장된 템플릿이 없습니다</p>
        <p className="text-muted-foreground text-xs">자주 보내는 문구를 템플릿으로 저장하면 여기서 불러올 수 있습니다.</p>
        <Button asChild variant="outline" size="sm" className="mt-1">
          <Link href="/messages/templates">템플릿 만들기</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[320px] flex-1 flex-col gap-2 rounded-md border p-3">
      <Input placeholder="템플릿 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul className="flex max-h-64 flex-col overflow-y-auto">
        {isLoading && <li className="text-muted-foreground p-2 text-sm">불러오는 중...</li>}
        {!isLoading && filtered.length === 0 && (
          <li className="text-muted-foreground p-2 text-sm">&apos;{keyword}&apos;와 일치하는 템플릿이 없습니다.</li>
        )}
        {filtered.map((template) => (
          <li key={template.id}>
            <button
              type="button"
              onClick={() => {
                setSelectedId(template.id);
                onSelect(template);
              }}
              className={cn(
                'hover:bg-muted flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
                template.id === selectedId && 'bg-muted font-medium'
              )}
            >
              <CategoryBadge category={template.category} />
              <span className="truncate">{template.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="flex flex-col gap-1 border-t pt-2">
          <div className="text-sm font-medium">{selected.name}</div>
          <p className="text-muted-foreground text-sm whitespace-pre-wrap">{selected.content}</p>
          <p className="text-muted-foreground text-xs">
            {selected.createdByName ?? '-'} · {new Date(selected.updatedAt).toLocaleDateString('ko-KR')}
          </p>
        </div>
      )}
    </div>
  );
}
