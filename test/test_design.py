"""A few of docs/design.md's rules that a source check can hold, and only in the forms it names:

- raw colours (hex, rgb()/hsl()/hwb()/oklch()/lab()/lch()/color() and the common colour names) in the values of the
  app's stylesheets outside the design system (web/src/ds.css), and in literal `style={{…}}` props in TSX;
- font sizes off the type scale in `font-size:` and `font:` values (a size from a token, `inherit` or `%` passes),
  and in an inline style's `fontSize`;
- animations that never end (`infinite`, a huge iteration count outside `steps()`, `infinite` in an inline style, or
  a script animation with `iterations: Infinity`);
- hover styles outside `@media (hover: hover)` (or `any-hover`), counted per selector that names `:hover`;
- a monospace stack written out in `font:` or `font-family:` instead of `var(--mono)`, and a z-index above a
  component's own 1 to 3 (or under -1) written as a number instead of a `--z-` layer;
- the grey of second lines (`--muted`) at 4.5:1 on the page, a field, an agent's bubble and your own, in light, the
  device's dark, Dark and Night;
- reduced motion: whatever moves (a transform, or a box's size or place, in a transition or an animation) has a rule
  that stops it under each switch alone, the device's and Settings › General › Motion's, and script asks calm();
- haptics: `navigator.vibrate` only in web/src/feel.ts's haptic(), and no hidden native switch clicked from script.

What each file holds today is its cap below: a count may go down, never up, and a new file starts at none. A cap above
what a file holds fails too, so lower it with the change that removed some. Moving rules to another file moves their
cap with them. Reduced motion as it plays (web/demo/motion-check.ts), idle work and contrast on other states are
checked in the browser."""
import home_guard  # noqa: F401  (first: a throwaway HOME)

import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DS = "web/src/ds.css"
# the type scale (docs/design.md, Type)
SCALE = {12, 13, 14, 16, 18, 20, 24}

COLOURS = {
    "web/src/styles.css": 21,
    "web/src/settings-look.css": 15,
    "web/src/sheets.css": 1,
    "web/plugins/installed/installed.css": 1,
}
OFF_SCALE = {
    "web/src/ds.css": 1,
    "web/src/styles.css": 1,
    "web/src/about.css": 1,
    "web/plugins/chat/kind.css": 1,
    "web/plugins/whatsnew/whats-new.css": 1,
}
ENDLESS = {
    "web/src/ds.css": 5,
    "web/src/styles.css": 2,
    "web/src/dictate.css": 4,
}
INLINE_OFF_SCALE = {
    "web/plugins/screens/pane.tsx": 1,
}
INLINE_COLOURS = {
    "web/plugins/screens/pane.tsx": 10,
    "web/plugins/terminal/client.tsx": 1,
}
# hover styles outside @media (hover: hover), which a tap leaves lit (ds.css held 25 before #150)
BARE_HOVER = {
    "web/src/styles.css": 2,
    "web/src/dictate.css": 3,
}
# a monospace stack written out instead of var(--mono) (ds.css held 11)
RAW_MONO = {
    "web/src/styles.css": 2,
    "web/src/about.css": 1,
    "web/plugins/whatsnew/whats-new.css": 1,
}
# a layer's z-index written as a number instead of a --z- token (ds.css held 4)
RAW_LAYERS = {
    "web/src/styles.css": 5,
}

NAMES = "white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|navy|teal|maroon|olive|lime|aqua|fuchsia"
COLOUR = re.compile(r"#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\(|\b(?:" + NAMES + r")\b")
SIZE_VALUE = re.compile(r"(-?[0-9]*\.?[0-9]+)(px|PX|rem|em|vw|vh|vmin|vmax|ch)\b")


def files(*kinds):
    out = []
    for top in ("web/src", "web/plugins"):
        for d, _, names in os.walk(os.path.join(ROOT, top)):
            out += [os.path.relpath(os.path.join(d, n), ROOT) for n in names
                    if n.endswith(kinds) and ".test." not in n]
    return sorted(out)


