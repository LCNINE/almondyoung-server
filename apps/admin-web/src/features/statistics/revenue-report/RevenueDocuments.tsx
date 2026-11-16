'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { archiveClient } from '@/lib/api/domains/archive/archive.client';
import { getFileSignedUrlFromFileService } from '@/lib/api/domains/files/upload.client';
import { Button } from '@/components/ui/button';

/** Only authenticated file-service attachments; never execute arbitrary document links. */
export function revenueAttachments(blocks: Record<string, unknown>[]) {
  const files = new Map<string, { id: string; name: string }>();
  const visit = (items: Record<string, unknown>[]) => {
    for (const block of items) {
      const props = block.props as Record<string, unknown> | undefined;
      const match =
        typeof props?.url === 'string'
          ? props.url.match(
              /^\/api\/proxy\/file\/files\/([a-zA-Z0-9-]+)\/open$/
            )
          : null;
      if (block.type === 'file' && match)
        files.set(match[1], {
          id: match[1],
          name: typeof props?.name === 'string' ? props.name : '첨부 자료',
        });
      if (Array.isArray(block.children)) visit(block.children);
    }
  };
  visit(blocks);
  return [...files.values()];
}

export function RevenueDocuments() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string>();
  const documents = useQuery({
    queryKey: ['revenue-documents'],
    queryFn: async () => {
      const pages = (await archiveClient.listTree('team')).filter(
        (page) => !page.parentId && page.title === '매출 자료'
      );
      if (pages.length !== 1) return null;
      const page = await archiveClient.get(pages[0].id);
      return { page, files: revenueAttachments(page.content) };
    },
    staleTime: 60_000,
  });

  async function download(id: string) {
    setBusy(id);
    setError('');
    try {
      const result = await getFileSignedUrlFromFileService(id, 300, {
        forceDownload: true,
      });
      const link = document.createElement('a');
      link.href = result.signedUrl;
      link.rel = 'noopener';
      link.click();
    } catch {
      setError(
        '파일을 내려받지 못했습니다. 자료 보관함에서 권한과 파일 상태를 확인해 주세요.'
      );
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <h3 className="font-medium">원본·세무사 전달 자료</h3>
      <p className="text-sm text-gray-600">
        보관함의 원본 묶음입니다. 파일명의 연도와 보완 여부를 확인하세요. 위
        연도 선택으로 파일이 바뀌지는 않습니다.
      </p>
      {documents.isLoading ? (
        <p className="text-sm">자료 목록을 불러오는 중입니다.</p>
      ) : null}
      {documents.isError ? (
        <p role="alert">자료 목록을 불러오지 못했습니다.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {documents.data?.files.map((file) => (
          <Button
            key={file.id}
            variant="outline"
            disabled={Boolean(busy)}
            onClick={() => download(file.id)}
          >
            {busy === file.id ? '다운로드 준비 중…' : file.name}
          </Button>
        ))}
        <Link
          className="self-center text-sm underline"
          href={
            documents.data ? `/archive/${documents.data.page.id}` : '/archive'
          }
        >
          자료 보관함·업로드 안내
        </Link>
      </div>
      {!documents.isLoading &&
      !documents.isError &&
      !documents.data?.files.length ? (
        <p className="text-sm">
          등록된 첨부 파일이 없습니다. 팀 스페이스의 ‘매출 자료’ 문서에 원본을
          보관하세요.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
