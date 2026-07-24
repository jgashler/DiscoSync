import { useRef } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { composeTimeValue, sanitizeDigits, splitTimeValue } from "../lib/timeInputSegments";

interface TimeInputProps {
  /** "HH:MM:SS", a partial value while typing (e.g. "9::"), or "". */
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
}

type Segment = "h" | "m" | "s";

// Three separate HH/MM/SS boxes instead of one "type the colons yourself"
// text field, so entering a timestamp is just type-two-digits-and-move-on
// (auto-advance forward, Backspace-on-empty moves back) — no colons to type,
// still tabs through in order since they're just three inputs in sequence.
export function TimeInput({ value, onChange, invalid }: TimeInputProps) {
  const [hh, mm, ss] = splitTimeValue(value);
  const hourRef = useRef<HTMLInputElement>(null);
  const minRef = useRef<HTMLInputElement>(null);
  const secRef = useRef<HTMLInputElement>(null);

  function segmentValue(segment: Segment): string {
    return segment === "h" ? hh : segment === "m" ? mm : ss;
  }

  function handleChange(segment: Segment, raw: string, next: RefObject<HTMLInputElement | null> | null) {
    const digits = sanitizeDigits(raw);
    onChange(
      composeTimeValue(
        segment === "h" ? digits : hh,
        segment === "m" ? digits : mm,
        segment === "s" ? digits : ss,
      ),
    );
    if (digits.length === 2) {
      // Defer to let React commit the re-render with the new digits first.
      // Focusing synchronously here fires a native blur on this box while
      // its closure still only knows the previous (one-digit) value, so
      // handleBlurPad would pad *that* stale value and clobber what was
      // just typed (e.g. typing "18" landing as "01").
      setTimeout(() => next?.current?.focus(), 0);
    }
  }

  function handleBlurPad(segment: Segment, max: number) {
    const current = segmentValue(segment);
    if (current === "") return;
    const padded = Math.min(Number(current), max).toString().padStart(2, "0");
    if (padded === current) return;
    onChange(
      composeTimeValue(
        segment === "h" ? padded : hh,
        segment === "m" ? padded : mm,
        segment === "s" ? padded : ss,
      ),
    );
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>, segment: Segment, prev: RefObject<HTMLInputElement | null> | null) {
    if (e.key === "Backspace" && segmentValue(segment) === "") prev?.current?.focus();
  }

  const boxClass = `bg-neutral-900 rounded px-1 py-1 w-10 text-center outline-none border ${
    invalid ? "border-red-600" : "border-neutral-800 focus:border-blue-500"
  }`;

  return (
    <div className="flex items-center gap-1">
      <input
        ref={hourRef}
        value={hh}
        onChange={(e) => handleChange("h", e.target.value, minRef)}
        onBlur={() => handleBlurPad("h", 23)}
        onKeyDown={(e) => handleKeyDown(e, "h", null)}
        placeholder="HH"
        inputMode="numeric"
        maxLength={2}
        className={boxClass}
      />
      <span className="text-neutral-500">:</span>
      <input
        ref={minRef}
        value={mm}
        onChange={(e) => handleChange("m", e.target.value, secRef)}
        onBlur={() => handleBlurPad("m", 59)}
        onKeyDown={(e) => handleKeyDown(e, "m", hourRef)}
        placeholder="MM"
        inputMode="numeric"
        maxLength={2}
        className={boxClass}
      />
      <span className="text-neutral-500">:</span>
      <input
        ref={secRef}
        value={ss}
        onChange={(e) => handleChange("s", e.target.value, null)}
        onBlur={() => handleBlurPad("s", 59)}
        onKeyDown={(e) => handleKeyDown(e, "s", minRef)}
        placeholder="SS"
        inputMode="numeric"
        maxLength={2}
        className={boxClass}
      />
    </div>
  );
}
