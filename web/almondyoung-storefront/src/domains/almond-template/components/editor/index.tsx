"use client"

import {
  useAlmondEditor,
  type AlmondEditorProps,
} from "../../hooks/use-almond-editor"
import { Info } from "lucide-react"
import { Canvas } from "./canvas"
import { AuthDialog } from "./dialogs/auth-dialog"
import { HelpDialog } from "./dialogs/help-dialog"
import { IssuesDialog } from "./dialogs/issues-dialog"
import { LoadDialog } from "./dialogs/load-dialog"
import { PreviewDialog } from "./dialogs/preview-dialog"
import { SaveDialog } from "./dialogs/save-dialog"
import { TextDialog } from "./dialogs/text-dialog"
import { EditorHeader } from "./editor-header"
import { PropertyPanel } from "./property-panel"
import { StatusBar } from "./status-bar"
import { ToolNav } from "./tool-nav"
import { ToolPanel } from "./tool-panel"
import { FONT_STYLESHEET } from "../../lib/fonts"

export function AlmondTemplateEditor(props: AlmondEditorProps) {
  const editor = useAlmondEditor(props)
  const {
    message,
    toastId,
    saveDialog,
    loadDialog,
    setHelpOpen,
    helpOpen,
    textDialog,
    issues,
    preview,
  } = editor

  return (
    <div className="fixed inset-0 z-[10000] flex h-screen flex-col overflow-hidden bg-[#f5f5f4] text-slate-900">
      <link rel="stylesheet" href={FONT_STYLESHEET} precedence="default" />
      <EditorHeader editor={editor} />
      <div className="relative flex min-h-0 flex-1">
        <ToolNav editor={editor} />
        <ToolPanel editor={editor} />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <Canvas editor={editor} />
          <StatusBar editor={editor} />
        </main>
        <PropertyPanel editor={editor} />
      </div>
      {message && (
        <p
          key={toastId}
          role="status"
          className="animate-in fade-in slide-in-from-top-2 absolute top-20 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-2.5 rounded-xl border border-[#dcdee3] bg-white py-3 pr-5 pl-4 text-[15px] font-semibold text-[#1a1c20] shadow-[0_12px_32px_rgba(0,0,0,0.16)] duration-200"
        >
          <Info className="h-5 w-5 shrink-0 text-[#555d6d]" strokeWidth={2.4} />
          {message}
        </p>
      )}
      {saveDialog && <SaveDialog editor={editor} />}
      <AuthDialog editor={editor} />
      {loadDialog && <LoadDialog editor={editor} />}
      <button
        aria-label="편집 도움말"
        onClick={() => setHelpOpen(true)}
        className="absolute right-3 bottom-16 z-20 flex h-10 w-10 items-center justify-center rounded bg-[#303030] text-xl font-bold text-white shadow"
      >
        ?
      </button>
      {helpOpen && <HelpDialog editor={editor} />}
      {textDialog !== null && (
        <TextDialog editor={editor} textDialog={textDialog} />
      )}
      {issues.length > 0 && <IssuesDialog editor={editor} />}
      {preview && <PreviewDialog editor={editor} />}
    </div>
  )
}
