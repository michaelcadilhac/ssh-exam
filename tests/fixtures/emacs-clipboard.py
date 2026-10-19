"""Capture real terminal Emacs OSC 52 output in a private PTY (no OS clipboard)."""
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import signal
import struct
import sys
import tempfile
import termios
import time

config = Path(__file__).resolve().parents[2] / "ssh-server/emacs/50terminal-clipboard.el"
text = "Emacs clipboard λ 🌍\nsecond line"
with tempfile.TemporaryDirectory(prefix="exam-emacs-clipboard-") as directory:
    Path(directory, "site-start.el").write_text(
        "(load " + json.dumps(str(config)) + " nil t)\n"
        + "(setq user-emacs-directory " + json.dumps(directory + "/") + ")\n"
    )
    pid, master = pty.fork()
    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        os.environ["EMACSLOADPATH"] = directory + os.pathsep
        os.execvp("emacs", ["emacs", "-nw", "-q", "--no-splash", "--eval",
            '(progn (switch-to-buffer (get-buffer-create "clipboard-test")) '
            '(insert ' + json.dumps(text, ensure_ascii=False) + ') '
            '(goto-char (point-min)) (set-mark (point-max)) '
            '(activate-mark) (message "CLIPBOARD-READY"))'])
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 100, 0, 0))
    output = bytearray()
    sent = False
    deadline = time.monotonic() + 15
    try:
        while time.monotonic() < deadline:
            if not select.select([master], [], [], .1)[0]:
                continue
            chunk = os.read(master, 65536)
            if not chunk:
                break
            output.extend(chunk)
            if not sent and b"CLIPBOARD-READY" in output:
                os.write(master, b"\x17")  # real C-w, with the default binding
                sent = True
            if b"\x1b]52;c;" in output and output.endswith((b"\x1b\\", b"\x07")):
                break
            if b"\x1b]52;c;" in output:
                # The sequence and subsequent redraw may share a read.
                tail = output.split(b"\x1b]52;c;", 1)[1]
                if b"\x1b\\" in tail or b"\x07" in tail:
                    break
        if b"\x1b]52;c;" not in output:
            raise RuntimeError("Emacs did not emit an OSC 52 clipboard write")
        sys.stdout.buffer.write(output)
    finally:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
        os.close(master)
