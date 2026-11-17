// 노이즈를 R 채널 기준 불투명 회색으로 바꾼다. 노이즈 알파가 섞이면 arithmetic 합성에서 밝기가 틀어진다
const MONO = "1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1"

// 0.1+0.2 같은 부동소수 꼬리가 SVG 에 그대로 찍히지 않게 자른다
const round = (value: number) => Math.round(value * 10000) / 10000

function Noise({
  frequency,
  octaves,
  seed,
  result,
}: {
  frequency: number | [number, number]
  octaves: number
  seed: number
  result: string
}) {
  return (
    <>
      <feTurbulence
        type="fractalNoise"
        baseFrequency={
          typeof frequency === "number"
            ? round(frequency)
            : frequency.map(round).join(" ")
        }
        numOctaves={octaves}
        seed={seed}
        colorInterpolationFilters="sRGB"
      />
      <feColorMatrix
        type="matrix"
        values={MONO}
        result={result}
        colorInterpolationFilters="sRGB"
      />
    </>
  )
}

function Blend({
  a,
  b,
  weight,
  result,
}: {
  a: string
  b: string
  weight: number
  result: string
}) {
  return (
    <feComposite
      in={a}
      in2={b}
      operator="arithmetic"
      k2={weight}
      k3={1 - weight}
      result={result}
      colorInterpolationFilters="sRGB"
    />
  )
}

// 0.5 를 축으로 대비를 올린다. 퍼지만 하던 노이즈가 경계가 선 알갱이가 된다
function Contrast({
  input,
  slope,
  result,
}: {
  input: string
  slope: number
  result: string
}) {
  const intercept = 0.5 - slope / 2
  return (
    <feComponentTransfer
      in={input}
      result={result}
      colorInterpolationFilters="sRGB"
    >
      <feFuncR type="linear" slope={slope} intercept={intercept} />
      <feFuncG type="linear" slope={slope} intercept={intercept} />
      <feFuncB type="linear" slope={slope} intercept={intercept} />
    </feComponentTransfer>
  )
}

// 필름 그레인: 고운 알갱이에 굵은 뭉침을 섞고 대비를 세워 또렷하게 한다.
// 알갱이를 키울수록 대비를 눅인다. 큰 알갱이를 같은 대비로 세우면 얼룩무늬처럼 보인다
export function FilmGrainNoise({
  size,
  scale = 100,
  softness = 0,
  result = "textureMono",
}: {
  size: number
  scale?: number
  softness?: number
  result?: string
}) {
  const frequency = 60 / size
  const slope =
    Math.min(2.6, Math.max(1.5, 2.6 - (scale - 100) / 250)) - softness
  return (
    <>
      <Noise frequency={frequency} octaves={3} seed={3} result="grainFine" />
      <Noise
        frequency={frequency / 2.5}
        octaves={2}
        seed={11}
        result="grainClump"
      />
      <Blend a="grainFine" b="grainClump" weight={0.82} result="grainMix" />
      <Contrast input="grainMix" slope={slope} result={result} />
    </>
  )
}

// 종이: 넓은 얼룩 + 가로·세로로 엉킨 섬유 + 비스듬한 빛을 받은 표면 요철.
// 요철은 노이즈와 살짝 민 노이즈의 차로 만든다. 밀어내는 거리가 mm 라 화면·인쇄 해상도와 상관없이 같다
export function PaperNoise({ size }: { size: number }) {
  const frequency = 120 / size
  const nudge = 0.35 / frequency
  return (
    <>
      <Noise
        frequency={frequency / 30}
        octaves={3}
        seed={21}
        result="paperMottle"
      />
      <Noise
        frequency={[frequency * 1.4, frequency * 0.18]}
        octaves={2}
        seed={5}
        result="paperFiberV"
      />
      <Noise
        frequency={[frequency * 0.18, frequency * 1.4]}
        octaves={2}
        seed={9}
        result="paperFiberH"
      />
      <Blend a="paperFiberV" b="paperFiberH" weight={0.5} result="paperFiber" />
      <Noise frequency={frequency} octaves={2} seed={13} result="paperTooth" />
      {/* 뺄셈을 arithmetic 로 바로 하면 알파도 빠져 밝은 쪽이 잘린다. 뒤집은 사본과 반씩 섞어 불투명하게 둔다 */}
      <feOffset in="paperTooth" dx={nudge} dy={nudge} />
      <feColorMatrix
        type="matrix"
        values="-1 0 0 0 1  -1 0 0 0 1  -1 0 0 0 1  0 0 0 0 1"
        result="paperToothShiftInv"
        colorInterpolationFilters="sRGB"
      />
      <Blend
        a="paperTooth"
        b="paperToothShiftInv"
        weight={0.5}
        result="paperSlope"
      />
      <Contrast input="paperSlope" slope={6.4} result="paperRelief" />
      <Contrast input="paperFiber" slope={1.8} result="paperFiberSharp" />
      <Blend
        a="paperRelief"
        b="paperFiberSharp"
        weight={0.55}
        result="paperSurface"
      />
      <Blend
        a="paperSurface"
        b="paperMottle"
        weight={0.75}
        result="textureMono"
      />
    </>
  )
}