def text(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def bare(rel):
    """a stylesheet with its comments, strings and url()s taken out"""
    # one pass, so an apostrophe in a comment opens no string and a /* in a string opens no comment
    s = re.sub(r"/\*.*?\*/|\"(?:\\.|[^\"\\\n])*\"|'(?:\\.|[^'\\\n])*'",
               lambda m: "" if m.group(0).startswith("/*") else '""', text(rel), flags=re.S)
    return re.sub(r"url\([^)]*\)", "url()", s)


def declarations(rel):
    """(property, value) of each declaration in a stylesheet, at any depth (nested rules and @media included), with
    its comments, strings and url()s taken out"""
    s = bare(rel)
    out = []
    # each piece of text up to a { (a selector or an at-rule), a ; or a } (the end of a declaration)
    for piece, end in re.findall(r"([^{};]*)([{};])", s):
        if end != "{" and ":" in piece:
            prop, value = piece.split(":", 1)
            out.append((prop.strip().lower(), value.strip()))
    return out


def rules(rel):
    """(selector, the at-rules around it) of each style rule in a stylesheet, nested ones included"""
    out, stack, piece = [], [], ""
    for ch in bare(rel):
        if ch == "{":
            head = " ".join(piece.split())
            if not head.startswith("@"):
                out.append((head, [h for h in stack if h.startswith("@")]))
            stack.append(head)
            piece = ""
        elif ch == "}":
            if stack:
                stack.pop()
            piece = ""
        elif ch == ";":
            piece = ""
        else:
            piece += ch
    return out


def selectors(head):
    """each selector of a selector list, split at its own commas (not those inside :is() or :not())"""
    out, depth, cur = [], 0, ""
    for ch in head:
        depth += {"(": 1, ")": -1}.get(ch, 0)
        if ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    return [x for x in out + [cur.strip()] if x]


HOVER = re.compile(r"\(\s*hover\s*:\s*hover\s*\)")


def for_a_mouse(at):
    """an @media whose every branch asks for a primary pointer that hovers: (hover: hover), not negated, not or-ed;
    any-hover is not enough (a phone with a mouse paired still taps)"""
    if not at.startswith("@media"):
        return False
    branches = at[len("@media"):].lower().split(",")
    return all(HOVER.search(b) and not re.search(r"\b(?:not|or)\b", b) for b in branches)


def bare_hover(rel):
    """selectors with :hover outside an @media (hover: hover): on a touch screen a tap leaves them lit"""
    return sum(1 for head, ats in rules(rel) if not any(for_a_mouse(a) for a in ats)
               for sel in selectors(head) if ":hover" in sel)


def raw_mono(rel):
    """font and font-family values that write out a monospace stack instead of var(--mono)"""
    return sum(1 for prop, value in declarations(rel)
               if prop in ("font", "font-family") and re.search(r"\bmonospace\b", no_tokens(value)))


def raw_layers(rel):
    """z-index values above a component's own 1 to 3 (or under -1) written as a number, not a --z- layer"""
    return sum(1 for prop, value in declarations(rel) if prop == "z-index"
               and any(not -1 <= int(x) <= 3 for x in re.findall(r"-?\d+", no_tokens(value))))


def no_tokens(value):
    """a value without its tokens' names, a var()'s fallback kept: var(--fg, red) still holds red"""
    return re.sub(r"var\(\s*--[\w-]+\s*,?|--[\w-]+", "", value)


def colours(rel):
    return sum(len(COLOUR.findall(no_tokens(value))) for _, value in declarations(rel))


def font_size(prop, value):
    """the size a font-size or font declaration sets, or None when a token, a keyword or a percentage sets it"""
    value = re.sub(r"\s*!important\s*$", "", value)
    if prop == "font-size":
        v = value
    elif prop == "font":
        if "var(" in value.split("/")[0] and not SIZE_VALUE.search(value.split("/")[0]):
            return None
        # the size is the length before the "/" of the line height, or the first length
        m = re.search(r"(?:^|\s)(\S+)\s*/", value) or re.search(r"(?:^|\s)([0-9.]+[a-zA-Z]+)(?:\s|$)", value)
        if not m:
            return None
        v = m.group(1)
    else:
        return None
    if "var(" in v or "%" in v or v in ("inherit", "initial", "unset"):  # from a token, or the size around it
        return None
    return v


def off_scale(rel):
    n = 0
    for prop, value in declarations(rel):
        v = font_size(prop, value)
        if v is None:
            continue
        m = SIZE_VALUE.fullmatch(v.strip())
        if not m or m.group(2) not in ("px", "PX") or float(m.group(1)) not in SCALE:
            n += 1  # calc(), em, rem, vw or a px value off the scale
    return n


def endless(rel):
    n = 0
    for prop, value in declarations(rel):
        if prop in ("animation", "animation-iteration-count"):
            n += len(re.findall(r"\binfinite\b", value))
            # a bare whole number in the shorthand or the count is its iteration count: 100 or more is endless
            # (not the steps of a steps() timing, which is how a finite one moves in frames)
            plain = re.sub(r"\b(?:steps|cubic-bezier|linear)\([^)]*\)", "", value)
            n += sum(1 for x in re.findall(r"(?<![\w.-])(\d+)(?![\w.%])", plain) if int(x) >= 100)
    return n


def code(rel):
    """a script's source with its comments taken out and its strings kept (a // inside 'https://' is no comment)"""
    return re.sub(r"(\"(?:\\.|[^\"\\\n])*\"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|/\*.*?\*/|//[^\n]*",
                  lambda m: m.group(1) or "", text(rel), flags=re.S)


def script_endless(rel):
    src = code(rel)
    n = len(re.findall(r"iterations\s*:\s*(?:Infinity|Number\.POSITIVE_INFINITY)", src))
    # and an endless CSS animation written in an inline style's animation
    for m in inline_styles(src):
        for v in re.findall(r"\banimation(?:IterationCount)?\s*:\s*([^,}]+)", m):
            n += sum(len(re.findall(r"\binfinite\b", b)) for b in branches(v))
    return n


def branches(value):
    """what an inline value can be: each branch of a `cond ? a : b`, without its condition"""
    parts = re.split(r"(\?|:)", value)
    return [p for k, p in enumerate(parts[::2]) if 2 * k + 1 >= len(parts) or parts[2 * k + 1] != "?"]


def inline_styles(source):
    """the text of each literal style={{…}} prop, its nested braces kept"""
    out = []
    for m in re.finditer(r"\bstyle\s*=\s*\{\s*\{", source):
        i = m.start()
        depth, j = 0, source.index("{", i)
        while j < len(source):
            depth += {"{": 1, "}": -1}.get(source[j], 0)
            j += 1
            if depth == 0:
                break
        out.append(source[i:j])
    return out


# a string a style compares with (state === 'red' ? …) is no colour it paints
COMPARED = re.compile(r"""[=!]==?\s*(['"`])[^'"`]*\1|(['"`])[^'"`]*\2\s*[=!]==?""")


def inline_colours(rel):
    return sum(len(COLOUR.findall(no_tokens(COMPARED.sub("", m)))) for m in inline_styles(code(rel)))


def inline_off_scale(rel):
    """fontSize in an inline style, a number or a px string off the scale (a token or a % is fine)"""
    n = 0
    for m in inline_styles(code(rel)):
        for v in re.findall(r"\bfontSize\s*:\s*([^,}]+)", m):
            # each branch it can take, so `phone ? 14 : 11` counts its 11 and `w >= 768 ? 14 : 16` not its 768
            # (a token, em and % follow the text around)
            for b in branches(v):
                px = re.fullmatch(r"\s*['\"`]?(\d+(?:\.\d+)?)(?:px|PX)?['\"`]?\s*", b)
                n += bool(px) and float(px.group(1)) not in SCALE
    return n


class DesignTokens(unittest.TestCase):
    """New UI uses the design system's tokens (docs/design.md): the counts of raw values only go down."""

    def ratchet(self, measure, kinds, allowed, what):
        over = []
        for rel in files(*kinds):
            n, cap = measure(rel), allowed.get(rel, 0)
            if n > cap:
                over.append(f"{rel}: {n} {what} (at most {cap})")
        self.assertEqual(over, [], f"use a token from {DS} (docs/design.md) instead")

    def test_colours_only_in_the_design_system(self):
        self.ratchet(lambda rel: 0 if rel == DS else colours(rel), (".css",), COLOURS, "raw colours")

    def test_type_sizes_on_the_scale(self):
        self.ratchet(off_scale, (".css",), OFF_SCALE, "font sizes off the scale")

    def test_no_new_endless_animation(self):
        # an animation that never ends costs a phone's battery all day: it stops once its wait is over (docs/design.md, Motion)
        self.ratchet(endless, (".css",), ENDLESS, "endless animations")
        self.ratchet(script_endless, (".ts", ".tsx"), {}, "endless script animations")

    def test_no_colours_in_inline_styles(self):
        self.ratchet(inline_colours, (".tsx",), INLINE_COLOURS, "raw colours in inline styles")

    def test_inline_type_sizes_on_the_scale(self):
        self.ratchet(inline_off_scale, (".tsx",), INLINE_OFF_SCALE, "inline font sizes off the scale")

    def test_hover_only_for_a_mouse(self):
        # docs/design.md, Touch: a hover style sits under @media (hover: hover), so a tap never leaves one lit
        self.ratchet(bare_hover, (".css",), BARE_HOVER, "hover styles outside @media (hover: hover)")

    def test_code_font_from_its_token(self):
        self.ratchet(raw_mono, (".css",), RAW_MONO, "monospace stacks written out (use var(--mono))")

    def test_layers_from_the_scale(self):
        self.ratchet(raw_layers, (".css",), RAW_LAYERS, "z-index layers written as numbers (use a --z- token)")

    def test_the_counts_are_current(self):
        stale = []
        for allowed, measure in ((COLOURS, colours), (OFF_SCALE, off_scale), (ENDLESS, endless), (INLINE_COLOURS, inline_colours),
                                 (INLINE_OFF_SCALE, inline_off_scale), (BARE_HOVER, bare_hover), (RAW_MONO, raw_mono),
                                 (RAW_LAYERS, raw_layers)):
            for rel, cap in allowed.items():
                if not os.path.exists(os.path.join(ROOT, rel)):
                    stale.append(f"{rel}: gone")
                elif measure(rel) < cap:
                    stale.append(f"{rel}: {measure(rel)} now, {cap} allowed")
        self.assertEqual(stale, [], "lower these counts in test/test_design.py")

    def test_the_document_names_real_tokens(self):
        # every `--token` docs/design.md names is declared in a stylesheet or set from script with setProperty
        doc = text("docs/design.md")
        defined = set()
        for rel in files(".css"):
            defined |= {p for p, _ in declarations(rel) if p.startswith("--")}
        for rel in files(".ts", ".tsx"):
            defined |= set(re.findall(r"setProperty\(\s*['\"`](--[a-z][a-z0-9-]*)", text(rel)))
        named = set(re.findall(r"`(--[a-z][a-z0-9-]*)`", doc))
        self.assertEqual(sorted(named - defined), [])


class Checks(unittest.TestCase):
    """the measures above on small samples, so a regex change can't quietly stop counting"""

    def sample(self, css, measure, suffix=".css"):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=suffix, dir=os.path.join(ROOT, "test"), delete=False) as f:
            f.write(css)
        try:
            return measure(os.path.relpath(f.name, ROOT))
        finally:
            os.unlink(f.name)

    def test_colours(self):
        self.assertEqual(self.sample(".a{color:#fff;background:rgb(0 0 0/.1)}", colours), 2)
        self.assertEqual(self.sample(".a{border-color:red;fill:color-mix(in srgb,white,var(--fg))}", colours), 2)
        self.assertEqual(self.sample("#fade{color:var(--red);background:url(#feed) transparent}", colours), 0)
        self.assertEqual(self.sample("/* #fff */.a{content:\"#fff\";color:currentColor}", colours), 0)
        self.assertEqual(self.sample("@media (hover:hover){.a:hover{color:#000}}", colours), 1)
        self.assertEqual(self.sample(".a{color:var(--fg, red)}", colours), 1)  # a fallback is a colour
        self.assertEqual(self.sample(".a{color:#111; .b{color:#222} background:#333}", colours), 3)  # nested CSS
        self.assertEqual(self.sample(".a{content:'it\\'s';color:#444}/* don't */.b{color:#555}", colours), 2)

    def test_sizes(self):
        self.assertEqual(self.sample(".a{font-size:13px}.b{font:600 14px/20px Inter}.c{font-size:var(--ui)}", off_scale), 0)
        self.assertEqual(self.sample(".a{font:italic 600 11px/18px Inter}.b{font-size:.5vw}.c{font-size:calc(10px*2)}", off_scale), 3)
        self.assertEqual(self.sample(".a{font-size:16PX}.b{font-size:15px}.c{font:500 var(--sec)/var(--secl) Inter}", off_scale), 1)
        self.assertEqual(self.sample(".a{font-size:14px !important}.b{font-size:11px!important}", off_scale), 1)

    def test_endless(self):
        self.assertEqual(self.sample(".a{animation:spin 1s linear infinite}.b{animation-iteration-count:999999}", endless), 2)
        self.assertEqual(self.sample(".a{animation:fade .2s ease}", endless), 0)
        self.assertEqual(self.sample(".a{animation:spin 1s 999999}.b{animation:fade 1.999s 2}", endless), 1)
        self.assertEqual(self.sample(".a{animation:film 2s steps(120) 1}", endless), 0)  # finite, in 120 frames
        self.assertEqual(self.sample("<a style = {{ animation: 'spin 1s infinite' }} />", script_endless, ".tsx"), 1)
        self.assertEqual(self.sample("<a style={{ opacity: plan === 'infinite' ? 0 : 1 }} />", script_endless, ".tsx"), 0)
        self.assertEqual(self.sample("<a style={{ animation: on ? 'spin 1s infinite' : 'none' }} />", script_endless, ".tsx"), 1)
        js = "el.animate(k, { iterations: Infinity })\n// el.animate(k, { iterations: Infinity })\n/* iterations: Infinity */"
        self.assertEqual(self.sample(js, script_endless, ".ts"), 1)

    def test_hover(self):
        self.assertEqual(self.sample(".a:hover{color:red}.b:hover,.b.on,.c:focus{color:red}", bare_hover), 2)
        self.assertEqual(self.sample("@media(hover:hover){.a:hover{x:1}}@media (hover: hover) and (pointer:fine){.b:hover{x:1}}", bare_hover), 0)
        # a branch that still matches a touch screen: or-ed with a width, negated, any-hover, or level 4 `or`
        self.assertEqual(self.sample("@media (hover: hover), (max-width: 767px){.a:hover{x:1}}", bare_hover), 1)
        self.assertEqual(self.sample("@media not all and (hover: hover){.a:hover{x:1}}", bare_hover), 1)
        self.assertEqual(self.sample("@media (any-hover: hover){.a:hover{x:1}}", bare_hover), 1)
        self.assertEqual(self.sample("@media (hover: hover) or (width > 1px){.a:hover{x:1}}", bare_hover), 1)
        self.assertEqual(self.sample("@media(pointer:coarse){.a:hover{x:1}}@media(hover:none){.b:hover{x:1}}", bare_hover), 2)
        self.assertEqual(self.sample(":is(.a,.b):hover{x:1}.c:not(:hover,.d){x:1}", bare_hover), 2)  # one each
        self.assertEqual(self.sample(".a{color:red;&:hover{x:1}}/* .b:hover{} */.c[title=\":hover\"]{x:1}", bare_hover), 1)
        self.assertEqual(self.sample("@media(hover:hover){@supports(x:y){.a:hover{x:1}}}", bare_hover), 0)

    def test_mono_and_layers(self):
        self.assertEqual(self.sample(".a{font:13px/20px ui-monospace,Menlo,monospace}.b{font-family:monospace}", raw_mono), 2)
        self.assertEqual(self.sample(".a{font:var(--code)/var(--codel) var(--mono)}.b{--mono:ui-monospace,monospace}", raw_mono), 0)
        self.assertEqual(self.sample(".a{font-family:var(--mono,monospace)}", raw_mono), 1)  # a fallback is written out
        self.assertEqual(self.sample(".a{z-index:20}.b{z-index:1}.c{z-index:-1}.d{z-index:var(--z-layer)}", raw_layers), 1)
        self.assertEqual(self.sample(".a{z-index:var(--z-layer,20)}.b{z-index:calc(var(--z-layer) + 1)}.c{z-index:-5}", raw_layers), 2)

    def test_inline(self):
        src = ("<a style={{ color: '#fff', ...(x ? { background: 'rgb(0 0 0)' } : {}) }} /> {/* style={{color:'#000'}} */}\n"
               "<a href='https://example.com' style={{ color: 'red', border: 'var(--line, #ddd)' }} /> // style={{color:'#000'}}")
        self.assertEqual(self.sample(src, inline_colours, ".tsx"), 4)
        self.assertEqual(self.sample("<a style ={ { color: '#fff' } } />", inline_colours, ".tsx"), 1)
        cmp = "<a style={{ color: state === 'red' ? 'var(--red)' : 'var(--fg)', borderColor: 'red' !== k ? 'var(--line)' : 'var(--fg)' }} />"
        self.assertEqual(self.sample(cmp, inline_colours, ".tsx"), 0)
        sizes = "<a style={{ fontSize: 11, lineHeight: 1 }} /><u style={{ fontSize: p ? 14 : 15, x: '1.25em' }} /><b style={{ fontSize: '13px' }} /><i style={{ fontSize: 'var(--ui)' }} />"
        self.assertEqual(self.sample(sizes, inline_off_scale, ".tsx"), 2)
        branch = "<a style={{ fontSize: phone ? 'var(--ui)' : 11 }} /><b style={{ fontSize: width >= 768 ? 14 : 16 }} />"
        self.assertEqual(self.sample(branch, inline_off_scale, ".tsx"), 1)

    def test_moves(self):
        kf = {"spin", "rise"}
        n = lambda css: len(moves([d for _, _, decls in self.sample(css, styled) for d in decls], kf))  # noqa: E731
        self.assertEqual(n(".a{transition:transform .2s ease}.b{transition:opacity .2s,background-color .1s}"), 1)
        self.assertEqual(n(".a{transition:.2s}.b{transition:visibility 0s .2s}.c{transition:none!important}"), 1)  # all
        self.assertEqual(n(".a{transition:opacity .1s,transform 160ms cubic-bezier(.2,0,0,1)}.b{transition-property:height}"), 2)
        self.assertEqual(n(".a{animation:spin 1s linear infinite}.b{animation:fade .2s}.c{animation-name:rise}"), 2)
        self.assertEqual(n(".a{animation:none}.b{animation:spin 0s}"), 0)
        self.assertEqual(self.sample("@keyframes up{from{transform:none}}@keyframes in{50%{opacity:.5}}", styled)[0][1], ["@keyframes up"])

    def test_stops(self):
        k = {"rxpop"}
        self.assertEqual(stops([("animation", "none")], k), {"animation"})
        self.assertEqual(stops([("animation-duration", "0s")], k), {"animation"})
        self.assertEqual(stops([("animation", "fade .18s")], k), {"animation"})
        self.assertEqual(stops([("transition", "none!important")], k), {"transition"})
        self.assertEqual(stops([("transition", "background-color .12s ease")], k), {"transition"})
        self.assertEqual(stops([("opacity", ".99")], k), set())  # names the selector, leaves its pop running
        self.assertEqual(stops([("animation-delay", ".4s")], k), set())
        self.assertEqual(stops([("transform", "none")], k), set())
        self.assertEqual(stops([("animation", "rxpop 280ms")], k), set())
        self.assertEqual(stops([("transition", "transform .2s")], k), set())

    def test_covers(self):
        self.assertTrue(covers(".settle", ".tslide .settle"))
        self.assertTrue(covers(".settle", ".bmv.settle"))
        self.assertTrue(covers(".a>.b", ".a>.b"))
        self.assertFalse(covers(".a .b", ".c .b"))
        self.assertFalse(covers(".b.c", ".a .b"))
        self.assertFalse(covers(".grp", ".grp .i"))
        self.assertTrue(covers(".app.phone .bar", ".reading .app.phone .bar"))
        self.assertFalse(covers(".app.phone .bar", ".app.phone .bar.x"))
        self.assertFalse(covers(".phone .bar", ".app.phone .bar"))
        self.assertEqual(REDUCED.sub("", ':root[data-motion=""] .x'), ".x")  # as bare() leaves it
        self.assertEqual(REDUCED.sub("", 'html[data-motion=""]'), "")


