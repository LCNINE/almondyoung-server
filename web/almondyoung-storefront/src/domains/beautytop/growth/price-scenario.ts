export type PriceScenarioInput = {
  currentPrice: number
  nextPrice: number
  visits: number
  variableCost: number | null
  minutes: number | null
}

export function calculatePriceScenario(input: PriceScenarioInput) {
  const { currentPrice, nextPrice, visits, variableCost, minutes } = input
  if (
    ![currentPrice, nextPrice, visits].every((v) => Number.isFinite(v) && v > 0)
  )
    return null
  if (
    currentPrice > 10_000_000 ||
    nextPrice > 10_000_000 ||
    visits > 1_000_000 ||
    !Number.isInteger(visits)
  )
    return null
  if (
    variableCost !== null &&
    (!Number.isFinite(variableCost) ||
      variableCost < 0 ||
      variableCost > 10_000_000)
  )
    return null
  if (
    minutes !== null &&
    (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440)
  )
    return null
  const oldContribution =
    variableCost === null ? null : currentPrice - variableCost
  const newContribution =
    variableCost === null ? null : nextPrice - variableCost
  return {
    currentRevenue: currentPrice * visits,
    nextRevenue: nextPrice * visits,
    revenueDelta: (nextPrice - currentPrice) * visits,
    revenueBreakEvenVisits: Math.ceil((currentPrice * visits) / nextPrice),
    currentContribution:
      oldContribution === null ? null : oldContribution * visits,
    nextContribution:
      newContribution === null ? null : newContribution * visits,
    contributionBreakEvenVisits:
      oldContribution !== null &&
      oldContribution > 0 &&
      newContribution !== null &&
      newContribution > 0
        ? Math.ceil((oldContribution * visits) / newContribution)
        : null,
    hourlyContribution:
      newContribution !== null && minutes !== null
        ? (newContribution * 60) / minutes
        : null,
  }
}
