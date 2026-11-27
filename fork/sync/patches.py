"""The patch list: the patches we carry on upstream's files, and the tests that show each one survived a release
(fork/specs/sync-pipeline.md, "Patch inventory"; the fork-patch skill).

One file per patch, `fork/patches/<issue>.json`, so patches built side by side never touch the same lines and merge
without a conflict. Each holds {"issue": <n>, "name": "<short name>", "files": [<paths>], "tests": [<entries>]},
paths in the repo. A test entry is a test file's path, or, for a Python test file, `<path>::<Class>` or
`<path>::<Class>.<test>`: only those run, for a patch whose tests sit among many others in a big file
(test/test_herdr_task.py). A tree from before (no `fork/patches/`) has every line in `fork/patches.json`, as
{"patches": [<lines>]}: `read` takes that too, for old trees and the commits the install gate reads.

`read` is the one loader, for a tree or a commit. `problems` checks every line against a tree (each file and test
there, each named class or test defined), and `run` runs a line's tests the way this repo runs them: a Python file
from its own folder (`cd test && python3 -m unittest test_herdr_task.Class`, as AGENTS.md says), anything else with
`bun test` from the repo's root (bunfig's preload)."""
import ast
import json
import os
import re
import subprocess

from .release import git

DIR = "fork/patches"                 # one file per patch: fork/patches/<issue>.json
LEGACY = "fork/patches.json"         # a tree from before: every line in one file
NAME = re.compile(r"^([1-9][0-9]*)\.json$")
TIMEOUT = 900   # one entry's run, in seconds: test_herdr_task's classes take seconds, a whole file minutes
TAIL = 20       # a failed entry's last lines of output, in the step's JSON line


def _tree(repo):
    """(a folder's names, or None: no such folder; a file's text, or None: no such file), in the working tree."""
    def names(folder):
        full = os.path.join(repo, folder)
        return os.listdir(full) if os.path.isdir(full) else None

    def text(path):
        full = os.path.join(repo, path)
        if not os.path.isfile(full):
            return None
        with open(full, encoding="utf-8") as f:
            return f.read()
    return names, text


def _commit(repo, sha):
    """The same two readers at a commit, from git: nothing is checked out."""
    def kind(path):
        ok, out, _ = git(repo, "cat-file", "-t", f"{sha}:{path}")
        return out if ok else None

    def names(folder):
        if kind(folder) != "tree":
            return None
        ok, out, err = git(repo, "ls-tree", "--name-only", f"{sha}:{folder}")
        if not ok:
            raise OSError(f"can't list {folder} at {sha[:12]}: {err}")
        return out.splitlines()

    def text(path):
        if kind(path) != "blob":
            return None
        ok, out, err = git(repo, "show", f"{sha}:{path}")
        if not ok:
            raise OSError(f"can't read {path} at {sha[:12]}: {err}")
        return out
    return names, text


def _order(name):
    m = NAME.match(name)
    return (0, int(m[1]), name) if m else (1, 0, name)


def read(repo, at=None):
    """(lines, layout problems): every patch's line, in the working tree at `repo` or, with `at`, at that commit.

    The lines come from `fork/patches/*.json` in issue order, then from `fork/patches.json` when the tree has it.
    Layout problems, one plain line each: a file in `fork/patches/` that isn't `<issue>.json` for its own issue, and
    the old list beside the new folder (a rebase that kept it). Raises OSError when the tree has neither, and
    ValueError, KeyError or TypeError when a file isn't a patch's JSON."""
    names, text = _commit(repo, at) if at else _tree(repo)
    folder, legacy = names(DIR), text(LEGACY)
    if folder is None and legacy is None:
        raise FileNotFoundError(f"neither {DIR}/ nor {LEGACY} is there")
    lines, found = [], []
    for n in sorted(folder or [], key=_order):
        path = f"{DIR}/{n}"
        if not n.endswith(".json"):
            found.append(f"{path}: only <issue>.json files go in {DIR}/")
            continue
        body = text(path)
        if body is None:                                   # a folder named like a file
            found.append(f"{path}: not a file")
            continue
        line = json.loads(body)
        if not isinstance(line, dict):
            raise TypeError(f"{path} isn't one patch's line")
        m, issue = NAME.match(n), line.get("issue")
        if not m:
            found.append(f"{path}: name it <issue>.json")
        elif isinstance(issue, bool) or issue != int(m[1]):
            found.append(f"{path}: its issue is {json.dumps(issue)}, its name says {m[1]}")
        lines.append(line)
    if legacy is not None:
        old = json.loads(legacy)["patches"]
        if not isinstance(old, list):
            raise TypeError(f"{LEGACY}'s patches isn't a list")
        if folder is not None:
            found.append(f"{LEGACY} is the old list: move each of its lines to {DIR}/<issue>.json")
        lines += old
    return lines, found