def styled(rel):
    """(selector, the at-rules around it, its own declarations) of each style rule in a stylesheet, nested ones and
    keyframe steps included"""
    out, stack, piece = [], [], ""
    for ch in bare(rel):
        if ch == "{":
            stack.append((" ".join(piece.split()), []))
            piece = ""
        elif ch in ";}":
            if ":" in piece and stack and not stack[-1][0].startswith("@"):
                prop, value = piece.split(":", 1)
                stack[-1][1].append((prop.strip().lower(), value.strip()))
            piece = ""
            if ch == "}" and stack:
                head, decls = stack.pop()
                if not head.startswith("@"):
                    out.append((head, [h for h, _ in stack if h.startswith("@")], decls))
        else:
            piece += ch
    return out


# what moves the page when it changes: a transform, or the size and place of a box
MOVES = re.compile(r"^(?:transform|translate|scale|rotate|all|width|height|(?:min|max)-(?:width|height)|top|left|right|"
                   r"bottom|inset(?:-[\w-]+)?|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|grid-template-(?:rows|columns))$")
TIME = re.compile(r"^-?[0-9.]+m?s$")
REDUCED = re.compile(r"^(?::root|html)\[data-motion=(?:\"\"|\"reduced\"|reduced)\]\s*")


def commas(value):
    """a value's items at its own commas, not those inside cubic-bezier() or var()"""
    return selectors(value)


