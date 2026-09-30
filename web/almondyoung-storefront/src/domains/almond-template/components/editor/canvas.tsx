import { LayerGraphic } from "../graphic"
import type { AlmondEditor } from "../../hooks/use-almond-editor"
import { CanvasGuides } from "./canvas-guides"
import { imageSrc } from "../../lib/image-ref"

export function Canvas({ editor }: { editor: AlmondEditor }) {
  const {
    mode,
    design,
    side,
    setSelectedId,
    showRuler,
    showCutline,
    showSafety,
    layers,
    selected,
    spec,
    selectedLowDpi,
    selectedPrintWarning,
    zoom,
    svgRef,
    canvasAreaRef,
    startDrag,
    startResize,
    moveDrag,
    endDrag,
    canvasFit,
    handleSize,
  } = editor
  return (
    <div
      ref={canvasAreaRef}
      className="flex flex-1 items-center justify-center overflow-auto p-8"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setSelectedId(null)
      }}
    >
      <div className="relative shrink-0">
        <svg
          ref={svgRef}
          role="img"
          aria-label={`${spec.label} ${side === "front" ? "앞면" : "뒷면"} 디자인`}
          viewBox={`0 0 ${design.widthMm} ${design.heightMm}`}
          style={{
            width: `${design.widthMm * canvasFit * zoom}px`,
            height: `${design.heightMm * canvasFit * zoom}px`,
            overflow: "visible",
          }}
          className="block shrink-0 touch-none bg-white shadow-xl outline outline-1 outline-offset-2 outline-[#222]"
          onPointerDown={() => setSelectedId(null)}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <defs>
            <clipPath id="almond-print-area">
              <rect width={design.widthMm} height={design.heightMm} />
            </clipPath>
          </defs>
          <rect width="100%" height="100%" fill={design.background} />
          {design.backgroundImage && (
            <image
              href={imageSrc(design.backgroundImage)}
              width="100%"
              height="100%"
              preserveAspectRatio="xMidYMid slice"
            />
          )}
          <g clipPath="url(#almond-print-area)">
            {layers.map((layer) =>
              layer.visible === false ? null : (
                <g
                  key={layer.id}
                  onPointerDown={(event) => startDrag(event, layer)}
                  className={
                    layer.locked ||
                    (mode === "customer" && layer.editable === false)
                      ? "cursor-default"
                      : "cursor-move"
                  }
                >
                  <LayerGraphic layer={layer} />
                  <rect
                    x={layer.x}
                    y={layer.y}
                    width={layer.width}
                    height={layer.height}
                    fill="transparent"
                  />
                </g>
              )
            )}
          </g>
          {selected && selected.visible !== false && (
            <g
              id="selection-outline"
              transform={`translate(${selected.x + selected.width / 2} ${selected.y + selected.height / 2}) rotate(${selected.rotation ?? 0}) scale(${selected.flipX ? -1 : 1} ${selected.flipY ? -1 : 1}) translate(${-selected.x - selected.width / 2} ${-selected.y - selected.height / 2})`}
            >
              <rect
                x={selected.x}
                y={selected.y}
                width={selected.width}
                height={selected.height}
                fill="none"
                stroke="#10c9c1"
                strokeWidth={1 / (canvasFit * zoom)}
                pointerEvents="none"
              />
              {(
                [
                  ["nw", 0, 0],
                  ["n", 0.5, 0],
                  ["ne", 1, 0],
                  ["e", 1, 0.5],
                  ["se", 1, 1],
                  ["s", 0.5, 1],
                  ["sw", 0, 1],
                  ["w", 0, 0.5],
                ] as const
              ).map(([handle, rx, ry]) => (
                <rect
                  key={handle}
                  role="button"
                  aria-label={`${handle} 크기 조절`}
                  x={selected.x + selected.width * rx - handleSize / 2}
                  y={selected.y + selected.height * ry - handleSize / 2}
                  width={handleSize}
                  height={handleSize}
                  fill="white"
                  stroke="#10c9c1"
                  strokeWidth={1 / (canvasFit * zoom)}
                  className="cursor-pointer"
                  onPointerDown={(event) =>
                    startResize(event, selected, handle)
                  }
                />
              ))}
              <line
                x1={selected.x + selected.width / 2}
                y1={selected.y}
                x2={selected.x + selected.width / 2}
                y2={selected.y - handleSize * 2}
                stroke="#10c9c1"
                strokeWidth={1 / (canvasFit * zoom)}
                pointerEvents="none"
              />
              <circle
                role="button"
                aria-label="요소 회전"
                cx={selected.x + selected.width / 2}
                cy={selected.y - handleSize * 2}
                r={handleSize / 2}
                fill="white"
                stroke="#10c9c1"
                strokeWidth={1 / (canvasFit * zoom)}
                className="cursor-grab"
                onPointerDown={(event) =>
                  startResize(event, selected, "rotate")
                }
              />
            </g>
          )}
          {(showRuler || showCutline || showSafety) && (
            <CanvasGuides editor={editor} />
          )}
        </svg>
        {selected && selectedPrintWarning && (
          <div
            role="status"
            title={
              selectedLowDpi
                ? "사진을 현재 크기로 인쇄하기에는 해상도가 낮습니다."
                : "인쇄 영역 밖의 부분은 출력되지 않습니다."
            }
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 bg-white px-2 py-1 text-xs font-semibold text-red-600 shadow"
            style={{
              left: `${Math.max(0, Math.min(design.widthMm, selected.x + selected.width / 2)) * canvasFit * zoom}px`,
              top: `${Math.max(0, Math.min(design.heightMm, selected.y + selected.height / 2)) * canvasFit * zoom}px`,
            }}
          >
            ⚠ 인쇄 비권장
          </div>
        )}
        <div
          aria-label="인쇄 안내선 범례"
          className="absolute top-0 left-full ml-3 w-24 space-y-2 bg-[#f5f5f4] text-sm"
        >
          <div className="border-b-2 border-[#222] pb-1">작업선</div>
          {showCutline && (
            <div className="border-b-2 border-[#f03838] pb-1 text-[#e32727]">
              재단선
            </div>
          )}
          {showSafety && (
            <div className="border-b-2 border-[#31b991] pb-1 text-[#16a77c]">
              안전선
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
