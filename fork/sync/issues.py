"""Issues after a healthy install, and the `Part of #n` a patch's pull request owes (upstream-sync skill, step 7;
FORK.md, "Every piece of work is recorded on GitHub"; fork/specs/issue-loop.md, "Close and tell").

- `issues`: one pass over our open issues after a healthy install. It reads the open issues and the merged pull
  requests once and never rewrites an issue's body:
  - **live:** an issue whose own pull request this install brought gets one comment, "Live since `<tag>` (#m)",
    with a hidden mark, so it is written once per issue and install tag. An issue with a "Device check:" line also
    gets `device-check`, the comment says "not seen on a device yet", and `device_checks` hands its words to
    finish's --says.
  - **closed only by its own fix:** an issue closes as completed only when the Triage fix linked to it (Triage's
    record, `.triage.json` in herdr-task's store) merged and runs at the installed commit. Just before the close, the
    issue is read again: one reopened or edited after that merge, or now labelled `device-check`, is left as it is
    (`left`). `fixing` comes off. Nothing closes because the patch list names it, and the pass doesn't write `live`,
    `not-filed` or `reverted` any more.
  - **fixed upstream:** an open `fixed-upstream` issue the install no longer carries gets one comment, "Fixed
    upstream in `vX.Y.Z`; ours was dropped" (once per release). It stays open for the person.
- Which issue a merged pull request is part of: its body's `Part of #n`, and else the patch files its merge commit
  changed (`fork/patches/<n>.json`, plus the umbrella a patch file names). One that names none in its body gets the
  line added to its body (`linked`); one that changes Shepherdr and names no issue at all is listed (`unlinked`).
- `part_of_missing`: the fork check's rule for a pull request: every patch file its branch adds, changes or removes
  is named by a `Part of #n` in its body (and the umbrella's). A sync pull request (`sync/*`) adapts every patch and
  names them in its own words: it is exempt.

A test never reaches GitHub: `gh` is a fake there."""
import json
import os
import re
import tempfile

from . import patches, release, state
from .release import git, is_ancestor

PART_OF = re.compile(r"\bPart of #(\d+)\b", re.I)
FENCE = re.compile(r"^ {0,3}(```|~~~)")
INLINE_CODE = re.compile(r"(`+)[^`]*?\1")
DEVICE_LINE = re.compile(r"^\s*(?:[-*]\s*)?(?:\*\*)?Device check:(?:\*\*)?\s*(.+)$", re.M)
NOT_SEEN = "not seen on a device yet"
PATCH_FILE = re.compile(r"^fork/patches/([1-9][0-9]*)\.json$")
LIVE_MARK = "<!-- shepherdr-live {} -->"
UPSTREAM_MARK = "<!-- shepherdr-upstream {} -->"
# our own files: a pull request that changes only these ships nothing (the fork check's workflow and the issue forms
# among them)
OWN_FILES = ("FORK.md", ".github/workflows/fork-check.yml")
OWN_DIRS = ("fork/", ".agents/", ".github/ISSUE_TEMPLATE/")
SYNC_BRANCH = "sync/"
LIST_LIMIT = "500"
PR_LIMIT = "100"
TRIAGE_FILE = ".triage.json"
FRESH = """query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $n) {
  state lastEditedAt labels(first: 50) { nodes { name } }
  timelineItems(itemTypes: [REOPENED_EVENT], last: 1) { nodes { ... on ReopenedEvent { createdAt } } } } } }"""


# --- reading ---

def labels_of(issue):
    return {(x.get("name") if isinstance(x, dict) else str(x)) for x in issue.get("labels") or []}


def prose(body):
    """A Markdown body without its code (fenced blocks, indented blocks, inline code spans): where an example or an
    instruction ("add `Part of #132`") sits, not a link."""
    out, fenced = [], False
    for line in str(body or "").split("\n"):
        if FENCE.match(line):
            fenced = not fenced
            continue
        if fenced or line.startswith(("    ", "\t")):
            continue
        out.append(INLINE_CODE.sub(" ", line))
    return "\n".join(out)


def body_part_of(body):
    return {int(n) for n in PART_OF.findall(prose(body))}


def changed_paths(repo, a, b):
    ok, out, _ = git(repo, "diff", "--name-only", "--no-renames", a, b)
    return [f for f in out.splitlines() if f] if ok else None


