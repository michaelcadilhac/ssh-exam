"""Retry only an old nginx fence after the exact normal site is installed.

The unchanged complete check keeps its own request timeouts. Five seconds is the
retry budget; other HTTP, asset-digest and site-identity failures are definitive.
"""
import time
from urllib.error import HTTPError


def run(check, opened, normal_installed):
    deadline = time.monotonic() + 5
    while True:
        try:
            return check()
        except HTTPError as error:
            if (
                not opened
                or error.code != 503
                or error.headers.get("Retry-After") != "60"
                or not normal_installed()
            ):
                raise
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise
            time.sleep(min(0.1, remaining))
            if time.monotonic() >= deadline or not normal_installed():
                raise
