"""Issues after a healthy install, and the `Part of #n` a patch's pull request owes (upstream-sync skill, step 7;
FORK.md, "Every piece of work is recorded on GitHub").

- `issues`: one pass over our issues after a healthy install. It reads the open issues and the merged pull requests
  once, works out each issue's status line and labels from the patch list at the installed commit, and writes only
  the issues whose line or labels change (one `gh issue edit` each). The words after the status line stay as they
  are. What the pass does to a status line, and nothing else:
  - an issue the install carries: "carried since `<tag>`" goes at the start of a line that has none, in place of a
    leading "building". A line that already says "carried since" keeps its tag: it names the install that first
    carried the fix, so a later install writes nothing there. A fix's part "#m: building" becomes "#m: not filed
    yet" once pull request #m runs; "reverting in #m" becomes "reverted in #m". `live` goes on.
  - an issue the install no longer carries loses `live`. One labelled `fixed-upstream` says "fixed upstream in
    `vX.Y.Z`, then dropped" and closes; one whose last fix was reverted says "reverted in #m" and closes.
  - `not-filed` follows the line: on while it says "not filed yet" or "reverting", off when it says neither.
  - a fix that landed in this install, on an issue with a "Device check:" line: `device-check` goes on, the line says
    "not seen on a device yet", and `device_checks` hands its words to finish's --says.
- Which issue a merged pull request is part of: its body's `Part of #n`, and else the patch files its merge commit
  changed (`fork/patches/<n>.json`, plus the umbrella a patch file names). One that names none in its body gets the
  line added to its body (`linked`); one that changes Shepherdr and names no issue at all is listed (`unlinked`).
- `part_of_missing`: the fork check's rule for a pull request: every patch file its branch adds, changes or removes
  is named by a `Part of #n` in its body (and the umbrella's). A sync pull request (`sync/*`) adapts every patch and
  names them in its own words: it is exempt.

Nothing here edits an issue's words outside its status line, and a test never reaches GitHub: `gh` is a fake there."""
import json
import os
import re
import tempfile

from . import patches, release, state
from .release import git, is_ancestor

PART_OF = re.compile(r"\bPart of #(\d+)\b", re.I)
# a status line: at most three spaces in (four or more is a Markdown code block)
STATUS = re.compile(r"^( {0,3}(?:[-*] )?(?:\*\*Status:\*\*|\*\*Status\*\*:|Status:)\s*)(.*)$")
FENCE = re.compile(r"^ {0,3}(```|~~~)")
INLINE_CODE = re.compile(r"(`+)[^`]*?\1")
PART = re.compile(r"#\d+(?: \([^()]*\))?: ")           # a fix's own part, on a line with several: "#29: ..."
CLAUSE_END = re.compile(r"; |\. |\.$")
CARRIED = re.compile(r"carried since `?ours-[0-9][\w.-]*`?")
LEAD_BUILDING = re.compile(r"^building\b[.,;:]?\s*", re.I)
PART_BUILDING = re.compile(r"(#(\d+)(?: \([^()]*\))?): building\b")
REVERTING = re.compile(r"\breverting in #(\d+)")
DEVICE_LINE = re.compile(r"^\s*(?:[-*]\s*)?(?:\*\*)?Device check:(?:\*\*)?\s*(.+)$", re.M)
NOT_SEEN = "not seen on a device yet"
PATCH_FILE = re.compile(r"^fork/patches/([1-9][0-9]*)\.json$")
# our own files: a pull request that changes only these ships nothing (the fork check's workflow among them)
OWN_FILES = ("FORK.md", ".github/workflows/fork-check.yml")
OWN_DIRS = ("fork/", ".agents/")
SYNC_BRANCH = "sync/"
LIST_LIMIT = "500"
PR_LIMIT = "100"


# --- reading ---

def status_at(body):
    """(index of the status line among the body's lines, its prefix, its text), or None when it has none."""
    fenced = False
    for i, line in enumerate(str(body or "").split("\n")):
        if FENCE.match(line):
            fenced = not fenced
            continue
        m = None if fenced else STATUS.match(line)
        if m:
            return i, m.group(1), m.group(2)
    return None


def with_status(body, i, prefix, text):
    lines = str(body or "").split("\n")
    lines[i] = prefix + text
    return "\n".join(lines)


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
    """Whether any of the paths is outside our own files (FORK.md, the fork check's workflow, fork/, .agents/)."""
    return any(not (p in OWN_FILES or p.startswith(OWN_DIRS)) for p in paths)


# --- the plan ---

