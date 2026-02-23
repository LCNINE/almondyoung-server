'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function IntentSearch() {
  const router = useRouter();
  const [value, setValue] = useState('');

  function navigate() {
    const id = value.trim();
    if (id) router.push(`/dev/intents/${id}`);
  }

  return (
    <div className="flex gap-2">
      <Input
        placeholder="Intent UUID 입력..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && navigate()}
        className="max-w-sm font-mono text-sm"
      />
      <Button variant="outline" onClick={navigate} disabled={!value.trim()}>
        조회
      </Button>
    </div>
  );
}
