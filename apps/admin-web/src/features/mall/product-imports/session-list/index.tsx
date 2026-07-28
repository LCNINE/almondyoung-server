'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { useImportSessions } from '@/lib/services/products';
import type { SessionSummaryDto } from '@/lib/types/dto/product-import';
import { Plus } from 'lucide-react';

/**
 * `SessionSummaryDto.status` 는 잡 상태가 아니라 아카이브 플래그다(항상 'completed') —
 * 세션 상세(session-detail/index.tsx)가 진행 상태를 commitStatus/publishStatus 로
 * 판단하는 것과 같은 근거로, 목록도 같은 두 필드에서 라벨을 뽑는다. 단어 선택도
 * 세션 상세의 버튼 라벨("생성 중...","게시 중...")과 맞춘다 — 두 화면이 어긋나면 안 된다.
 */
function jobStatusLabel(s: Pick<SessionSummaryDto, 'commitStatus' | 'publishStatus'>): string {
  if (s.commitStatus === 'queued' || s.commitStatus === 'running') return '생성 중';
  if (s.commitStatus === 'failed') return '생성 실패';
  if (s.publishStatus === 'queued' || s.publishStatus === 'running') return '게시 중';
  if (s.publishStatus === 'failed') return '게시 실패';
  return '완료';
}

export function SessionList() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useImportSessions(page);

  const sessions = data?.data ?? [];
  const total = data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / (data?.limit ?? 20)));

  return (
    <div className="flex flex-col gap-y-4">
      <Container className="divide-y-0">
        <Header
          title="엑셀 대량등록"
          subtitle="과거 대량등록 세션을 확인하거나 새로 등록합니다."
          right={
            <Button onClick={() => router.push('/mall/product-imports/new')}>
              <Plus className="mr-2 h-4 w-4" />새 대량등록
            </Button>
          }
        />
        <div className="p-6 pt-2">
          <div className="overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-2">파일명</th>
                  <th className="p-2">시도</th>
                  <th className="p-2">성공</th>
                  <th className="p-2">실패</th>
                  <th className="p-2">상태</th>
                  <th className="p-2">생성일시</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td className="p-4 text-muted-foreground" colSpan={6}>
                      불러오는 중...
                    </td>
                  </tr>
                )}
                {!isLoading && sessions.length === 0 && (
                  <tr>
                    <td className="p-4 text-muted-foreground" colSpan={6}>
                      대량등록 이력이 없습니다.
                    </td>
                  </tr>
                )}
                {sessions.map((s) => (
                  <tr
                    key={s.id}
                    className="cursor-pointer border-t hover:bg-muted/30"
                    onClick={() => router.push(`/mall/product-imports/${s.id}`)}
                  >
                    <td className="p-2">{s.fileName ?? '(파일명 없음)'}</td>
                    <td className="p-2">{s.totalRows}</td>
                    <td className="p-2 text-green-600">{s.createdCount}</td>
                    <td className="p-2 text-destructive">{s.failedCount}</td>
                    <td className="p-2">{jobStatusLabel(s)}</td>
                    <td className="p-2">
                      {new Date(s.createdAt).toLocaleString('ko-KR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-end gap-2 text-sm">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              이전
            </Button>
            <span className="text-muted-foreground">
              {page} / {maxPage}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= maxPage}
              onClick={() => setPage((p) => p + 1)}
            >
              다음
            </Button>
          </div>
        </div>
      </Container>
    </div>
  );
}
