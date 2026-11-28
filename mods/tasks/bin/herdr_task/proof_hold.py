"""Never merged before its proof (dmalis/shepherdr#215, "Workers never stall").

A task said ready without proof while Proof was on: ready opened its pull request and, with Merge on its own, merged
it at once, so the agent's second ready with --proof was refused as already done. Now, Proof on and no proof found,
a merge Merge would make on its own waits for the person instead, as Merge "ask me first" does: the card says why, and
the agent hears to publish its proof and say ready again with --proof, which then merges as Merge says. Not refused:
a change too small to show has none (the worker template's "a line in your chat instead"), and the person may accept
it as it is."""

WHY = "Waits for you to merge it: Proof is on and it has none yet."
TOLD = (" It won't merge before its proof: publish it (herdr-artifact), then run ready again with --proof <its id>, and"
        " it merges as Merge says. Too small to show? Say so in your chat; the person merges it from its card.")


def asked(s, t):
    """Whether this task's Settings block asks for proof (its Proof line)."""
    from .settings import task_settings
    return bool(next((x["value"] for x in task_settings(s, t) if x["label"] == "Proof"), False))


def policy(s, t, merge):
    """The merge policy ready goes by: "ask" while Proof is on and it has no proof, where Merge would merge it on its
    own ("auto", "checks"); else Merge's own. Keeps t["proof_held"] true while it holds."""
    if merge in ("auto", "checks") and not t.get("proof") and asked(s, t):
        t["proof_held"] = True
        return "ask"
    t.pop("proof_held", None)
    return merge
