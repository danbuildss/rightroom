export const newId = () => crypto.randomUUID();
export const nowIso = (now: Date = new Date()) => now.toISOString();

/** Parse JSON stored by this app. Throws if the database holds something unexpected. */
export function fromJson<T>(value: string | null): T | null {
  return value === null ? null : (JSON.parse(value) as T);
}

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

/** D1 allows at most 100 bound values per query; long id lists are split into pieces of this size. */
export const MAX_IDS = 90;
export function chunks<T>(list: T[], size = MAX_IDS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
