"""One read of GitHub for every open pull request of a repo (dmalis/shepherdr#201): the scheduler's pass asks one
GraphQL query per repo for all its tasks' pull requests (their state, mergeability, checks, required checks and
workflow runs), and one gh pr list for the branches of its Working tasks, instead of a few calls per task. Its cost no
longer grows with the number of tasks. The answers are github.pr_view()'s and the others' shapes, handed to the
tick through github.answered() (tick.prefetch()); anything the batch couldn't say is asked per task, as before."""

import json

from . import ghbudget
from .base import now
from . import github

CHUNK = 50          # pull requests per query (GitHub's node limit is far above it; a short answer stays quick)
LIST_LIMIT = 200    # open pull requests listed for the Working tasks' branches
METHOD_KEEP = 3600000

_METHODS = {}       # repo: (at, "--squash" | "--merge" | "--rebase" | None)

CHECK = """... on CheckRun { name status conclusion startedAt completedAt detailsUrl
        checkSuite { workflowRun { workflow { name } } } isRequired(pullRequestNumber: %(n)d) }
      ... on StatusContext { context state targetUrl createdAt isRequired(pullRequestNumber: %(n)d) }"""
PR = """p_%(n)d: pullRequest(number: %(n)d) { number state mergeable headRefOid mergeCommit { oid } reviewDecision
    mergeStateStatus updatedAt commits(last: 1) { nodes { commit {
      checkSuites(first: 50) { nodes { status workflowRun { databaseId } } }
      statusCheckRollup { contexts(first: 100) { pageInfo { hasNextPage } nodes { __typename
      """ + CHECK + """ } } } } } } }"""
QUERY = """query($owner: String!, $name: String!) { rateLimit { limit remaining resetAt }
  repository(owner: $owner, name: $name) { squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed
    %s } }"""
METHODS = """query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
  squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed } }"""


def asked(*key):
    """An answer the pass already has for this key (github.answer() takes it)."""
    return key in github._ANSWERS


def _flag(repo_node):
    for key, flag in (("squashMergeAllowed", "--squash"), ("mergeCommitAllowed", "--merge"), ("rebaseMergeAllowed", "--rebase")):
        if repo_node.get(key) is True:
            return flag
    return None


def merge_method(repo):
    """The repo's first allowed merge method from GraphQL, kept an hour, or None (github.merge_method() asks REST)."""
    at, flag = _METHODS.get(repo, (0, None))
    if flag and now() - at < METHOD_KEEP:
        return flag
    owner, _, name = (repo or "").partition("/")
    if not (owner and name):
        return None
    ok, out, _ = github.gh("api", "graphql", "-f", f"query={METHODS}", "-f", f"owner={owner}", "-f", f"name={name}")
    try:
        node = json.loads(out)["data"]["repository"] if ok else None
    except (ValueError, TypeError, KeyError):
        node = None
    flag = _flag(node) if isinstance(node, dict) else None
    if flag:
        _METHODS[repo] = (now(), flag)
    return flag


def _row(c):
    """One check as gh pr view's statusCheckRollup has it."""
    if c.get("__typename") == "StatusContext":
        return {"__typename": "StatusContext", "context": c.get("context") or "", "state": c.get("state") or "",
                "targetUrl": c.get("targetUrl") or "", "startedAt": c.get("createdAt") or ""}
    wf = ((c.get("checkSuite") or {}).get("workflowRun") or {}).get("workflow") or {}
    return {"__typename": "CheckRun", "name": c.get("name") or "", "status": c.get("status") or "",
            "conclusion": c.get("conclusion") or "", "startedAt": c.get("startedAt") or "",
            "completedAt": c.get("completedAt") or "", "detailsUrl": c.get("detailsUrl") or "", "workflowName": wf.get("name") or ""}


