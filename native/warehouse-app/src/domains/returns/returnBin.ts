const RETURN_BIN_CODE = /^RB-[A-Za-z0-9._-]{1,125}$/;

export function isReturnBinCode(code: string): boolean {
  return RETURN_BIN_CODE.test(code.trim());
}
