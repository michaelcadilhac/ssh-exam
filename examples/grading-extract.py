#!/usr/bin/env python3
"""Bounded extraction for the offline grading example; never use tar.extractall.

Authored materials are extracted on the controller; student archives are extracted
only by the unprivileged container. No JSON/student programs are evaluated here.
"""
import argparse
import os
from pathlib import Path, PurePosixPath
import shutil
import tarfile


def extract(archive: Path, destination: Path, materials: bool) -> None:
    maximum = (16 if materials else 512) * 1024**2
    per_file = (16 if materials else 128) * 1024**2
    total = 0
    seen = set()
    if not destination.is_dir() or destination.is_symlink() or any(destination.iterdir()):
        raise ValueError("extraction destination must be an empty real directory")
    with tarfile.open(archive, "r:gz") as source:
        for index, member in enumerate(source):
            name = member.name
            parts = PurePosixPath(name).parts
            if (index >= 10000 or not name or len(name) > 4096 or "\x00" in name
                    or name.startswith("/") or not parts or len(parts) > 32
                    or any(p in ("", ".", "..") for p in name.split("/"))):
                raise ValueError("unsafe archive name/count/depth")
            if name in seen or not (member.isfile() or member.isdir()):
                raise ValueError("duplicate name, link or special archive entry")
            seen.add(name)
            if not materials and name == "MANIFEST.json":
                if not member.isfile() or not 0 <= member.size <= 64 * 1024**2:
                    raise ValueError("invalid protected manifest entry")
                continue
            if not 0 <= member.size <= per_file:
                raise ValueError("archive file exceeds grading bound")
            if member.isfile():
                total += member.size
                if total > maximum:
                    raise ValueError("archive exceeds grading bound")
            target = destination.joinpath(*parts)
            target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            if member.isdir():
                target.mkdir(mode=0o755, exist_ok=True)
                continue
            with source.extractfile(member) as reader, target.open("xb") as writer:
                shutil.copyfileobj(reader, writer, 65536)
                if writer.tell() != member.size:
                    raise ValueError("short archive member")
            # Never restore submitted execute/setuid/ownership/xattr metadata.
            target.chmod(0o555 if materials and name == "grade" else 0o444 if materials else 0o644)
    for path in destination.rglob("*"):
        if path.is_dir():
            path.chmod(0o555 if materials else 0o755)
    destination.chmod(0o555 if materials else 0o700)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=("materials", "submission"))
    parser.add_argument("archive", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    try:
        extract(args.archive, args.destination, args.kind == "materials")
    except (OSError, ValueError, tarfile.TarError) as error:
        parser.exit(1, "Archive refused: " + str(error) + "\n")
