"""PESU Downloader - native messaging helper.

Chrome/Brave/Edge start this process when the extension connects to "com.pesu.downloader".
It converts Office documents (pptx/ppt/docx/doc/xlsx/odp/odt/rtf/...) to PDF and repairs
PDFs that cannot be merged (encrypted / damaged).

Conversion engines, in order (configurable per request):
  1. Microsoft Office via COM (Windows only; persistent PowerShell worker -> best fidelity)
  2. LibreOffice (soffice --headless --convert-to pdf) - Windows, macOS and Linux

Runs on Windows, macOS and Linux with Python 3.8+.

Protocol: Chrome native messaging (4-byte little-endian length + UTF-8 JSON).
Requests:  {"id":N, "op":"...", "meta":{...}, "chunks":K}  followed by K x {"id":N,"op":"chunk","i":i,"data":b64}
Responses: {"id":N, "type":"result", "ok":true, "meta":{...}, "chunks":M} followed by M x {"id":N,"type":"chunk","i":i,"data":b64}
           {"id":N, "type":"result", "ok":false, "error":"..."}
Only the standard library is required. pypdf / PyMuPDF are used for PDF repair when present.
"""
import base64
import io
import json
import os
import queue
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
import traceback

VERSION = "1.0.0"
HERE = os.path.dirname(os.path.abspath(__file__))
IS_WIN = os.name == "nt"
IS_MAC = sys.platform == "darwin"


def _appdir():
    if IS_WIN:
        base = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
        return os.path.join(base, "PESUDownloader")
    if IS_MAC:
        return os.path.expanduser("~/Library/Application Support/PESUDownloader")
    base = os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")
    return os.path.join(base, "pesu-downloader")


APPDIR = _appdir()
try:
    os.makedirs(APPDIR, exist_ok=True)
except OSError:
    APPDIR = os.path.join(tempfile.gettempdir(), "PESUDownloader")
    os.makedirs(APPDIR, exist_ok=True)
LOGFILE = os.path.join(APPDIR, "host.log")
OUT_CHUNK = 600 * 1024  # raw bytes per outgoing chunk (base64 + JSON stays < 1 MB Chrome limit)
CREATE_NO_WINDOW = 0x08000000

POWERPOINT_EXT = {"ppt", "pptx", "pptm", "pps", "ppsx", "ppsm", "pot", "potx", "potm", "odp"}
WORD_EXT = {"doc", "docx", "docm", "dot", "dotx", "dotm", "rtf", "odt", "wpd", "txt", "htm", "html", "xml"}
EXCEL_EXT = {"xls", "xlsx", "xlsm", "xlsb", "ods", "csv"}


