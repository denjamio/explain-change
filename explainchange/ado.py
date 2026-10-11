"""Azure DevOps pull requests: the PR's commits through git, its title and links through the `az` CLI.

Git never prompts: it authenticates with the user's own credentials first and, on an HTTPS Azure DevOps remote,
retries with the `az login` token. When az has no session or it expired, `az login` runs once, in the browser.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

from .constants import ADO_RESOURCE, AZ_TIMEOUT, FETCH_TIMEOUT, LOGIN_TIMEOUT
from .util import Fail, git

__all__ = [
    "AZ_SETUP", "ado_pr_id", "ado_web_url", "needs_login", "az_login", "az_hint", "ado_metadata", "is_ado_https",
    "is_ado_repo_url", "require_ado", "az_token", "ado_fetch", "ado_remote", "ado_source",
]

AZ_SETUP = "install the az CLI, then `az extension add --name azure-devops` and `az login`"


def ado_pr_id(pr: str) -> str:
    """The PR id from `1234`, `!1234` or a PR URL (query and fragment ignored)."""
    s = pr.strip()
    m = re.fullmatch(r"!?(\d+)", s) or re.search(r"/pullrequest/(\d+)(?:/|$)", urlsplit(s).path, re.I)
    if not m:
        raise Fail(f"Expected a PR id or a pull request URL (…/pullrequest/<id>), got '{pr}'. To explain a branch, "
                   "run `explain-change local` on it.")
    return m.group(1)


def ado_web_url(pr: str, pr_id: str) -> str:
    """The PR page from a pasted URL, without its query, so file links can append their own."""
    parts = urlsplit(pr.strip())
    if parts.scheme not in ("http", "https"):
        return ""
    path = re.sub(r"(/pullrequest/\d+).*$", r"\1", parts.path, flags=re.I)
    return f"{parts.scheme}://{parts.netloc}{path}" if path.lower().endswith(f"/pullrequest/{pr_id}") else ""


def _az(args: list[str], cwd: Path) -> subprocess.CompletedProcess | str:
    """az's result, or why it could not run."""
    az = shutil.which("az")  # full path, so az.cmd runs on Windows without a shell
    if not az:
        return "az CLI not found"
    try:
        return subprocess.run([az, *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8",
                              errors="replace", stdin=subprocess.DEVNULL, timeout=AZ_TIMEOUT)
    except subprocess.TimeoutExpired:
        return f"az timed out after {AZ_TIMEOUT}s"


def needs_login(stderr: str) -> bool:
    low = stderr.lower()
    return any(w in low for w in ("az login", "aadsts", "credentials", "unauthorized", "expired")) or bool(
        re.search(r"(?<![\w])401(?![\w])", low))  # not inside ADO codes like TF401180


_login = {"tried": False}  # az login runs at most once per command


def az_login(root: Path) -> bool:
    """Runs `az login` in the user's terminal and browser, once. Its output is shown, so a device code is too."""
    az = shutil.which("az")
    if not az or _login["tried"]:
        return False
    _login["tried"] = True
    print("explain-change: az has no valid session; running `az login`…", file=sys.stderr, flush=True)
    env = {**os.environ, "AZURE_CORE_LOGIN_EXPERIENCE_V2": "off"}  # no subscription picker to answer
    try:
        p = subprocess.run([az, "login", "--allow-no-subscriptions", "--only-show-errors", "-o", "none"], cwd=root,
                           env=env, stdout=sys.stderr, timeout=LOGIN_TIMEOUT)
    except subprocess.TimeoutExpired:
        return False
    return p.returncode == 0


def _az_logged_in(args: list[str], cwd: Path) -> subprocess.CompletedProcess | str:
    """_az, logging in and retrying once when az has no valid session."""
    p = _az(args, cwd)
    if not isinstance(p, str) and p.returncode != 0 and needs_login(p.stderr) and az_login(cwd):
        p = _az(args, cwd)
    return p


def az_hint(stderr: str) -> str:
    """az's error, with the fix for the usual causes."""
    low = stderr.lower()
    if "azure-devops" in low or "misspelled or not recognized" in low:
        return "the azure-devops extension is missing: run `az extension add --name azure-devops`"
    if needs_login(stderr):
        return "not logged in: run `az login`"
    if "organization" in low:
        return ("no organization detected from the git remote: run "
                "`az devops configure --defaults organization=https://dev.azure.com/<org>`")
    lines = [ln.strip() for ln in stderr.splitlines() if ln.strip() and not ln.lower().startswith("warning")]
    return lines[0][:200] if lines else "unknown error"


def ado_metadata(root: Path, pr_id: str, notes: list[str]) -> dict:
    """`az repos pr show`, or {} with a note saying what is missing and how to fix it."""
    p = _az_logged_in(["repos", "pr", "show", "--id", pr_id, "-o", "json"], root)
    if isinstance(p, str):
        notes.append(f"{p}: no PR title, description or file links ({AZ_SETUP}).")
        return {}
    if p.returncode != 0:
        notes.append(f"az repos pr show failed, so no PR title, description or file links: {az_hint(p.stderr)}.")
        return {}
    try:
        meta = json.loads(p.stdout)
    except json.JSONDecodeError:
        notes.append("az repos pr show returned no JSON: no PR title, description or file links.")
        return {}
    return meta if isinstance(meta, dict) else {}


def is_ado_https(url: str) -> bool:
    return bool(re.match(r"https://([^/@]*@)?(dev\.azure\.com|[^/]+\.visualstudio\.com)/", url, re.I))


def is_ado_repo_url(url: str) -> bool:
    return "/_git/" in url or "ssh.dev.azure.com" in url or "vs-ssh.visualstudio.com" in url


def require_ado(root: Path, pr: str):
    """A PR is explained from Azure DevOps: its URL, or else a remote of this repository, must be one."""
    host = urlsplit(pr.strip()).netloc.lower()
    if host:
        if not re.search(r"(^|\.)dev\.azure\.com$|\.visualstudio\.com$", host.split("@")[-1]):
            raise Fail(f"Only Azure DevOps PRs are supported, not {host}. Check out the PR branch and run "
                       "`explain-change local`.")
        return
    urls = [git(["remote", "get-url", r], root, check=False).strip().lower() for r in git(["remote"], root).split()]
    if not any(is_ado_https(u) or is_ado_repo_url(u) for u in urls):
        raise Fail("PR ids work with Azure DevOps remotes, and this repository has none. Check out the PR branch "
                   "and run `explain-change local`.")


def az_token(root: Path) -> str | None:
    """An Azure DevOps access token from `az login`, or None."""
    p = _az_logged_in(["account", "get-access-token", "--resource", ADO_RESOURCE, "--query", "accessToken",
                       "-o", "tsv"], root)
    if isinstance(p, str) or p.returncode != 0:
        return None
    return p.stdout.strip() or None


def _fetch(root: Path, args: list[str], token: str | None) -> str | None:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never"}
    if token:  # passed through the environment, never on the command line (git 2.31+)
        env.update({"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "http.extraHeader",
                    "GIT_CONFIG_VALUE_0": f"Authorization: Bearer {token}"})
    try:
        p = subprocess.run(["git", *args], cwd=root, capture_output=True, stdin=subprocess.DEVNULL, env=env,
                           timeout=FETCH_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise Fail(f"git {' '.join(args)} timed out after {FETCH_TIMEOUT}s.") from None
    return None if p.returncode == 0 else p.stderr.decode(errors="replace").strip() or "git fetch failed"


def ado_fetch(root: Path, remote: str, refspecs: list[str]) -> str | None:
    """None when every refspec was fetched, else git's error. A missing ref is returned; any other error stops."""
    args = ["fetch", "--quiet", "--no-tags", remote, *refspecs]
    err = _fetch(root, args, None)
    url = git(["remote", "get-url", remote], root, check=False).strip()
    if err and "couldn't find remote ref" not in err.lower() and is_ado_https(url):
        token = az_token(root)
        if token:
            err = _fetch(root, args, token)
    if err and "couldn't find remote ref" not in err.lower():
        raise Fail(f"git fetch from '{remote}' failed: {err.splitlines()[-1]}\n"
                   "Check that `git fetch` works in this repository, or log in with `az login` "
                   "(explain-change then uses its token for HTTPS Azure DevOps remotes).")
    return err


def ado_remote(root: Path, meta: dict) -> str:
    """The remote of the PR's repository: the one whose URL matches az's metadata, else origin, else the only one."""
    remotes = git(["remote"], root).split()
    if not remotes:
        raise Fail("This repository has no git remote to fetch the PR from.")
    repo = meta.get("repository") or {}
    known = {u.rstrip("/").lower() for u in (repo.get("remoteUrl"), repo.get("sshUrl")) if u}
    name = (repo.get("name") or "").lower()
    for r in remotes:
        url = unquote(git(["remote", "get-url", r], root, check=False).strip()).rstrip("/").lower()
        url = url[:-4] if url.endswith(".git") else url
        if url in {unquote(k) for k in known} or (name and is_ado_repo_url(url) and url.rsplit("/", 1)[-1] == name):
            return r
    if "origin" in remotes:
        return "origin"
    if len(remotes) == 1:
        return remotes[0]
    raise Fail(f"Cannot tell which remote holds the PR ({', '.join(remotes)}); name it origin or log in with az.")


def ado_source(root: Path, pr: str, notes: list[str] | None = None) -> dict:
    """The PR as a change source. Prefers ADO's merge ref (the PR applied to its target); a PR without one
    (merge conflicts, completed, abandoned) falls back to its source branch against the merge base with its target."""
    notes = [] if notes is None else notes
    pr_id = ado_pr_id(pr)
    meta = ado_metadata(root, pr_id, notes)
    remote = ado_remote(root, meta)
    ref = f"refs/explain-change/pr-{pr_id}"
    source = (meta.get("sourceRefName") or "").removeprefix("refs/heads/")
    target = (meta.get("targetRefName") or "").removeprefix("refs/heads/")

    head = base = None
    head_ref = f"{ref}/merge"
    if not ado_fetch(root, remote, [f"+refs/pull/{pr_id}/merge:{ref}/merge"]):
        parents = git(["rev-list", "--parents", "-n", "1", f"{ref}/merge"], root).split()
        if len(parents) >= 3:
            head, base = parents[0], parents[1]
    if head is None:
        head_ref = f"{ref}/source"
        if not (source and target):
            raise Fail(f"PR {pr_id} has no merge ref (merge conflicts, completed or abandoned?), and without az "
                       f"metadata its branches are unknown ({AZ_SETUP}).")
        err = ado_fetch(root, remote, [f"+refs/heads/{source}:{ref}/source", f"+refs/heads/{target}:{ref}/target"])
        if err:
            raise Fail(f"PR {pr_id} has no merge ref, and its branches '{source}' → '{target}' cannot be fetched "
                       f"from '{remote}' (deleted after completion?).")
        head = git(["rev-parse", head_ref], root).strip()
        base = git(["merge-base", f"{ref}/target", head], root).strip()
        notes.append(f"PR {pr_id} has no merge ref ({meta.get('mergeStatus') or meta.get('status') or 'unknown'}): "
                     f"explained as '{source}' against its merge base with '{target}'.")

    repo = meta.get("repository") or {}
    url = f"{repo['webUrl']}/pullrequest/{pr_id}" if repo.get("webUrl") else ado_web_url(pr, pr_id)
    return {"mode": "ado", "pr_id": pr_id, "head_ref": head_ref, "head_sha": head, "base_ref": target or base,
            "merge_base": base, "branch": source or f"pr-{pr_id}", "title": meta.get("title") or f"PR {pr_id}",
            "description": (meta.get("description") or "")[:4000], "url": url}
