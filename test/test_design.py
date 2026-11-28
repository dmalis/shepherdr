"""A few of docs/design.md's rules that a source check can hold, and only in the forms it names:

- raw colours (hex, rgb()/hsl()/hwb()/oklch()/lab()/lch()/color() and the common colour names) in the values of the
  app's stylesheets outside the design system (web/src/ds.css), and in literal `style={{…}}` props in TSX;
- font sizes off the type scale in `font-size:` and `font:` values (a size from a token, `inherit` or `%` passes);
- animations that never end (`infinite`, a huge iteration count, or a script animation with `iterations: Infinity`);
- the grey of second lines (`--muted`) at 4.5:1 on the page, a field, an agent's bubble and your own, in light, the
  device's dark, Dark and Night.

What each file holds today is its cap below: a count may go down, never up, and a new file starts at none. A cap above
what a file holds fails too, so lower it with the change that removed some. Moving rules to another file moves their
cap with them. Reduced motion, idle work and contrast on other states are checked in the browser, not here."""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME)

import unittest  # noqa: E402

DS = "web/src/ds.css"
# the type scale (docs/design.md, Type)
SCALE = {12, 13, 14, 16, 18, 20, 24}

COLOURS = {
    "web/src/styles.css": 22,
    "web/src/settings-look.css": 15,
    "web/src/sheets.css": 1,
    "web/plugins/installed/installed.css": 1,
}
OFF_SCALE = {
    "web/src/ds.css": 6,
    "web/src/styles.css": 1,
    "web/src/about.css": 1,
    "web/plugins/chat/kind.css": 1,
    "web/plugins/files/files.css": 1,
    "web/plugins/whatsnew/whats-new.css": 1,
}
ENDLESS = {
    "web/src/ds.css": 5,
    "web/src/styles.css": 3,
    "web/src/dictate.css": 4,
}
INLINE_COLOURS = {
    "web/plugins/screens/client.tsx": 10,
    "web/plugins/terminal/client.tsx": 1,
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


def declarations(rel):
    """(property, value) of each declaration in a stylesheet, its comments, strings and url()s taken out"""
    # one pass, so an apostrophe in a comment opens no string and a /* in a string opens no comment
    s = re.sub(r"/\*.*?\*/|\"(?:\\.|[^\"\\\n])*\"|'(?:\\.|[^'\\\n])*'",
               lambda m: "" if m.group(0).startswith("/*") else '""', text(rel), flags=re.S)
    s = re.sub(r"url\([^)]*\)", "url()", s)
    out = []
    for body in re.findall(r"\{([^{}]*)\}", s):  # innermost blocks: a rule inside @media is still one
        for decl in body.split(";"):
            if ":" in decl:
                prop, value = decl.split(":", 1)
                out.append((prop.strip().lower(), value.strip()))
    return out


def colours(rel):
    n = 0
    for prop, value in declarations(rel):
        value = re.sub(r"var\([^)]*\)|--[\w-]+", "", value)  # a token's name is no colour (var(--red))
        n += len(COLOUR.findall(value))
    return n


def font_size(prop, value):
    """the size a font-size or font declaration sets, or None when a token, a keyword or a percentage sets it"""
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
            n += sum(1 for x in re.findall(r"\b\d+\b", value) if prop == "animation-iteration-count" and int(x) >= 100)
    return n


def script_endless(rel):
    return len(re.findall(r"iterations\s*:\s*(?:Infinity|Number\.POSITIVE_INFINITY)", text(rel)))


def inline_styles(source):
    """the text of each literal style={{…}} prop, its nested braces kept"""
    out, i = [], 0
    while (i := source.find("style={{", i)) != -1:
        depth, j = 0, i + len("style=")
        while j < len(source):
            depth += {"{": 1, "}": -1}.get(source[j], 0)
            j += 1
            if depth == 0:
                break
        out.append(source[i:j])
        i = j
    return out


def inline_colours(rel):
    src = re.sub(r"/\*.*?\*/|//[^\n]*", "", text(rel), flags=re.S)
    return sum(len(COLOUR.findall(re.sub(r"var\([^)]*\)|--[\w-]+", "", m))) for m in inline_styles(src))


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

    def test_the_counts_are_current(self):
        stale = []
        for allowed, measure in ((COLOURS, colours), (OFF_SCALE, off_scale), (ENDLESS, endless), (INLINE_COLOURS, inline_colours)):
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

    def sample(self, css, measure):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".css", dir=os.path.join(ROOT, "test"), delete=False) as f:
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

    def test_sizes(self):
        self.assertEqual(self.sample(".a{font-size:13px}.b{font:600 14px/20px Inter}.c{font-size:var(--ui)}", off_scale), 0)
        self.assertEqual(self.sample(".a{font:italic 600 11px/18px Inter}.b{font-size:.5vw}.c{font-size:calc(10px*2)}", off_scale), 3)
        self.assertEqual(self.sample(".a{font-size:16PX}.b{font-size:15px}.c{font:500 var(--sec)/var(--secl) Inter}", off_scale), 1)

    def test_endless(self):
        self.assertEqual(self.sample(".a{animation:spin 1s linear infinite}.b{animation-iteration-count:999999}", endless), 2)
        self.assertEqual(self.sample(".a{animation:fade .2s ease}", endless), 0)

    def test_inline(self):
        src = "<a style={{ color: '#fff', ...(x ? { background: 'rgb(0 0 0)' } : {}) }} /> {/* style={{color:'#000'}} */}"
        self.assertEqual(sum(len(COLOUR.findall(m)) for m in inline_styles(re.sub(r"\{/\*.*?\*/\}", "", src))), 2)


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
            muted = rgb(t["--muted"], canvas)
            for surface in ("--canvas", "--well", "--raised", "--mine"):
                ratio = contrast(muted, rgb(t[surface], canvas))
                if ratio < 4.5:
                    low.append(f"{name} {surface}: {ratio:.2f}")
        self.assertEqual(low, [])


if __name__ == "__main__":
    unittest.main()
