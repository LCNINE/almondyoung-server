const e164PhoneNumberRegex = /^\+[1-9]\d{7,14}$/;
const koreanMobilePhoneNumberRegex = /^01\d{8,9}$/;

export function normalizePhoneNumber(input: string) {
  const trimmed = input.trim();

  if (!trimmed) {
    return null;
  }

  if (e164PhoneNumberRegex.test(trimmed)) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  if (digits.startsWith("82")) {
    const e164PhoneNumber = `+${digits}`;
    return e164PhoneNumberRegex.test(e164PhoneNumber) ? e164PhoneNumber : null;
  }

  if (koreanMobilePhoneNumberRegex.test(digits)) {
    return `+82${digits.slice(1)}`;
  }

  return null;
}
