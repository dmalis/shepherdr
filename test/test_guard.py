"""A task's agent can't take down the session it runs in (SHEP-323, herdr_task/guard.py).

SHEP-321's agent ran `export HC_SESSION=shep321try` in one shell call and a bare `hc server stop` in the next; the
export was gone, the terminal's own HC_SESSION=shepherdr was back, and the live core went down with every agent.
These run the guard's stand-ins with fake commands behind them; RealCore (opt-in: SHEPHERDR_REAL_CORE=1 and an hc
on PATH) replays the same two calls inside a real throwaway core standing in for the live one."""
import home_guard  # noqa: F401  (first: a throwaway HOME, the agent's own terminal dropped)

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "mods", "tasks", "bin"))

from herdr_task import guard  # noqa: E402

FAKE = """#!/bin/sh
echo "$(basename "$0") HC_SESSION=${HC_SESSION:-} $*" >> "$FAKE_LOG"
"""


class Stand(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.fake = os.path.join(self.tmp, "real")
        os.makedirs(self.fake)
        for name in guard.GUARDED:
            p = os.path.join(self.fake, name)
            with open(p, "w") as f:
                f.write(FAKE)
            os.chmod(p, 0o755)
        self.log = os.path.join(self.tmp, "log")
        self.dir = guard.guard_dir(os.path.join(self.tmp, "store"))

    def call(self, line, session="shepherdr", start=None, **env):
        """One shell call inside a task's terminal: HC_SESSION from its core, the guard first on PATH, as launch
        starts the agent (guard_argv; start=guard.assistant_argv: an Assistant's), each call a new shell."""
        e = {"HOME": os.environ["HOME"], "PATH": f"{self.fake}:/usr/bin:/bin", "FAKE_LOG": self.log, "HC_SESSION": session, **env}
        argv = (start or guard.guard_argv)(["sh", "-c", line], session, os.path.join(self.tmp, "store"))
        r = subprocess.run(argv, env=e, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
        return r

    def ran(self):
        try:
            with open(self.log) as f:
                return f.read().splitlines()
        except FileNotFoundError:
            return []


class Refuses(Stand):
    def test_shep321_bare_stop_after_an_export_in_an_earlier_call(self):
        r1 = self.call("export HC_SESSION=shep321try; unset HC_TERMINAL_SOCKET; hc run --bg --name p1 -- sleep 30")
        self.assertEqual(r1.returncode, 0, r1.stderr)
        r2 = self.call("hc server stop")
        self.assertEqual(r2.returncode, 77)
        self.assertIn('stop the live session "shepherdr"', r2.stderr)
        self.assertIn("HC_SESSION=<throwaway> hc server stop", r2.stderr)
        self.assertEqual(self.ran(), ["hc HC_SESSION=shep321try run --bg --name p1 -- sleep 30"])

    def test_a_throwaway_session_named_on_the_command_goes_through(self):
        self.assertEqual(self.call("HC_SESSION=shep321try hc server stop").returncode, 0)
        self.assertEqual(self.call("HC_SESSION=shep321try hc server restart").returncode, 0)
        self.assertEqual(self.ran(), ["hc HC_SESSION=shep321try server stop", "hc HC_SESSION=shep321try server restart"])

    def test_protected_sessions(self):
        for line in ("hc server restart", "hc --json server stop", "herdr-core server stop",
                     "HC_SESSION=shepherdr hc server stop", "HC_SESSION=default hc server stop",
                     "unset HC_SESSION; hc server stop", "HC_SESSION=mine hc server stop", "hc update",
                     "hc update --version 0.2.0", "HC_SESSION=x hc update"):
            with self.subTest(line):
                self.assertEqual(self.call(line, session="mine").returncode, 77)
        self.assertEqual(self.ran(), [])

    def test_everyday_hc_goes_through(self):
        for line in ("hc ls", "hc run --bg --name x -- claude", "hc wait x --timeout 600", "hc kill x", "hc server status",
                     "hc server --help", "hc update --help", "hc read x --lines 400"):
            with self.subTest(line):
                self.assertEqual(self.call(line).returncode, 0, line)
        self.assertEqual(len(self.ran()), 8)

    def test_services_and_processes(self):
        refused = ("systemctl --user stop hc-serve-02a62dc5.service", "systemctl --user restart shepherdr.service",
                   "systemctl --user kill hc-hold-9a76bbbf.service", "pkill -f herdr-core", "pkill hc",
                   "killall herdr-core", "pkill -f 'bun service/main.ts'")
        for line in refused:
            with self.subTest(line):
                self.assertEqual(self.call(line).returncode, 77)
        self.assertEqual(self.ran(), [])
        for line in ("systemctl --user status shepherdr.service", "systemctl --user list-units", "pkill -f 'vite preview'",
                     "systemctl --user stop my-own.service"):
            with self.subTest(line):
                self.assertEqual(self.call(line).returncode, 0)

    def test_installer_on_the_live_home(self):
        for line in ("shepherdr update", "shepherdr install --yes", "shepherdr uninstall", "shepherdr migrate --rollback",
                     "shepherdr web serve-from vm", "shepherdr secrets move-to vm"):
            with self.subTest(line):
                self.assertEqual(self.call(line).returncode, 77)
        for line in ("shepherdr install --root /tmp/x", "shepherdr update --dry-run", "shepherdr doctor", "shepherdr version",
                     "shepherdr web status", "shepherdr where"):
            with self.subTest(line):
                self.assertEqual(self.call(line).returncode, 0)

    def test_212_no_keys_in_its_own_reviewers_screen(self):
        """dmalis/shepherdr#212: a worker answered its reviewer's folder-trust screen with keys; that's the person's.
        Known by the terminal's role label (the real hc's `get`), whichever address names it."""
        with open(os.path.join(self.fake, "hc"), "w") as f:
            f.write(FAKE + 'if [ "$1" = get ]; then case "$2" in\n'
                    '  sd-4-review|t5) echo \'{"address":"t5","labels":{"herdr.role":"reviewer","herdr.task":"x#4"}}\' ;;\n'
                    '  demo-1-helper) echo \'{"address":"t6","labels":{"herdr.role": "helper"}}\' ;;\n'
                    '  visual-review|t9) echo \'{"address":"t9","labels":{"herdr.task":"x#4"}}\' ;;\n'
                    '  *) exit 1 ;;\nesac; fi\n')
        for line in ("hc keys sd-4-review down enter", "hc keys t5 enter", "hc keys demo-1-helper --text y",
                     "HC_SESSION=shepherdr hc keys sd-4-review enter"):
            with self.subTest(line):
                r = self.call(line)
                self.assertEqual(r.returncode, 77)
                self.assertIn("the person's to answer", r.stderr)
        self.assertFalse([x for x in self.ran() if " keys " in x])
        # its own test terminals (whatever their names), a throwaway session's reviewer, and waiting on or reading
        # its reviewer go through
        for line in ("hc keys t9 enter", "hc keys visual-review down", "hc keys gone-review enter",
                     "HC_SESSION=try212 hc keys sd-4-review enter", "hc wait sd-4-review --timeout 600",
                     "hc read sd-4-review --lines 400", "hc kill t5"):
            with self.subTest(line):
                self.assertEqual(self.call(line).returncode, 0, line)
        self.assertEqual(len([x for x in self.ran() if " get " not in x]), 7)

    def test_nested_guard_and_rc_files_putting_the_real_one_first_again(self):
        # a second launch inside the first (or an rc file prepending the real folder) still finds the real one
        r = self.call(f'PATH="{self.dir}:{self.dir}:$PATH" hc ls')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.ran(), ["hc HC_SESSION=shepherdr ls"])


class Launch(unittest.TestCase):
    def test_every_task_agent_starts_guarded(self):
        with open(os.path.join(ROOT, "mods", "tasks", "bin", "herdr_task", "launch.py")) as f:
            self.assertIn("in_shell(guard_argv(cmd))", f.read())

    def test_the_rule_in_plain_words(self):
        from herdr_task import templates
        with open(os.path.join(ROOT, "templates", "worker.md")) as f:
            worker = f.read()
        for words in (templates.WORKER_MD, worker):
            self.assertIn(templates.LIVE_RULE, words)
        self.assertIn(templates.WORKER_MD_BEFORE_LIVE, templates.OLD_WORKERS)   # an unedited old one gets today's
        for name in ("templates/assistant.md", "AGENTS.md"):
            with open(os.path.join(ROOT, name)) as f:
                self.assertIn("`HC_SESSION=<throwaway> hc", f.read())

    def test_rewritten_when_changed(self):
        with tempfile.TemporaryDirectory() as t:
            d = guard.guard_dir(t)
            with open(os.path.join(d, "guard.sh"), "w") as f:
                f.write("#!/bin/sh\nexec \"$@\"\n")
            guard.guard_dir(t)
            with open(os.path.join(d, "hc")) as f:
                self.assertEqual(f.read(), guard.SCRIPT)


class EveryAgent(Stand):
    """dmalis/shepherdr#247: every agent Shepherdr starts has the guard, not only a task's."""

    def assistant(self, line, **env):
        return self.call(line, start=guard.assistant_argv, **env)

    def test_an_assistant_is_refused_the_same(self):
        for line in ("hc server stop", "hc server restart", "hc update", "systemctl --user restart shepherdr.service",
                     "pkill -f herdr-core", "shepherdr update"):
            with self.subTest(line):
                r = self.assistant(line)
                self.assertEqual(r.returncode, 77)
                self.assertIn("HERDR_GUARD_ASKED=1", r.stderr)   # how to do it when the person asked for it
                self.assertNotIn("update-shepherdr", r.stderr)    # a schedule's words, not an Assistant's
        self.assertEqual(self.ran(), [])
        self.assertEqual(self.assistant("HC_SESSION=try247 hc server stop").returncode, 0)
        self.assertEqual(self.assistant("hc ls").returncode, 0)

    def test_the_persons_yes_word_works_for_an_assistant_only(self):
        r = self.assistant("HERDR_GUARD_ASKED=1 hc server restart")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("the person asked for it", r.stderr)
        self.assertEqual(self.ran(), ["hc HC_SESSION=shepherdr server restart"])
        # a task's terminal can't say yes for the person, nor can the next shell call
        self.assertEqual(self.call("HERDR_GUARD_ASKED=1 hc server restart").returncode, 77)
        self.assertEqual(self.assistant("hc server restart").returncode, 77)
        self.assertEqual(len(self.ran()), 1)

    def test_an_assistant_protects_the_session_it_runs_in(self):
        self.assertEqual(self.assistant("hc server stop", session="mine").returncode, 77)
        self.assertEqual(self.assistant("HC_SESSION=shepherdr hc server stop", session="mine").returncode, 77)

    def run_args(self, line, **env):
        """What the real hc was given for `hc run …`, one word per line (the fake writes them)."""
        with open(os.path.join(self.fake, "hc"), "w") as f:
            f.write(FAKE + 'printf "%s\\n" "$@" > "$FAKE_LOG.args"\n')
        try:
            os.remove(self.log + ".args")
        except FileNotFoundError:
            pass
        r = self.call(line, **env)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(self.log + ".args") as f:
            return f.read().splitlines()

    def test_a_reviewer_or_helper_it_starts_gets_it_too(self):
        # hc runs a child in herdr-core's environment, not its caller's: the stand-in wraps the command after --
        for role in ("reviewer", "helper"):
            with self.subTest(role):
                args = self.run_args(f"hc run --bg --name sd-1-review --label herdr.task=x --label herdr.role={role} "
                                     "-- env PATH=/usr/bin:/bin codex --no-daemon review")
                at = args.index("--")
                self.assertEqual(args[:at], ["run", "--bg", "--name", "sd-1-review", "--label", "herdr.task=x",
                                             "--label", f"herdr.role={role}"])
                child = args[at + 1:]
                guarded = os.path.join(os.path.realpath(self.dir), "herdr-guard")
                self.assertEqual(child, [guarded, "shepherdr", "env", "PATH=/usr/bin:/bin", "codex", "--no-daemon", "review"])
        # the wrapped child, run in a bare environment as the holder would: guarded, as a task (no yes word), also
        # when its own `env "PATH=<the CLI's folders>:$PATH"` (settings.py) puts the real hc first again
        e = {"HOME": os.environ["HOME"], "PATH": "/usr/bin:/bin", "FAKE_LOG": self.log, "HC_SESSION": "shepherdr"}
        for cmd in (["sh", "-c", "HERDR_GUARD_ASKED=1 hc server stop"],
                    ["env", f"PATH={self.fake}:/usr/bin:/bin", "sh", "-c", "hc server stop"],
                    ["env", "-u", "X", "-i", f"PATH={self.fake}:/usr/bin:/bin", "HOME=/x", "sh", "-c",
                     "HERDR_GUARD_ASKED=1 hc server stop"]):
            with self.subTest(cmd):
                r = subprocess.run([guarded, "shepherdr", *cmd], env=e, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   universal_newlines=True)
                self.assertEqual(r.returncode, 77, r.stderr)
                self.assertIn("they do it from their own terminal", r.stderr)
        r = subprocess.run([guarded, "shepherdr", "env", f"PATH={self.fake}:/usr/bin:/bin", "sh", "-c", "hc ls"], env=e,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual([x for x in self.ran() if " run " not in x], ["hc HC_SESSION=shepherdr ls"])

    def test_one_on_another_machine_gets_that_machines_guard(self):
        args = self.run_args("hc run --bg --on vmb --label herdr.role=helper -- env PATH=/usr/bin:/bin sh -c 'hc server stop'")
        at = args.index("--")
        child = args[at + 1:]
        self.assertEqual(child[:2], ["sh", "-c"])
        self.assertEqual(child[3:], ["herdr-guard", "env", "PATH=/usr/bin:/bin", "sh", "-c", "hc server stop"])
        # run there: its herdr-task says where its folder is (here: this one), and the session it runs in
        there = os.path.join(self.tmp, "there")
        os.makedirs(there)
        with open(os.path.join(there, "herdr-task"), "w") as f:
            f.write(f'#!/bin/sh\n[ "$1" = _guard-dir ] && echo "{self.dir}"\n')
        os.chmod(os.path.join(there, "herdr-task"), 0o755)
        e = {"HOME": os.environ["HOME"], "PATH": f"{there}:{self.fake}:/usr/bin:/bin", "FAKE_LOG": self.log, "HC_SESSION": "vmb"}
        child = [*child[:4], "env", f"PATH={self.fake}:/usr/bin:/bin", "sh", "-c", "hc server stop"]
        r = subprocess.run(child, env=e, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
        self.assertEqual(r.returncode, 77, r.stderr)
        self.assertIn('the live session "vmb"', r.stderr)
        # no herdr-task there (or an older one): it runs as asked
        r = subprocess.run(child, env={**e, "PATH": f"{self.fake}:/usr/bin:/bin"}, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, universal_newlines=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual([x for x in self.ran() if " run " not in x], ["hc HC_SESSION=vmb server stop"])

    def test_other_runs_are_left_as_they_are(self):
        for line in ("hc run --bg --name w -- sleep 30",                                     # its own test program
                     "hc run --bg --label herdr.role=reviewer reviewer 'review it'",          # a template
                     "HC_SESSION=try247 hc run --bg --label herdr.role=reviewer -- codex"):  # a throwaway core's
            with self.subTest(line):
                self.assertNotIn("herdr-guard", self.run_args(line))

    def test_kill_by_number(self):
        # `env kill`, `xargs kill`: not the shell's builtin, which no stand-in can reach (docs/guard.md)
        procs = []
        core = os.path.join(self.tmp, "herdr-core")
        with open(core, "w") as f:
            f.write("#!/bin/sh\nsleep 30\n")   # its process name is herdr-core, as the live core's
        os.chmod(core, 0o755)
        live = "/x/.local/share/shepherdr/service/main.ts"    # the install's own service (bin/shepherdr's unit)
        for argv in ([core], ["sh", "-c", "sleep 30; exit 0", "herdr-task", "scheduler"],
                     ["sh", "-c", "sleep 30; exit 0", "bun", live], ["sleep", "30"],
                     ["sh", "-c", "sleep 30; exit 0", "bun", "service/main.ts"]):   # a throwaway one, from a checkout
            procs.append(subprocess.Popen(argv))
            self.addCleanup(procs[-1].wait)
            self.addCleanup(procs[-1].kill)
        time.sleep(0.3)
        for p in procs[:3]:
            for line in (f"env kill {p.pid}", f"echo {p.pid} | xargs kill -9", f"env kill -s TERM -- {p.pid}"):
                with self.subTest(line):
                    # xargs says 123 for any command that failed
                    self.assertIn(self.call(line, COLUMNS="20").returncode, (77, 123) if "xargs" in line else (77,))
                    self.assertIsNone(p.poll())
        self.assertEqual(self.ran(), [])
        for line in (f"env kill {procs[3].pid}", f"env kill {procs[4].pid}", "env kill -l", f"env kill -0 {procs[0].pid}",
                     f"env kill -s 0 {procs[0].pid}"):
            with self.subTest(line):
                self.assertEqual(self.call(line).returncode, 0)
        self.assertEqual(len(self.ran()), 5)

    def test_launchctl_on_a_mac(self):
        for line in ("launchctl kickstart -k gui/501/dev.shepherdr.service", "launchctl bootout gui/501/dev.shepherdr.service",
                     "launchctl stop dev.shepherdr.service"):
            with self.subTest(line):
                self.assertEqual(self.call(line).returncode, 77)
        self.assertEqual(self.call("launchctl print gui/501/dev.shepherdr.service").returncode, 0)
        self.assertEqual(self.call("launchctl kickstart -k gui/501/com.example.mine").returncode, 0)

    def home(self):
        h = os.path.join(self.tmp, "home")
        for d in (".local/bin", ".local/share/shepherdr/mods/tasks/bin", ".local/share/shepherdr/web",
                  ".local/share/shepherdr/worktrees/x", ".local/share/shepherdr/tasks", ".local/share/shepherdr/service", "build"):
            os.makedirs(os.path.join(h, d), exist_ok=True)
        os.makedirs(os.path.join(h, "opt"), exist_ok=True)
        for f in (".local/bin/hc", ".local/share/shepherdr/mods/tasks/bin/herdr-task", "build/hc", "build/herdr-task", "opt/hc"):
            open(os.path.join(h, f), "w").close()
        return h

    def test_no_copy_over_the_live_commands_or_install(self):
        h = self.home()
        share = f"{h}/.local/share/shepherdr"
        for line in (f"cp build/hc {h}/.local/bin/hc", f"cp build/hc {h}/.local/bin/", f"cp -f build/hc build/herdr-task {h}/.local/bin",
                     f"install -m 755 build/herdr-task {h}/.local/bin/herdr-task", f"cp -t {h}/.local/bin build/hc",
                     f"ln -sf /x {h}/.local/bin/shepherdr", f"mv {h}/.local/bin/hc /tmp/old-hc", f"mv build/hc {h}/.local/bin",
                     f"cp build/herdr-task {share}/mods/tasks/bin/herdr-task", f"cp -r build {share}/web/",
                     f"cd {h}/.local/bin && cp ../../build/hc .", f"install -d {share}/service/x",
                     # grouped options, and an hc the install found elsewhere on PATH
                     f"cp -ft {h}/.local/bin build/hc", f"cp -ft{h}/.local/bin build/hc", f"install -Dm755 build/hc {h}/.local/bin/hc",
                     f"cp -fT build/hc {h}/.local/bin/hc", f'PATH="$PATH:{h}/opt" cp build/hc {h}/opt/hc'):
            with self.subTest(line):
                r = self.call(f"cd {h} && {line}", HOME=h)
                self.assertEqual(r.returncode, 77, r.stderr)
        self.assertEqual(self.ran(), [])
        for line in ("cp build/hc build/hc2", f"cp build/hc {h}/.local/bin/my-tool", f"cp build/hc {share}/worktrees/x/",
                     f"mv build/hc {share}/tasks/x", f"install -d {h}/scratch", "ln -s build/hc", "cp -t build build/hc",
                     f"cp {h}/.local/bin/hc build/hc-copy", "cp --help", f"install -Dm755 build/hc {h}/scratch/hc",
                     f"cp -ft build {h}/.local/bin/hc", f"cp build/hc {h}/opt/hc"):
            with self.subTest(line):
                r = self.call(f"cd {h} && {line}", HOME=h)
                self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(self.ran()), 12)

    def test_the_installer_run_by_its_path(self):
        sh = os.path.join(ROOT, "bin", "shepherdr")
        base = {"HOME": os.environ["HOME"], "PATH": "/usr/bin:/bin"}
        for env, args, code in (({"HERDR_GUARD_SESSION": "shepherdr"}, ["update"], 77),
                                ({"HERDR_GUARD_LIVE": "shepherdr"}, ["install", "--yes"], 77),
                                ({"HERDR_GUARD_SESSION": "shepherdr", "HERDR_GUARD_ASKED": "1"}, ["uninstall"], 77),
                                ({"HERDR_GUARD_LIVE": "shepherdr"}, ["migrate", "--rollback"], 77),
                                ({"HERDR_GUARD_SESSION": "shepherdr"}, ["version"], 0)):
            with self.subTest(args, env=env):
                r = subprocess.run([sys.executable, sh, *args], env={**base, **env}, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, universal_newlines=True, timeout=60)
                self.assertEqual(r.returncode, code, r.stderr)
        import importlib.machinery
        import importlib.util
        spec = importlib.util.spec_from_loader("shepherdr_cli", importlib.machinery.SourceFileLoader("shepherdr_cli", sh))
        cli = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cli)
        A = lambda **k: type("A", (), {"cmd": "update", "root": None, "dry_run": False, **k})()
        self.assertIsNone(cli.guard_refuses(A(), {}))                                          # the person's own shell
        self.assertIsNone(cli.guard_refuses(A(root="/tmp/x"), {"HERDR_GUARD_SESSION": "s"}))   # a scratch root
        self.assertIsNone(cli.guard_refuses(A(dry_run=True), {"HERDR_GUARD_SESSION": "s"}))
        self.assertIsNone(cli.guard_refuses(A(), {"HERDR_GUARD_LIVE": "s", "HERDR_GUARD_ASKED": "1"}))
        self.assertIn("update-shepherdr", cli.guard_refuses(A(), {"HERDR_GUARD_SESSION": "s"}))
        # a --root that is the real home is the live install (only asked, never run)
        self.assertIsNotNone(cli.guard_refuses(A(root=cli.real_home() + "/"), {"HERDR_GUARD_SESSION": "s"}))
        # and the stand-in's
        for line in ('shepherdr update --root "$HOME"', 'shepherdr install --root="$HOME/"', 'cd "$HOME" && shepherdr update --root .'):
            with self.subTest(line):
                self.assertEqual(self.call(line).returncode, 77)
        self.assertEqual(self.call("shepherdr update --root /tmp/not-there-247").returncode, 0)

    def test_the_update_runner_drops_every_guard_word(self):
        from herdr_task import self_update
        e = self_update.clean_env({"PATH": f"{self.dir}:/usr/bin", "HERDR_GUARD_SESSION": "s", "HERDR_GUARD_LIVE": "s",
                                   "HERDR_GUARD_ASKED": "1", "X": "1"}, os.path.join(self.tmp, "store"))
        self.assertEqual(e, {"PATH": "/usr/bin", "X": "1"})


class Starts(unittest.TestCase):
    """dmalis/shepherdr#247: where Shepherdr starts an agent that isn't a task's, it starts guarded."""

    def read(self, *p):
        with open(os.path.join(ROOT, *p)) as f:
            return f.read()

    def test_one_guard_line_everywhere(self):
        import re
        js = re.search(r"^export const GUARD = '(.*)';$", self.read("core", "clean-env.js"), re.M).group(1)
        sh = re.search(r"^guard='(.*)'$", self.read("service", "restart.sh"), re.M).group(1)
        self.assertEqual(js, guard.GUARD_SH)
        self.assertEqual(sh, guard.GUARD_SH)

    def test_the_start_points(self):
        self.assertIn("${CLEAN_ENV} ${AGENT_PATH} ${GUARD} exec", self.read("core", "clean-env.js"))   # the service's
        restart = self.read("service", "restart.sh")
        self.assertIn('sh -c "$clean $apath $guard"', restart)        # a restart on its own conversation
        self.assertIn('"$clean $apath $guard exec $line"', restart)   # a handoff
        self.assertIn("clean_env(assistant_argv(argv))", self.read("mods", "tasks", "bin", "herdr_task", "revive.py"))
        self.assertIn("cleanCommand(cmd)", self.read("service", "spaces.ts"))   # execTemplate: new space, first message

    def test_guard_sh_names_the_folder_herdr_task_writes(self):
        with tempfile.TemporaryDirectory() as t:
            bin_ = os.path.join(t, "bin")
            os.makedirs(bin_)
            with open(os.path.join(bin_, "herdr-task"), "w") as f:
                f.write(f'#!/bin/sh\nexec {sys.executable} {os.path.join(ROOT, "mods", "tasks", "bin", "herdr-task")} "$@"\n')
            os.chmod(os.path.join(bin_, "herdr-task"), 0o755)
            e = {"HOME": os.environ["HOME"], "PATH": f"{bin_}:/usr/bin:/bin", "HERDR_TASK_STORE": os.path.join(t, "store"),
                 "SHEPHERDR_NO_MIGRATE": "1", "HC_SESSION": "shepherdr"}
            r = subprocess.run(["sh", "-c", guard.GUARD_SH + ' echo "$PATH|$HERDR_GUARD_LIVE"; command -v hc'], env=e,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=60)
            d = os.path.join(t, "store", ".guard", "bin")
            self.assertEqual(r.stdout.splitlines(), [f"{d}:{bin_}:/usr/bin:/bin|shepherdr", f"{d}/hc"], r.stderr)


def unguarded(path):
    """PATH without any guard folder (the terminal this runs in may be a guarded one)."""
    return ":".join(d for d in path.split(":") if not d.rstrip("/").endswith(os.path.join(".guard", "bin")))


HC = shutil.which("hc", path=unguarded(os.environ.get("PATH", "")))


@unittest.skipUnless(HC and os.environ.get("SHEPHERDR_REAL_CORE") == "1", "a real herdr-core: SHEPHERDR_REAL_CORE=1")
class RealCore(unittest.TestCase):
    """SHEP-321's two shell calls in a terminal of a real throwaway core ("live"), with and without the guard."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        n = f"{os.getpid()}{int(time.time()) % 100000}"
        self.live, self.try_ = f"shep323live{n}", f"shep323try{n}"
        # a clean environment: the throwaway HOME, no terminal of the real core
        # (and no guard folder of the terminal this runs in on PATH)
        self.env = {"HOME": os.environ["HOME"], "PATH": unguarded(os.environ["PATH"]), "TERM": "xterm"}
        for s in (self.live, self.try_):
            self.addCleanup(self.hc, s, "server", "stop")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.assertEqual(self.hc(self.live, "server", "start").returncode, 0)
        self.pid = self.status(self.live)["pid"]

    def hc(self, session, *args):
        # the session named on every call, never inherited (the lesson of SHEP-321)
        return subprocess.run([HC, *args], env={**self.env, "HC_SESSION": session}, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, universal_newlines=True, timeout=60)

    def status(self, session):
        r = self.hc(session, "server", "status", "--json")
        try:
            return json.loads(r.stdout)
        except ValueError:
            return {}

    def replay(self, guarded, start="task", reviewer=False):
        """start: how Shepherdr starts the agent: "task" (launch's guard_argv) or "assistant" (the service's one sh
        line, GUARD_SH, with this checkout's herdr-task). reviewer: first, the agent starts a reviewer the way a
        worker does (`hc run --bg … --label herdr.role=reviewer -- <command>`), which tries a bare stop itself."""
        out = os.path.join(self.tmp, "out")
        script = os.path.join(self.tmp, "agent.sh")
        rev = os.path.join(self.tmp, "reviewer.sh")
        with open(rev, "w") as f:
            f.write(f'hc server stop >/dev/null 2>{out}.rev; echo "reviewer stop: $?" >> {out}\n')
        # its command as settings.py writes a reviewer's: `env "PATH=<the CLI's folders>:$PATH" …`, the real hc's
        # folder first
        first = (f'hc run --bg --name rv --label herdr.task=x --label herdr.role=reviewer -- env "PATH={os.path.dirname(HC)}:$PATH" '
                 f"sh {rev} >/dev/null 2>&1\n"
                 f'for i in $(seq 50); do grep -q reviewer {out} 2>/dev/null && break; sleep 0.2; done\n') if reviewer else ""
        with open(script, "w") as f:
            # each line a shell of its own, as an agent's tool calls are
            f.write(f"""{first}
sh -c 'export HC_SESSION={self.try_}; unset HC_TERMINAL_SOCKET; hc run --bg --name p1 -- sleep 30 >/dev/null 2>&1'
sh -c 'hc server stop >/dev/null 2>{out}.err; echo "bare stop: $?" >> {out}'
sh -c 'HC_SESSION={self.try_} hc server stop >/dev/null 2>&1; echo "throwaway stop: $?" >> {out}'
echo done >> {out}
""")
        argv = ["sh", script]
        path = self.env["PATH"]
        if guarded and start == "task":
            argv = guard.guard_argv(argv, self.live, os.path.join(self.tmp, "store"))
        elif guarded:
            bin_ = os.path.join(self.tmp, "bin")
            os.makedirs(bin_)
            with open(os.path.join(bin_, "herdr-task"), "w") as f:
                f.write(f'#!/bin/sh\nHERDR_TASK_STORE={self.tmp}/store exec {sys.executable} '
                        f'{os.path.join(ROOT, "mods", "tasks", "bin", "herdr-task")} "$@"\n')
            os.chmod(os.path.join(bin_, "herdr-task"), 0o755)
            path = f"{bin_}:{path}"   # this checkout's herdr-task, not an installed older one
            argv = ["sh", "-c", f'{guard.GUARD_SH} exec "$@"', "herdr-assistant", *argv]
        argv = ["env", f"PATH={path}", *argv]   # as the person's shell gives it its PATH
        r = self.hc(self.live, "run", "--bg", "--name", "agent", "--", *argv)
        self.assertEqual(r.returncode, 0, r.stderr)
        for _ in range(150):
            if os.path.exists(out):
                with open(out) as f:
                    if "done" in f.read():
                        break
            if not guarded and self.status(self.live).get("pid") != self.pid:
                break
            time.sleep(0.2)
        try:
            with open(out) as f:
                return f.read()
        except FileNotFoundError:
            return ""

    def test_with_the_guard_the_live_core_survives(self):
        said = self.replay(True)
        self.assertIn("bare stop: 77", said)
        self.assertIn("throwaway stop: 0", said)
        self.assertEqual(self.status(self.live).get("pid"), self.pid)   # the same core, still up

    def test_247_an_assistant_and_the_reviewer_it_starts_keep_the_live_core_up(self):
        said = self.replay(True, start="assistant", reviewer=True)
        self.assertIn("reviewer stop: 77", said)
        self.assertIn("bare stop: 77", said)
        self.assertIn("throwaway stop: 0", said)
        self.assertEqual(self.status(self.live).get("pid"), self.pid)

    def test_247_a_tasks_reviewer_keeps_the_live_core_up(self):
        said = self.replay(True, reviewer=True)
        self.assertIn("reviewer stop: 77", said)
        self.assertEqual(self.status(self.live).get("pid"), self.pid)

    def test_without_it_the_bare_stop_takes_the_live_core_down(self):
        # the bug, reproduced on the stand-in: the stop lands on the session the terminal runs in
        self.replay(False)
        for _ in range(50):
            if self.status(self.live).get("pid") != self.pid:
                break
            time.sleep(0.2)
        self.assertNotEqual(self.status(self.live).get("pid"), self.pid)


if __name__ == "__main__":
    unittest.main()
