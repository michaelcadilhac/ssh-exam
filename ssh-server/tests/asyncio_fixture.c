/* Disposable unprivileged guest workload, never an installed native command.
 * Linux UAPI only: no liburing dependency. All buffers/rings remain live until
 * completion/exit; release/acquire ordering follows the shared-ring contract.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/io_uring.h>
#include <poll.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/utsname.h>
#include <time.h>
#include <unistd.h>

_Static_assert(sizeof(struct io_uring_sqe) == 64, "SQE ABI");
_Static_assert(sizeof(struct io_uring_cqe) == 16, "CQE ABI");
_Static_assert(sizeof(struct io_uring_params) == 120, "setup ABI");

static void fail(const char *stage) {
  fprintf(stderr, "private async-IO fixture failed: %s errno=%d\n", stage, errno);
  exit(1);
}

static int64_t boot_ms(void) {
  struct timespec value;
  if (clock_gettime(CLOCK_BOOTTIME, &value) || value.tv_sec < 0)
    fail("clock");
  return (int64_t)value.tv_sec * 1000 + value.tv_nsec / 1000000;
}

int main(int argc, char **argv) {
  /* Parent Go test validates the pinned private guest before UID drop/exec.
   * This unprivileged workload must never create files as root. */
  if (getuid() < 1000 || geteuid() != getuid() || argc != 5)
    return 77;
  int sqpoll = !strcmp(argv[1], "sqpoll");
  int timer = !strcmp(argv[2], "timer");
  int forced = !strcmp(argv[3], "forced");
  if ((!sqpoll && strcmp(argv[1], "basic")) ||
      (!timer && strcmp(argv[2], "pipe")) ||
      (!forced && strcmp(argv[3], "normal")))
    return 78;
  struct stat source;
  if (fstat(3, &source) || !S_ISFIFO(source.st_mode))
    fail("inherited private pipe");
  int output = open(argv[4], O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
  if (output < 0)
    fail("new synthetic file");
  struct io_uring_params p = {0};
  p.flags = sqpoll ? IORING_SETUP_SQPOLL : 0;
  p.sq_thread_idle = sqpoll ? 1 : 0;
  int ring = syscall(SYS_io_uring_setup, 8u, &p);
  if (ring < 0)
    fail("setup");
  if (p.sq_entries < 2 || p.sq_entries > 64 || p.cq_entries > 128)
    fail("ring bounds");
  size_t sq_len = p.sq_off.array + p.sq_entries * sizeof(unsigned);
  size_t cq_len = p.cq_off.cqes + p.cq_entries * sizeof(struct io_uring_cqe);
  if (p.features & IORING_FEAT_SINGLE_MMAP)
    sq_len = cq_len = sq_len > cq_len ? sq_len : cq_len;
  void *sq = mmap(NULL, sq_len, PROT_READ | PROT_WRITE, MAP_SHARED,
                  ring, IORING_OFF_SQ_RING);
  if (sq == MAP_FAILED)
    fail("SQ mmap");
  void *cq = sq;
  if (!(p.features & IORING_FEAT_SINGLE_MMAP)) {
    cq = mmap(NULL, cq_len, PROT_READ | PROT_WRITE, MAP_SHARED,
              ring, IORING_OFF_CQ_RING);
    if (cq == MAP_FAILED)
      fail("CQ mmap");
  }
  struct io_uring_sqe *entries = mmap(NULL, p.sq_entries * sizeof(*entries),
      PROT_READ | PROT_WRITE, MAP_SHARED, ring, IORING_OFF_SQES);
  if (entries == MAP_FAILED)
    fail("SQE mmap");
#define FIELD(base, offset) ((_Atomic unsigned *)((char *)(base) + (offset)))
  _Atomic unsigned *sq_head = FIELD(sq, p.sq_off.head);
  _Atomic unsigned *sq_tail = FIELD(sq, p.sq_off.tail);
  _Atomic unsigned *sq_flags = FIELD(sq, p.sq_off.flags);
  _Atomic unsigned *cq_head = FIELD(cq, p.cq_off.head);
  _Atomic unsigned *cq_tail = FIELD(cq, p.cq_off.tail);
  unsigned *array = (unsigned *)((char *)sq + p.sq_off.array);
  unsigned sq_mask = atomic_load(FIELD(sq, p.sq_off.ring_mask));
  unsigned cq_mask = atomic_load(FIELD(cq, p.cq_off.ring_mask));
  struct io_uring_cqe *results = (void *)((char *)cq + p.cq_off.cqes);
  char buffer = timer ? 'X' : 0;
  struct __kernel_timespec timeout = {.tv_sec = 2, .tv_nsec = 0};
  int64_t expires = timer ? boot_ms() + 2000 : 0;
  entries[0] = (struct io_uring_sqe){
    .opcode = timer ? IORING_OP_TIMEOUT : IORING_OP_READ,
    .flags = IOSQE_IO_LINK | (timer ? IOSQE_IO_HARDLINK : 0) |
             (forced ? IOSQE_ASYNC : 0),
    .fd = timer ? -1 : 3,
    .addr = (uint64_t)(uintptr_t)(timer ? (void *)&timeout : (void *)&buffer),
    .len = 1,
    .timeout_flags = timer ? IORING_TIMEOUT_BOOTTIME : 0,
    .user_data = 1,
  };
  entries[1] = (struct io_uring_sqe){
    .opcode = IORING_OP_WRITE,
    .flags = forced ? IOSQE_ASYNC : 0,
    .fd = output,
    .addr = (uint64_t)(uintptr_t)&buffer,
    .len = 1,
    .user_data = 2,
  };
  unsigned tail = atomic_load_explicit(sq_tail, memory_order_relaxed);
  array[tail & sq_mask] = 0;
  array[(tail + 1) & sq_mask] = 1;
  atomic_store_explicit(sq_tail, tail + 2, memory_order_release);
  unsigned flags = 0;
  if (sqpoll) {
    atomic_thread_fence(memory_order_seq_cst);
    if (atomic_load_explicit(sq_flags, memory_order_acquire) & IORING_SQ_NEED_WAKEUP)
      flags = IORING_ENTER_SQ_WAKEUP;
  }
  if ((!sqpoll || flags) && syscall(SYS_io_uring_enter, ring,
        sqpoll ? 0u : 2u, 0u, flags, NULL, 0u) < 0)
    fail("submit");
  int64_t limit = boot_ms() + 1000;
  while (atomic_load_explicit(sq_head, memory_order_acquire) != tail + 2) {
    if (boot_ms() >= limit)
      fail("submission readiness");
    struct timespec delay = {.tv_nsec = 1000000};
    nanosleep(&delay, NULL);
  }
  struct utsname kernel;
  if (uname(&kernel))
    fail("kernel identity");
  printf("{\"phase\":\"ready\",\"pid\":%d,\"uid\":%u,\"kernel\":\"%s\",\"expires\":%lld,\"completions\":%u}\n",
      getpid(), getuid(), kernel.release, (long long)expires,
      atomic_load_explicit(cq_tail, memory_order_acquire) - atomic_load(cq_head));
  fflush(stdout);
  int first = -99999, second = -99999, released = 0;
  limit = boot_ms() + 10000;
  while (first == -99999 || second == -99999 || !released) {
    unsigned head = atomic_load_explicit(cq_head, memory_order_relaxed);
    unsigned end = atomic_load_explicit(cq_tail, memory_order_acquire);
    while (head != end) {
      struct io_uring_cqe result = results[head & cq_mask];
      if (result.user_data == 1 && first == -99999)
        first = result.res;
      else if (result.user_data == 2 && second == -99999)
        second = result.res;
      else
        fail("unexpected completion identity");
      head++;
    }
    atomic_store_explicit(cq_head, head, memory_order_release);
    if (boot_ms() >= limit)
      fail("completion/control deadline");
    struct pollfd control = {.fd = STDIN_FILENO, .events = POLLIN};
    int found = poll(&control, 1, 5);
    if (found < 0 && errno != EINTR)
      fail("control poll");
    if (found > 0 && control.revents & (POLLHUP | POLLERR | POLLNVAL))
      fail("private control disconnected");
    if (found > 0 && control.revents & POLLIN) {
      char signal;
      if (read(STDIN_FILENO, &signal, 1) != 1 || signal != 'Q')
        fail("private control release");
      released = 1;
    }
    if (syscall(SYS_io_uring_enter, ring, 0u, 0u,
          IORING_ENTER_GETEVENTS, NULL, 0u) < 0 && errno != EINTR)
      fail("completion progress");
  }
  char saved = 0;
  ssize_t count = pread(output, &saved, 1, 0);
  if (count < 0)
    fail("completed synthetic output");
  printf("{\"phase\":\"done\",\"first\":%d,\"second\":%d,\"saved\":%d,\"dropped\":%u,\"overflow\":%u}\n",
      first, second, count ? (unsigned char)saved : -1, atomic_load(FIELD(sq, p.sq_off.dropped)),
      atomic_load(FIELD(cq, p.cq_off.overflow)));
  fflush(stdout);
  close(ring);
  close(output);
  return 0;
}