def split(entry):
    """`<path>` or `<path>::<name>` -> (path, name or None)."""
    path, _, name = entry.partition("::")
    return path, name or None


def defined(source, name):
    """`Class` or `Class.test` is defined at the top level of that Python source."""
    cls, _, test = name.partition(".")
    for node in ast.parse(source).body:
        if isinstance(node, ast.ClassDef) and node.name == cls:
            return not test or any(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == test
                                   for n in node.body)
    return False


def problems(repo, patches):
    """What is wrong with the lines against the tree at `repo`, one plain line each: [] when every line names its
    issue, real files and tests that exist."""
    out, seen = [], set()
    for i, p in enumerate(patches):
        issue = p.get("issue") if isinstance(p, dict) else None
        if isinstance(issue, bool) or not isinstance(issue, int):
            issue = None
        at = f"#{issue}" if issue is not None else f"line {i + 1}"
        if issue is None:
            out.append(f"{at}: no issue number")
        elif issue in seen:
            out.append(f"{at}: listed twice")
        seen.add(issue)
        if not isinstance(p, dict):
            continue
        if not isinstance(p.get("name"), str) or not p["name"].strip():
            out.append(f"{at}: no name")
        named = {}
        for key in ("files", "tests"):
            v = p.get(key)
            named[key] = [x for x in v if isinstance(x, str) and x] if isinstance(v, list) else []
            if not isinstance(v, list) or not v or len(named[key]) != len(v):
                out.append(f"{at}: no {key}")
        for f in named["files"]:
            if not os.path.isfile(os.path.join(repo, f)):
                out.append(f"{at}: {f} isn't there")
        for t in named["tests"]:
            path, name = split(t)
            full = os.path.join(repo, path)
            if not os.path.isfile(full):
                out.append(f"{at}: {path} isn't there")
            elif name is not None:
                if not path.endswith(".py"):
                    out.append(f"{at}: {t}: only a Python test file names its tests")
                    continue
                with open(full, encoding="utf-8") as f:
                    if not defined(f.read(), name):
                        out.append(f"{at}: {path} has no {name}")
    return out


def command(entry):
    """(folder in the repo, argv) that runs one test entry."""
    path, name = split(entry)
    folder, base = os.path.split(path)
    if path.endswith(".py"):
        mod = base[:-3]
        return folder or ".", ["python3", "-m", "unittest", f"{mod}.{name}" if name else mod]
    return ".", ["bun", "test", "./" + path]


def tail(text, n=TAIL):
    return "\n".join(text.rstrip().splitlines()[-n:])


def run(repo, patch, timeout=TIMEOUT):
    """Each of the line's test entries, run: [{"test", "ok", "tail" (a failure's last lines)}]."""
    results = []
    for entry in patch["tests"]:
        folder, argv = command(entry)
        try:
            r = subprocess.run(argv, cwd=os.path.join(repo, folder), capture_output=True, text=True, timeout=timeout)
            ok, out = r.returncode == 0, (r.stdout or "") + (r.stderr or "")
        except subprocess.TimeoutExpired:
            ok, out = False, f"timed out after {timeout} s"
        except OSError as e:
            ok, out = False, f"can't run {argv[0]} ({type(e).__name__})"
        results.append({"test": entry, "ok": ok, **({} if ok else {"tail": tail(out)})})
    return results
