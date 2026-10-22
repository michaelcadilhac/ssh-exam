#define _GNU_SOURCE
#include <node_api.h>
#include "monitoring_clock_value.h"

#ifndef __linux__
#error "Monitoring evidence requires the Linux CLOCK_BOOTTIME reader; no approximate fallback"
#endif

/* No browser input, file IO, allocation of native buffers, or configurable clock
 * source. CLOCK_BOOTTIME includes suspend; Node/libuv MONOTONIC does not. */
static napi_value unavailable(napi_env env) {
  napi_throw_error(env, "MONITORING_BOOT_CLOCK_UNAVAILABLE",
                   "Monitoring boot clock unavailable; no evidence authorized");
  return NULL;
}

static napi_value read_boottime(napi_env env, napi_callback_info info) {
  (void)info;
  struct timespec ts;
  uint64_t milliseconds;
  napi_value value;
  if (clock_gettime(CLOCK_BOOTTIME, &ts) != 0 ||
      !monitoring_clock_milliseconds(&ts, &milliseconds))
    return unavailable(env);
  if (napi_create_double(env, (double)milliseconds, &value) != napi_ok)
    return unavailable(env);
  return value;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value now, kind;
  if (napi_create_function(env, "now", NAPI_AUTO_LENGTH, read_boottime, NULL,
                           &now) != napi_ok ||
      napi_create_string_utf8(env, "linux-boottime-ms-v1", NAPI_AUTO_LENGTH,
                              &kind) != napi_ok ||
      napi_set_named_property(env, exports, "kind", kind) != napi_ok ||
      napi_set_named_property(env, exports, "now", now) != napi_ok)
    return unavailable(env);
  return exports;
}

NAPI_MODULE(monitoring_clock, initialize)
