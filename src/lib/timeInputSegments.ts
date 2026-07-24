// Pure helpers behind the HH/MM/SS segmented time input.
export function splitTimeValue(value: string): [string, string, string] {
  const [h, m, s] = value.split(":");
  return [h ?? "", m ?? "", s ?? ""];
}

export function composeTimeValue(hh: string, mm: string, ss: string): string {
  if (hh === "" && mm === "" && ss === "") return "";
  return `${hh}:${mm}:${ss}`;
}

export function sanitizeDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 2);
}