def moving_keyframes():
    """the names of the app's keyframes that move something (not those that only fade)"""
    out = set()
    for rel in files(".css"):
        for _, ats, decls in styled(rel):
            for at in ats:
                m = re.match(r"@(?:-webkit-)?keyframes\s+([\w-]+)", at)
                if m and any(MOVES.match(p) for p, _ in decls):
                    out.add(m.group(1))
    return out


def moves(decls, keyframes):
    """the declarations of a rule that make something move: a transition of a transform or a box's size or place
    that takes time, or an animation whose keyframes move"""
    out = []
    for prop, value in decls:
        value = re.sub(r"\s*!important$", "", value)
        if prop == "transition":
            for item in commas(value):
                words = item.split()
                times = [w for w in words if TIME.match(w)]
                names = [w for w in words if not TIME.match(w) and not re.match(r"^(?:ease|linear|step|cubic-bezier|allow)", w)]
                if names[:1] == ["none"] or not times or float(re.sub(r"m?s$", "", times[0])) == 0:
                    continue
                if MOVES.match(names[0] if names else "all"):
                    out.append(f"transition: {item}")
        elif prop == "transition-property":
            out += [f"transition-property: {n}" for n in commas(value) if MOVES.match(n.strip())]
        elif prop in ("animation", "animation-name"):
            for item in commas(value):
                words = item.split()
                times = [w for w in words if TIME.match(w)]
                if prop == "animation" and (not times or float(re.sub(r"m?s$", "", times[0])) == 0):
                    continue  # no duration, or none: it never runs
                out += [f"{prop}: {item}" for w in words if w in keyframes]
    return out


