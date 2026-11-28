"""Our repo's label set, and the one migration to it (fork/specs/issue-loop.md, "Labels" and "Data").

A label says only what GitHub can't: open and closed, the close reason, linked pull requests and pinned issues are
GitHub's own. One label per family, at most one flow label.

`fork/bin/sync labels` is a dry run: it reads the repo's labels, open issues and open pull requests, and lists, per
open issue, its labels before and after. `--apply` then:
1. creates or updates every label of the set (name, colour, description);
2. relabels each open issue that changes (one `gh issue edit` each), and pins the handover issue;
3. only when every issue went in and a fresh read finds no open issue still holding an old label: deletes the old
   labels from the repo.
It never closes, reopens or edits an issue's words. Run again, it writes only what is still different.
"""
import json
import re

from . import state
from .issues import body_part_of

# (name, colour, description): the set, in its families' order
SET = [
    ("bug", "d73a4a", "Something is broken"),
    ("enhancement", "a2eeef", "Something new"),
    ("patch", "0e8a16", "Shepherdr's code: a change we carry"),
    ("pipeline", "5319e7", "This fork's own machinery: specs, skills, scripts"),
    ("score:1", "ededed", "Triage's score: an idea"),
    ("score:2", "d4e5f7", "Triage's score: looks or wording on rarely used screens"),
    ("score:3", "fbca04", "Triage's score: an agent did by hand what should happen by itself"),
    ("score:4", "f9a03f", "Triage's score: things run but stall or lie"),
    ("score:5", "b60205", "Triage's score: work stops, or something real is at risk"),
    ("needs-triage", "c5def5", "New: not scored yet"),
    ("ready", "0052cc", "The go: start a fix"),
    ("fixing", "1d76db", "A task is on it"),
    ("decision", "d876e3", "Only the person can settle it: ready, later, or close as not planned"),
    ("blocked", "e99695", "Tried and couldn't: waits for the person"),
    ("later", "bfdadc", "Not now"),
    ("device-check", "c2e0c6", "Live, but only a real device can confirm it: please check"),
    ("sync-blocked", "b60205", "An upstream release waits on this patch"),
    ("fixed-upstream", "006b75", "Upstream shipped it; our patch was dropped"),
]
NAMES = [n for n, _, _ in SET]
KINDS = ("bug", "enhancement")
AREAS = ("patch", "pipeline")
FLOW = ("needs-triage", "ready", "fixing", "decision", "blocked", "later")
# not a flow label, but an issue holding one already says where it stands: no needs-triage
STANDS = ("device-check", "sync-blocked")
RENAMED = {"on-hold": "later"}
HANDOVER = "handover"
BROKEN = re.compile(r"\b(?:fail\w*|broken|breaks?|crash\w*|bug|errors?|wrong|lost|stuck|can't|cannot|doesn't|"
                    r"isn't|won't|not \w+ed|cancel+ed|refused)\b", re.I)


def labels_of(issue):
    return {(x.get("name") if isinstance(x, dict) else str(x)) for x in issue.get("labels") or []}


def target(issue, has_patch_file, in_work):
    """The labels an open issue ends with, from its own: (labels, pin, guessed kind)."""
    old = labels_of(issue)
    if HANDOVER in old or issue.get("isPinned"):
        # the handover issue: pinned instead (GitHub's own), and left out of the flow
        return sorted(old & set(NAMES)), True, False
    new = {RENAMED.get(x, x) for x in old} & set(NAMES)
    guessed = False
    if set(KINDS) <= new:
        new.discard("enhancement")          # one kind: something broken says more
    if not new & set(KINDS):
        new.add("bug" if BROKEN.search(str(issue.get("title") or "")) else "enhancement")
        guessed = True
    areas = new & set(AREAS)
    if len(areas) != 1:
        new -= set(AREAS)
        new.add("patch" if has_patch_file else "pipeline")
    flows = [f for f in FLOW if f in new]
    if len(flows) > 1:
        # one flow label: what holds it back wins over what moves it ("later" over the rest)
        keep = "later" if "later" in flows else flows[0]
        new -= set(flows) - {keep}
    elif not flows and not new & set(STANDS):
        new.add("fixing" if in_work else "needs-triage")
    return sorted(new), False, guessed


