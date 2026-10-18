#!/usr/bin/env python3
"""Rebuild the pinned D2 compatibility package; requires Go 1.27.1 and Bun 1.3.14."""
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent
COMMIT = "d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda"
VERSION = "0.1.34-zoomflow.1"
BUN = os.environ.get("D2_BUILD_BUN", "bun")


def run(*args, cwd=None, env=None):
    subprocess.run(args, cwd=cwd, env=env, check=True)


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


if output("go", "version").split()[2] != "go1.27.1":
    raise SystemExit("Use Go 1.27.1 (the pinned WASM compiler)")
if output(BUN, "--version") != "1.3.14":
    raise SystemExit("Use Bun 1.3.14 (or set D2_BUILD_BUN to its executable)")

with tempfile.TemporaryDirectory(prefix="zoomflow-d2-build-") as temp:
    source = Path(temp) / "source"
    run("git", "init", "-q", str(source))
    run("git", "-C", str(source), "fetch", "-q", "--depth=1", "https://github.com/d2lang/d2.git", COMMIT)
    run("git", "-C", str(source), "checkout", "-q", "--detach", "FETCH_HEAD")
    run("go", "mod", "download", cwd=source)
    run("go", "mod", "verify", cwd=source)
    run("go", "mod", "vendor", cwd=source)
    run("git", "apply", "--check", str(ROOT / "goldmark-linkify.patch"), cwd=source)
    run("git", "apply", str(ROOT / "goldmark-linkify.patch"), cwd=source)
    goldmark = source / "vendor/github.com/yuin/goldmark"
    shutil.copyfile(ROOT / "linkify_compat_test.go", goldmark / "extension/zoomflow_compat_test.go")
    run("go", "test", "-mod=vendor", "./vendor/github.com/yuin/goldmark/extension", cwd=source)

    package = source / "d2js/js"
    wasm = package / "wasm/d2.wasm"
    wasm.parent.mkdir(exist_ok=True)
    flags = "-s -w -buildid= -X github.com/d2lang/d2/lib/version.Version=v0.9.0 " + \
            f"-X github.com/d2lang/d2/d2js/d2wasm.jsVersion={VERSION}"
    run("go", "build", "-mod=vendor", "-buildvcs=false", "-trimpath", f"-ldflags={flags}",
        "-o", str(wasm), "./d2js", cwd=source, env={**os.environ, "GOOS": "js", "GOARCH": "wasm"})
    goroot = Path(output("go", "env", "GOROOT"))
    shutil.copyfile(goroot / "lib/wasm/wasm_exec.js", package / "wasm/wasm_exec.js")
    run(BUN, "build.js", cwd=package)

    # Keep upstream notices and add licenses/source for the changed dependency.
    shutil.copyfile(goldmark / "LICENSE", package / "GOLDMARK_LICENSE.txt")
    shutil.copyfile(ROOT / "GO_LICENSE.txt", package / "GO_LICENSE.txt")
    shutil.copyfile(ROOT / "goldmark-linkify.patch", package / "goldmark-linkify.patch")
    shutil.copyfile(goldmark / "extension/linkify.go", package / "goldmark-linkify.go")
    shutil.copyfile(ROOT / "README.md", package / "ZOOMFLOW_BUILD.md")
    manifest = json.loads((package / "package.json").read_text())
    manifest["version"] = VERSION
    manifest["files"] += ["GOLDMARK_LICENSE.txt", "GO_LICENSE.txt", "goldmark-linkify.patch",
                          "goldmark-linkify.go", "ZOOMFLOW_BUILD.md", "ZOOMFLOW_BUILD.json"]
    (package / "package.json").write_text(json.dumps(manifest, indent=2) + "\n")
    provenance = {
        "source": "https://github.com/d2lang/d2",
        "commit": COMMIT, "d2_version": "v0.9.0", "package_version": VERSION,
        "go": "1.27.1", "bun": "1.3.14", "goldmark": "1.8.5",
        "patch_sha256": digest(ROOT / "goldmark-linkify.patch"),
        "wasm_sha256": digest(wasm), "wasm_exec_sha256": digest(package / "wasm/wasm_exec.js"),
        "wasm_opt": False,
    }
    (package / "ZOOMFLOW_BUILD.json").write_text(json.dumps(provenance, indent=2) + "\n")
    (ROOT / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    for notice in ["LICENSE.txt", "THIRD_PARTY_NOTICES.txt", "GOLDMARK_LICENSE.txt", "GO_LICENSE.txt"]:
        shutil.copyfile(package / notice, ROOT / notice)

    # Stable archive metadata avoids host paths, timestamps, uid/gid and npm
    # version affecting the package checksum. Normal installs need no build tools.
    selected = set()
    for name in manifest["files"] + ["package.json", "README.md"]:
        path = package / name
        selected.update(p for p in path.rglob("*") if p.is_file()) if path.is_dir() else selected.add(path)
    archive = Path(temp) / f"d2lang-d2-{VERSION}.tgz"
    with archive.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode="w|", format=tarfile.USTAR_FORMAT) as tar:
            for path in sorted(selected):
                data = path.read_bytes()
                info = tarfile.TarInfo("package/" + path.relative_to(package).as_posix())
                info.size, info.mode, info.mtime = len(data), 0o644, 0
                tar.addfile(info, io.BytesIO(data))
    checksum = ROOT / "SHA256SUMS"
    if checksum.exists():
        previous_hash, previous_name = checksum.read_text().split()
        if previous_name == archive.name and previous_hash != digest(archive):
            raise SystemExit("Rebuild differs from the pinned checksum; preserve the artifact and investigate before changing its version")
    shutil.copyfile(archive, ROOT / archive.name)
    (ROOT / "SHA256SUMS").write_text(f"{digest(archive)}  {archive.name}\n")
    print(f"Built {archive.name}: {digest(archive)}")
