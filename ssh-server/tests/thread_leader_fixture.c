/* Owned synthetic unprivileged workload only. No installed native command.
 * The main thread exits; another thread keeps a shared file descriptor live. */
#define _GNU_SOURCE
#include <fcntl.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

static int output = -1;

static void *writer(void *unused) {
  (void)unused;
  printf("%ld %ld\n", (long)getpid(), (long)syscall(SYS_gettid));
  fflush(stdout);
  for (;;) {
    if (write(output, "x", 1) != 1)
      _exit(2);
    struct timespec pause = {.tv_sec = 0, .tv_nsec = 10000000};
    nanosleep(&pause, NULL);
  }
  return NULL;
}

int main(int argc, char **argv) {
  if (argc != 2 || getuid() < 1000 || geteuid() != getuid())
    return 77;
  alarm(15); /* Self-expire even if the supervising synthetic test dies. */
  output = open(argv[1], O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_APPEND, 0600);
  if (output < 0)
    return 78;
  pthread_t thread;
  if (pthread_create(&thread, NULL, writer, NULL) != 0)
    return 79;
  pthread_exit(NULL);
}
