"""fork/bin/trial's own tests (Part of #2): its children's environment, the made-list cleanup, its wrappers for hc, gh
and shepherdr, and its core and service steps against fakes. The real run (a real throwaway core and the candidate's
service) is done by hand, as the spec says; these never start a real herdr-core."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME, the agent's own terminal dropped)

import ast  # noqa: E402
import importlib.machinery  # noqa: E402
import importlib.util  # noqa: E402
import json  # noqa: E402
import shutil  # noqa: E402
import signal  # noqa: E402
import socket  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402
import time  # noqa: E402
import unittest  # noqa: E402
from unittest import mock  # noqa: E402

TRIAL = os.path.join(ROOT, "fork", "bin", "trial")
TASKS = os.path.join(ROOT, "mods", "tasks", "bin", "herdr_task")


def load():
    loader = importlib.machinery.SourceFileLoader("fork_trial", TRIAL)
    spec = importlib.util.spec_from_loader("fork_trial", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


trial = load()


def script(path, text):
    with open(path, "w") as f:
        f.write(text)
    os.chmod(path, 0o755)
    return path


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.fakes = os.path.join(self.tmp, "fakes")
        os.makedirs(self.fakes)
        self.home = os.environ["HOME"]   # home_guard's throwaway

    def make(self, **kw):
        env = {"HOME": self.home, "PATH": f"{self.fakes}:/usr/bin:/bin", "TERM": "xterm",
               "XDG_RUNTIME_DIR": os.path.join(self.tmp, "run"), **kw.pop("env", {})}
        t = trial.Trial("HEAD", ROOT, home=self.home, caller_env=env, base=self.tmp, log=lambda m: None, **kw)
        return t

    def scratch(self, t):
        t.scratch = tempfile.mkdtemp(prefix=t.name + "-", dir=self.tmp)
        t.mark(t.scratch, "scratch")
        for d in ("bin", "src", "data", "store", "tmp", "templates", "worktrees"):
            os.makedirs(os.path.join(t.scratch, d))
        return t.scratch


class Env(Base):
    CALLER = {"HC_SOCKET": "/x/shepherdr.sock", "HC_TERMINAL_ID": "t9", "HC_TERMINAL_SOCKET": "/x/t.sock",
              "HC_SESSION": "shepherdr", "SHEPHERDR_SESSION": "shepherdr", "HERDR_BROWSER_TASK": "x#1",
              "HERDR_GUARD_SESSION": "shepherdr", "HERDR_TASK_STORE": "/real/store", "CLAUDE_CODE_ENTRYPOINT": "cli",
              "CLAUDECODE": "1", "CODEX_HOME": "/real/.codex", "SECRET_TOKEN": "x", "EDITOR": "vi"}

    def test_a_child_gets_only_the_trials_variables(self):
        t = self.make(env=self.CALLER)
        s = self.scratch(t)
        e = t.env
        self.assertEqual(set(e), {"HOME", "TERM", "PATH", "HC_SESSION", "SHEPHERDR_SESSION", "SHEPHERDR_FROM_SESSION",
                                  "SHEPHERDR_DATA", "HERDR_TASK_STORE", "HERDR_TASK_SETTINGS", "HERDR_TASK_TEMPLATES",
                                  "HERDR_TASK_GH", "SHEPHERDR_NO_MIGRATE", "SHEPHERDR_PORT", "SHEPHERDR_WEB", "TMPDIR",
                                  "GIT_TERMINAL_PROMPT", "LANG", "XDG_RUNTIME_DIR"})
        self.assertEqual(e["HOME"], self.home)
        for k in ("HC_SESSION", "SHEPHERDR_SESSION", "SHEPHERDR_FROM_SESSION"):
            self.assertEqual(e[k], t.name)
        self.assertRegex(t.name, r"^fork-trial-[0-9a-f]{8}$")
        for k in ("SHEPHERDR_DATA", "HERDR_TASK_STORE", "HERDR_TASK_SETTINGS", "HERDR_TASK_TEMPLATES", "HERDR_TASK_GH",
                  "TMPDIR"):
            self.assertTrue(e[k].startswith(s + os.sep), k)
        self.assertEqual(e["PATH"].split(os.pathsep)[0], os.path.join(s, "bin"))
        self.assertEqual((e["SHEPHERDR_WEB"], e["SHEPHERDR_NO_MIGRATE"]), ("off", "1"))
        self.assertEqual(e["SHEPHERDR_PORT"], str(t.port))

    def test_two_trials_never_share_a_name_or_a_port_folder(self):
        a, b = self.make(), self.make()
        self.assertNotEqual(a.name, b.name)

    def test_tool_dirs_skip_a_task_terminals_guard(self):
        guard = os.path.join(self.tmp, "guard")
        real = os.path.join(self.tmp, "real")
        os.makedirs(guard)
        os.makedirs(real)
        script(os.path.join(guard, "guard.sh"), "#!/bin/sh\n")
        for d in (guard, real):
            script(os.path.join(d, "hc"), "#!/bin/sh\n")
        script(os.path.join(real, "bun"), "#!/bin/sh\n")
        dirs = trial.tool_dirs(os.pathsep.join([guard, real, "/usr/bin"]))
        self.assertNotIn(guard, dirs)
        self.assertEqual(dirs[0], real)
        self.assertIn("/usr/bin", dirs)
        self.assertIn("/bin", dirs)

    def test_the_settings_keep_worktrees_and_templates_in_scratch(self):
        t = self.make()
        s = self.scratch(t)
        t.write_settings()
        with open(os.path.join(s, "settings.json")) as f:
            tasks = json.load(f)["everywhere"]["tasks"]
        self.assertEqual(tasks["worktree_root"], os.path.join(s, "worktrees"))
        self.assertTrue(tasks["worktrees"])
        self.assertEqual((tasks["review_rounds"], tasks["merge"]), (3, "ask"))


class Made(Base):
    def test_cleanup_removes_what_made_json_lists_and_nothing_else(self):
        t = self.make()
        s = self.scratch(t)
        core = os.path.join(self.tmp, "state", t.name)
        os.makedirs(core)
        t.mark(core, "core state")
        other = os.path.join(self.tmp, "fork-trial-0000aaaa")   # another trial's: same prefix, not listed
        os.makedirs(other)
        with open(os.path.join(s, "made.json")) as f:
            self.assertEqual([m["path"] for m in json.load(f)], [s, core])
        self.assertEqual(t.remove_made(), [])
        self.assertFalse(os.path.exists(s))
        self.assertFalse(os.path.exists(core))
        self.assertTrue(os.path.isdir(other))

    def test_a_listed_path_not_named_for_this_trial_is_refused(self):
        t = self.make()
        s = self.scratch(t)
        keep = os.path.join(self.tmp, "keep-me")
        os.makedirs(keep)
        made = t.made_list() + [{"path": keep, "what": "planted"}]
        with open(os.path.join(s, "made.json"), "w") as f:
            json.dump(made, f)
        problems = t.remove_made()
        self.assertTrue(os.path.isdir(keep))
        self.assertTrue(any("isn't the trial's" in p for p in problems), problems)

    def test_cleanup_reads_its_own_list_when_the_scratch_is_gone(self):
        t = self.make()
        s = self.scratch(t)
        core = os.path.join(self.tmp, "state", t.name)
        os.makedirs(core)
        t.mark(core, "core state")
        shutil.rmtree(s)
        self.assertEqual(t.remove_made(), [])
        self.assertFalse(os.path.exists(core))

    def test_a_worktree_in_the_live_worktrees_folder_is_removed_and_failed(self):
        t = self.make()
        self.scratch(t)
        os.makedirs(os.path.join(t.shared_worktrees, "1-trial-task"))
        problems = t.remove_made()
        self.assertFalse(os.path.exists(t.shared_worktrees))
        self.assertTrue(any("worktrees" in p for p in problems), problems)

    def test_leftovers_name_what_is_still_there(self):
        t = self.make()
        s = self.scratch(t)
        t.core_started = True
        os.makedirs(t.core_dir)
        self.addCleanup(shutil.rmtree, t.core_dir, True)
        left = t.leftovers()
        self.assertIn("the scratch folder", left)
        self.assertIn(f"herdr-core's state for {t.name}", left)
        shutil.rmtree(s)
        shutil.rmtree(t.core_dir)
        self.assertEqual(t.leftovers(), [])


class Wrappers(Base):
    def setUp(self):
        super().setUp()
        self.hc_log = os.path.join(self.tmp, "real-hc.log")
        script(os.path.join(self.fakes, "hc"), f'#!/bin/sh\necho "$HC_SESSION $*" >> {self.hc_log}\n')
        self.t = self.make()
        self.s = self.scratch(self.t)
        os.makedirs(os.path.join(self.s, "src", "bin"))
        script(os.path.join(self.s, "src", "bin", "shepherdr"), 'import sys\nprint("candidate", *sys.argv[1:])\n')
        self.t.write_bin(os.path.join(self.s, "src"))

    def call(self, name, *args, **env):
        e = {**self.t.env, **env}
        return subprocess.run([os.path.join(self.s, "bin", name), *args], env=e, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, universal_newlines=True)

    def real_calls(self):
        try:
            with open(self.hc_log) as f:
                return f.read().splitlines()
        except FileNotFoundError:
            return []

    def sock(self):
        return os.path.join(trial.runtime_dir(self.t.env), f"{self.t.name}.sock")

    def test_hc_runs_only_in_the_trials_session(self):
        self.assertEqual(self.call("hc", "ls", "--json").returncode, 0)
        self.assertEqual(self.real_calls(), [f"{self.t.name} ls --json"])
        r = self.call("hc", "server", "stop", HC_SESSION="shepherdr")
        self.assertEqual(r.returncode, 77)
        self.assertEqual(self.real_calls(), [f"{self.t.name} ls --json"])
        r = self.call("hc", "connect", HC_SESSION="")
        self.assertEqual(r.returncode, 77)
        bad = trial.hc_calls(os.path.join(self.s, "hc.log"), self.t.name, self.sock())
        self.assertEqual(bad, ["HC_SESSION=shepherdr hc server stop ", "HC_SESSION=(none) hc connect "])

    def test_hc_by_the_trials_socket_is_its_own(self):
        r = self.call("hc", "connect", HC_SESSION="", HC_SOCKET=self.sock())
        self.assertEqual(r.returncode, 0)
        self.assertEqual(trial.hc_calls(os.path.join(self.s, "hc.log"), self.t.name, self.sock()), [])

    def test_a_multi_line_argument_is_one_log_line(self):
        self.call("hc", "run", "--bg", "--", "claude", "line one\nline two\tand a tab")
        with open(os.path.join(self.s, "hc.log")) as f:
            lines = f.read().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0].split("\t")[0], self.t.name)

    def test_gh_fails_every_call_and_only_the_repo_lookup_is_allowed(self):
        r = self.call("gh-stub", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner")
        self.assertEqual(r.returncode, 1)
        self.assertIn("none of the git remotes", r.stderr)   # what github.py's settled() reads as "merge locally"
        log = os.path.join(self.s, "gh.log")
        self.assertEqual(trial.gh_calls(log), [])
        self.call("gh-stub", "pr", "create", "--title", "x")
        self.assertEqual(trial.gh_calls(log), ["gh pr create --title x"])

    def test_shepherdr_refuses_what_would_change_an_install(self):
        for args in (["update"], ["install"], ["uninstall"], ["migrate"], ["web", "on"], ["secrets", "set", "x"]):
            r = self.call("shepherdr", *args)
            self.assertEqual(r.returncode, 77, args)
        for args in (["update", "--root", "/scratch"], ["web", "status"], ["doctor"], ["install", "--dry-run"]):
            r = self.call("shepherdr", *args)
            self.assertEqual((r.returncode, r.stdout.strip()), (0, "candidate " + " ".join(args)), args)
        with open(os.path.join(self.s, "refused.log")) as f:
            self.assertEqual(len(f.read().splitlines()), 6)

    def test_the_stand_in_writes_the_expected_tree(self):
        repo = os.path.join(self.tmp, "repo")
        os.makedirs(repo)
        git = ["git", *trial.GIT_PLAIN]
        e = {**self.t.env, **trial.FIXED}
        subprocess.run([*git, "init", "-q", "-b", "main"], cwd=repo, env=e, check=True)
        with open(os.path.join(repo, "README.md"), "w") as f:
            f.write("x\n")
        subprocess.run([*git, "add", "README.md"], cwd=repo, env=e, check=True)
        subprocess.run([*git, "commit", "-q", "-m", "start"], cwd=repo, env=e, check=True)
        stand_in = self.t.stand_in_script()
        sh = subprocess.Popen(["sh", stand_in], cwd=repo, env=self.t.env)
        self.addCleanup(lambda: sh.poll() is None and sh.kill())
        for _ in range(100):
            log = subprocess.run(["git", "log", "--format=%H"], cwd=repo, env=e, stdout=subprocess.PIPE,
                                 universal_newlines=True).stdout.split()
            if len(log) == 2:
                break
            time.sleep(0.1)
        sh.kill()
        sh.wait()
        with open(os.path.join(repo, "trial.txt")) as f:
            self.assertEqual(f.read(), trial.STAND_IN_TEXT)
        out = subprocess.run(["git", "log", "-1", "--format=%an %ae %ad %cn %cd", "--date=raw"], cwd=repo,
                             env=e, stdout=subprocess.PIPE, universal_newlines=True).stdout.strip()
        self.assertEqual(out, "Fork Trial trial@example.invalid 1767225600 +0000 Fork Trial "
                              "1767225600 +0000")


FAKE_HC = """#!/bin/sh
echo "${HC_SESSION:-} $*" >> "$FAKE_LOG"
case "$1 $2" in
  "server status") echo '{"pid": 4242}' ;;
  "machine ls") cat "$FAKE_MACHINES" 2>/dev/null || echo '{"machines": []}' ;;