def log(*a):
    try:
        if os.path.exists(LOGFILE) and os.path.getsize(LOGFILE) > 2 * 1024 * 1024:
            os.replace(LOGFILE, LOGFILE + ".1")
        with open(LOGFILE, "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(x) for x in a) + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------- messaging
_stdin = sys.stdin.buffer
_stdout = sys.stdout.buffer
if os.name == "nt":
    import msvcrt

    msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
    msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
# Anything a library prints must never reach the protocol stream.
sys.stdout = sys.stderr
_out_lock = threading.Lock()


def _read_exact(n):
    buf = b""
    while len(buf) < n:
        part = _stdin.read(n - len(buf))
        if not part:
            return None
        buf += part
    return buf


def read_message():
    raw = _read_exact(4)
    if raw is None:
        return None
    (n,) = struct.unpack("<I", raw)
    data = _read_exact(n)
    if data is None:
        return None
    return json.loads(data.decode("utf-8"))


def send(obj):
    data = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    with _out_lock:
        _stdout.write(struct.pack("<I", len(data)))
        _stdout.write(data)
        _stdout.flush()


def reply(mid, meta=None, data=None):
    chunks = [data[i:i + OUT_CHUNK] for i in range(0, len(data), OUT_CHUNK)] if data else []
    send({"id": mid, "type": "result", "ok": True, "meta": meta or {}, "chunks": len(chunks)})
    for i, c in enumerate(chunks):
        send({"id": mid, "type": "chunk", "i": i, "data": base64.b64encode(c).decode("ascii")})


def fail(mid, err):
    send({"id": mid, "type": "result", "ok": False, "error": str(err)[:2000]})


# ---------------------------------------------------------------- engine discovery
def _reg_exists(root, path):
    try:
        import winreg

        k = winreg.OpenKey(root, path)
        winreg.CloseKey(k)
        return True
    except Exception:
        return False


def office_apps():
    if os.name != "nt":
        return {}
    import winreg

    res = {}
    for kind, prog in (("powerpoint", "PowerPoint.Application"), ("word", "Word.Application"), ("excel", "Excel.Application")):
        res[kind] = _reg_exists(winreg.HKEY_CLASSES_ROOT, prog + "\\CLSID")
    return res


def find_soffice():
    cands = []
    if os.name == "nt":
        try:
            import winreg

            for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
                for sub in ("SOFTWARE\\LibreOffice\\UNO\\InstallPath", "SOFTWARE\\WOW6432Node\\LibreOffice\\UNO\\InstallPath"):
                    try:
                        k = winreg.OpenKey(root, sub)
                        v, _ = winreg.QueryValueEx(k, "")
                        cands.append(os.path.join(v, "soffice.exe"))
                    except Exception:
                        pass
        except Exception:
            pass
        for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"), os.environ.get("LOCALAPPDATA")):
            if base:
                cands.append(os.path.join(base, "LibreOffice", "program", "soffice.exe"))
    elif IS_MAC:
        for base in ("/Applications", os.path.expanduser("~/Applications")):
            cands.append(os.path.join(base, "LibreOffice.app", "Contents", "MacOS", "soffice"))
    else:
        import glob

        cands += ["/usr/bin/soffice", "/usr/bin/libreoffice", "/usr/local/bin/soffice",
                  "/usr/lib/libreoffice/program/soffice", "/usr/lib64/libreoffice/program/soffice",
                  "/snap/bin/libreoffice"]
        cands += sorted(glob.glob("/opt/libreoffice*/program/soffice"), reverse=True)
    # The browser may start us with a minimal PATH (notably on macOS), so add common bin dirs.
    extra = os.pathsep.join(["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/snap/bin"])
    path = os.environ.get("PATH", "") + ("" if IS_WIN else os.pathsep + extra)
    for name in ("soffice", "soffice.exe", "libreoffice"):
        w = shutil.which(name, path=path)
        # Skip private copies bundled inside other apps' hidden folders (e.g. ~/.cache/<app>/...).
        if w and os.sep + "." not in os.path.dirname(os.path.abspath(w)):
            cands.append(w)
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


def pdf_libs():
    libs = {}
    try:
        import fitz  # noqa: F401

        libs["pymupdf"] = True
    except Exception:
        libs["pymupdf"] = False
    try:
        import pypdf  # noqa: F401

        libs["pypdf"] = True
    except Exception:
        libs["pypdf"] = False
    return libs


# ---------------------------------------------------------------- Office worker
class OfficeWorker:
    def __init__(self):
        self.proc = None
        self.q = None
        self.lock = threading.Lock()

    def _start(self):
        script = os.path.join(HERE, "office_worker.ps1")
        self.proc = subprocess.Popen(
            ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        self.q = queue.Queue()
        proc, q = self.proc, self.q

        def pump():
            for line in iter(proc.stdout.readline, b""):
                q.put(line.decode("utf-8", "replace").strip())
            q.put(None)

        threading.Thread(target=pump, daemon=True).start()
        first = self._get(60)
        if not first or '"ready"' not in first:
            self.kill()
            raise RuntimeError("Office worker failed to start")

    def _get(self, timeout):
        deadline = time.time() + timeout
        while True:
            left = deadline - time.time()
            if left <= 0:
                raise TimeoutError("Office conversion timed out")
            try:
                line = self.q.get(timeout=left)
            except queue.Empty:
                raise TimeoutError("Office conversion timed out")
            if line is None:
                raise RuntimeError("Office worker exited")
            if line.startswith("{"):
                return line

    def convert(self, kind, src, dst, timeout=240):
        with self.lock:
            if not self.proc or self.proc.poll() is not None:
                self._start()
            req = json.dumps({"kind": kind, "in": src, "out": dst}) + "\n"
            try:
                self.proc.stdin.write(req.encode("utf-8"))
                self.proc.stdin.flush()
                res = json.loads(self._get(timeout))
            except Exception:
                self.kill()
                raise
            if not res.get("ok"):
                raise RuntimeError(res.get("error") or "Office conversion failed")

    def kill(self):
        p = self.proc
        self.proc = None
        if p and p.poll() is None:
            try:
                p.stdin.write(b'{"kind":"quit"}\n')
                p.stdin.flush()
                p.wait(timeout=8)
            except Exception:
                try:
                    subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)], capture_output=True,
                                   creationflags=CREATE_NO_WINDOW)
                except Exception:
                    pass


