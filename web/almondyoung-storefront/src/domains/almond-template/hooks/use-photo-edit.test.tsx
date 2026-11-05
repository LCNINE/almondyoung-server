// @vitest-environment jsdom
import { act, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { newDesign, type Layer } from "../lib/document"
import { photoBox } from "../components/graphic"
import { Canvas } from "../components/editor/canvas"
import { FrameOptions } from "../components/editor/frame-options"
import { ObjectProperties } from "../components/editor/object-properties"
import { useAlmondEditor, type AlmondEditor } from "./use-almond-editor"
import { usePropertyPanel } from "./use-property-panel"
import { svgMarkup } from "./use-template-export"

vi.mock("./use-auth-retry", () => ({ useAuthRetry: () => ({}) }))
vi.mock("./use-template-storage", () => ({ useTemplateStorage: () => ({}) }))
vi.mock("./use-design-order", () => ({ useDesignOrder: () => ({}) }))

const frame: Layer = {
  id: "photo",
  name: "사진 틀",
  type: "frame",
  x: 10,
  y: 10,
  width: 20,
  height: 20,
  fill: "#ffffff",
  image: "data:image/png;base64,AA==",
  pixelWidth: 2000,
  pixelHeight: 1000,
  imageScale: 2,
}

let root: Root
let host: HTMLDivElement
let editor: AlmondEditor

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function mount(layer: Layer = frame) {
  const design = newDesign("card")
  design.front = [
    layer,
    { ...frame, id: "other", x: 50, groupId: layer.groupId },
  ]

  function Harness() {
    editor = useAlmondEditor({ initialDesign: design })
    const panel = usePropertyPanel(editor)
    const input = useRef<HTMLInputElement>(null)

    return (
      <>
        <Canvas editor={editor} />
        {editor.selected &&
          (editor.selected.type === "frame" ? (
            <FrameOptions
              editor={editor}
              panel={panel}
              selected={editor.selected}
              selectedImageInputRef={input}
            />
          ) : (
            <ObjectProperties
              editor={editor}
              panel={panel}
              selected={editor.selected}
            />
          ))}
      </>
    )
  }

  await act(async () => root.render(<Harness />))
  await act(async () => editor.setSelectedId(layer.id))
  editor.svgRef.current!.setPointerCapture = () => {}
  vi.spyOn(editor.svgRef.current!, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: design.widthMm * 2,
    height: design.heightMm * 2,
  } as DOMRect)
}

async function click(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find(
    (item) => item.textContent === label
  )
  expect(button).toBeDefined()

  await act(async () => button!.click())
}

async function pointer(target: Element, type: string, x = 0, y = 0) {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })
    )
  })
}

