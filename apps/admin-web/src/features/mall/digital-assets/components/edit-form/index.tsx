'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import {
  useAddFileVersion,
  useDigitalAsset,
  useDigitalAssetFileVersions,
  useRollbackFileVersion,
  useUpdateDigitalAsset,
} from '@/lib/services/library';
import type {
  DigitalAssetFileVersionDto,
  UpdateDigitalAssetDto,
} from '@/lib/types/dto/library';
import { toast } from 'sonner';

type Props = { assetId: string };

export function DigitalAssetEditForm({ assetId }: Props) {
  const { data: asset, isLoading } = useDigitalAsset(assetId);
  const { data: versions } = useDigitalAssetFileVersions(assetId);
  const updateMutation = useUpdateDigitalAsset();
  const addVersionMutation = useAddFileVersion();
  const rollbackMutation = useRollbackFileVersion();

  const [form, setForm] = useState<UpdateDigitalAssetDto>({});
  const [newFileId, setNewFileId] = useState('');
  const [newReleaseNote, setNewReleaseNote] = useState('');
  const [pendingRollback, setPendingRollback] =
    useState<DigitalAssetFileVersionDto | null>(null);

  useEffect(() => {
    if (asset) {
      setForm({
        name: asset.name,
        description: asset.description ?? undefined,
        mimeType: asset.mimeType ?? undefined,
        thumbnailUrl: asset.thumbnailUrl ?? undefined,
      });
    }
  }, [asset]);

  if (isLoading || !asset) {
    return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>;
  }

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({ id: assetId, dto: form });
      toast.success('자산이 업데이트되었습니다.');
    } catch {
      toast.error('업데이트에 실패했습니다.');
    }
  };

  const handleRollback = async (version: DigitalAssetFileVersionDto) => {
    try {
      await rollbackMutation.mutateAsync({ id: assetId, versionId: version.id });
      toast.success(`v${version.version} 로 되돌렸습니다.`);
      setPendingRollback(null);
    } catch {
      toast.error('되돌리기에 실패했습니다.');
    }
  };

  const handleAddVersion = async () => {
    if (!newFileId.trim()) {
      toast.error('file-service 의 파일 ID 를 입력해 주세요.');
      return;
    }
    try {
      await addVersionMutation.mutateAsync({
        id: assetId,
        dto: { fileId: newFileId.trim(), releaseNote: newReleaseNote.trim() || undefined },
      });
      setNewFileId('');
      setNewReleaseNote('');
      toast.success('새 파일 버전이 등록되었습니다.');
    } catch {
      toast.error('파일 버전 등록에 실패했습니다.');
    }
  };

  return (
    <div className="grid gap-6 p-6">
      {/* 메타데이터 */}
      <div className="grid gap-4 rounded-md border bg-background p-5">
        <h2 className="text-base font-medium">메타데이터</h2>

        <div className="grid gap-2">
          <Label htmlFor="name">이름</Label>
          <Input
            id="name"
            value={form.name ?? ''}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="description">설명</Label>
          <Textarea
            id="description"
            className="min-h-[80px]"
            value={form.description ?? ''}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="mimeType">MIME 타입</Label>
            <Input
              id="mimeType"
              value={form.mimeType ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, mimeType: e.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="thumbnailUrl">썸네일 URL</Label>
            <Input
              id="thumbnailUrl"
              value={form.thumbnailUrl ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, thumbnailUrl: e.target.value }))}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            저장
          </Button>
        </div>
      </div>

      {/* 파일 버전 이력 */}
      <div className="grid gap-4 rounded-md border bg-background p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">파일 버전 이력</h2>
          {asset.currentFileVersion && (
            <span className="text-xs text-muted-foreground">
              현재 v{asset.currentFileVersion.version} ·{' '}
              {new Date(asset.currentFileVersion.releasedAt).toLocaleString()}
            </span>
          )}
        </div>

        <div className="grid gap-3 rounded-md border bg-muted/20 p-4">
          <h3 className="text-sm font-medium">새 파일 버전 등록 (파일 교체)</h3>
          <p className="text-xs text-muted-foreground">
            file-service 에 새 파일을 업로드한 뒤 그 파일 ID 를 입력하세요. 모든 ownership 보유자가 자동으로 최신 버전을 받습니다.
          </p>
          <p className="text-xs text-amber-700">
            ⚠️ 큰 변경(다른 상품 수준의 변경)은 <strong>새 자산</strong>으로 등록하고, 사소한 수정(오타·이미지 교체·재인쇄)만 같은 자산의 새 버전으로 올려주세요.
          </p>
          <div className="grid gap-2">
            <Label htmlFor="newFileId">file-service 파일 ID</Label>
            <Input
              id="newFileId"
              placeholder="00000000-0000-0000-0000-000000000000"
              value={newFileId}
              onChange={(e) => setNewFileId(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="newReleaseNote">릴리즈 노트</Label>
            <Input
              id="newReleaseNote"
              placeholder="예: 오타 수정"
              value={newReleaseNote}
              onChange={(e) => setNewReleaseNote(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleAddVersion}
              disabled={addVersionMutation.isPending}
            >
              파일 버전 추가
            </Button>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">버전</TableHead>
              <TableHead>파일 ID</TableHead>
              <TableHead>릴리즈 노트</TableHead>
              <TableHead className="w-48">릴리즈 시각</TableHead>
              <TableHead className="w-32 text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(versions ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  등록된 파일 버전이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              (versions ?? []).map((v) => {
                const isCurrent = v.id === asset.currentFileVersionId;
                return (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">
                      v{v.version}
                      {isCurrent && (
                        <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                          현재
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{v.fileId}</TableCell>
                    <TableCell className="text-xs">{v.releaseNote ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(v.releasedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {!isCurrent && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPendingRollback(v)}
                          disabled={rollbackMutation.isPending}
                        >
                          이 버전으로 되돌리기
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={pendingRollback !== null}
        onOpenChange={(open) => !open && setPendingRollback(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              v{pendingRollback?.version} 로 되돌리시겠습니까?
            </AlertDialogTitle>
            <AlertDialogDescription>
              모든 ownership 보유자의 다운로드가 즉시 이 버전의 파일로 바뀝니다.
              {pendingRollback?.releaseNote && (
                <>
                  <br />
                  <span className="mt-1 inline-block text-xs">
                    릴리즈 노트: {pendingRollback.releaseNote}
                  </span>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollbackMutation.isPending}>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={rollbackMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (pendingRollback) {
                  void handleRollback(pendingRollback);
                }
              }}
            >
              되돌리기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
