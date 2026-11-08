// Форматирование и разбор значений. Деньги в коде всегда в копейках (целое число).
export function esc(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function formatRub(kopecks: number): string {
  const rub = kopecks / 100;
  const text = Number.isInteger(rub)
    ? rub.toLocaleString("ru-RU")
    : rub.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${text} ₽`;
}

// "1 500,50" -> 150050. Некорректный ввод -> null.
export function parseRub(input: string): number | null {
  const cleaned = input.replace(/[\s ₽]|руб\.?|р\.?$/gi, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const kopecks = Math.round(Number(cleaned) * 100);
  return kopecks > 9_999_999_999 ? null : kopecks;
}

export function kopecksFromDb(value: unknown): number {
  return Math.round(parseFloat(String(value)) * 100);
}

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

export function parseList(input: string): string[] {
  const trimmed = input.trim();
  if (trimmed === "-" || trimmed === "—") return [];
  return [...new Set(trimmed.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean))];
}