esac
"""

# A stand-in for `bun service/main.ts`: writes its token and answers GET /api/state with it, on 127.0.0.1.
FAKE_SERVICE = r'''
import http.server, os, secrets, sys
data = os.environ["SHEPHERDR_DATA"]
os.makedirs(data, exist_ok=True)
if os.environ.get("FAKE_SERVICE_DIE"):
    print("service: cannot start: " + os.environ["FAKE_SERVICE_DIE"], flush=True)
    sys.exit(3)
token = secrets.token_hex(8)
with open(os.path.join(data, "token"), "w") as f:
    f.write(token + "\n")
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        ok = self.path == "/api/state" and self.headers.get("Authorization") == "Bearer " + token \
            and self.headers.get("x-shepherdr") == "1"
        self.send_response(200 if ok else 403)
        self.end_headers()
        self.wfile.write(b'{"version": 1}' if ok else b"{}")
    def log_message(self, *a):
        pass
http.server.HTTPServer(("127.0.0.1", int(os.environ["SHEPHERDR_PORT"])), H).serve_forever()
'''


class CoreAndService(Base):
    def setUp(self):
        super().setUp()
        self.log = os.path.join(self.tmp, "hc.log")
        script(os.path.join(self.fakes, "hc"), FAKE_HC)
        svc = os.path.join(self.tmp, "fake_service.py")
        with open(svc, "w") as f:
            f.write(FAKE_SERVICE)
        script(os.path.join(self.fakes, "bun"), f'#!/bin/sh\nexec "{sys.executable}" "{svc}"\n')
        self.t = self.make()
        self.s = self.scratch(self.t)
        self.t.src = os.path.join(self.s, "src")
        self.t.write_bin(self.t.src)

    def env(self, **kw):
        return mock.patch.object(type(self.t), "env", property(
            lambda t: {**trial.clean_env(t.scratch, t.name, t.port, t.home, t.caller_env),
                       "FAKE_LOG": self.log, **kw}))

    def calls(self):
        with open(self.log) as f:
            return f.read().splitlines()

    def test_every_core_call_names_the_throwaway_session(self):
        with self.env():
            self.t.core()
            self.t.stop_core()
        calls = self.calls()
        self.assertEqual([c.split(" ", 1)[1] for c in calls],
                         ["server start", "server status --json", "machine ls --json", "server stop"])
        self.assertTrue(all(c.startswith(self.t.name + " ") for c in calls), calls)
        # its state folder didn't exist before: it is on the made list, so cleanup removes it
        self.assertIn(self.t.core_dir, [m["path"] for m in self.t.made_list()])

    def test_a_core_with_linked_machines_fails(self):
        machines = os.path.join(self.tmp, "machines.json")
        with open(machines, "w") as f:
            json.dump({"machines": [{"name": "elsewhere"}]}, f)
        with self.env(FAKE_MACHINES=machines), self.assertRaises(trial.Failed) as e:
            self.t.core()
        self.assertEqual(e.exception.step, "core")
        self.assertIn("linked machines", e.exception.why)

    def test_the_live_cores_pid_is_a_fail(self):
        self.t.live_pid = 4242
        with self.env(), self.assertRaises(trial.Failed) as e:
            self.t.core()
        self.assertIn("live core", e.exception.why)

    def test_the_service_answers_with_the_scratch_token_and_is_stopped_by_its_own_pid(self):
        with self.env():
            self.t.start_service()
            pid = self.t.service.pid
            self.assertIsNone(self.t.service.poll())
            self.t.stop_service()
        self.assertIsNotNone(self.t.service.poll())
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)
        with socket.socket() as s:
            self.assertNotEqual(s.connect_ex(("127.0.0.1", self.t.port)), 0)

    def test_a_service_that_exits_is_a_fail_with_its_last_line(self):
        with self.env(FAKE_SERVICE_DIE="port taken"), self.assertRaises(trial.Failed) as e:
            self.t.start_service()
        self.assertEqual(e.exception.step, "service")
        self.assertIn("cannot start: port taken", e.exception.why)


class Live(Base):
    def test_ended_terminals_are_allowed_and_the_trials_own_are_not(self):
        before = {"t1": {"address": "t1"}, "t2": {"address": "t2"}}
        after = {"t1": {"address": "t1"}, "t3": {"address": "t3", "cwd": "/tmp/fork-trial-ab12cd34-x/repo"},
                 "t4": {"address": "t4", "cwd": "/home/someone", "name": "unrelated"}}
        changes, ended = trial.live_changes(before, after, ["fork-trial-ab12cd34", "/tmp/fork-trial-ab12cd34-x"])
        self.assertEqual(ended, ["t2"])
        self.assertEqual(changes, ["live terminal t3 is the trial's"])

    def test_session_up_never_starts_a_core(self):
        run = os.path.join(self.tmp, "r")
        os.makedirs(os.path.join(run, "herdr-core"))
        env = {"XDG_RUNTIME_DIR": run}
        self.assertFalse(trial.session_up(env, "s1"))
        path = os.path.join(run, "herdr-core", "s1.sock")
        open(path, "w").close()   # a stale file, no one listening
        self.assertFalse(trial.session_up(env, "s1"))
        os.remove(path)
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(srv.close)
        srv.bind(path)
        srv.listen(1)
        self.assertTrue(trial.session_up(env, "s1"))

    def test_a_live_session_that_isnt_running_is_not_read(self):
        t = self.make()
        with mock.patch.object(trial.subprocess, "run") as run:
            self.assertEqual(t.live_read("before"), (None, None))
        run.assert_not_called()


class Main(Base):
    def setUp(self):
        super().setUp()
        self.handlers = {s: signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
        self.addCleanup(lambda: [signal.signal(s, h) for s, h in self.handlers.items()])
        self.made = []

    def go(self, finish):
        test = self

        def go(t):
            t.base, t.home, t.log = test.tmp, test.home, (lambda m: None)
            t.caller_env = {"HOME": test.home, "PATH": "/usr/bin:/bin"}
            t.scratch = tempfile.mkdtemp(prefix=t.name + "-", dir=test.tmp)
            t.mark(t.scratch, "scratch")
            test.made.append(t.scratch)
            finish(t)
        return go

    def main(self, finish):
        out = []
        with mock.patch.object(trial.Trial, "go", self.go(finish)), \
                mock.patch.object(trial.Trial, "live_read", lambda t, step, all_=False: (None, None)), \
                mock.patch("builtins.print", lambda *a, **k: out.append(" ".join(map(str, a)))):
            rc = trial.main(["HEAD", "--repo", ROOT])
        return rc, out[-1]

    def test_pass(self):
        rc, last = self.main(lambda t: None)
        self.assertEqual((rc, last), (0, "PASS"))
        self.assertFalse(os.path.exists(self.made[0]))

    def test_a_failed_step_still_cleans_up(self):
        def fail(t):
            raise trial.Failed("review", "ready was accepted with no review round recorded")
        rc, last = self.main(fail)
        self.assertEqual((rc, last), (1, "FAIL: review: ready was accepted with no review round recorded"))
        self.assertFalse(os.path.exists(self.made[0]))

    def test_a_signal_mid_run_fails_and_cleans_up(self):
        def term(t):
            os.kill(os.getpid(), signal.SIGTERM)
            time.sleep(5)
        rc, last = self.main(term)
        self.assertEqual((rc, last), (1, "FAIL: interrupted: SIGTERM"))
        self.assertFalse(os.path.exists(self.made[0]))

    def test_a_surprise_is_a_fail_too(self):
        def boom(t):
            raise KeyError("x")
        rc, last = self.main(boom)
        self.assertTrue(last.startswith("FAIL: trial: KeyError"), last)
        self.assertFalse(os.path.exists(self.made[0]))

    def test_a_leftover_turns_a_pass_into_a_fail(self):
        def leave(t):
            t.core_started = True
            os.makedirs(t.core_dir)
            self.addCleanup(shutil.rmtree, t.core_dir, True)
        with mock.patch.object(trial.Trial, "stop_core", lambda t: None):
            rc, last = self.main(leave)
        self.assertEqual(rc, 1)
        self.assertTrue(last.startswith("FAIL: cleanup: left behind: herdr-core's state"), last)


class Pins(unittest.TestCase):
    """What the trial relies on in herdr-task and the service, by name (Part of #2). A break here means fork/bin/trial
    needs adapting to the release, before any trial result is trusted."""

    def source(self, *parts):
        with open(os.path.join(ROOT, *parts)) as f:
            return f.read()

    def test_review_refusal_is_still_the_gate(self):
        tree = ast.parse(self.source("mods", "tasks", "bin", "herdr_task", "commands.py"))
        fn = next((n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "review_refusal"), None)
        self.assertIsNotNone(fn, "commands.review_refusal is gone")
        self.assertEqual([a.arg for a in fn.args.args], ["s", "t", "wt"])
        self.assertIn("isn't reviewed", ast.get_source_segment(self.source("mods", "tasks", "bin", "herdr_task",
                                                                           "commands.py"), fn))

    def test_templates_and_worktree_root_keep_their_names(self):
        settings = self.source("mods", "tasks", "bin", "herdr_task", "settings.py")
        self.assertIn('os.environ.get("HERDR_TASK_TEMPLATES")', settings)
        tree = ast.parse(settings)
        defaults = next(n.value for n in ast.walk(tree) if isinstance(n, ast.Assign)
                        and any(isinstance(x, ast.Name) and x.id == "DEFAULTS" for x in n.targets))
        tasks = ast.literal_eval(defaults)["tasks"]
        self.assertIn("worktree_root", tasks)
        self.assertIn('["tasks"].get("worktree_root")', self.source("mods", "tasks", "bin", "herdr_task", "launch.py"))

    def test_the_environment_names_it_sets(self):
        base = self.source("mods", "tasks", "bin", "herdr_task", "base.py")
        for name in ("HERDR_TASK_STORE", "HERDR_TASK_GH", "SHEPHERDR_SESSION", "SHEPHERDR_FROM_SESSION"):
            self.assertIn(f'os.environ.get("{name}")', base, name)
        self.assertIn('os.environ.get("HERDR_TASK_SETTINGS")', self.source("mods", "tasks", "bin", "herdr_task",
                                                                           "settings.py"))
        self.assertIn("process.env.SHEPHERDR_FROM_SESSION", self.source("service", "model.ts"))
        self.assertIn("process.env.SHEPHERDR_SESSION", self.source("service", "session.ts"))
        self.assertIn("process.env.SHEPHERDR_PORT", self.source("service", "paths.ts"))

    def test_the_github_lookup_the_gh_stub_allows(self):
        gh = self.source("mods", "tasks", "bin", "herdr_task", "github.py")
        self.assertIn('gh("repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"', gh)
        self.assertIn('"none of the git remotes"', gh)


if __name__ == "__main__":
    unittest.main()
