// src/features/mall/bulk-sessions/session-detail/images-panel/dropzone.tsx
// 파일·폴더 드롭 입력. 판정(매칭)은 여기서 하지 않는다 — 모은 File[] 을 그대로 위로
// 올려 보내면 use-image-uploader.ts 가 bulk-session-model.ts 의 매칭 함수로 넘긴다.

'use client';

import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Folder, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/ui';

// webkitdirectory 는 표준이 아니라 React.InputHTMLAttributes 에 없다. 폴더 선택은
// 이 속성으로만 열리므로 로컬 확장으로 좁게 연다 — any 캐스팅보다 범위가 작다.
declare module 'react' {
  // 선언 병합은 원본 InputHTMLAttributes<T> 와 같은 타입 매개변수 목록을 요구한다.
  // T 를 지우면 병합이 아니라 새 선언이 되어 버린다.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}

function isFileEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile;
}

function isDirectoryEntry(
  entry: FileSystemEntry
): entry is FileSystemDirectoryEntry {
  return entry.isDirectory;
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** 브라우저(Chrome)가 `readEntries` 한 번에 최대 100개만 돌려준다 — 빈 배치가 올 때까지 반복한다. */
function readAllDirectoryEntries(
  reader: FileSystemDirectoryReader
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
          return;
        }
        all.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

async function collectFilesFromEntry(
  entry: FileSystemEntry,
  out: File[]
): Promise<void> {
  if (isFileEntry(entry)) {
    out.push(await fileFromEntry(entry));
    return;
  }
  if (isDirectoryEntry(entry)) {
    const entries = await readAllDirectoryEntries(entry.createReader());
    for (const child of entries) {
      await collectFilesFromEntry(child, out);
    }
  }
}

/**
 * 드롭된 항목에서 파일을 모은다.
 *
 * 폴더 재귀는 `webkitGetAsEntry` 로 하되, 지원하지 않는 브라우저에서는 파일만 조용히
 * 받는다 — 경고 문구 없이도 폴더 선택 입력(directory picker)이 대체 경로로 남아 있다.
 */
async function filesFromDataTransferItems(
  items: DataTransferItemList
): Promise<File[]> {
  const files: File[] = [];
  const tasks: Promise<void>[] = [];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind !== 'file') continue;

    const entry =
      typeof item.webkitGetAsEntry === 'function'
        ? item.webkitGetAsEntry()
        : null;

    if (entry) {
      tasks.push(collectFilesFromEntry(entry, files));
    } else {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }

  await Promise.all(tasks);
  return files;
}

interface DropzoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

export function Dropzone({ onFiles, disabled = false }: DropzoneProps) {
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (disabled) return;
    setDragActive(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    if (disabled) return;
    // 이벤트가 아니라 items 를 붙잡아 둔다 — 순회는 비동기라 이벤트 객체에 기대지 않는다.
    const items = e.dataTransfer.items;
    void filesFromDataTransferItems(items).then((files) => {
      if (files.length > 0) onFiles(files);
    });
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    e.target.value = ''; // 같은 파일을 다시 골라도 change 가 뜨도록 초기화
    if (!files || files.length === 0) return;
    onFiles(Array.from(files));
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
        dragActive
          ? 'border-primary bg-primary/5'
          : 'border-muted-foreground/30',
        disabled && 'pointer-events-none opacity-50'
      )}
    >
      <Upload className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        이미지 파일이나 폴더를 이 영역에 끌어다 놓으세요.
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          파일 선택
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => folderInputRef.current?.click()}
        >
          <Folder data-icon="inline-start" />
          폴더 선택
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={handleInputChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        hidden
        onChange={handleInputChange}
      />
    </div>
  );
}