STOPPERS = {"transition": ("transition", "transition-property", "transition-duration"),
            "animation": ("animation", "animation-name", "animation-duration")}


def stops(decls, keyframes):
    """what a reduced rule stops: "transition" when it sets the transition again to one that moves nothing (none, a
    fade, no time), "animation" the same for the animation; a delay or a transform alone stops neither"""
    left = {m.split(":")[0].split("-")[0] for m in moves(decls, keyframes)}
    return {kind for kind, props in STOPPERS.items() if kind not in left and any(p in props for p, _ in decls)}


def reduced_rules():
    """the selectors each switch writes its own rules for: the device's (@media (prefers-reduced-motion: reduce)) and
    Settings › General › Motion's (html[data-motion="reduced"]), each without what says which and with what its rules
    stop (stops()), and the rules themselves; html and :root are one"""
    keyframes = moving_keyframes()
    device, setting, rules_ = {}, {}, []
    for rel in files(".css"):
        for head, ats, decls in styled(rel):
            in_media = any(re.search(r"prefers-reduced-motion\s*:\s*reduce", a) for a in ats)
            for sel in selectors(head):
                if in_media:
                    device.setdefault(re.sub(r"^(?::root|html)\s+", "", re.sub(r"^:root$", "html", sel)), set()).update(stops(decls, keyframes))
                    rules_.append((rel, sel, decls))
                elif REDUCED.match(sel):
                    setting.setdefault(REDUCED.sub("", sel) or "html", set()).update(stops(decls, keyframes))
                    rules_.append((rel, sel, decls))
    return device, setting, rules_


