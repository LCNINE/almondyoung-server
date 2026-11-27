type PayMethod = { type: string };

/** 함께 배송 결제처럼 입금을 기다릴 수 없는 결제. 무통장·가상계좌(토스 위젯)를 보이지 않는다. */
export function isInstantOnly(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.instantOnly === true;
}

export function filterExternalMethods<T extends PayMethod>(
  methods: T[],
  opts: {
    isAvailableInRegion: (type: string) => boolean;
    isMembership: boolean;
    widgetCoversBankTransfer: boolean;
    instantOnly: boolean;
  },
): T[] {
  return methods
    .filter((m) => m.type !== 'POINTS' && opts.isAvailableInRegion(m.type))
    .filter((m) => !opts.isMembership || m.type === 'BANK_TRANSFER')
    .filter((m) => !opts.widgetCoversBankTransfer || m.type !== 'BANK_TRANSFER')
    .filter((m) => !opts.instantOnly || m.type !== 'BANK_TRANSFER');
}