def _view(p):
    """(pr_view's answer, its required checks' names) from one pull request node, or None when it can't stand in."""
    nodes = ((p.get("commits") or {}).get("nodes") or [])
    commit = (nodes[-1] or {}).get("commit") or {} if nodes else {}
    contexts = (commit.get("statusCheckRollup") or {}).get("contexts") or {}
    if (contexts.get("pageInfo") or {}).get("hasNextPage"):
        return None  # more checks than one page: pr_view reads them all
    raw = [c for c in contexts.get("nodes") or [] if isinstance(c, dict)]
    v = {"state": p.get("state"), "mergeable": p.get("mergeable"), "headRefOid": p.get("headRefOid"),
         "mergeCommit": p.get("mergeCommit"), "reviewDecision": p.get("reviewDecision") or "",
         "mergeStateStatus": p.get("mergeStateStatus"), "updatedAt": p.get("updatedAt"),
         "statusCheckRollup": [_row(c) for c in raw]}
    if v["statusCheckRollup"]:
        v["statusCheckRollup"] = github.latest_checks(v["statusCheckRollup"])
    # #1044 as pr_view's runs_pending(): a workflow run at its head not finished, its jobs not all shown as checks yet
    suites = (commit.get("checkSuites") or {}).get("nodes") or []
    on_way = any(isinstance(su, dict) and su.get("workflowRun") and (su.get("status") or "") != "COMPLETED" for su in suites)
    if v["state"] == "OPEN" and not github.pr_pending(v) and on_way:
        v["runs_pending"] = True
    elif v["state"] == "OPEN" and not on_way and isinstance(commit.get("checkSuites"), dict):
        v["runs_none"] = True  # dmalis/shepherdr: read, and no Actions run on its way (github.checks_missing())
    required = {c.get("name") or c.get("context") for c in raw if c.get("isRequired")}
    return v, required


def views(repo, numbers):
    """{("view", repo, n): pr_view's answer, ("required", repo, n): its required checks} for the numbers, one GraphQL
    query per CHUNK of them. A number left out (GitHub couldn't say, too many checks) is asked per task as before."""
    owner, _, name = (repo or "").partition("/")
    found = {}
    if not (owner and name):
        return found
    numbers = sorted({int(n) for n in numbers})
    for i in range(0, len(numbers), CHUNK):
        part = numbers[i:i + CHUNK]
        q = QUERY % "\n    ".join(PR % {"n": n} for n in part)
        ok, out, _ = github.gh("api", "graphql", "-f", f"query={q}", "-f", f"owner={owner}", "-f", f"name={name}")
        try:
            d = json.loads(out) if ok else None
            node = d["data"]["repository"] if isinstance(d, dict) and not d.get("errors") else None
        except (ValueError, TypeError, KeyError):
            node = None
        if not isinstance(node, dict):
            continue  # a checks permission this token lacks (SHEP-179), a blip: each asks on its own
        ghbudget.graphql_left((d.get("data") or {}).get("rateLimit"))
        flag = _flag(node)
        if flag:
            _METHODS[repo] = (now(), flag)
        for n in part:
            p = node.get(f"p_{n}")
            got = _view(p) if isinstance(p, dict) else None
            if got:
                found[("view", repo, n)], found[("required", repo, n)] = got
    return found


def branches(repo, tasks):
    """{("branch", repo, branch): pr_for_branch()'s answer} for the Working tasks' branches, from one gh pr list of the
    repo's open pull requests; a branch with none is answered None only when the list was whole."""
    ok, out, _ = github.gh("pr", "list", "--repo", repo, "--state", "open", "--limit", str(LIST_LIMIT),
                           "--json", "number,url,isCrossRepository,baseRefName,headRefName,headRefOid")
    try:
        rows = json.loads(out) if ok and out else None
    except ValueError:
        rows = None
    if not isinstance(rows, list):
        return {}
    whole = len(rows) < LIST_LIMIT
    found = {}
    for t in tasks:
        mine = next((p for p in rows if isinstance(p, dict) and p.get("headRefName") == t["branch"]
                     and not p.get("isCrossRepository") and p.get("baseRefName") == (t.get("base") or "main")), None)
        if mine or whole:
            found[("branch", repo, t["branch"])] = ({k: mine[k] for k in mine if k != "headRefName"} if mine else None)
    return found


def ahead(tasks, repo):
    """The pass's batched answers for these tasks (copies, read with the list's lock let go): every pull request of
    theirs per repo in one query, and the Working ones' branches in one list."""
    found = {}
    by_repo = {}
    for t in tasks:
        pr = t.get("pr") or {}
        if pr.get("repo") and pr.get("number"):
            by_repo.setdefault(pr["repo"], set()).add(pr["number"])
    for r, numbers in by_repo.items():
        found.update(views(r, numbers))
    looking = [t for t in tasks if not t.get("pr") and t["state"] == "running" and t.get("mode") == "worktree" and t.get("branch")]
    if repo and looking:
        found.update(branches(repo, looking))
    return found
