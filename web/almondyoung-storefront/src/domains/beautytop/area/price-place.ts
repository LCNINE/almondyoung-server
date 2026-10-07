/** Where a price lands among the listed menu prices: 1 = cheapest. Equal prices share a place. */
export function placeAmong(values: number[], mine: number): { place: number; total: number; cheaper: number; same: number } {
  const cheaper = values.filter((v) => v < mine).length
  const same = values.filter((v) => v === mine).length
  return { place: cheaper + 1, total: values.length + 1, cheaper, same }
}