def compound(sel):
    """the simple selectors of a selector's last compound (`.a > .b.c:active` → .b, .c, :active), and whether it has
    no combinator of its own"""
    parts = re.split(r"\s*[>+~]\s*|\s+(?![^(]*\))", sel.strip())
    last = parts[-1]
    return set(re.findall(r"[.#]?[\w-]+|\[[^\]]+\]|::?[\w-]+(?:\([^)]*\))?", last)), len(parts) == 1


def covers(over, sel):
    """a reduced rule written for `over` reaches what `sel` styles: the same selector, or one compound naming less
    (`.settle` reaches `.tslide .settle`), or the same selector inside another (`.a .b` reaches `.c .a .b`)"""
    if over == sel or sel.endswith(" " + over):
        return True
    mine, alone = compound(over)
    theirs, _ = compound(sel)
    return alone and bool(mine) and mine <= theirs


def moving_without_cover():
    """each selector whose rule moves something, outside a reduced rule, that one of the two switches doesn't stop: a
    reduced rule reaching it (covers()) has to stop that kind of move (stops()), not only name it"""
    keyframes = moving_keyframes()
    device, setting, _ = reduced_rules()
    out = []
    for rel in files(".css"):
        for head, ats, decls in styled(rel):
            if any(a.startswith(("@keyframes", "@-webkit-keyframes")) for a in ats):
                continue
            if any(re.search(r"prefers-reduced-motion", a) for a in ats):
                continue
            what = moves(decls, keyframes)
            if not what:
                continue
            for sel in selectors(head):
                if REDUCED.match(sel):
                    continue
                for name, under in (("the device's setting", device), ("Motion › Reduced", setting)):
                    for w in what:
                        kind = w.split(":")[0].split("-")[0]
                        if not any(kind in stopped and covers(o, sel) for o, stopped in under.items()):
                            out.append(f"{rel}: {sel} ({w}) moves under {name}")
                            break
    return out