def plan(issues, patch_files, open_prs):
    """[{number, title, before, after, add, remove, pin, guessed}] for every open issue, from the open issues
    ([{number, title, labels, isPinned}]), the issue numbers with a `fork/patches/<n>.json`, and the open pull
    requests ([{body}])."""
    in_work = set()
    for pr in open_prs or []:
        in_work |= body_part_of(pr.get("body"))
    out = []
    for issue in sorted(issues, key=lambda i: i.get("number") or 0):
        n, before = issue.get("number"), labels_of(issue)
        after, pin, guessed = target(issue, n in patch_files, n in in_work)
        out.append({"number": n, "title": issue.get("title") or "", "before": sorted(before), "after": after,
                    "add": sorted(set(after) - before), "remove": sorted(before - set(after)),
                    "pin": pin and not issue.get("isPinned"), "guessed": guessed})
    return out


def label_writes(existing):
    """The `gh label` calls that make the repo's set: [(args, name)]."""
    have = {x.get("name"): x for x in existing or []}
    calls = []
    for name, colour, words in SET:
        x = have.get(name)
        if x is None:
            calls.append((["label", "create", name, "--color", colour, "--description", words], name))
        elif (x.get("color") or "").lower() != colour or (x.get("description") or "") != words:
            calls.append((["label", "edit", name, "--color", colour, "--description", words], name))
    return calls


def gh_json(gh, *args):
    ok, out, _ = gh(*args)
    if not ok:
        return None
    try:
        return json.loads(out)
    except ValueError:
        return None


def read(gh):
    labels = gh_json(gh, "label", "list", "-R", state.REPO, "--limit", "200", "--json", "name,color,description")
    issues = gh_json(gh, "issue", "list", "-R", state.REPO, "--state", "open", "--limit", "500",
                     "--json", "number,title,labels,isPinned")
    prs = gh_json(gh, "pr", "list", "-R", state.REPO, "--state", "open", "--limit", "200", "--json", "number,body")
    if not all(isinstance(x, list) for x in (labels, issues, prs)):
        raise state.Refused("our labels, issues or pull requests can't be read from GitHub: call labels again",
                            outcome="wait")
    return labels, issues, prs


def run(gh, patch_files, apply=False):
    labels, issues, prs = read(gh)
    moves = plan(issues, patch_files, prs)
    changes = [m for m in moves if m["add"] or m["remove"] or m["pin"]]
    old = sorted(x.get("name") for x in labels if x.get("name") not in NAMES)
    out = {"dry_run": not apply, "issues": len(moves), "changes": changes, "unchanged": len(moves) - len(changes),
           "labels_to_write": [n for _, n in label_writes(labels)], "labels_to_delete": old}
    if not apply:
        return out
    failed = []
    for args, name in label_writes(labels):
        ok, _, _ = gh(*args, "-R", state.REPO)
        if not ok:
            failed.append(f"label {name}")
    if failed:
        raise state.Refused("GitHub refused a label: call labels --apply again", outcome="wait", failed=failed, **out)
    for m in changes:
        args = ["issue", "edit", str(m["number"]), "-R", state.REPO]
        if m["add"]:
            args += ["--add-label", ",".join(m["add"])]
        if m["remove"]:
            args += ["--remove-label", ",".join(m["remove"])]
        ok = True
        if len(args) > 5:
            ok, _, _ = gh(*args)
        if ok and m["pin"]:
            ok, _, _ = gh("issue", "pin", str(m["number"]), "-R", state.REPO)
        if not ok:
            failed.append(m["number"])
    if failed:
        raise state.Refused(f"GitHub refused {len(failed)} issue edits: call labels --apply again (old labels stay "
                            "until every issue is moved)", outcome="wait", failed=failed, **out)
    _, fresh, _ = read(gh)
    holding = sorted(i["number"] for i in fresh if labels_of(i) - set(NAMES))
    if holding:
        raise state.Refused("some open issues still hold an old label: call labels --apply again", outcome="wait",
                            holding=holding, **out)
    deleted = []
    for name in old:
        ok, _, _ = gh("label", "delete", name, "-R", state.REPO, "--yes")
        (deleted if ok else failed).append(name)
    out["deleted"] = deleted
    if failed:
        raise state.Refused("GitHub refused deleting a label: call labels --apply again", outcome="wait",
                            failed=failed, **out)
    return out