def carried_text(text, tag, fork_only, landed, device):
    """A carried issue's status text, moved by this install. `landed`: the pull requests of this issue that run now
    ({number: newly}, newly true when this install brought it)."""
    out = text
    newly_landed = False
    if not CARRIED.search(out):
        lead = LEAD_BUILDING.match(out)
        # each fix's own part says where it stands ("#29: proposed upstream ...; #30: building"): the issue's lead
        # then only says it is carried. A single fix's lead also says it isn't filed yet, unless it stays ours.
        parts = bool(PART.search(out))
        carried = f"carried since `{tag}`" + ("" if fork_only or parts else ", not filed yet")
        if lead:
            # only the leading "building" clause goes ("building, ready for merge in "X" (#187)", up to its first
            # "; " or ". "), and the pull requests it named stay as "(built in #187)"; every word after it stays
            end = CLAUSE_END.search(out)
            clause, rest = (out[:end.start()], out[end.start():]) if end else (out, "")
            prs = list(dict.fromkeys(re.findall(r"#(\d+)", clause)))
            built = f" (built in {', '.join('#' + n for n in prs)})" if prs else ""
            out = carried + built + (rest or ".")
            newly_landed = True
        else:
            out = f"carried since `{tag}`. " + out if out else f"carried since `{tag}`."

    def part(m):
        nonlocal newly_landed
        n = int(m.group(2))
        if n not in landed:
            return m.group(0)
        newly_landed = newly_landed or landed[n]
        # a fix's own part: it waits for an upstream round like any other, whatever the issue's other parts are
        return f"{m.group(1)}: not filed yet"
    out = PART_BUILDING.sub(part, out)
    out = REVERTING.sub(lambda m: f"reverted in #{m.group(1)}" if int(m.group(1)) in landed else m.group(0), out)
    if device and newly_landed and NOT_SEEN not in out:
        head, dot, rest = out.partition(". ")
        out = f"{head}; {NOT_SEEN}: please check its Device check line" + (dot + rest if dot else "")
    return out, newly_landed


def not_filed_fits(text):
    return "not filed yet" in text or "reverting" in text


def all_undone(text):
    """An issue the install no longer carries, whose line says each revert landed and no fix of it is still
    building: every fix on it was undone."""
    return ("reverted in #" in text and not REVERTING.search(text) and not PART_BUILDING.search(text)
            and not LEAD_BUILDING.match(text))


def plan(issues, closed_live, carried, landed, tag, release_tag):
    """[{number, body (or None), add, remove, close, device}] for each issue that changes, from: the open issues
    ([{number, body, labels}]), the closed issues still labelled live, the issue numbers the install carries,
    `landed` ({issue: {pr number: newly}}: each issue's own pull requests that run now, by their `Part of #n` or
    their patch files), the install's tag and the upstream release it holds. A pass that stopped half way (an edit
    went in, its close didn't) is finished by the next: a close follows the issue's line and labels as they are."""
    out = []
    for issue in sorted(issues, key=lambda i: i.get("number") or 0):
        n, body, labels = issue.get("number"), issue.get("body") or "", labels_of(issue)
        add, remove, close, new_body, device = set(), set(), False, None, None
        st = status_at(body)
        mine = landed.get(n) or {}
        if n in carried:
            if "live" not in labels:
                add.add("live")
            if st:
                i, prefix, text = st
                dev = DEVICE_LINE.search(body)
                text2, newly = carried_text(text, tag, "fork-only" in labels, mine, bool(dev))
                if text2 != text:
                    new_body = with_status(body, i, prefix, text2)
                if dev and newly:
                    device = dev.group(1).strip()
                    if "device-check" not in labels:
                        add.add("device-check")
                fits = not_filed_fits(text2)
                if fits and "not-filed" not in labels:
                    add.add("not-filed")
                elif not fits and "not-filed" in labels:
                    remove.add("not-filed")
        else:
            if "live" in labels:
                remove.add("live")
            if st and "fixed-upstream" in labels:
                i, prefix, text = st
                if text.startswith("fixed upstream in"):
                    close = True                    # said already: an earlier pass's close didn't go in
                    remove |= {"not-filed"} & labels
                elif release_tag:
                    rest = CARRIED.sub("", text, count=1).lstrip(" ,;")
                    rest = re.sub(r"^not filed yet\b[.,;]?\s*", "", rest)
                    text2 = f"fixed upstream in `{release_tag}`, then dropped" + (". " + rest if rest else ".")
                    new_body = with_status(body, i, prefix, text2)
                    remove |= {"not-filed"} & labels
                    close = True
            elif st and REVERTING.search(st[2]):
                i, prefix, text = st
                text2 = REVERTING.sub(lambda m: f"reverted in #{m.group(1)}" if int(m.group(1)) in mine
                                      else m.group(0), text)
                if text2 != text:
                    new_body = with_status(body, i, prefix, text2)
                    if all_undone(text2):
                        add.add("reverted")
                        remove |= {"not-filed"} & labels
                        close = True
            elif st and "reverted" in labels and all_undone(st[2]):
                close = True                        # said already: an earlier pass's close didn't go in
                remove |= {"not-filed"} & labels
        if new_body is not None or add or remove or close:
            out.append({"number": n, "body": new_body, "add": sorted(add), "remove": sorted(remove), "close": close,
                        **({"device": device} if device else {})})
    for issue in closed_live:
        if issue.get("number") not in carried and "live" in labels_of(issue):
            out.append({"number": issue["number"], "body": None, "add": [], "remove": ["live"], "close": False})
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
    """The three reads the pass makes: open issues, closed issues still labelled live, merged pull requests."""
    issues = gh_json(gh, "issue", "list", "-R", state.REPO, "--state", "open", "--limit", LIST_LIMIT,
                     "--json", "number,body,labels")
    closed = gh_json(gh, "issue", "list", "-R", state.REPO, "--state", "closed", "--label", "live",
                     "--limit", LIST_LIMIT, "--json", "number,labels")
    prs = gh_json(gh, "pr", "list", "-R", state.REPO, "--state", "merged", "--limit", PR_LIMIT,
                  "--json", "number,headRefName,mergeCommit,body")
    if not all(isinstance(x, list) for x in (issues, closed, prs)):
        raise state.Refused("our issues or pull requests can't be read from GitHub: call issues again",
                            outcome="wait")
    return issues, closed, prs


