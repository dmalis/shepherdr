"""An agent can't take down the session it runs in (SHEP-323; every agent's terminal since dmalis/shepherdr#247).

On 2026-11-23 a task's agent tried a throwaway herdr-core with `export HC_SESSION=<test>` in one shell call and a
bare `hc server stop` in the next. Each call is a new shell, so the export was gone: the terminal's own
HC_SESSION=shepherdr was back, and the stop took down Shepherdr's live core with every Assistant and task agent in it.

So every agent Shepherdr starts has a folder of small stand-ins first on its PATH: hc, herdr-core, systemctl,
launchctl, pkill, killall, kill, shepherdr, and cp, mv, install and ln. Each runs the real one, except for what would
stop, restart, replace or reconfigure the live session: `hc server stop|restart` aimed at a protected session,
`hc update`, systemctl or launchctl stopping or restarting herdr-core's or Shepherdr's units, pkill/killall naming
herdr-core or Shepherdr, kill aimed at their processes by number, `shepherdr install|update|uninstall|migrate|web|
secrets` on the real home, and copying, moving or linking over the live commands (~/.local/bin) or the live install
(~/.local/share/shepherdr's code). Those are refused with why and how to do it right (a throwaway session named on
the same command). Protected sessions: the one the agent runs in (HERDR_GUARD_SESSION for a task, HERDR_GUARD_LIVE
for any other agent, set at launch), Shepherdr's ("shepherdr") and the Herdr app's ("default").

Who gets it, all through this module:
- a task's agent and its reviewer (launch.py: guard_argv). HERDR_GUARD_SESSION also marks a task's terminal for
  what only the person may do (self_update.py, base.py, fork/sync/state.py), and nothing there can say yes for them;
- each space's Assistant, however it starts (assistant_argv; GUARD_SH in core/clean-env.js and service/restart.sh,
  run on the Assistant's own machine through `herdr-task _guard-dir`). Unlike a task, an Assistant may still do one
  of these when the person asked for exactly that: it puts HERDR_GUARD_ASKED=1 on that one command;
- the reviewers and helpers an agent starts itself (`hc run … --label herdr.role=reviewer|helper … -- <command>` on a
  protected session): hc runs a child in herdr-core's environment, not its caller's, so the stand-in hc wraps the
  command after `--` the way guard_argv does (HERDR_GUARD_SESSION: no yes word, it never speaks for the person).
The person's own terminals (the web app's Terminal, their shell) are never guarded.

dmalis/shepherdr#212: nor can it press keys in a reviewer's or helper's screen (`hc keys` on a terminal labelled
herdr.role=reviewer or helper, by name or t-id, on a protected session; the real hc's `get` says): their trust, sign-in and start screens are the person's to answer (AGENTS.md "Nothing that risks a
ban").

It fails open: a guard folder that can't be written, or a herdr-task too old to say where it is, starts the agent
without it, and a check that can't look (no ps, an unreadable folder) lets the command through. A broken seatbelt
must never stop agents from starting or hc from working.

It's a guard against mistakes, not against an agent set on getting round it: a full path to the real command, the
shell's own `kill` builtin, an rc file or command that puts the real folder first on PATH again, `hc run` of a
template, and writing a file with `>` or tee all get round it (docs/guard.md).
"""
import os

from .base import SESSION

GUARDED = ("hc", "herdr-core", "systemctl", "launchctl", "pkill", "killall", "kill", "shepherdr", "cp", "mv", "install", "ln")

