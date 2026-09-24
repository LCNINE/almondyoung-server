export function clearWhiteBackdrop(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
) {
  const isWhite = (offset: number) =>
    pixels[offset + 3] > 240 &&
    pixels[offset] > 245 &&
    pixels[offset + 1] > 245 &&
    pixels[offset + 2] > 245

  const corners = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    (width * height - 1) * 4,
  ]
  if (corners.filter(isWhite).length < 3) return false

  for (let offset = 0; offset < pixels.length; offset += 4) {
    const lightestDarkChannel = Math.min(
      pixels[offset],
      pixels[offset + 1],
      pixels[offset + 2]
    )
    if (lightestDarkChannel > 240) {
      pixels[offset + 3] = Math.round(
        (pixels[offset + 3] * (255 - lightestDarkChannel)) / 15
      )
    }
  }
  return true
}