def write(gh, edit, scratch):
    args = ["issue", "edit", str(edit["number"]), "-R", state.REPO]
    if edit.get("body") is not None:
        f = os.path.join(scratch, f"issue-{edit['number']}.md")
        with open(f, "w", encoding="utf-8") as fh:
            fh.write(edit["body"])
        args += ["--body-file", f]
    if edit.get("add"):
        args += ["--add-label", ",".join(edit["add"])]
    if edit.get("remove"):
        args += ["--remove-label", ",".join(edit["remove"])]
    ok = True
    if len(args) > 5:
        ok, _, _ = gh(*args)
    if ok and edit.get("close"):
        ok, _, _ = gh("issue", "close", str(edit["number"]), "-R", state.REPO)
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


def run(repo, candidate, since, tag, release_tag, gh, dry_run=False, cfg_hostname=None):
    """The whole pass: reads, the plan, the writes. Returns the step's fields."""
    lines, layout = patches.read(repo, candidate)
    if layout:
        raise state.Refused("the patch list is laid out wrong: " + "; ".join(layout), outcome="stop")
    carried = {x.get("issue") for x in lines if isinstance(x.get("issue"), int)}
    issues, closed, prs = read_github(gh)
    landed, linked, unlinked = {}, [], []
    for pr in prs:
        if str(pr.get("headRefName") or "").startswith(SYNC_BRANCH) or not runs_at(repo, pr, candidate):
            continue
        newly = bool(merged_in(repo, pr, candidate, since))
        said, from_files = pr_issues(repo, pr)
        for n in said | from_files:
            landed.setdefault(n, {})[pr["number"]] = newly     # a part moves only on its own issue
        if not newly:
            continue
        if from_files - said:
            linked.append({"pr": pr["number"], "issues": sorted(from_files - said), "pr_obj": pr})
        if not said and not from_files:
            c = pr["mergeCommit"]["oid"]
            if ships(changed_paths(repo, f"{c}^", c) or []):
                unlinked.append(pr["number"])
    edits = plan(issues, closed, carried, landed, tag, release_tag)
    from . import public
    for e in edits:
        if e.get("body") is not None:
            st = status_at(e["body"])
            found = public.problems(st[2] if st else "", cfg_hostname)
            if found:
                raise state.Refused(f"the status line of #{e['number']} would carry {public.words(found)}",
                                    outcome="stop")
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
    out = {"carried": len(carried), "read": len(issues), "edits": [
        {k: v for k, v in e.items() if k != "body"} | {"status": bool(e.get("body"))} for e in edits],
        "written": written, "linked": [{k: v for k, v in x.items() if k != "pr_obj"} for x in linked],
        "unlinked": unlinked, "device_checks": [{"issue": e["number"], "check": e["device"]}
                                                for e in edits if e.get("device")],
        "dry_run": bool(dry_run)}
    if dry_run:
        out["bodies"] = {str(e["number"]): status_at(e["body"])[2] for e in edits if e.get("body")}
    if failed:
        raise state.Refused(f"GitHub refused {len(failed)} of the writes: call issues again (it writes only what "
                            "is still different)", outcome="wait", failed=failed, **out)
    return out


def release_in(repo, candidate):
    rel = next((x for x in release.releases(repo) if is_ancestor(repo, x["sha"], candidate)), None)
    return rel["tag"] if rel else None
