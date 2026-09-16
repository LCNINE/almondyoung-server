/** Explicit selection must never silently expand to unrelated sample accounts. */
export function selectDemoSeedGroups(available: string[], stage?: string, requested?: string): string[] {
  const selected = requested ?? (stage === 'demo' ? 'demo-logistics' : undefined);
  if (selected) {
    if (!selected.startsWith('demo-') || !available.includes(selected)) {
      throw new Error(`Unknown demo seed group: ${selected}`);
    }
    return [selected];
  }
  return available.filter((group) => group.startsWith('demo-'));
}
