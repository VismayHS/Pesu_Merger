"""Used by the installers to check the converter. Prints one line of JSON:
    {"ok": true/false, "office": ["powerpoint", "word", ...], "libreoffice": "<path or empty>", "error": "..."}

    selftest.py <launcher>   start the helper through its launcher, as the browser does, and ask it what it can do
    selftest.py              ask the helper's code directly without starting it (used by --dry-run)
"""
import json
import os
import struct
import subprocess
import sys
import threading

OUT = sys.stdout  # the helper module redirects sys.stdout when it is imported


def via_launcher(launcher):
    p = subprocess.Popen([launcher], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    watchdog = threading.Timer(30, p.kill)
    watchdog.start()
    try:
        msg = json.dumps({"id": 1, "op": "ping", "meta": {}, "chunks": 0}).encode()
        p.stdin.write(struct.pack("<I", len(msg)) + msg)
        p.stdin.flush()
        head = p.stdout.read(4)
        if len(head) < 4:
            raise RuntimeError("the helper did not answer")
        reply = json.loads(p.stdout.read(struct.unpack("<I", head)[0]))
        if not reply.get("ok"):
            raise RuntimeError(reply.get("error") or "the helper reported an error")
        return reply.get("meta") or {}
    finally:
        watchdog.cancel()
        try:
            p.stdin.close()  # the helper exits when its input closes
        except Exception:
            pass
        try:
            p.wait(timeout=5)
        except Exception:
            p.kill()


def direct():
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import pesu_host

    meta, _ = pesu_host.op_ping({}, None)
    return meta


def main():
    out = {"ok": False, "office": [], "libreoffice": ""}
    try:
        meta = via_launcher(sys.argv[1]) if len(sys.argv) > 1 else direct()
        out["ok"] = True
        out["office"] = [k for k, v in (meta.get("office") or {}).items() if v]
        out["libreoffice"] = meta.get("libreoffice") or ""
    except Exception as e:
        out["error"] = str(e)
    OUT.write(json.dumps(out) + "\n")
    OUT.flush()


if __name__ == "__main__":
    main()
