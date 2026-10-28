/** A currency's minor-unit digits (ISO 4217, from the runtime's ICU: JPY 0, USD 2), or null for a code it doesn't know. */
export function minorDigits(currency: string): number | null {
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? null;
  } catch {
    return null;
  }
}

/** "3.42" USD → 342; "" → null (unknown, never 0); anything else that isn't a plain amount → undefined (an error). */
export function toMinor(text: string, currency: string): number | null | undefined {
  if (text === '') return null;
  const digits = minorDigits(currency);
  if (digits === null || !/^\d+(\.\d+)?$/.test(text)) return undefined;
  return Math.round(Number(text) * 10 ** digits);
}
