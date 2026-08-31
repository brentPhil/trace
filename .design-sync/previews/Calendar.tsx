import { Calendar } from 'chroneli';

/* Dates are pinned, never `new Date()` — the render hash has to be stable
 * across runs or every re-sync re-grades the card for no reason. */
const AUG_2026 = new Date(2026, 7, 1);

export function SingleDate() {
  return (
    <Calendar
      mode="single"
      defaultMonth={AUG_2026}
      selected={new Date(2026, 7, 19)}
      className="rounded-2xl border"
    />
  );
}

export function DateRange() {
  return (
    <Calendar
      mode="range"
      defaultMonth={AUG_2026}
      selected={{ from: new Date(2026, 7, 10), to: new Date(2026, 7, 16) }}
      className="rounded-2xl border"
    />
  );
}

/* `captionLayout="dropdown"` needs an explicit month range to populate its
 * selects; without startMonth/endMonth react-day-picker falls back to its own
 * default window and defaultMonth is ignored, so the card shows an unrelated
 * month. */
export function WithDropdownCaption() {
  return (
    <Calendar
      mode="single"
      captionLayout="dropdown"
      startMonth={new Date(2024, 0, 1)}
      endMonth={new Date(2027, 11, 31)}
      defaultMonth={AUG_2026}
      selected={new Date(2026, 7, 19)}
      className="rounded-2xl border"
    />
  );
}
