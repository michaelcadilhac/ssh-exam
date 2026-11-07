import { createContext, useContext, useMemo, useRef } from "react";
import * as dates from "./local-date-time.js";
export const ExamTimeZone = createContext(dates.DEFAULT_EXAM_TIMEZONE);
export function useExamDates(override?: string, pin = false) {
  const inherited = useContext(ExamTimeZone),
    initial = useRef(inherited),
    zone = override ?? (pin ? initial.current : inherited);
  return useMemo(
    () => ({
      zone,
      localDateTime: (
        at: number,
        p: dates.DateTimePrecision = "minute",
        z = zone,
      ) => dates.localDateTime(at, p, z),
      localOccurrence: (
        at: number,
        p: dates.DateTimePrecision = "minute",
        z = zone,
      ) => dates.localOccurrence(at, p, z),
      localTimeOptions: (
        value: string,
        p: dates.DateTimePrecision = "minute",
      ) => dates.localTimeOptions(value, p, zone),
      parseLocalDateTime: (
        value: string,
        occurrence = 0,
        p: dates.DateTimePrecision = "minute",
      ) => {
        if (pin && inherited !== zone)
          throw Error(
            "The exam time zone changed. Close this form and reopen it before changing dates.",
          );
        return dates.parseLocalDateTime(value, occurrence, p, zone);
      },
      utcOffset: (at: number) => dates.utcOffset(at, zone),
      shortDateTime: (at: number) => dates.shortDateTime(at, zone),
      windowLabel: (start: number, end: number) =>
        dates.windowLabel(start, end, zone),
      dateTime: (at: number | null | undefined, seconds = true) =>
        dates.dateTime(at, zone, seconds),
    }),
    [zone, inherited, pin],
  );
}