# One POSIX sh script for every name: it looks at $0's name, then runs the next one of that name on PATH after its
# own folder. Exit 77 when it refuses.
SCRIPT = r'''#!/bin/sh
# Shepherdr's guard (SHEP-323, dmalis/shepherdr#247): an agent can't take down the live session it runs in. Written
# by herdr-task (herdr_task/guard.py); edits here are overwritten.
me=${0##*/}
here=$(cd "${0%/*}" 2>/dev/null && pwd -P)
task=${HERDR_GUARD_SESSION:-}
own=${HERDR_GUARD_SESSION:-${HERDR_GUARD_LIVE:-shepherdr}}

refuse() {
  # an Assistant (never a task) does it when the person asked for exactly that: HERDR_GUARD_ASKED=1 on the command
  if [ -z "$task" ] && [ "${HERDR_GUARD_ASKED:-}" = 1 ]; then
    echo "Shepherdr's guard let \`$me\` through: the person asked for it (HERDR_GUARD_ASKED=1)." >&2
    return 0
  fi
  echo "Shepherdr refused: $1" >&2
  echo "An agent's terminal can't stop, restart, update or reconfigure the live session it runs in ($own), nor" >&2
  echo "Shepherdr's own services. Tests use a throwaway session named on the same command, every time:" >&2
  echo "  HC_SESSION=<throwaway> hc server stop     (an export from an earlier shell call is gone)" >&2
  if [ -n "$task" ]; then
    echo "If the person wants the live one changed, they do it from their own terminal." >&2
  else
    echo "Only if the person asked you for exactly this, in their own words, run it again marked as theirs:" >&2
    echo "  HERDR_GUARD_ASKED=1 $me ...     (never for a test, and never on your own)" >&2
  fi
  exit 77
}

protected() {
  case "$1" in "$own"|shepherdr|default) return 0 ;; esac
  return 1
}

hc_check() {
  cmd= sub= on= kid= dash=
  for a in "$@"; do
    if [ -n "$dash" ]; then continue; fi
    case "$a" in
      --) dash=1 ;;
      -h|--help|help) return 0 ;;
      --on|--on=*) on=1 ;;
      herdr.role=reviewer|herdr.role=helper|--label=herdr.role=reviewer|--label=herdr.role=helper) kid=1 ;;
      -*) ;;
      *) if [ -z "$cmd" ]; then cmd=$a; elif [ -z "$sub" ]; then sub=$a; fi ;;
    esac
  done
  target=${HC_SESSION:-default}
  case "$cmd" in
    server)
      case "$sub" in stop|restart)
        protected "$target" && refuse "\`$me server $sub\` here would $sub the live session \"$target\"" ;;
      esac ;;
    update) refuse "\`$me update\` replaces the herdr-core every live session runs on" ;;
    keys)
      # dmalis/shepherdr#212: a worker pressed keys on its reviewer's folder-trust screen. Known by its role label,
      # whichever address names it (its name or its t-id).
      if protected "$target" && [ -n "$sub" ] && [ -n "$real" ] &&
         "$real" get "$sub" </dev/null 2>/dev/null | grep -Eq '"herdr\.role": ?"(reviewer|helper)"'; then
        echo "Shepherdr refused: \`$me keys $sub\` would press keys in your reviewer's or helper's own screen." >&2
        echo "Its trust, sign-in and start screens are the person's to answer: tell them \"Your reviewer is waiting on a" >&2
        echo "startup screen; answer it in its terminal\", then wait for it (\`$me wait $sub --timeout 600\`)." >&2
        exit 77
      fi ;;
    run)
      # dmalis/shepherdr#247: a reviewer or helper it starts runs in herdr-core's environment, not this one: it gets
      # the guard the same way (wrapped below)
      [ "$cmd" = run ] && [ -n "$dash" ] && [ -n "$kid" ] && [ -z "$on" ] && protected "$target" && wrap=1 ;;
    serve|hold)
      protected "$target" && refuse "\`$me $cmd\` here would start a second core on the live session \"$target\"" ;;
  esac
  return 0
}

systemctl_check() {
  verb= hit=
  for a in "$@"; do
    case "$a" in
      stop|restart|try-restart|reload-or-restart|try-reload-or-restart|kill|disable|mask|isolate|reload|edit|revert|link|set-property)
        [ -z "$verb" ] && verb=$a ;;
      -*) ;;
      hc-serve*|hc-hold*|hc-shutdown*|herdr-core*|shepherdr*|herdr-*) hit=$a ;;
    esac
  done
  [ -n "$verb" ] && [ -n "$hit" ] && refuse "\`systemctl $verb $hit\` would touch the live herdr-core or Shepherdr"
  return 0
}

launchctl_check() {
  # macOS: Shepherdr's service is dev.shepherdr.service (launchd)
  verb= hit=
  for a in "$@"; do
    case "$a" in
      stop|kill|kickstart|bootout|unload|remove|disable) [ -z "$verb" ] && verb=$a ;;
      -*) ;;
      *shepherdr*|*herdr*) hit=$a ;;
    esac
  done
  [ -n "$verb" ] && [ -n "$hit" ] && refuse "\`launchctl $verb $hit\` would touch the live herdr-core or Shepherdr"
  return 0
}

kill_check() {
  for a in "$@"; do
    case "$a" in
      hc|*herdr-core*|*shepherdr*|*hc-serve*|*hc-hold*|*"service/main.ts"*)
        refuse "\`$me $a\` would end the live herdr-core or Shepherdr" ;;
    esac
  done
  return 0
}

pid_check() {
  # kill by number (not the shell's own builtin: `env kill`, `xargs kill`): what that process is, by ps
  for a in "$@"; do
    p=${a#-}
    case "$p" in ''|*[!0-9]*) continue ;; esac
    [ "$p" -gt 1 ] 2>/dev/null || continue
    c=$(ps -o comm= -p "$p" 2>/dev/null) || continue
    l=$(ps -o args= -p "$p" 2>/dev/null)
    case "${c##*/}" in herdr-core|hc) refuse "\`kill $a\` would end the live herdr-core (process $p)" ;; esac
    case "$l" in *"herdr-task scheduler"*|*"service/main.ts"*) refuse "\`kill $a\` would end Shepherdr's own service (process $p)" ;; esac
  done
  return 0
}

shepherdr_check() {
  cmd= root= dry=
  for a in "$@"; do
    case "$a" in
      -h|--help) return 0 ;;
      --root|--root=*) root=1 ;;
      --dry-run) dry=1 ;;
      -*) ;;
      *) [ -z "$cmd" ] && cmd=$a ;;
    esac
  done
  case "$cmd" in
    install|update|uninstall|migrate)
      if [ -z "$root$dry" ]; then
        [ "$cmd" = update ] && [ -n "$task" ] && echo "A schedule the person let update Shepherdr asks for it with \`herdr-task update-shepherdr <its task>\`." >&2
        refuse "\`shepherdr $cmd\` would change the live install (use --root <scratch> for a try)"
      fi ;;
    web|secrets)
      case " $* " in *" status "*|*" where "*) ;; *) refuse "\`shepherdr $cmd\` would reconfigure the live Shepherdr" ;; esac ;;
  esac
  return 0
}

# the live commands (in ~/.local/bin) and the live install's code (in ~/.local/share/shepherdr)
NAMES=" hc herdr-core herdr herdr-task herdr-artifact herdr-secret herdr-browser herdr-desktop shepherdr "
live_bin= live_share=
live() {
  # $1: a path something would be written to, moved from or linked at. 0: it is one of the live ones
  p=$1
  case "$p" in */) p=${p%/}; [ -n "$p" ] || p=/ ;; esac
  case "$p" in */*) d=${p%/*} b=${p##*/}; [ -n "$d" ] || d=/ ;; *) d=. b=$p ;; esac
  rd=$(cd "$d" 2>/dev/null && pwd -P) || return 1
  if [ -z "$live_bin$live_share" ]; then
    live_bin=$(cd "$HOME/.local/bin" 2>/dev/null && pwd -P) || live_bin=-
    live_share=$(cd "$HOME/.local/share/shepherdr" 2>/dev/null && pwd -P) || live_share=-
  fi
  case "$NAMES" in *" $b "*) [ "$rd" = "$live_bin" ] && return 0 ;; esac
  [ "$live_share" = - ] && return 1
  case "$rd/$b/" in
    "$live_share"/bin/*|"$live_share"/core/*|"$live_share"/herdr/*|"$live_share"/hooks/*|"$live_share"/mods/*|\
    "$live_share"/service/*|"$live_share"/web/*|"$live_share"/templates/*|"$live_share"/install.sh/*|"$live_share"/package.json/*)
      return 0 ;;
  esac
  return 1
}

valued() {
  # whether option $1 of $me takes the next word as its value
  case "$1" in
    -t|--target-directory|-S|--suffix) return 0 ;;
    -m|-o|-g|--mode|--owner|--group) [ "$me" = install ] && return 0 ;;
  esac
  return 1
}

copy_check() {
  # cp, mv, install, ln: where each would land (a -t folder, else the last word: a folder takes each source's name)
  n=0 t= skip= no_t= end= last= dirs=
  for a in "$@"; do
    if [ -n "$skip" ]; then
      [ "$skip" = t ] && t=$a
      skip=; continue
    fi
    if [ -z "$end" ]; then
      case "$a" in
        --) end=1; continue ;;
        -t|--target-directory) skip=t; continue ;;
        --target-directory=*) t=${a#*=}; continue ;;
        -T|--no-target-directory) no_t=1; continue ;;
        -d|--directory) [ "$me" = install ] && dirs=1; continue ;;
        -t?*) t=${a#-t}; continue ;;
        -*) valued "$a" && skip=1; continue ;;
      esac
    fi
    n=$((n + 1))
    [ "$me" = mv ] && live "$a" && refuse "\`mv $a\` would move one of the live commands or the live install's files"
    last=$a
  done
  [ "$n" -gt 0 ] || return 0
  if [ -n "$dirs" ]; then
    for a in "$@"; do case "$a" in -*) ;; *) live "$a" && refuse "\`install -d $a\` would change the live install" ;; esac; done
    return 0
  fi
  if [ -z "$t" ] && [ "$n" -eq 1 ]; then
    [ "$me" = ln ] && t=. || return 0
  fi
  if [ -z "$t" ]; then
    if [ -z "$no_t" ] && [ -d "$last" ]; then t=$last; else
      live "$last" && refuse "\`$me ... $last\` would write over one of the live commands or the live install"
      return 0
    fi
  fi
  end= i=0 skip=
  for a in "$@"; do
    if [ -n "$skip" ]; then skip=; continue; fi
    if [ -z "$end" ]; then
      case "$a" in
        --) end=1; continue ;;
        -*) valued "$a" && skip=1; continue ;;
      esac
    fi
    i=$((i + 1))
    [ "$i" -eq "$n" ] && [ "$t" = "$last" ] && continue
    s=${a%/}
    live "$t/${s##*/}" && refuse "\`$me ... $t\` would write over the live ${s##*/}"
  done
  return 0
}

# the real one: the first of that name on PATH that isn't in this folder (found first: a check may ask it). Only a
# folder that has one is looked at twice (pwd -P), so this costs little for cp and the rest.
real=
rest=$PATH
while [ -n "$rest" ]; do
  d=${rest%%:*}
  case "$rest" in *:*) rest=${rest#*:} ;; *) rest= ;; esac
  [ -n "$d" ] || d=.
  [ -f "$d/$me" ] && [ -x "$d/$me" ] || continue
  [ "$(cd "$d" 2>/dev/null && pwd -P)" = "$here" ] && continue
  real=$d/$me; break
done

wrap=
case "$me" in
  hc|herdr-core) hc_check "$@" ;;
  systemctl) systemctl_check "$@" ;;
  launchctl) launchctl_check "$@" ;;
  pkill|killall) kill_check "$@" ;;
  kill) pid_check "$@" ;;
  shepherdr) shepherdr_check "$@" ;;
  cp|mv|install|ln) copy_check "$@" ;;
esac

[ -n "$real" ] || { echo "$me: command not found" >&2; exit 127; }
if [ -n "$wrap" ]; then
  # `hc run … -- <command>`: <command> starts with this folder first on its PATH and the session it protects, as a
  # task's agent does (no yes word: a reviewer or helper never speaks for the person)
  n=$# seen=
  for a in "$@"; do
    set -- "$@" "$a"
    if [ -z "$seen" ] && [ "$a" = -- ]; then
      seen=1
      set -- "$@" sh -c 'export PATH="$1:$PATH" HERDR_GUARD_SESSION="$2"; shift 2; exec "$@"' herdr-guard "$here" "$own"
    fi
  done
  shift "$n"
fi
exec "$real" "$@"
'''


