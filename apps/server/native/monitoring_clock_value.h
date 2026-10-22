#ifndef EXAM_MONITORING_CLOCK_VALUE_H
#define EXAM_MONITORING_CLOCK_VALUE_H

#include <stdint.h>
#include <time.h>

/* Exact JavaScript integer milliseconds; no floating-point clock conversion. */
static inline int monitoring_clock_milliseconds(const struct timespec *ts,
                                                uint64_t *out) {
  const uint64_t max_ms = UINT64_C(9007199254740991);
  if (!ts || !out || ts->tv_sec < 0 || ts->tv_nsec < 0 ||
      ts->tv_nsec >= 1000000000L || (uint64_t)ts->tv_sec > max_ms / 1000)
    return 0;
  uint64_t value = (uint64_t)ts->tv_sec * 1000 +
                   (uint64_t)ts->tv_nsec / 1000000;
  if (value > max_ms)
    return 0;
  *out = value;
  return 1;
}

#endif
