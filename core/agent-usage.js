// Where Claude Code's and Codex's plan usage is seen: in each agent's own command, never read by Shepherdr (the ban-risk
// second pass). One line for both, shown once where usage belongs (Settings › Usage, and the voice's answers), never
// per machine. machine.py still sends a note per installed CLI; these keep it off every screen.

export const AGENT_USAGE = "For Claude Code and Codex, run /usage in Claude Code or /status in Codex.";

/** the agent CLIs whose plan usage is never read: their machine.py note isn't shown */
export const NOT_READ = ["claude", "codex"];
export const notRead = (cli) => NOT_READ.includes(cli);