async function scaleFrame(value: number) {
  const slider = Array.from(
    host.querySelectorAll<HTMLInputElement>('input[type="range"]')
  ).find((input) => input.parentElement?.textContent?.trim() === "확대")!

  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(slider, String(value))
    slider.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("사진 수정 모드", () => {
  it.each(["frame", "rect"] as const)(
    "%s 패널에서 시작·완료하고 위치 슬라이더를 대신한다",
    async (type) => {
      await mount({ ...frame, type })
      expect(host.textContent).not.toContain("가로 위치")
      expect(host.textContent).not.toContain("세로 위치")
      expect(host.textContent).toContain("확대")
      await click("사진 수정")
      expect(editor.photoEditId).toBe(frame.id)
      expect(host.textContent).toContain(
        "사진을 끌어서 위치를 옮기세요. 더 옮기려면 확대를 올리세요."
      )
      expect(host.querySelector('[aria-label="요소 회전"]')).toBeNull()
      await click("완료")
      expect(editor.photoEditId).toBeNull()
    }
  )

  it("그룹 사진도 틀은 고정하고 드래그 한 번을 undo 한 단계로 기록한다", async () => {
    await mount({ ...frame, groupId: "group", rotation: 90, flipX: true })
    const before = editor.design

    await click("사진 수정")
    const svg = editor.svgRef.current!
    const target = host.querySelector(
      '#selection-outline rect[fill="transparent"]'
    )!

    await pointer(target, "pointerdown", 40, 40)
    await pointer(svg, "pointermove", 45, 25)
    await pointer(svg, "pointermove", 50, 10)
    expect(editor.history).toHaveLength(0)
    await pointer(svg, "pointerup", 50, 10)
    expect(editor.selected).toMatchObject({
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      rotation: 90,
      imageOffsetX: 0.25,
      imageOffsetY: 0.75,
    })
    expect(editor.design.front).toHaveLength(2)
    expect(editor.history).toHaveLength(1)
    await act(async () => editor.undo())
    expect(editor.design).toEqual(before)
    await act(async () => editor.redo())
    expect(editor.selected?.imageOffsetX).toBeCloseTo(0.25)
    expect(editor.selected?.imageOffsetY).toBeCloseTo(0.75)
  })

  it("Esc와 다른 레이어 선택, 캔버스 빈 곳 클릭으로 종료한다", async () => {
    await mount()
    await click("사진 수정")
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    )
    expect(editor.photoEditId).toBeNull()
    await click("사진 수정")
    await act(async () => editor.setSelectedId("other"))
    expect(editor.photoEditId).toBeNull()
    await click("사진 수정")
    await pointer(editor.svgRef.current!, "pointerdown")
    await pointer(editor.svgRef.current!, "pointerup")
    expect(editor.photoEditId).toBeNull()
  })

  it("드래그 중 Esc로 끝내도 한 번만 기록하고 이후 이동은 무시한다", async () => {
    await mount()
    await click("사진 수정")
    const svg = editor.svgRef.current!
    const target = host.querySelector(
      '#selection-outline rect[fill="transparent"]'
    )!

    await pointer(target, "pointerdown", 40, 40)
    await pointer(svg, "pointermove", 70, 30)
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    )
    await pointer(svg, "pointermove", 100, 100)
    await pointer(svg, "pointerup")
    expect(editor.history).toHaveLength(1)
    expect(editor.selected?.imageOffsetX).toBeCloseTo(0.25)
    await act(async () => editor.undo())
    expect(editor.selected).toEqual(frame)
  })

  it("확대·이동해도 프레임의 자르기 영역은 레이어 상자에 고정한다", async () => {
    await mount({ ...frame, imageOffsetMode: "cover" })
    await click("사진 수정")
    const clip = host.querySelector(
      '[clip-path="url(#almond-print-area)"] #clip-photo'
    )!

    expect(clip.getAttribute("clipPathUnits")).toBe("userSpaceOnUse")
    expect(clip.getAttribute("transform")).toBe("translate(10 10) scale(20 20)")
    await act(async () =>
      editor.patch(frame.id, {
        imageScale: 3,
        imageOffsetX: 0,
        imageOffsetY: 1,
      })
    )
    expect(clip.getAttribute("transform")).toBe("translate(10 10) scale(20 20)")
  })

  it("인쇄 직렬화는 편집 표시를 제외하고 사진 위치를 유지한다", async () => {
    await mount()
    await click("사진 수정")
    const editing = svgMarkup(editor.svgRef.current!, editor.design)
    expect(
      host.querySelector('#selection-outline image[opacity="0.3"]')
    ).not.toBeNull()
    await click("완료")
    expect(svgMarkup(editor.svgRef.current!, editor.design)).toBe(editing)
  })

  it.each([{ locked: true }, { editable: false }])(
    "수정할 수 없는 사진은 모드에 들어가지 않는다: %o",
    async (restriction) => {
      await mount({ ...frame, ...restriction })
      await act(async () => editor.startPhotoEdit())
      expect(editor.photoEditId).toBeNull()
      const button = Array.from(host.querySelectorAll("button")).find(
        (item) => item.textContent === "사진 수정"
      )
      expect(button?.disabled).toBe(true)
    }
  )
})

