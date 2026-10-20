'use client';

import { useState } from 'react';
import { createReactBlockSpec, useEditorChange } from '@blocknote/react';
import { collectHeadings, type LooseBlock } from './toc-headings';

export const TOC_BLOCK_TYPE = 'tableOfContents';

/** 노션의 「목차」 블록. 저장하는 값은 없고, 문서가 바뀔 때마다 지금 제목에서 다시 만든다. */
export const createTocBlockSpec = createReactBlockSpec(
  { type: TOC_BLOCK_TYPE, propSchema: {}, content: 'none' },
  {
    render: function TocBlock({ editor }) {
      // 스키마마다 블록 타입이 달라 공통 모양(id·type·props.level·content·children)으로만 읽는다
      const read = () =>
        collectHeadings(editor.document as unknown as LooseBlock[]);
      const [headings, setHeadings] = useState(read);

      useEditorChange(() => setHeadings(read()), editor);

      if (!headings.length) {
        return (
          <p className="text-sm text-slate-400" contentEditable={false}>
            제목을 추가하면 여기에 목차가 생겨요.
          </p>
        );
      }

      const minLevel = Math.min(...headings.map((entry) => entry.level));

      return (
        <nav
          aria-label="목차"
          contentEditable={false}
          className="w-full rounded-lg bg-slate-50 px-4 py-3"
        >
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500">
            목차
          </p>
          <ol className="space-y-0.5">
            {headings.map((entry) => (
              <li
                key={entry.id}
                style={{ paddingLeft: `${(entry.level - minLevel) * 16}px` }}
              >
                <button
                  type="button"
                  className="w-full truncate rounded px-1.5 py-1 text-left text-sm text-slate-700 underline-offset-2 hover:bg-slate-100 hover:underline"
                  onClick={() =>
                    document
                      .querySelector(
                        `[data-node-type="blockOuter"][data-id="${entry.id}"]`
                      )
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                >
                  {entry.text}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      );
    },
    toExternalHTML: () => <p>[목차]</p>,
  }
);
