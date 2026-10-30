import { useMemo } from "react";
import { localTimeOptions, utcOffset } from "./local-date-time.js";

export function LocalDateTimeInput({
  label,
  value,
  onChange,
  occurrence,
  onOccurrence,
  required = true,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  occurrence: number;
  onOccurrence: (value: number) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  const choices = useMemo(() => {
    try {
      return localTimeOptions(value);
    } catch {
      return [];
    }
  }, [value]);
  return (
    <>
      <label>
        {label}
        <input
          type="datetime-local"
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