def guard_dir(store=None):
    """The guard's folder (written when missing or changed): beside the task lists, so every machine's herdr-task
    has its own."""
    if store is None:
        from .base import STORE as store
    d = os.path.join(store, ".guard", "bin")
    os.makedirs(d, exist_ok=True)
    main = os.path.join(d, "guard.sh")
    try:
        with open(main) as f:
            same = f.read() == SCRIPT
    except OSError:
        same = False
    if not same:
        tmp = f"{main}.{os.getpid()}"
        with open(tmp, "w") as f:
            f.write(SCRIPT)
        os.chmod(tmp, 0o755)
        os.replace(tmp, main)
    for name in GUARDED:
        p = os.path.join(d, name)
        if os.path.islink(p) and os.readlink(p) == "guard.sh":
            continue
        try:
            os.remove(p)
        except FileNotFoundError:
            pass
        os.symlink("guard.sh", p)
    return d


# Run after the person's interactive shell (in_shell) has read its rc files, which put ~/.local/bin (the real hc)
# first: the guard goes first again, and the agent and every shell it opens inherit it.
def guard_argv(argv, session=None, store=None):
    """argv run with the guard first on PATH and the live session it protects (see the module's words)."""
    try:
        d = guard_dir(store)
    except OSError:
        return argv   # a guard that can't be written never stops a task from starting
    return ["sh", "-c", 'export PATH="$0:$PATH" HERDR_GUARD_SESSION="$1"; shift; exec "$@"', d, session or SESSION, *argv]


def assistant_argv(argv, session=None, store=None):
    """An Assistant's argv (any agent that isn't a task's), guarded as guard_argv's but not marked as a task's
    terminal: HERDR_GUARD_LIVE, not HERDR_GUARD_SESSION, so the person's own asks still work there."""
    try:
        d = guard_dir(store)
    except OSError:
        return argv
    return ["sh", "-c", 'export PATH="$0:$PATH" HERDR_GUARD_LIVE="$1"; shift; exec "$@"', d, session or SESSION, *argv]


# The same for a start that is one sh line (a template's `command:`, run on the agent's own machine): GUARD_SH in
# core/clean-env.js and service/restart.sh, kept equal by test_guard.py. herdr-task there writes its folder and says
# where; an older herdr-task, or none, leaves the agent unguarded rather than not started.
GUARD_SH = ('g=$(herdr-task _guard-dir 2>/dev/null) && [ -d "$g" ] && '
            'export PATH="$g:$PATH" HERDR_GUARD_LIVE="${HC_SESSION:-default}";')


def cmd_guard_dir(_args):
    """`herdr-task _guard-dir`: writes this machine's guard folder and prints it (GUARD_SH)."""
    print(guard_dir())