OFFICE = OfficeWorker()


def office_kind(ext):
    if ext in POWERPOINT_EXT:
        return "powerpoint"
    if ext in WORD_EXT:
        return "word"
    if ext in EXCEL_EXT:
        return "excel"
    return None


def convert_with_office(src, dst, ext):
    kind = office_kind(ext)
    apps = office_apps()
    if not kind or not apps.get(kind):
        raise RuntimeError("Microsoft Office (%s) not available" % (kind or ext))
    OFFICE.convert(kind, src, dst)


def convert_with_libreoffice(src, dst, ext):
    soffice = find_soffice()
    if not soffice:
        raise RuntimeError("LibreOffice not installed")
    outdir = os.path.dirname(dst)
    profile = os.path.join(APPDIR, "lo_profile")
    os.makedirs(profile, exist_ok=True)
    import pathlib

    prof_url = pathlib.Path(profile).resolve().as_uri()
    cmd = [soffice, "-env:UserInstallation=" + prof_url, "--headless", "--norestore", "--nologo",
           "--nodefault", "--nolockcheck", "--convert-to", "pdf", "--outdir", outdir, src]
    r = subprocess.run(cmd, capture_output=True, timeout=300, creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0)
    produced = os.path.join(outdir, os.path.splitext(os.path.basename(src))[0] + ".pdf")
    if not os.path.isfile(produced):
        raise RuntimeError("LibreOffice failed: " + (r.stderr or r.stdout or b"").decode("utf-8", "replace")[:300])
    if produced != dst:
        os.replace(produced, dst)


def is_pdf_file(path):
    try:
        with open(path, "rb") as f:
            return b"%PDF-" in f.read(1024)
    except Exception:
        return False


def op_convert(meta, data):
    ext = "".join(ch for ch in str(meta.get("ext") or "").lower() if ch.isalnum())[:5] or "bin"
    engine = meta.get("engine") or "auto"
    order = {"office": ["office"], "libreoffice": ["libreoffice"]}.get(engine, ["office", "libreoffice"])
    work = tempfile.mkdtemp(prefix="pesu_", dir=APPDIR)
    try:
        src = os.path.join(work, "input." + ext)
        dst = os.path.join(work, "output.pdf")
        with open(src, "wb") as f:
            f.write(data)
        errors = []
        for eng in order:
            t0 = time.time()
            try:
                if os.path.exists(dst):
                    os.remove(dst)
                if eng == "office":
                    convert_with_office(src, dst, ext)
                else:
                    convert_with_libreoffice(src, dst, ext)
                if not is_pdf_file(dst):
                    raise RuntimeError("output is not a PDF")
                with open(dst, "rb") as f:
                    out = f.read()
                log("converted", meta.get("name"), ext, "via", eng, "%.1fs" % (time.time() - t0), len(out))
                return {"engine": eng, "seconds": round(time.time() - t0, 2)}, out
            except Exception as e:
                log("convert failed", meta.get("name"), eng, repr(e))
                errors.append("%s: %s" % (eng, e))
        raise RuntimeError("; ".join(errors) or "no converter available")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def op_repair_pdf(meta, data):
    errors = []
    try:
        import fitz

        doc = fitz.open(stream=data, filetype="pdf")
        if doc.needs_pass:
            if not doc.authenticate(""):
                raise RuntimeError("PDF needs a password")
        out = doc.tobytes(garbage=3, deflate=True, encryption=fitz.PDF_ENCRYPT_NONE)
        doc.close()
        return {"engine": "pymupdf"}, out
    except Exception as e:
        errors.append("pymupdf: %s" % e)
    try:
        import pypdf

        reader = pypdf.PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            reader.decrypt("")
        writer = pypdf.PdfWriter()
        for p in reader.pages:
            writer.add_page(p)
        buf = io.BytesIO()
        writer.write(buf)
        return {"engine": "pypdf"}, buf.getvalue()
    except Exception as e:
        errors.append("pypdf: %s" % e)
    raise RuntimeError("; ".join(errors))


