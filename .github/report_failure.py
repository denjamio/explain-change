"""Turns a CI failure into GitHub annotations, which anyone can read on the run page without signing in.

    python .github/report_failure.py tests <unittest log>   # each FAIL / ERROR with its traceback
    python .github/report_failure.py examples               # what changed in each rebuilt example report
"""
import json
import re
import subprocess
import sys

MAX_ANNOTATIONS = 10  # GitHub shows at most 10 errors per step
MAX_CHARS = 3500


def annotate(title: str, body: str):  # stdout is UTF-8 (see __main__), so any traceback prints
    body = body[-MAX_CHARS:] if len(body) > MAX_CHARS else body
    esc = body.replace("%", "%25").replace("\r", "").replace("\n", "%0A")
    print(f"::error title={title.replace(',', ';').replace(':', ' ')}::{esc}")


def tests(log_path: str):
    text = open(log_path, encoding="utf-8", errors="replace").read().replace("\r\n", "\n")
    blocks = re.findall(r"^={20,}\n((?:FAIL|ERROR): .+?)\n-{20,}\n(.*?)(?=^={20,}\n|^-{20,}\nRan )", text, re.M | re.S)
    for head, trace in blocks[:MAX_ANNOTATIONS]:
        annotate(head, trace.strip())
    if not blocks:
        annotate("tests failed", text[-MAX_CHARS:])


def report_data(html: str):
    m = re.search(r'<script type="application/json" id="ec-data">(.*?)</script>', html, re.S)
    return json.loads(m.group(1).replace("<\\/", "</")) if m else None


def differences(a, b, path="$", out=None):
    out = [] if out is None else out
    if len(out) >= 15:
        return out
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b), key=str):
            differences(a.get(k, "<missing>"), b.get(k, "<missing>"), f"{path}.{k}", out)
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b, strict=True)):
            differences(x, y, f"{path}[{i}]", out)
    elif a != b:
        out.append(f"{path}: {json.dumps(a, ensure_ascii=False)[:200]} -> {json.dumps(b, ensure_ascii=False)[:200]}")
    return out


def examples():
    changed = subprocess.run(["git", "diff", "--name-only", "--", "examples/"], capture_output=True, text=True).stdout
    for path in changed.split()[:MAX_ANNOTATIONS]:
        old = subprocess.run(["git", "show", f"HEAD:{path}"], capture_output=True, text=True, encoding="utf-8").stdout
        new = open(path, encoding="utf-8").read()
        if path.endswith(".html") and report_data(old) is not None:
            diffs = differences(report_data(old), report_data(new)) or ["the data is equal; the template or CSS differ"]
        else:
            diffs = [subprocess.run(["git", "diff", "-U1", "--", path], capture_output=True, text=True).stdout]
        annotate(f"{path} is out of date", "\n".join(diffs))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    tests(sys.argv[2]) if sys.argv[1] == "tests" else examples()
