/**
 * Shared validation for time / count number inputs.
 *
 * The UI rule: empty is allowed *while editing*, but on submit an empty
 * required field shows an inline error and blocks the save. Filling in
 * a non-positive value where the form requires positive shows a similar
 * inline error.
 *
 * Use this helper from any form's submit handler — keep the input state
 * as a string (so the field can genuinely be cleared), then call
 * `validatePositiveInt` and either render `error` under the field or
 * proceed with the parsed `value`.
 */

export interface ValidatePositiveIntOptions {
  /** Display label used in error messages (e.g. "Daily minutes goal"). */
  label?: string;
  /** Minimum allowed integer (default 1). Set to 0 if zero is acceptable. */
  min?: number;
  /** Optional upper bound, inclusive. */
  max?: number;
  /** When true, an empty string resolves to `null` instead of an error. */
  optional?: boolean;
  /** Custom unit suffix used in range error text ("min", "sessions", …). */
  unit?: string;
}

export type ValidatePositiveIntResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/**
 * Parse a user-entered number string and check it is a positive integer
 * within the given bounds. Returns either the parsed value or a human
 * error message ready to show under the field.
 */
export function validatePositiveInt(
  raw: string,
  opts: ValidatePositiveIntOptions = {}
): ValidatePositiveIntResult {
  const { label = "Value", min = 1, max, optional = false, unit } = opts;
  const trimmed = raw.trim();

  if (trimmed === "") {
    if (optional) return { ok: true, value: null };
    return { ok: false, error: `${label} can't be empty` };
  }

  if (!/^-?\d+$/.test(trimmed)) {
    return { ok: false, error: `${label} must be a whole number` };
  }

  const n = parseInt(trimmed, 10);

  if (Number.isNaN(n)) {
    return { ok: false, error: `${label} must be a whole number` };
  }

  if (min >= 1 && n < 1) {
    return { ok: false, error: `${label} must be greater than 0` };
  }

  if (n < min) {
    return { ok: false, error: `${label} must be at least ${min}${unit ? ` ${unit}` : ""}` };
  }

  if (max != null && n > max) {
    return { ok: false, error: `${label} must be at most ${max}${unit ? ` ${unit}` : ""}` };
  }

  return { ok: true, value: n };
}

/**
 * Coerce a possibly-null number into the string form an input field
 * should display. `null` / `undefined` → "" so the field renders blank
 * (which is what the user sees the first time they edit a never-set
 * preference).
 */
export function numberFieldString(value: number | null | undefined): string {
  if (value == null) return "";
  return String(value);
}
