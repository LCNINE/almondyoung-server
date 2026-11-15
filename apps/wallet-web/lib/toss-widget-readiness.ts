export function isTossWidgetReady(amount: number, required: boolean, readyAmount: number | null, hasWidget: boolean) {
  return amount === 0 || !required || (hasWidget && readyAmount === amount);
}