def op_ping(meta, data):
    return {
        "version": VERSION,
        "office": office_apps(),
        "libreoffice": find_soffice(),
        "pdf": pdf_libs(),
        "python": sys.version.split()[0],
    }, None


def _home_ok(path):
    home = os.path.normcase(os.path.abspath(os.path.expanduser("~")))
    p = os.path.normcase(os.path.abspath(path))
    return p.startswith(home + os.sep)


def op_read_file(meta, data):
    path = meta.get("path") or ""
    if not _home_ok(path) or not os.path.isfile(path):
        raise RuntimeError("file not accessible")
    with open(path, "rb") as f:
        return {"size": os.path.getsize(path)}, f.read()


def op_delete_file(meta, data):
    path = meta.get("path") or ""
    if _home_ok(path) and os.path.isfile(path):
        os.remove(path)
    return {}, None


def op_open_folder(meta, data):
    path = meta.get("path") or ""
    if not _home_ok(path):
        raise RuntimeError("folder not accessible")
    if not os.path.exists(path):
        raise RuntimeError("folder does not exist")
    if IS_WIN:
        if os.path.isfile(path):
            subprocess.Popen(["explorer", "/select,", path])
        else:
            os.startfile(path)
    elif IS_MAC:
        subprocess.Popen(["open", "-R", path] if os.path.isfile(path) else ["open", path])
    else:
        subprocess.Popen(["xdg-open", os.path.dirname(path) if os.path.isfile(path) else path])
    return {}, None


OPS = {
    "ping": op_ping,
    "convert": op_convert,
    "repair_pdf": op_repair_pdf,
    "read_file": op_read_file,
    "delete_file": op_delete_file,
    "open_folder": op_open_folder,
}


def handle(msg, data):
    mid = msg.get("id")
    op = msg.get("op")
    fn = OPS.get(op)
    if not fn:
        return fail(mid, "unknown op " + str(op))
    try:
        meta, out = fn(msg.get("meta") or {}, data)
        reply(mid, meta, out)
    except Exception as e:
        log("op error", op, traceback.format_exc())
        fail(mid, e)


def main():
    log("host start", VERSION, sys.executable)
    pending = {}
    try:
        while True:
            msg = read_message()
            if msg is None:
                break
            mid = msg.get("id")
            if msg.get("op") == "chunk":
                p = pending.get(mid)
                if p is None:
                    continue
                p["parts"][msg.get("i", 0)] = base64.b64decode(msg.get("data") or "")
                if all(x is not None for x in p["parts"]):
                    del pending[mid]
                    handle(p["msg"], b"".join(p["parts"]))
                continue
            n = int(msg.get("chunks") or 0)
            if n > 0:
                pending[mid] = {"msg": msg, "parts": [None] * n}
            else:
                handle(msg, b"")
    finally:
        OFFICE.kill()
        log("host exit")


if __name__ == "__main__":
    main()
