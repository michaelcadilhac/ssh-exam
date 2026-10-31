import { useMemo } from "react";
import {
  localTimeOptions,
  utcOffset,
  type DateTimePrecision,
} from "./local-date-time.js";

export function LocalDateTimeInput({
  label,
  value,
  onChange,
  occurrence,
  onOccurrence,
  required = true,
  disabled = false,
  precision = "minute",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  occurrence: number;
  onOccurrence: (value: number) => void;
  required?: boolean;
  disabled?: boolean;
  precision?: DateTimePrecision;
}) {
  const choices = useMemo(() => {
    try {
      return localTimeOptions(value, precision);
    } catch {
      return [];
    }
  }, [value, precision]);
  return (
    <>
      <label>
        {label}
        <input
          type="datetime-local"
          step={precision === "exact" ? "0.001" : undefined}
          disabled={disabled}
          required={required}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            onOccurrence(0);
          }}
        />
      </label>
      {choices.length > 1 && (
        <>
          <p>This time occurs twice when clocks go back.</p>
          <label>
            Occurrence for {label}
            <select
              disabled={disabled}
              value={occurrence}
              onChange={(e) => onOccurrence(Number(e.target.value))}
            >
              {choices.map((at, index) => (
                <option key={at} value={index}>
                  {index === 0 ? "First" : "Second"} ({utcOffset(at)})
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </>
  );
}
