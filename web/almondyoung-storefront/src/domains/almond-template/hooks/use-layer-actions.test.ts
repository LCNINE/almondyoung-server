// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { newDesign, type Layer } from "../lib/document"
import { makeLayer } from "../lib/layer"
import { rasterMergedLayer } from "../lib/merge-layers"
import { useDesignHistory } from "./use-design-history"
import { useLayerActions } from "./use-layer-actions"

vi.mock("../lib/merge-layers", async (original) => ({
  ...(await original<typeof import("../lib/merge-layers")>()),
  rasterMergedLayer: vi.fn(),
}))
vi.mock("./use-auth-retry", () => ({ reportFailure: vi.fn() }))

let root: Root
let history: ReturnType<typeof useDesignHistory>
let actions: ReturnType<typeof useLayerActions>
let finish: (layer: Layer) => void
let side: "front" | "back"
let front: Layer[]
const setSelectedId = vi.fn()
const setMessage = vi.fn()
const design = newDesign("card")
const lower = {
  ...makeLayer("image", design),
  name: "아래",
  image: "data:image/png;base64,AA==",
}
const upper = { ...makeLayer("rect", design), name: "위" }
const merged = {
  ...makeLayer("image", design),
  image: "data:image/png;base64,AA==",
  pixelWidth: 600,
  pixelHeight: 600,
}

function Harness() {
  history = useDesignHistory(() => ({ ...design, front }))
  actions = useLayerActions({
    design: history.design,
    change: history.change,
    side,
    layers: history.design[side],
    selected: upper,
    mode: "designer",
    productId: "",
    size: "",
    setSelectedId,
    setMessage,
    group: [],
    setGroupIds: vi.fn(),
  })

  return null
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  side = "front"
  front = [lower, upper]
  vi.mocked(rasterMergedLayer).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  root = createRoot(document.createElement("div"))
  await act(async () => root.render(createElement(Harness)))
})

afterEach(async () => {
  await act(async () => root.unmount())
  vi.unstubAllGlobals()
})

it("한 번의 병합을 한 번에 실행 취소·다시 실행한다", async () => {
  await act(async () => {
    const pending = actions.mergeDown(upper.id)
    finish(merged)
    await pending
  })

  expect(history.design.front).toEqual([merged])
  expect(history.history).toHaveLength(1)
  expect(setSelectedId).toHaveBeenCalledWith(merged.id)
  await act(async () => history.undo())
  expect(history.design.front).toEqual([lower, upper])
  await act(async () => history.redo())
  expect(history.design.front).toEqual([merged])
})

it.each(["edit", "side"])(
  "처리 중 %s 변경이 있으면 원래 시안으로 덮어쓰지 않는다",
  async (operation) => {
    let pending: Promise<void>
    await act(async () => {
      pending = actions.mergeDown(upper.id)
    })
    await act(async () => {
      if (operation === "edit") {
        history.change({ ...history.design, title: "새 제목" })
      } else {
        side = "back"
        root.render(createElement(Harness))
      }
    })
    await act(async () => {
      finish(merged)
      await pending
    })

    expect(history.design.front).toEqual([lower, upper])
    expect(history.history).toHaveLength(operation === "edit" ? 1 : 0)
    expect(setSelectedId).not.toHaveBeenCalled()
    expect(setMessage).toHaveBeenCalledWith(expect.stringContaining("취소"))
  }
)

it("연속 클릭을 무시하고 실패하면 히스토리와 레이어를 보존한다", async () => {
  let reject!: (reason: Error) => void
  vi.mocked(rasterMergedLayer).mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail
      })
  )
  await act(async () => {
    const pending = actions.mergeDown(upper.id)
    await actions.mergeDown(upper.id)
    reject(new Error("이미지 실패"))
    await pending
  })

  expect(rasterMergedLayer).toHaveBeenCalledTimes(1)
  expect(history.design.front).toEqual([lower, upper])
  expect(history.history).toHaveLength(0)
  expect(actions.mergeDownReason(upper.id)).toBe("")
})

it("도형끼리는 그림으로 굽지 않고 그룹으로 묶는다", async () => {
  const shape = { ...makeLayer("ellipse", design), name: "원" }
  front = [shape, upper]
  await act(async () => root.unmount())
  root = createRoot(document.createElement("div"))
  await act(async () => root.render(createElement(Harness)))
  await act(async () => actions.mergeDown(upper.id))

  const [a, b] = history.design.front
  expect(rasterMergedLayer).not.toHaveBeenCalled()
  expect(a).toMatchObject({ id: shape.id, type: "ellipse" })
  expect(b).toMatchObject({ id: upper.id, type: "rect" })
  expect(a.groupId).toBeTruthy()
  expect(b.groupId).toBe(a.groupId)
})
