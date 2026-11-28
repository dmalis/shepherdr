"""Fork #175: GitHub's Check runs its parts side by side and still runs every check it ran as one job. Pins what
the split relies on: every part is in the last job's needs (or a failed part could leave `check` green), that job runs
when a part failed, every browser check and both shell loops are still there, and the Python tests' three parts
leave no test file out."""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME, the agent's own terminal dropped)

import glob  # noqa: E402
import subprocess  # noqa: E402
import unittest  # noqa: E402

CHECK_YML = os.path.join(ROOT, ".github", "workflows", "check.yml")


def text():
    with open(CHECK_YML, encoding="utf-8") as f:
        return f.read()


def jobs(t):
    """{job id: its block}, read from the two-space keys under `jobs:` (no YAML library on the runner)."""
    body = t.split("\njobs:\n", 1)[1]
    parts = re.split(r"(?m)^  ([\w-]+):\n", body)
    return dict(zip(parts[1::2], parts[2::2]))


class CheckWorkflow(unittest.TestCase):
    def test_every_part_is_in_checks_needs(self):
        j = jobs(text())
        self.assertIn("check", j)
        needs = re.search(r"(?m)^    needs: \[([^\]]*)\]$", j["check"]).group(1)
        self.assertEqual(sorted(n.strip() for n in needs.split(",")), sorted(k for k in j if k != "check"))

    def test_check_runs_when_a_part_failed_and_reads_every_result(self):
        c = jobs(text())["check"]
        # a job skipped because a need failed would report as passed: `check` must not be skipped that way
        self.assertIn("if: ${{ !cancelled() }}", c)
        self.assertIn("${{ join(needs.*.result, ' ') }}", c)
        self.assertIn('[ "$r" = success ] ||', c)
        # a matrix folds its jobs into one result: each job of the run is read from GitHub too
        self.assertIn("actions/runs/${{ github.run_id }}/attempts/${{ github.run_attempt }}/jobs", c)
        self.assertIn('select(.name != "check" and .conclusion != "success")', c)
        self.assertIn('[ -z "$bad" ] || {', c)
        self.assertIn("actions: read", c)

    def test_every_check_still_runs(self):
        j = jobs(text())
        browser = j["browser"]
        # the reading check runs once more after a failure (its long-task bar reads the runner's speed): both runs fail
        # the job when both fail
        self.assertIn('            run: bun web/demo/reading-check.ts || { echo "::warning::the reading check failed once, '
                      'running it again"; bun web/demo/reading-check.ts; }\n', browser)
        for f in ("tap-check", "scroll-check", "reply-check", "dict-check", "box-check", "phone-box-check",
                  "draft-check.ts --phone", "edit-check", "still-check", "artifact-check",
                  "motion-check", "swipe-check", "fit-check"):
            f = f if " " in f else f + ".ts"
            self.assertIn(f"            run: bun web/demo/{f}\n", browser, f)
        # each browser check is the browser matrix's: none left as a step of another job
        for name, block in j.items():
            if name != "browser":
                self.assertNotIn("bun web/demo/", block, name)
        self.assertIn("        run: bun web/first-screen.ts\n", j["build"])
        # the matrix's command is what the job's last step runs
        self.assertRegex(browser, r"(?m)^      - name: \$\{\{ matrix\.name \}\}\n        run: \$\{\{ matrix\.run \}\}\n\s*\Z")
        for job, lines in (("web", ("python3 bin/sync-shared --check", 'node --input-type=module --check < "$f"',
                                    'python3 -m json.tool "$f"', 'bash -n "$f"', 'sh -n "$f"', "bunx tsc --noEmit -p .",
                                    "bun test --parallel=4 service core web")),
                           ("build", ("bun run build", './install.sh --root "$root" --dry-run --yes',
                                      './install.sh --root "$root" --yes', 'python3 bin/shepherdr doctor --root "$root"',
                                      'python3 bin/shepherdr uninstall --root "$root"')),
                           ("python", ('          python3 -m unittest -v "$@"\n',))):
            for line in lines:
                self.assertIn(line, j[job], f"{job}: {line}")

    def test_only_a_pull_requests_older_run_is_cancelled(self):
        # main's runs finish, so merges every few minutes still get a verdict (the sync gate reads it)
        self.assertIn("  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n", text())

    def test_each_job_keeps_a_time_limit(self):
        for name, block in jobs(text()).items():
            self.assertRegex(block, r"(?m)^    timeout-minutes: \d+$", name)

    def test_the_python_parts_leave_no_test_file_out(self):
        """The shell of the Python job's test step, run here for each part: the three lists together are every
        test/test_*.py, each once."""
        python = jobs(text())["python"]
        parts = re.search(r"part: \[([^\]]*)\]", python).group(1).split(", ")
        script = re.search(r'(?ms)^          (case "\$\{\{ matrix\.part \}\}" in\n.*?)^          python3 -m unittest -v',
                           python).group(1)
        script = re.sub(r"(?m)^          ", "", script) + 'printf "%s\\n" "$@"\n'
        seen = []
        for part in parts:
            out = subprocess.run(["bash", "-c", script.replace("${{ matrix.part }}", part)], cwd=os.path.join(ROOT, "test"),
                                 capture_output=True, text=True, check=True).stdout.split()
            self.assertTrue(out, part)
            seen += out
        every = sorted(os.path.basename(f)[:-3] for f in glob.glob(os.path.join(ROOT, "test", "test_*.py")))
        self.assertEqual(sorted(seen), every)

    def test_the_browser_and_python_jobs_get_the_built_web_app(self):
        j = jobs(text())
        upload = "      - uses: actions/upload-artifact@v4\n"
        self.assertIn(upload, j["build"])
        self.assertRegex(j["build"].split(upload, 1)[1], r"^(        #[^\n]*\n)?        with:\n          name: web-dist\n"
                                                         r"          path: web/dist\n")
        # the build comes before the upload, the installer (which installs that build) after it
        self.assertLess(j["build"].index("bun run build"), j["build"].index(upload))
        for name in ("python", "browser"):
            self.assertIn("    needs: build\n", j[name], name)
            self.assertIn("      - uses: actions/download-artifact@v4\n        with:\n          name: web-dist\n"
                          "          path: web/dist\n", j[name], name)
        # the Python tests start after the download: the installer tests install that build
        self.assertLess(j["python"].index("download-artifact"), j["python"].index("python3 -m unittest"))


if __name__ == "__main__":
    unittest.main()