SCRIPTS = ("web/src", "web/plugins", "web/shared")


class ReducedMotion(unittest.TestCase):
    """docs/design.md, Motion: when the device asks for less (prefers-reduced-motion) or Settings › General › Motion is
    Reduced (html[data-motion="reduced"]), nothing slides, grows or spins. Either switch alone is enough, in CSS and in
    script. web/demo/motion-check.ts checks the same in a browser."""

    def test_both_switches_stop_the_same_rules(self):
        device, setting, _ = reduced_rules()
        self.assertEqual(sorted(device.keys() - setting.keys()), [], 'stopped for the device only: add an html[data-motion="reduced"] rule')
        self.assertEqual(sorted(setting.keys() - device.keys()), [], "stopped for Motion › Reduced only: add a prefers-reduced-motion rule")
        self.assertEqual([s for s in device if device[s] != setting[s]], [], "each switch stops the same kinds of move")

    def test_what_moves_stops_under_each(self):
        self.assertEqual(moving_without_cover(), [])

    def test_a_reduced_rule_moves_nothing(self):
        keyframes = moving_keyframes()
        moving = [f"{rel}: {sel} ({what[0]})" for rel, sel, decls in reduced_rules()[2] if (what := moves(decls, keyframes))]
        self.assertEqual(moving, [], "under reduced motion the change is instant or a fade")

    def test_script_asks_calm(self):
        # calm() reads both switches; the device's alone (still(), or a matchMedia of its own) leaves the setting out
        own = []
        for rel in files(".ts", ".tsx"):
            if not rel.startswith(SCRIPTS) or rel == "web/src/motion.ts":
                continue
            src = code(rel)
            if "prefers-reduced-motion" in src or re.search(r"\bstill\(\)", src) or re.search(r"dataset\.motion\s*[!=]==", src):
                own.append(rel)
        self.assertEqual(own, [], "use calm() from web/src/motion.ts")
        motion = code("web/src/motion.ts")
        self.assertNotRegex(motion, r"export\s+const\s+still\b", "still() stays inside motion.ts")
        calls = [line for line in motion.splitlines() if re.search(r"\bstill\(\)", line)]
        self.assertEqual(len(calls), 1, calls)
        self.assertRegex(calls[0], r"^export const calm = \(\) => still\(\) \|\|")


