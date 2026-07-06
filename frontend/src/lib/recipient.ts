export const isAddr = (value: string) => /^[GC][A-Z2-7]{55}$/.test(value);
export const isEmail = (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
export const isShp = (value: string) => value.startsWith("shp_");
export const isShieldPassUser = (value: string) => isEmail(value) || isShp(value);

// A scanned QR may be a deep link (…/send?to=shp_…) or a raw shp_/email/address.
// Pull the recipient out of either form.
export function recipientFromScan(raw: string): string {
  const t = raw.trim();
  try {
    const to = new URL(t).searchParams.get("to");
    if (to) return to.trim();
  } catch {
    /* not a URL — fall through */
  }
  return t;
}
