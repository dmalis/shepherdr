"""FORK.md loads in every Claude Code session in this repo: CLAUDE.md (upstream's) imports AGENTS.md, and AGENTS.md's
fork paragraph imports FORK.md with a bare `@FORK.md`. A sync that drops either import fails here. FORK.md imports
nothing itself, so the import pulls in only it, and the plain link stays for agents that read AGENTS.md as text."""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME, the agent's own terminal dropped)

import unittest  # noqa: E402

# Claude Code's import: `@path` at a line's start or after whitespace, outside code spans and blocks.
IMPORT = re.compile(r"(?:^|(?<=\s))@([^\s`]+)")


def imports(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        text = f.read()
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    text = re.sub(r"`[^`\n]*`", "", text)
    return IMPORT.findall(text), text


class RulesLoaded(unittest.TestCase):
    def test_claude_md_imports_agents_md(self):
        self.assertIn("AGENTS.md", imports("CLAUDE.md")[0])

    def test_agents_md_imports_fork_md_in_its_fork_paragraph(self):
        found, text = imports("AGENTS.md")
        self.assertIn("FORK.md", found)
        fork_paragraph = text.split("\n\n")[1]
        self.assertIn("@FORK.md", fork_paragraph)
        self.assertIn("[FORK.md](FORK.md)", fork_paragraph)   # the link, for Codex and the rest

    def test_fork_md_imports_nothing(self):
        self.assertEqual(imports("FORK.md")[0], [])


if __name__ == "__main__":
    unittest.main()
