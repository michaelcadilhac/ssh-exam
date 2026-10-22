#include "../../apps/server/native/monitoring_clock_value.h"
#include <limits.h>

#define CHECK(condition) do { if (!(condition)) return __LINE__; } while (0)

int main(void) {
  struct timespec ts = {0, 0};
  uint64_t out = 17;
  CHECK(monitoring_clock_milliseconds(&ts, &out) && out == 0);
  ts.tv_sec = 123;
  ts.tv_nsec = 456789012;
  CHECK(monitoring_clock_milliseconds(&ts, &out) && out == 123456);
  ts.tv_sec = -1;
  CHECK(!monitoring_clock_milliseconds(&ts, &out) && out == 123456);
  ts.tv_sec = 0;
  ts.tv_nsec = -1;
  CHECK(!monitoring_clock_milliseconds(&ts, &out));
  ts.tv_nsec = 1000000000L;
  CHECK(!monitoring_clock_milliseconds(&ts, &out));
  ts.tv_sec = 9007199254740;
  ts.tv_nsec = 991999999;
  CHECK(monitoring_clock_milliseconds(&ts, &out) &&
        out == UINT64_C(9007199254740991));
  ts.tv_nsec = 992000000;
  CHECK(!monitoring_clock_milliseconds(&ts, &out));
  ts.tv_sec = 9007199254741;
  ts.tv_nsec = 0;
  CHECK(!monitoring_clock_milliseconds(&ts, &out));
  ts.tv_sec = LONG_MAX;
  CHECK(!monitoring_clock_milliseconds(&ts, &out));
  CHECK(!monitoring_clock_milliseconds(NULL, &out));
  CHECK(!monitoring_clock_milliseconds(&ts, NULL));
  return 0;
}
