#!/usr/bin/env python3
"""Remove reviewed upstream secrets and build debris; preserve retained source."""

import argparse
import copy
import gzip
import hashlib
import json
import posixpath
import tarfile
from pathlib import Path, PurePosixPath


UPSTREAM_COMMIT = "76f3f135b7b27d2aa519f265b56bfc49a2573ab5"
ARCHIVE_ROOT = f"FreshCryptoLib-{UPSTREAM_COMMIT}"
EXCLUDED_PATHS = {
    f"{ARCHIVE_ROOT}/solidity/utils/deploy.sh":
        "Contains embedded third-party service credentials; not used by the account build.",
    f"{ARCHIVE_ROOT}/solidity/tests/hardhat/res.dat":
        "Contains an upstream test private-key log; not used by the account build.",
}
EXCLUDED_PREFIXES = {
    f"{ARCHIVE_ROOT}/solidity/tests/hardhat/node_modules/":
        "Vendored test dependencies contain upstream machine metadata; unused by the account build.",
    f"{ARCHIVE_ROOT}/solidity/tests/hardhat/cache/":
        "Generated Hardhat cache contains upstream machine paths; unused by the account build.",
    f"{ARCHIVE_ROOT}/solidity/tests/hardhat/artifacts/":
        "Generated Hardhat test artifacts are not source and are unused by the account build.",
}


def excluded_reason(name):
    if name in EXCLUDED_PATHS:
        return EXCLUDED_PATHS[name]
    for prefix, reason in EXCLUDED_PREFIXES.items():
        if name == prefix.rstrip("/") or name.startswith(prefix):
            return reason
    return None


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_member(member):
    path = PurePosixPath(member.name)
    if (
        not member.name
        or "\\" in member.name
        or path.is_absolute()
        or ".." in path.parts
        or path.parts[0] != ARCHIVE_ROOT
        or not (member.isfile() or member.isdir() or member.issym() or member.islnk())
    ):
        raise ValueError("The input archive contains an unexpected member path or type.")
    if member.issym() or member.islnk():
        link = PurePosixPath(member.linkname)
        if not member.linkname or "\\" in member.linkname or link.is_absolute():
            raise ValueError("The input archive contains an unsafe link target.")
        target = posixpath.normpath(
            posixpath.join(str(path.parent), member.linkname)
            if member.issym() else member.linkname
        )
        if (
            target != ARCHIVE_ROOT
            and not target.startswith(f"{ARCHIVE_ROOT}/")
        ) or (excluded_reason(target) and not excluded_reason(member.name)):
            raise ValueError("An archive link escapes its root or targets an excluded file.")


def checked_members(archive):
    members = archive.getmembers()
    names = set()
    for member in members:
        validate_member(member)
        if member.name in names:
            raise ValueError("The input archive contains duplicate member paths.")
        names.add(member.name)
    if not EXCLUDED_PATHS.keys() <= names or any(
        not any(name == prefix.rstrip("/") or name.startswith(prefix) for name in names)
        for prefix in EXCLUDED_PREFIXES
    ):
        raise ValueError("The input is not the complete reviewed upstream archive.")
    return members


def compare_retained_files(original, sanitized):
    regular_files = links = directories = payload_bytes = 0
    with tarfile.open(original, "r:gz") as source, tarfile.open(sanitized, "r:gz") as result:
        expected = {
            member.name: member
            for member in checked_members(source)
            if not excluded_reason(member.name)
        }
        actual_members = result.getmembers()
        actual = {member.name: member for member in actual_members}
        if len(actual) != len(actual_members) or expected.keys() != actual.keys():
            raise ValueError("The sanitized archive has unexpected paths.")
        for name, before in expected.items():
            after = actual[name]
            validate_member(after)
            if (before.type, before.mode, before.size, before.linkname) != (
                after.type, after.mode, after.size, after.linkname
            ):
                raise ValueError("A retained member changed type, mode, size, or link target.")
            if (after.uid, after.gid, after.uname, after.gname, after.mtime) != (0, 0, "", "", 0):
                raise ValueError("The sanitized archive metadata is not normalized.")
            if before.isfile():
                with source.extractfile(before) as left, result.extractfile(after) as right:
                    while True:
                        chunk = left.read(1024 * 1024)
                        if chunk != right.read(1024 * 1024):
                            raise ValueError("A retained regular-file payload changed.")
                        if not chunk:
                            break
                regular_files += 1
                payload_bytes += before.size
            elif before.isdir():
                directories += 1
            else:
                links += 1
    return {
        "retainedRegularFiles": regular_files,
        "retainedDirectories": directories,
        "retainedLinks": links,
        "retainedPayloadBytes": payload_bytes,
        "allRetainedPayloadsIdentical": True,
        "allRetainedModesAndLinkTargetsIdentical": True,
        "exactExcludedPathSetVerified": True,
    }


def sanitize(original, destination):
    if original.resolve() == destination.resolve():
        raise ValueError("Use a new destination and preserve the original archive separately.")
    if destination.exists():
        raise ValueError("The destination already exists.")
    with tarfile.open(original, "r:gz") as source:
        members = checked_members(source)
        # Empty gzip filename and fixed times keep the transformation reproducible.
        with destination.open("xb") as raw:
            with gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as compressed:
                with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as result:
                    for member in members:
                        if excluded_reason(member.name):
                            continue
                        normalized = copy.copy(member)
                        normalized.uid = normalized.gid = normalized.mtime = 0
                        normalized.uname = normalized.gname = ""
                        normalized.pax_headers = {}
                        if member.isfile():
                            with source.extractfile(member) as payload:
                                result.addfile(normalized, payload)
                        else:
                            result.addfile(normalized)
    return {
        "upstreamCommit": UPSTREAM_COMMIT,
        "originalSha256": sha256(original),
        "sanitizedSha256": sha256(destination),
        "excludedPaths": EXCLUDED_PATHS,
        "excludedPrefixes": EXCLUDED_PREFIXES,
        "excludedMemberCount": sum(bool(excluded_reason(member.name)) for member in members),
        "excludedPayloadBytes": sum(member.size for member in members if excluded_reason(member.name)),
        "verification": compare_retained_files(original, destination),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("original", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    try:
        result = sanitize(args.original, args.destination)
    except (OSError, ValueError, tarfile.TarError) as error:
        parser.exit(1, f"Sanitization failed: {error}\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
