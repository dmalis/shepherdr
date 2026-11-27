"""Release selection (fork/specs/sync-pipeline.md, "Release selection" and "One run", step 3), and the git helpers
the gates share.

- Releases come from `git ls-remote --tags upstream 'refs/tags/v*'`, never from local tags (`git tag -l` sees both
  remotes' tags). Only names matching `^v\\d+\\.\\d+\\.\\d+$` count; the highest by version wins.
- Its SHA is the peeled one (`^{}`). Only that tag is fetched; a local tag of that name at another SHA is a stop.
- It must be on upstream's main. Upstream's untagged main is never taken.
- The decision: the release already in origin/main and main not beyond the baseline is nothing new; in main and main
  beyond the baseline is a trial and install of main's SHA; not in main is a release to take.

The SHA, never the name, is what every later step checks."""
import re
import subprocess

from . import state
from .state import Refused

UPSTREAM = "eliasstravik/shepherdr"
GITHUB = re.compile(r"^(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)([^/]+/[^/]+?)(?:\.git)?/?$")
VERSION = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")


def git(repo, *args, timeout=600):
    """(ok, stdout stripped, stderr stripped). Never raises for git's own failures."""
    try:
        r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, "", type(e).__name__
    return r.returncode == 0, r.stdout.strip(), r.stderr.strip()


def git_to(repo, path, *args, timeout=600):
    """Runs git with its output written to a file (a diff can be large). Returns (ok, stderr)."""
    with open(path, "w", encoding="utf-8") as f:
        try:
            r = subprocess.run(["git", "-C", repo, *args], stdout=f, stderr=subprocess.PIPE, text=True, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired) as e:
            return False, type(e).__name__
    return r.returncode == 0, r.stderr.strip()


def rev(repo, ref):
    """The full commit SHA a ref names, or None."""
    ok, out, _ = git(repo, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}")
    return out if ok and state.SHA.match(out) else None


def is_ancestor(repo, a, b):
    """Whether commit a is b or an ancestor of it. A commit that isn't here is no ancestor."""
    return bool(a and b) and git(repo, "merge-base", "--is-ancestor", a, b)[0]


def tree(repo, sha):
    ok, out, _ = git(repo, "rev-parse", "--verify", "--quiet", f"{sha}^{{tree}}")
    return out if ok else None


def remote_repo(repo, remote):
    """The owner/name a remote's configured URL names on GitHub, or None (the raw config, so an `insteadOf` rule
    can't change what is checked)."""
    ok, url, _ = git(repo, "config", "--get", f"remote.{remote}.url")
    m = GITHUB.match(url) if ok else None
    return m.group(1) if m else None


def version_of(tag):
    m = VERSION.match(tag or "")
    return tuple(int(x) for x in m.groups()) if m else None


# --- upstream's releases ---

def releases(repo):
    """Upstream's release tags as [{tag, sha}], newest first: the peeled commit SHA, from `ls-remote`, never a local
    tag. Anything not named exactly vX.Y.Z is left out."""
    if remote_repo(repo, "upstream") != UPSTREAM:
        raise Refused(f"the upstream remote isn't {UPSTREAM}", outcome="held", kind="pipeline")
    ok, out, err = git(repo, "ls-remote", "--tags", "upstream", "refs/tags/v*", timeout=120)
    if not ok:
        raise Refused("upstream's tags can't be read (git ls-remote failed)", outcome="stop")
    direct, peeled = {}, {}
    for line in out.splitlines():
        sha, _, ref = line.partition("\t")
        if not ref.startswith("refs/tags/") or not state.SHA.match(sha):
            continue
        name = ref[len("refs/tags/"):]
        if name.endswith("^{}"):
            peeled[name[:-3]] = sha
        else:
            direct[name] = sha
    found = [{"tag": t, "sha": peeled.get(t, sha)} for t, sha in direct.items() if state.TAG.match(t)]
    return sorted(found, key=lambda r: version_of(r["tag"]), reverse=True)


def fetch_release(repo, rel):
    """Fetches only that tag, refusing a local tag of that name at another commit, and proves the commit is on
    upstream's main."""
    tag, sha = rel["tag"], rel["sha"]
    have = rev(repo, f"refs/tags/{tag}")
    if git(repo, "rev-parse", "--verify", "--quiet", f"refs/tags/{tag}")[0] and have != sha:
        raise Refused(f"a local tag {tag} names another commit than upstream's {sha[:12]}", outcome="held",
                      kind="pipeline")
    if not have:
        ok, _, _ = git(repo, "fetch", "--no-tags", "upstream", f"refs/tags/{tag}:refs/tags/{tag}", timeout=600)
        if not ok:
            raise Refused(f"upstream's tag {tag} can't be fetched", outcome="stop")
        if rev(repo, f"refs/tags/{tag}") != sha:
            raise Refused(f"upstream's tag {tag} doesn't name {sha[:12]} after the fetch", outcome="held",
                          kind="pipeline")
    ok, _, _ = git(repo, "fetch", "--no-tags", "upstream", "+refs/heads/main:refs/remotes/upstream/main", timeout=600)
    if not ok:
        raise Refused("upstream's main can't be fetched", outcome="stop")
    if not is_ancestor(repo, sha, "refs/remotes/upstream/main"):
        raise Refused(f"{sha} is not an ancestor of upstream's main", outcome="held", kind="pipeline")


def fetch_main(repo):
    """origin/main fetched now, pinned by its SHA."""
    if remote_repo(repo, "origin") != state.REPO:
        raise Refused(f"origin isn't {state.REPO}", outcome="held", kind="pipeline")
    ok, _, _ = git(repo, "fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main", timeout=600)
    sha = rev(repo, "refs/remotes/origin/main") if ok else None
    if not sha:
        raise Refused("origin's main can't be fetched", outcome="stop")
    return sha


def select(repo, baseline, quarantined=lambda sha: False):
    """The newest release and the run's path (One run, step 3):
    - "nothing": the release is in origin/main and main isn't beyond the baseline (or main's tip is quarantined);
    - "install-main": the release is in main and main is beyond the baseline: try main's SHA, then install it;
    - "take": the release isn't in main yet.
    `in_main` is the newest release origin/main holds: proven to be its ancestor before anything is deployed."""
    if not (baseline and state.SHA.match(baseline)):
        raise Refused("there is no baseline yet: run baseline first", outcome="stop")
    rels = releases(repo)
    if not rels:
        raise Refused("upstream has no release tag vX.Y.Z", outcome="held", kind="pipeline")
    newest = rels[0]
    fetch_release(repo, newest)
    main = fetch_main(repo)
    in_main = next((r for r in rels if is_ancestor(repo, r["sha"], main)), None)
    if not in_main:
        raise Refused("no upstream release is an ancestor of origin/main", outcome="held", kind="pipeline")
    out = {"release": newest, "main": main, "in_main": in_main, "candidate": None, "quarantined": False}
    if not is_ancestor(repo, newest["sha"], main):
        out["path"] = "take"
    elif is_ancestor(repo, main, baseline):
        out["path"] = "nothing"
    elif quarantined(main):
        out.update(path="nothing", quarantined=True)
    else:
        out.update(path="install-main", candidate=main)
    return out
