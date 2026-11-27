"""fork/patches.json: the patches we carry on upstream's files, and the tests that show each one survived a release
(fork/specs/sync-pipeline.md, "Patch inventory"; the fork-patch skill).

Each line is {"issue": <n>, "name": "<short name>", "files": [<paths>], "tests": [<entries>]}, paths in the repo. A
test entry is a test file's path, or, for a Python test file, `<path>::<Class>` or `<path>::<Class>.<test>`: only
those run, for a patch whose tests sit among many others in a big file (test/test_herdr_task.py).

`problems` checks every line against a tree (each file and test there, each named class or test defined), and `run`
runs a line's tests the way this repo runs them: a Python file from its own folder (`cd test && python3 -m unittest
test_herdr_task.Class`, as AGENTS.md says), anything else with `bun test` from the repo's root (bunfig's preload)."""
import ast
import json
import os
import subprocess

FILE = os.path.join("fork", "patches.json")
TIMEOUT = 900   # one entry's run, in seconds: test_herdr_task's classes take seconds, a whole file minutes
TAIL = 20       # a failed entry's last lines of output, in the step's JSON line


def read(repo):
    """The lines of fork/patches.json in that tree."""
    with open(os.path.join(repo, FILE), encoding="utf-8") as f:
        return json.load(f)["patches"]


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