describe("사진 수정 회귀", () => {
  it("잘라낸 사진을 자동담기로 프레임으로 바꿔도 실제 사진이 이동한다", async () => {
    await mount({
      ...frame,
      type: "image",
      imageScale: 1,
      crop: { x: 0.25, y: 0, w: 0.5, h: 1 },
    })
    await act(async () => editor.fillFrames())
    expect(editor.selected?.type).toBe("frame")

    const before = editor.design
    const box = photoBox(editor.selected!)
    await click("사진 수정")
    const target = host.querySelector(
      '#selection-outline rect[fill="transparent"]'
    )!

    await pointer(target, "pointerdown", 40, 40)
    await pointer(editor.svgRef.current!, "pointermove", 50, 40)
    await pointer(editor.svgRef.current!, "pointerup", 50, 40)
    expect(photoBox(editor.selected!).x).toBeCloseTo(box.x + 5)
    expect(editor.selected).toMatchObject({
      x: 10,
      y: 10,
      width: 20,
      height: 20,
    })
    expect(editor.history).toHaveLength(2)

    await act(async () => editor.undo())
    expect(editor.design).toEqual(before)
  })

  it("진입 전 상태까지 undo한 뒤에도 같은 편집 모드에서 드래그한다", async () => {
    await mount({ ...frame, type: "rect", imageScale: 1 })
    await act(async () => editor.patch(frame.id, { name: "이름 변경" }))
    await click("사진 수정")
    await act(async () => editor.undo())
    expect(editor.photoEditId).toBe(frame.id)
    const before = editor.design
    const target = host.querySelector(
      '#selection-outline rect[fill="transparent"]'
    )!

    await pointer(target, "pointerdown", 40, 40)
    await pointer(editor.svgRef.current!, "pointermove", 50, 40)
    await pointer(editor.svgRef.current!, "pointerup", 50, 40)
    expect(editor.selected?.imageOffsetX).toBeCloseTo(0.25)
    expect(editor.history).toHaveLength(1)
    const moved = editor.design

    await act(async () => editor.undo())
    expect(editor.design).toEqual(before)
    await act(async () => editor.redo())
    expect(editor.design).toEqual(moved)
  })

  it.each(["완료", "Escape"])(
    "옛 프레임은 진입·클릭·%s 종료만으로 문서나 출력이 바뀌지 않는다",
    async (exit) => {
      await mount()
      const before = editor.design
      const svg = editor.svgRef.current!
      const markup = svgMarkup(svg, before)
      await click("사진 수정")
      expect(editor.design).toEqual(before)
      expect(svgMarkup(svg, editor.design)).toBe(markup)
      const target = host.querySelector(
        '#selection-outline rect[fill="transparent"]'
      )!

      await pointer(target, "pointerdown", 40, 40)
      await pointer(svg, "pointermove", 40.1, 40)
      await pointer(svg, "pointerup", 40.1, 40)
      if (exit === "완료") {
        await click(exit)
      } else {
        await act(async () =>
          window.dispatchEvent(new KeyboardEvent("keydown", { key: exit }))
        )
      }

      expect(editor.design).toEqual(before)
      expect(svgMarkup(svg, editor.design)).toBe(markup)
      expect(editor.history).toHaveLength(0)
    }
  )

  it("옛 프레임의 clip 전환을 첫 드래그와 같은 undo 단계로 복원한다", async () => {
    await mount()
    const before = editor.design
    const svg = editor.svgRef.current!
    const markup = svgMarkup(svg, before)
    await click("사진 수정")
    const target = host.querySelector(
      '#selection-outline rect[fill="transparent"]'
    )!

    await pointer(target, "pointerdown", 40, 40)
    await pointer(svg, "pointermove", 50, 40)
    await pointer(svg, "pointermove", 70, 30)
    await pointer(svg, "pointerup", 70, 30)
    expect(editor.selected?.imageOffsetMode).toBe("cover")
    expect(editor.selected?.imageOffsetX).toBeCloseTo(0.25)
    expect(editor.history).toHaveLength(1)
    const movedMarkup = svgMarkup(svg, editor.design)

    await act(async () => editor.undo())
    expect(editor.design).toEqual(before)
    expect(svgMarkup(svg, editor.design)).toBe(markup)
    await act(async () => editor.redo())
    expect(svgMarkup(svg, editor.design)).toBe(movedMarkup)
  })
})

