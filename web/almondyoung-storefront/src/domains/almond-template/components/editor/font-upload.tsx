import { Plus, X } from "lucide-react"
import { useEffect, useState, useSyncExternalStore, useTransition } from "react"
import {
  deleteAlmondFont,
  listAlmondFonts,
  presignAlmondFont,
  registerAlmondFont,
} from "@/lib/api/ugc/almond-fonts"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import {
  fontOptions,
  loadUploadedFont,
  setUploadedFonts,
  subscribeFontOptions,
  uploadedFontValue,
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

// 띄어쓰기·대소문자만 다른 이름은 같은 글꼴로 본다. 기본 글꼴과 이미 올린 글꼴을 모두 비교한다
const squash = (value: string) => value.replace(/\s+/g, "").toLowerCase()
const sameFont = (name: string) =>
  fontOptions().find(
    (font) =>
      squash(font.label) === squash(name) ||
      squash(font.value.match(/'([^']+)'/)?.[1] ?? "") === squash(name)
  )?.label

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
    if (!file || !name.trim() || !licensed || sameFont(name)) return
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

  const duplicate = name.trim() ? sameFont(name) : undefined
  // 목록의 이름을 그 글꼴로 그려 보이려면 파일을 받아 둬야 한다
  useEffect(() => {
    fonts.forEach((font) =>
      loadUploadedFont(uploadedFontValue(font.family))?.catch(() => undefined)
    )
  }, [fonts])

  return (
    <section className="mt-[25px] border-t border-[#e6e7ea] pt-5">
      <h3 className="mb-5 text-[15px] text-[#20232A]">올린 글꼴</h3>
      {file ? (
        <div className="space-y-[15px] rounded-[7px] bg-[#f6f7f9] px-[15px] py-5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[15px] text-[#20232A]">
              {file.name}
            </span>
            <span className="shrink-0 text-[13px] text-[#70777F]">
              {(file.size / 1024 / 1024).toFixed(1)}MB
            </span>
            <button
              type="button"
              aria-label="고른 글꼴 파일 취소"
              disabled={pending}
              onClick={() => setFile(null)}
              className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[#70777F] hover:bg-[#e2e7ed]"
            >
              <X size={16} />
            </button>
          </div>
          {file.size > HEAVY_FONT_BYTES && (
            <p className="text-[13px] leading-[21px] text-[#70777F]">
              큰 파일이라 고객 화면이 늦게 뜰 수 있습니다. WOFF2 로 바꾸면 보통
              절반 이하로 줄어듭니다.
            </p>
          )}
          <label className="block">
            <span className="text-[13px] text-[#70777F]">목록에 보일 이름</span>
            <input
              value={name}
              maxLength={60}
              aria-invalid={!!duplicate}
              onChange={(event) => setName(event.target.value)}
              className={`mt-[5px] h-[38px] w-full rounded-[6px] border bg-white px-[10px] text-[14px] text-[#3F4250] outline-none ${duplicate ? "border-[#FE6767]" : "border-[#e0e1e5]"}`}
            />
            {duplicate && (
              <span className="mt-[5px] block text-[13px] text-[#FE6767]">
                이미 있는 글꼴입니다. ({duplicate})
              </span>
            )}
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-[13px] leading-[21px] text-[#3F4250]">
            <input
              type="checkbox"
              className="mt-0.5 size-[18px] shrink-0 accent-[#fede29]"
              checked={licensed}
              onChange={(event) => setLicensed(event.target.checked)}
            />
            상업적 이용·웹 임베딩이 허용된 글꼴임을 라이선스에서 확인했습니다.
          </label>
          <button
            type="button"
            className="h-9 w-full rounded-[6px] bg-[#fede29] text-[14px] font-medium text-[#20232A] disabled:cursor-not-allowed disabled:bg-[#E2E7ED] disabled:text-[#AAACB0]"
            disabled={pending || !licensed || !name.trim() || !!duplicate}
            onClick={upload}
          >
            {pending ? "올리는 중…" : "글꼴 올리기"}
          </button>
        </div>
      ) : (
        <label
          className="flex h-[42px] cursor-pointer items-center justify-center gap-1 rounded-[7px] border border-[#d0d4d7] text-[14px] text-[#3F4250] transition-[border] duration-[120ms] ease-in-out hover:border-[#70777F]"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            pick(event.dataTransfer.files[0])
          }}
        >
          <Plus size={16} />내 PC 글꼴 불러오기
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
      )}
      {!file && (
        <p className="mt-2 text-[13px] text-[#AAACB0]">
          TTF·OTF·WOFF·WOFF2, 50MB까지. 파일을 여기로 끌어 놓아도 됩니다.
        </p>
      )}
      {fonts.length > 0 && (
        <ul className="mt-5 space-y-[10px]">
          {fonts.map((font) => (
            <li
              key={font.id}
              className="group/font flex h-[42px] items-center gap-2 rounded-[7px] bg-[#F6F7F9] pr-[7px] pl-3"
            >
              <span
                className="min-w-0 flex-1 truncate text-[16px] text-[#20232A]"
                style={{ fontFamily: uploadedFontValue(font.family) }}
              >
                {font.name}
              </span>
              <button
                type="button"
                aria-label={`${font.name} 목록에서 빼기`}
                title="목록에서 빼기"
                disabled={pending}
                onClick={() => remove(font.id, font.name)}
                className="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-[#70777F] opacity-0 group-hover/font:opacity-100 hover:bg-[#e2e7ed] focus-visible:opacity-100 disabled:opacity-40"
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
