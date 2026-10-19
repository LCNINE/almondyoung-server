import { X } from "lucide-react"
import { useState, useSyncExternalStore, useTransition } from "react"
import {
  deleteAlmondFont,
  listAlmondFonts,
  presignAlmondFont,
  registerAlmondFont,
} from "@/lib/api/ugc/almond-fonts"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import {
  setUploadedFonts,
  subscribeFontOptions,
  uploadedFonts,
} from "../../lib/fonts"

const FONT_TYPES: Record<string, string> = {
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
}
const MAX_FONT_BYTES = 50 * 1024 * 1024
const HEAVY_FONT_BYTES = 15 * 1024 * 1024

const refresh = () => listAlmondFonts().then(setUploadedFonts)

// 시안 디자이너만 쓴다. 올린 글꼴은 고객 브라우저로도 내려가므로 웹 임베딩 허용까지 확인받는다
export function FontUpload({ editor }: { editor: AlmondEditor }) {
  const { runAuthed, setMessage } = editor
  const fonts = useSyncExternalStore(
    subscribeFontOptions,
    uploadedFonts,
    uploadedFonts
  )
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState("")
  const [licensed, setLicensed] = useState(false)
  const [pending, startTransition] = useTransition()
  const extension = file?.name.split(".").pop()?.toLowerCase() ?? ""

  const pick = (picked: File | undefined) => {
    if (!picked) return
    if (!FONT_TYPES[picked.name.split(".").pop()?.toLowerCase() ?? ""])
      return setMessage("TTF·OTF·WOFF·WOFF2 글꼴만 올릴 수 있습니다.")
    if (picked.size > MAX_FONT_BYTES)
      return setMessage("글꼴 파일은 50MB까지 올릴 수 있습니다.")
    setFile(picked)
    setName(picked.name.replace(/\.[^.]+$/, "").slice(0, 60))
    setLicensed(false)
  }

  const upload = () => {
    if (!file || !name.trim() || !licensed) return
    startTransition(() =>
      runAuthed(async () => {
        const presigned = await presignAlmondFont({
          fileName: file.name,
          size: file.size,
          mimeType: FONT_TYPES[extension],
        })
        if ("error" in presigned) return setMessage(presigned.error)
        const put = await fetch(presigned.uploadUrl, {
          method: "PUT",
          headers: presigned.headers,
          body: file,
        })
        if (!put.ok) throw new Error(`글꼴 업로드 실패 (${put.status})`)
        const font = await registerAlmondFont({
          fileId: presigned.fileId,
          name: name.trim(),
        })
        if ("error" in font) return setMessage(font.error)
        await refresh()
        setFile(null)
        setMessage(
          `"${font.name}" 글꼴을 올렸습니다. 폰트 목록에서 고를 수 있습니다.`
        )
      }, "글꼴을 올리지 못했습니다.")
    )
  }

  const remove = (id: string, label: string) => {
    if (
      !window.confirm(
        `"${label}" 을(를) 글꼴 목록에서 뺄까요? 이미 이 글꼴을 쓴 시안은 그대로 보이고 인쇄됩니다.`
      )
    )
      return
    startTransition(() =>
      runAuthed(async () => {
        await deleteAlmondFont(id)
        await refresh()
      }, "글꼴을 빼지 못했습니다.")
    )
  }

  return (
    <section className="text-sm">
      <h3 className="mt-5 mb-3 border-b pb-2 text-sm font-semibold">
        올린 글꼴
      </h3>
      {file ? (
        <div className="space-y-2 border p-3">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">
              {file.name}
            </span>
            <span className="shrink-0 text-xs text-slate-500">
              {(file.size / 1024 / 1024).toFixed(1)}MB
            </span>
            <button
              type="button"
              aria-label="고른 글꼴 파일 취소"
              disabled={pending}
              onClick={() => setFile(null)}
              className="flex size-5 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
            >
              <X size={14} />
            </button>
          </div>
          {file.size > HEAVY_FONT_BYTES && (
            <p className="text-xs leading-5 text-slate-500">
              큰 파일이라 고객 화면이 늦게 뜰 수 있습니다. WOFF2 로 바꾸면 보통
              절반 이하로 줄어듭니다.
            </p>
          )}
          <label className="block text-xs text-slate-600">
            목록에 보일 이름
            <input
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full border p-1.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-xs leading-5 text-slate-600">
            <input
              type="checkbox"
              className="mt-1"
              checked={licensed}
              onChange={(event) => setLicensed(event.target.checked)}
            />
            상업적 이용·웹 임베딩이 허용된 글꼴임을 라이선스에서 확인했습니다.
          </label>
          <button
            className="w-full bg-[#303030] py-2 text-white disabled:opacity-40"
            disabled={pending || !licensed || !name.trim()}
            onClick={upload}
          >
            {pending ? "올리는 중…" : "글꼴 올리기"}
          </button>
        </div>
      ) : (
        <>
          <label
            className="block cursor-pointer border py-2 text-center hover:bg-slate-50"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              pick(event.dataTransfer.files[0])
            }}
          >
            + 내 PC 글꼴 불러오기
            <input
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              hidden
              onChange={(event) => {
                pick(event.target.files?.[0])
                event.target.value = ""
              }}
            />
          </label>
          <p className="mt-1.5 text-xs text-slate-400">
            TTF·OTF·WOFF·WOFF2, 50MB까지
          </p>
        </>
      )}
      {fonts.length > 0 && (
        <ul className="mt-3">
          {fonts.map((font) => (
            <li
              key={font.id}
              className="flex items-center gap-2 border-b py-2 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate">{font.name}</span>
              <button
                type="button"
                aria-label={`${font.name} 목록에서 빼기`}
                title="목록에서 빼기"
                disabled={pending}
                onClick={() => remove(font.id, font.name)}
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
