/* Owned synthetic unprivileged workload only. No installed native command.
 * The main thread exits; another thread keeps a shared file descriptor live. */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

static int output = -1;
static int terminal_mode = 0;

static void *writer(void *unused) {
  (void)unused;
  printf(terminal_mode ? "THREAD-TTY %ld %ld\n" : "%ld %ld\n",
         (long)getpid(), (long)syscall(SYS_gettid));
  fflush(stdout);
  char buffer[128] = "empty";
  unsigned sequence = 0;
  for (;;) {
    if (write(output, "x", 1) != 1)
      _exit(2);
    if (terminal_mode) {
      struct pollfd input = {.fd = STDIN_FILENO, .events = POLLIN};
      int ready = poll(&input, 1, 0);
      if (ready < 0 && errno != EINTR)
        _exit(3);
      if (ready > 0 && (input.revents & POLLIN)) {
        char command[128] = {0};
        ssize_t count = read(STDIN_FILENO, command, sizeof(command) - 1);
        if (count <= 0)
          _exit(4);
        if (strcmp(command, "EXIT\n") == 0)
          _exit(0);
        if (strncmp(command, "PUT ", 4) == 0) {
          size_t length = strcspn(command + 4, "\r\n");
          memcpy(buffer, command + 4, length);
          buffer[length] = 0;
        } else if (strcmp(command, "CHECK\n") != 0) {
          puts("THREAD-ERROR");
          fflush(stdout);
          continue;
        }
        printf("THREAD-BUFFER %u %s\n", ++sequence, buffer);
        fflush(stdout);
      }
    }
    struct timespec pause = {.tv_sec = 0, .tv_nsec = 10000000};
    nanosleep(&pause, NULL);
  }
  return NULL;
}

int main(int argc, char **argv) {
  if ((argc != 2 && argc != 3) || getuid() < 1000 || geteuid() != getuid())
    return 77;
  if (argc == 3) {
    if (strcmp(argv[2], "tty") != 0 || !isatty(STDIN_FILENO))
      return 77;
    terminal_mode = 1;
  }
  alarm(15); /* Self-expire even if the supervising synthetic test dies. */
  output = open(argv[1], O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_APPEND, 0600);
  if (output < 0)
    return 78;
  pthread_t thread;
  if (pthread_create(&thread, NULL, writer, NULL) != 0)
    return 79;
  pthread_exit(NULL);
}
