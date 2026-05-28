"use client";

import { forwardRef, useId } from "react";

interface NumberFieldProps {
  /** String value so the field can genuinely be cleared while editing. */
  value: string;
  onChange: (next: string) => void;
  /** Optional label rendered above the input. */
  label?: React.ReactNode;
  /** Inline help text rendered between label and input. */
  hint?: React.ReactNode;
  /** Inline error text rendered in red below the input. */
  error?: string | null;
  /** Suffix shown inside the input (e.g. "min", "sessions"). */
  unit?: string;
  /** HTML min/max — passed through for browser stepper UX, also used as visual hints. */
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  /** Wrapper className (around label + input). */
  className?: string;
  /** className applied to the input element itself. */
  inputClassName?: string;
  /** Wrapper className for just the input row (relative box). */
  fieldClassName?: string;
  id?: string;
  name?: string;
  required?: boolean;
  /** Set the input to a fixed width (e.g. "w-28"). */
  inputWidthClassName?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
}

const DEFAULT_INPUT_CLASS =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

/**
 * Numeric input that is allowed to be **empty while editing**. Parents
 * keep the value as a string and validate at submit time; this component
 * just owns the visual concerns (label, unit suffix, inline error).
 *
 * The input strips non-digit characters in onChange so the parent's
 * string state is always pure digits or "". `inputMode="numeric"` +
 * `pattern="[0-9]*"` give the right virtual keyboard on mobile while
 * keeping the input as `type="text"` — using `type="number"` is what
 * caused the original bug, where the browser silently coerced empty to
 * the previous value on some platforms.
 */
export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(
  function NumberField(props, ref) {
    const {
      value,
      onChange,
      label,
      hint,
      error,
      unit,
      min,
      max,
      placeholder,
      disabled,
      className,
      inputClassName = DEFAULT_INPUT_CLASS,
      fieldClassName,
      id,
      name,
      required,
      inputWidthClassName,
      onBlur,
    } = props;

    const reactId = useId();
    const inputId = id ?? `numfield-${reactId}`;
    const errorId = `${inputId}-error`;

    const errorBorderClass = error
      ? " !border-red-500 dark:!border-red-500"
      : "";

    return (
      <div className={className}>
        {label && (
          <label
            htmlFor={inputId}
            className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
          >
            {label}
          </label>
        )}
        {hint && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">{hint}</p>
        )}
        <div className={`relative ${inputWidthClassName ?? ""} ${fieldClassName ?? ""}`}>
          <input
            ref={ref}
            id={inputId}
            name={name}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={value}
            min={min}
            max={max}
            placeholder={placeholder}
            disabled={disabled}
            required={required}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => {
              const cleaned = e.target.value.replace(/[^0-9]/g, "");
              onChange(cleaned);
            }}
            onBlur={onBlur}
            className={`${inputClassName}${errorBorderClass}`}
          />
          {unit && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
              {unit}
            </span>
          )}
        </div>
        {error && (
          <p id={errorId} className="mt-1 text-xs text-red-500 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    );
  }
);