class Haptics(unittest.TestCase):
    """docs/design.md, Haptics and sounds (fork #196): every haptic goes through web/src/feel.ts's haptic(), which
    Settings › General › Haptics and sounds Off and either reduced-motion switch turn off; and no script fakes an iPhone
    haptic by clicking a hidden native switch. web/src/feel.test.ts plays them."""

    FEEL = "web/src/feel.ts"

    def test_vibrate_only_in_feel(self):
        own = [rel for rel in files(".ts", ".tsx") if rel.startswith(SCRIPTS) and rel != self.FEEL
               and re.search(r"\.vibrate\b|\[.vibrate.\]", code(rel))]
        self.assertEqual(own, [], "a haptic goes through haptic() from web/src/feel.ts")
        feel = code(self.FEEL)
        self.assertEqual(len(re.findall(r"navigator\.vibrate\(", feel)), 1)
        self.assertRegex(feel, r"if \(getPrefs\(\)\.feel === 'Off' \|\| calm\(\) \|\| !canBuzz\(\)\) return\n\s*try \{\n\s*navigator\.vibrate\(")

    def test_no_hidden_switch(self):
        # Safari's switch checkbox gives its haptic when the person flips it; one made and clicked by script is a fake
        faked = [rel for rel in files(".ts", ".tsx") if rel.startswith(SCRIPTS)
                 and re.search(r"setAttribute\(\s*'switch'|\.switch\s*=\s*true|\bbuzz\(", code(rel))]
        self.assertEqual(faked, [], "no hidden switch clicked from script (docs/design.md: Haptics and sounds)")


def theme(name):
    """a theme's colour tokens as the cascade gives them: the device's dark and Dark over light, Night over light
    (Night's selector doesn't include Dark's, so what Night leaves out comes from light)"""
    s = re.sub(r"/\*.*?\*/", "", text(DS), flags=re.S)

    def tokens(sel):
        m = re.search(sel + r"\{([^}]*)\}", s)
        if not m:
            raise AssertionError(f"no {sel} block in {DS}")
        return dict(re.findall(r"(--[a-z0-9-]+):([^;]+)", m.group(1)))

    out = tokens(r"(?:^|\})\s*:root")
    out.update({"light": {}, "system-dark": tokens(r':root:not\(\[data-theme="light"\]\)'),
                "dark": tokens(r':root\[data-theme="dark"\]'), "night": tokens(r':root\[data-theme="night"\]')}[name])
    return out


def rgb(value, under=(255, 255, 255)):
    """#rgb or #rrggbb, or rgb(r g b / a) painted over `under`; anything else fails loudly rather than guessing"""
    v = value.strip()
    if re.fullmatch(r"#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}", v):
        h = v[1:]
        h = "".join(c * 2 for c in h) if len(h) == 3 else h
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    m = re.fullmatch(r"rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)\s*(?:[/,]\s*([0-9.]+))?\s*\)", v)
    if not m:
        raise AssertionError(f"can't read the colour {v!r}: add its form to test_design.rgb()")
    c, a = [int(x) for x in m.groups()[:3]], float(m.group(4) or 1)
    return tuple(round(u + (x - u) * a) for x, u in zip(c, under))


def contrast(a, b):
    def lum(c):
        c = [x / 255 for x in c]
        c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    hi, lo = sorted((lum(a), lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


class Contrast(unittest.TestCase):
    """docs/design.md, Readability: second lines (`--muted`) read at 4.5:1 on the page, a field, an agent's bubble and
    your own, in each theme. Other surfaces and states are measured as painted, in the browser."""

    def test_muted_on_the_page_a_field_and_both_bubbles(self):
        low = []
        for name in ("light", "system-dark", "dark", "night"):
            t = theme(name)
            canvas = rgb(t["--canvas"])
            for surface in ("--canvas", "--well", "--raised", "--mine"):
                under = rgb(t[surface], canvas)  # a see-through surface painted over the page, the grey over it
                ratio = contrast(rgb(t["--muted"], under), under)
                if ratio < 4.5:
                    low.append(f"{name} {surface}: {ratio:.2f}")
        self.assertEqual(low, [])

    def test_a_controls_edge_on_every_surface_it_sits_on(self):
        # UI 11: a checkbox, a field and a switch that is off are edged in --edge, at 3:1 (WCAG 2.2, non-text contrast)
        # against the page, a field's own fill, a raised surface and a menu or sheet, bare and under a hovered row, in
        # each theme
        low = []
        for name in ("light", "system-dark", "dark", "night"):
            t = theme(name)
            canvas = rgb(t["--canvas"])
            for surface in ("--canvas", "--well", "--raised", "--overlay"):
                bare = rgb(t[surface], canvas)
                # an unticked box on a hovered row sits on the row's --control
                for where, under in ((surface, bare), (f"{surface} hovered", rgb(t["--control"], bare))):
                    ratio = contrast(rgb(t["--edge"], under), under)
                    if ratio < 3:
                        low.append(f"{name} {where}: {ratio:.2f}")
        self.assertEqual(low, [])


if __name__ == "__main__":
    unittest.main()