def patch_issues(repo, paths, at):
    """The issues the changed patch files name: each file's own number, and the umbrella its line at `at` names (a
    removed file's at its parent, read by the caller)."""
    out = set()
    for f in paths or []:
        m = PATCH_FILE.match(f)
        if not m:
            continue
        out.add(int(m[1]))
        for where in (at, f"{at}^"):
            ok, text, _ = git(repo, "show", f"{where}:{f}")
            if not ok:
                continue
            try:
                umbrella = json.loads(text).get("umbrella")
            except (ValueError, AttributeError):
                umbrella = None
            if isinstance(umbrella, int) and not isinstance(umbrella, bool) and umbrella > 0:
                out.add(umbrella)
            break
    return out


def part_of_missing(repo, base, head, body, branch=None):
    """The `Part of #n` lines a pull request's body still needs: one for each patch file its branch changes (and the
    umbrella its line names). [] for a sync pull request. None when the diff can't be read."""
    if branch and str(branch).startswith(SYNC_BRANCH):
        return []
    paths = changed_paths(repo, base, head)
    if paths is None:
        return None
    need = patch_issues(repo, paths, head)
    return [f"Part of #{n}" for n in sorted(need - body_part_of(body))]


def merged_in(repo, pr, candidate, since):
    """A merged pull request's merge commit, when it runs at the candidate and not at `since` (the install before)."""
    c = ((pr.get("mergeCommit") or {}).get("oid") or "")
    if not state.SHA.match(c) or not is_ancestor(repo, c, candidate):
        return None
    if since and is_ancestor(repo, c, since):
        return None
    return c


def runs_at(repo, pr, candidate):
    c = ((pr.get("mergeCommit") or {}).get("oid") or "")
    return bool(state.SHA.match(c) and is_ancestor(repo, c, candidate))


def pr_issues(repo, pr):
    """(issues from its body, issues from the patch files its merge commit changed)."""
    c = (pr.get("mergeCommit") or {}).get("oid") or ""
    from_files = set()
    if state.SHA.match(c):
        paths = changed_paths(repo, f"{c}^", c) or []
        from_files = patch_issues(repo, paths, c)
    return body_part_of(pr.get("body")), from_files


def ships(paths):
    """Whether any of the paths is outside our own files (FORK.md, the fork check's workflow, fork/, .agents/, the
    issue forms)."""
    return any(not (p in OWN_FILES or p.startswith(OWN_DIRS)) for p in paths)


