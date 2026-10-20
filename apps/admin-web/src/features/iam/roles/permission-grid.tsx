'use client';

import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  domainReadState,
  screensOpenedBy,
  type GridCell,
  type GridDomain,
  type GridRow,
} from '@/lib/auth/role-editor';

const COLUMNS = [
  ['read', '조회'],
  ['write', '작성'],
  ['delete', '삭제'],
  ['export', '내보내기'],
] as const;

function CellBox({
  cell,
  row,
  held,
  readOnly,
  onToggle,
}: {
  cell: GridCell;
  row: GridRow;
  held: ReadonlySet<string>;
  readOnly: boolean;
  onToggle: (key: string, on: boolean) => void;
}) {
  const checked = held.has(cell.key);
  // 폐기된 권한은 끌 수만 있다
  const blocked = readOnly || (cell.deprecated && !checked);
  const screens = screensOpenedBy(cell.key);
  return (
    <span className="inline-flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Checkbox
              checked={checked}
              aria-label={`${row.title} – ${cell.label}`}
              aria-disabled={blocked || undefined}
              onCheckedChange={
                blocked ? undefined : (v) => onToggle(cell.key, v === true)
              }
            />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="font-medium">{cell.label}</p>
          <p className="text-xs">{cell.description}</p>
          <p className="mt-1 font-mono text-[11px] opacity-80">{cell.key}</p>
          {screens.length > 0 && (
            <p className="mt-1 text-xs">여는 화면: {screens.join(', ')}</p>
          )}
        </TooltipContent>
      </Tooltip>
      {cell.dangerous && (
        <Badge variant="destructive" className="px-1 py-0 text-[10px]">
          위험
        </Badge>
      )}
      {cell.deprecated && (
        <Badge variant="secondary" className="px-1 py-0 text-[10px]">
          폐기됨
        </Badge>
      )}
    </span>
  );
}

/** 영역마다 fieldset — 행은 대상, 열은 조회·작성·삭제·내보내기와 특수 동작. 영역 «전체 조회»는 3상태 체크. */
export function PermissionGrid({
  domains,
  held,
  readOnly,
  query,
  onToggle,
  onToggleDomainReads,
}: {
  domains: readonly GridDomain[];
  held: ReadonlySet<string>;
  readOnly: boolean;
  query: string;
  onToggle: (key: string, on: boolean) => void;
  onToggleDomainReads: (domain: string, on: boolean) => void;
}) {
  const q = query.trim().toLowerCase();
  const matches = (row: GridRow) =>
    q === '' ||
    row.title.toLowerCase().includes(q) ||
    [...Object.values(row.cells), ...row.special].some(
      (c) =>
        c !== undefined &&
        (c.key.includes(q) || c.label.toLowerCase().includes(q))
    );

  const shown = domains
    .map((d) => ({ ...d, rows: d.rows.filter(matches) }))
    .filter((d) => d.rows.length > 0);
  if (shown.length === 0)
    return (
      <p className="py-6 text-sm text-muted-foreground">
        찾는 권한이 없습니다.
      </p>
    );

  return (
    <div className="space-y-6">
      {shown.map((d) => {
        const state = domainReadState(held, d.domain);
        return (
          <fieldset
            key={d.domain}
            id={`perm-${d.domain}`}
            className="scroll-mt-4 rounded-md border p-3"
          >
            <legend className="flex items-center gap-3 px-1 text-sm font-semibold">
              {d.title}
              <label className="flex items-center gap-1 text-xs font-normal">
                <Checkbox
                  checked={state}
                  aria-label={`${d.title} 전체 조회`}
                  aria-disabled={readOnly || undefined}
                  onCheckedChange={
                    readOnly
                      ? undefined
                      : () => onToggleDomainReads(d.domain, state !== true)
                  }
                />
                전체 조회
              </label>
            </legend>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1 font-normal">
                    대상
                  </th>
                  {COLUMNS.map(([, label]) => (
                    <th key={label} scope="col" className="py-1 font-normal">
                      {label}
                    </th>
                  ))}
                  <th scope="col" className="py-1 font-normal">
                    특수
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((row) => (
                  <tr
                    key={`${row.domain}.${row.target}`}
                    className="border-t align-top"
                  >
                    <th scope="row" className="py-2 pr-2 text-left font-normal">
                      {row.title}
                    </th>
                    {COLUMNS.map(([col]) => {
                      const cell = row.cells[col];
                      return (
                        <td key={col} className="py-2">
                          {cell ? (
                            <CellBox
                              cell={cell}
                              row={row}
                              held={held}
                              readOnly={readOnly}
                              onToggle={onToggle}
                            />
                          ) : (
                            <span className="text-muted-foreground" aria-hidden>
                              —
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="py-2">
                      <div className="flex flex-col gap-1">
                        {row.special.map((cell) => (
                          <span
                            key={cell.key}
                            className="inline-flex items-center gap-1"
                          >
                            <CellBox
                              cell={cell}
                              row={row}
                              held={held}
                              readOnly={readOnly}
                              onToggle={onToggle}
                            />
                            <span className="text-xs">{cell.label}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </fieldset>
        );
      })}
    </div>
  );
}