it("crop 프레임의 확대 슬라이더도 실제 사진 크기를 바꾸고 undo한다", async () => {
  await mount({
    ...frame,
    imageScale: 1,
    crop: { x: 0.25, y: 0, w: 0.5, h: 1 },
  })
  await click("사진 수정")
  const before = editor.design
  const box = photoBox(editor.selected!)
  await scaleFrame(2)

  expect(photoBox(editor.selected!).width).toBeCloseTo(box.width * 2)
  expect(photoBox(editor.selected!).height).toBeCloseTo(box.height * 2)
  expect(editor.history).toHaveLength(1)
  await act(async () => editor.undo())
  expect(editor.design).toEqual(before)
})

describe.each([
  { name: "일반", crop: undefined },
  { name: "crop", crop: { x: 0.25, y: 0, w: 0.5, h: 1 } },
])("옛 $name 프레임 확대 회귀", ({ crop }) => {
  it.each([
    { editing: true, sequence: "진입 → 확대 → 드래그" },
    { editing: false, sequence: "진입 없이 확대" },
  ])(
    "$sequence: 인쇄 경계를 고정하고 undo로 원본을 복원한다",
    async ({ editing }) => {
      await mount({ ...frame, imageScale: 1, crop })
      const before = editor.design
      const svg = editor.svgRef.current!
      const beforeMarkup = svgMarkup(svg, before)

      if (editing) await click("사진 수정")

      await scaleFrame(2)
      const scaled = editor.design
      const scaledBox = photoBox(editor.selected!)
      const scaledMarkup = svgMarkup(svg, scaled)
      const clip = svg.querySelector(
        '[clip-path="url(#almond-print-area)"] #clip-photo'
      )!

      expect(clip.getAttribute("clipPathUnits")).toBe("userSpaceOnUse")
      expect(clip.getAttribute("transform")).toBe(
        "translate(10 10) scale(20 20)"
      )
      expect(scaledBox).toMatchObject({ x: -20, y: 0, width: 80, height: 40 })
      expect(editor.selected).toMatchObject({
        x: 10,
        y: 10,
        width: 20,
        height: 20,
      })
      expect(editor.history).toHaveLength(1)

      if (editing) {
        const target = host.querySelector(
          '#selection-outline rect[fill="transparent"]'
        )!

        await pointer(target, "pointerdown", 40, 40)
        await pointer(svg, "pointermove", 50, 40)
        await pointer(svg, "pointerup", 50, 40)
        expect(photoBox(editor.selected!).x).toBeCloseTo(scaledBox.x + 5)
        expect(clip.getAttribute("clipPathUnits")).toBe("userSpaceOnUse")
        expect(clip.getAttribute("transform")).toBe(
          "translate(10 10) scale(20 20)"
        )
        expect(editor.selected).toMatchObject({
          x: 10,
          y: 10,
          width: 20,
          height: 20,
        })
        expect(editor.history).toHaveLength(2)

        await act(async () => editor.undo())
        expect(editor.design).toEqual(scaled)
        expect(svgMarkup(svg, editor.design)).toBe(scaledMarkup)
        await click("완료")
      } else {
        expect(editor.photoEditId).toBeNull()
      }

      await act(async () => editor.undo())
      expect(editor.design).toEqual(before)
      expect(svgMarkup(svg, editor.design)).toBe(beforeMarkup)
      await act(async () => editor.redo())
      expect(editor.design).toEqual(scaled)
      expect(svgMarkup(svg, editor.design)).toBe(scaledMarkup)
    }
  )
})