def triage_links(path):
    """{issue number: pull request number} for our repo's Triage fixes, from Triage's record; {} without one, None
    when it can't be read (then nothing closes)."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        return None
    out = {}
    fixes = data.get("fixes") if isinstance(data, dict) else None
    for key, fix in (fixes or {}).items() if isinstance(fixes, dict) else ():
        repo, _, n = str(key).rpartition("#")
        pr = fix.get("pr") if isinstance(fix, dict) else None
        if repo == state.REPO and n.isdigit() and isinstance(pr, int) and not isinstance(pr, bool):
            out[int(n)] = pr
    return out


def default_links_path():
    store = os.environ.get("HERDR_TASK_STORE") or os.path.expanduser("~/.local/share/shepherdr/tasks")
    return os.path.join(store, TRIAGE_FILE)


# --- the plan ---

def live_words(tag, prs, device):
    said = f"Live since `{tag}`" + (f" ({', '.join('#' + str(p) for p in sorted(prs))})" if prs else "") + "."
    if device:
        said += f" {NOT_SEEN[0].upper() + NOT_SEEN[1:]}: please check its Device check line."
    return said + "\n\n" + LIVE_MARK.format(tag)


def upstream_words(release_tag):
    return (f"Fixed upstream in `{release_tag}`; ours was dropped.\n\n" + UPSTREAM_MARK.format(release_tag))


def plan(issues, carried, landed, links, tag, release_tag):
    """[{number, comment, mark, add, remove, close, device, pr}] for each open issue that changes, from: the open
    issues ([{number, body, labels}]), the issue numbers the install carries, `landed` ({issue: {pr number: newly}}:
    each issue's own pull requests that run now, by their `Part of #n` or their patch files), Triage's links ({issue:
    pr}), the install's tag and the upstream release it holds. `close` is only proposed: the run reads the issue again
    before it."""
    out = []
    for issue in sorted(issues, key=lambda i: i.get("number") or 0):
        n, body, labels = issue.get("number"), issue.get("body") or "", labels_of(issue)
        mine = landed.get(n) or {}
        newly = sorted(p for p, new in mine.items() if new)
        add, remove, comment, mark, device, close, pr = set(), set(), None, None, None, False, None
        dev = DEVICE_LINE.search(body)
        if newly:
            if dev:
                device = dev.group(1).strip()
                if "device-check" not in labels:
                    add.add("device-check")
            comment, mark = live_words(tag, newly, bool(dev)), LIVE_MARK.format(tag)
        fix = (links or {}).get(n)
        if fix is not None and fix in mine:
            pr = fix
            if "fixing" in labels:
                remove.add("fixing")
            close = "device-check" not in (labels | add)
        elif n not in carried and "fixed-upstream" in labels and release_tag and not comment:
            comment, mark = upstream_words(release_tag), UPSTREAM_MARK.format(release_tag)
        if comment or add or remove or close:
            out.append({"number": n, "comment": comment, "mark": mark, "add": sorted(add), "remove": sorted(remove),
                        "close": close, **({"device": device} if device else {}), **({"pr": pr} if pr else {})})
    return out


# --- GitHub ---

def gh_json(gh, *args):
    ok, out, _ = gh(*args)
    if not ok:
        return None
    try:
        return json.loads(out)
    except ValueError:
        return None


def read_github(gh):
    """The two reads the pass makes: open issues, merged pull requests."""
    issues = gh_json(gh, "issue", "list", "-R", state.REPO, "--state", "open", "--limit", LIST_LIMIT,
                     "--json", "number,body,labels")
    prs = gh_json(gh, "pr", "list", "-R", state.REPO, "--state", "merged", "--limit", PR_LIMIT,
                  "--json", "number,headRefName,mergeCommit,mergedAt,body")
    if not all(isinstance(x, list) for x in (issues, prs)):
        raise state.Refused("our issues or pull requests can't be read from GitHub: call issues again",
                            outcome="wait")
    return issues, prs


def has_mark(gh, n, mark):
    """Whether one of the issue's comments holds the mark; None when they can't be read."""
    owner, name = state.REPO.split("/")
    pages = gh_json(gh, "api", "--paginate", "--slurp", f"repos/{owner}/{name}/issues/{n}/comments")
    if not isinstance(pages, list):
        return None
    return any(mark in str((c or {}).get("body") or "") for page in pages for c in (page or []))


def still_closable(gh, n, merged_at):
    """None when the issue may close now, else why it is left as it is: closed, labelled device-check, or reopened or
    edited after its fix merged (or it can't be read)."""
    owner, name = state.REPO.split("/")
    data = gh_json(gh, "api", "graphql", "-f", f"query={FRESH}", "-F", f"owner={owner}", "-F", f"name={name}",
                   "-F", f"n={n}")
    issue = (((data or {}).get("data") or {}).get("repository") or {}).get("issue")
    if not isinstance(issue, dict) or not merged_at:
        return "it couldn't be read again"
    if issue.get("state") != "OPEN":
        return "it isn't open"
    if "device-check" in {x.get("name") for x in (issue.get("labels") or {}).get("nodes") or []}:
        return "it waits on a device check"
    reopened = [x.get("createdAt") for x in (issue.get("timelineItems") or {}).get("nodes") or [] if x]
    if any(r and r > merged_at for r in reopened):
        return "it was reopened after its fix merged"
    if (issue.get("lastEditedAt") or "") > merged_at:
        return "it was edited after its fix merged"
    return None


def write(gh, edit, scratch):
    n = str(edit["number"])
    if edit.get("comment"):
        seen = has_mark(gh, n, edit["mark"])
        if seen is None:
            return False
        if not seen:
            f = os.path.join(scratch, f"comment-{n}.md")
            with open(f, "w", encoding="utf-8") as fh:
                fh.write(edit["comment"])
            ok, _, _ = gh("issue", "comment", n, "-R", state.REPO, "--body-file", f)
            if not ok:
                return False
    args = ["issue", "edit", n, "-R", state.REPO]
    if edit.get("add"):
        args += ["--add-label", ",".join(edit["add"])]
    if edit.get("remove"):
        args += ["--remove-label", ",".join(edit["remove"])]
    ok = True
    if len(args) > 5:
        ok, _, _ = gh(*args)
    if ok and edit.get("close"):
        ok, _, _ = gh("issue", "close", n, "-R", state.REPO, "--reason", "completed")
    return ok


def link_pr(gh, pr, numbers, scratch):
    """Adds the missing `Part of #n` lines to a merged pull request's body (GitHub then links it from the issue)."""
    body = str(pr.get("body") or "").rstrip()
    body += ("\n\n" if body else "") + "\n".join(f"Part of #{n}" for n in sorted(numbers)) + "\n"
    f = os.path.join(scratch, f"pr-{pr['number']}.md")
    with open(f, "w", encoding="utf-8") as fh:
        fh.write(body)
    ok, _, _ = gh("pr", "edit", str(pr["number"]), "-R", state.REPO, "--body-file", f)
    return ok


def run(repo, candidate, since, tag, release_tag, gh, dry_run=False, cfg_hostname=None, links_path=None):
    """The whole pass: reads, the plan, the writes. Returns the step's fields."""
    lines, layout = patches.read(repo, candidate)
    if layout:
        raise state.Refused("the patch list is laid out wrong: " + "; ".join(layout), outcome="stop")
    carried = {x.get("issue") for x in lines if isinstance(x.get("issue"), int)}
    issues, prs = read_github(gh)
    links = triage_links(links_path or default_links_path())
    landed, linked, unlinked, merged_at = {}, [], [], {}
    for pr in prs:
        if str(pr.get("headRefName") or "").startswith(SYNC_BRANCH) or not runs_at(repo, pr, candidate):
            continue
        merged_at[pr["number"]] = pr.get("mergedAt")
        newly = bool(merged_in(repo, pr, candidate, since))
        said, from_files = pr_issues(repo, pr)
        for n in said | from_files:
            landed.setdefault(n, {})[pr["number"]] = newly     # a fix lands only on its own issue
        if not newly:
            continue
        if from_files - said:
            linked.append({"pr": pr["number"], "issues": sorted(from_files - said), "pr_obj": pr})
        if not said and not from_files:
            c = pr["mergeCommit"]["oid"]
            if ships(changed_paths(repo, f"{c}^", c) or []):
                unlinked.append(pr["number"])
    edits = plan(issues, carried, landed, links, tag, release_tag)
    from . import public
    for e in edits:
        found = public.problems(e.get("comment") or "", cfg_hostname)
        if found:
            raise state.Refused(f"the comment for #{e['number']} would carry {public.words(found)}", outcome="stop")
    left = []
    for e in edits:
        if e["close"]:
            why = still_closable(gh, e["number"], merged_at.get(e.get("pr")))
            if why:
                e["close"] = False
                left.append({"issue": e["number"], "why": why})
    edits = [e for e in edits if e.get("comment") or e["add"] or e["remove"] or e["close"]]
    written, failed = [], []
    if not dry_run:
        scratch = tempfile.mkdtemp(prefix="fork-issues-")
        try:
            for e in edits:
                (written if write(gh, e, scratch) else failed).append(e["number"])
            for x in linked:
                if not link_pr(gh, x["pr_obj"], x["issues"], scratch):
                    failed.append(f"pr {x['pr']}")
        finally:
            for f in os.listdir(scratch):
                os.remove(os.path.join(scratch, f))
            os.rmdir(scratch)
    out = {"carried": len(carried), "read": len(issues),
           "edits": [{k: v for k, v in e.items() if k not in ("comment", "mark")} | {"comment": bool(e.get("comment"))}
                     for e in edits],
           "written": written, "left": left, "linked": [{k: v for k, v in x.items() if k != "pr_obj"} for x in linked],
           "unlinked": unlinked, "device_checks": [{"issue": e["number"], "check": e["device"]}
                                                   for e in edits if e.get("device")],
           "triage_links": "unreadable" if links is None else len(links), "dry_run": bool(dry_run)}
    if dry_run:
        out["comments"] = {str(e["number"]): e["comment"].split("\n\n")[0] for e in edits if e.get("comment")}
    if failed:
        raise state.Refused(f"GitHub refused {len(failed)} of the writes: call issues again (it writes only what "
                            "is still different)", outcome="wait", failed=failed, **out)
    return out


def release_in(repo, candidate):
    rel = next((x for x in release.releases(repo) if is_ancestor(repo, x["sha"], candidate)), None)
    return rel["tag"] if rel else None
