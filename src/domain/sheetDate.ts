/** A yearless sheet date is never resolved against the clock. */
export function yearlessDate(value: unknown): { month: number; day: number } | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().replace(/[（(](?:星期|週|周)?[一二三四五六日天][）)]$/, '').trim();
  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (!match) return undefined;
  return { day: Number(match[1]), month: Number(match[2]) };
}
export function sheetDateWithYear(value: unknown, year?: number): string | undefined | false {
  const parts = yearlessDate(value);
  if (!parts || year === undefined) return undefined;
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return false;
  const date = new Date(Date.UTC(year, parts.month - 1, parts.day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== parts.month || date.getUTCDate() !== parts.day) return false;
  return `${year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}
