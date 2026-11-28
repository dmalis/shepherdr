"""docs/design.md's rules that a machine can check. Colours, type sizes and endless animations live in the design
system (web/src/ds.css): every other stylesheet and inline style uses its tokens. What is there today is counted per
file below; a count may go down, never up, and a new file starts at none. Lower a count here when a change removes some."""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME)

import unittest  # noqa: E402

DS = "web/src/ds.css"
# the type scale (docs/design.md, Type): a size outside it is a token's job (--ui, --sec, --chat ...)
SCALE = {"12px", "13px", "14px", "16px", "18px", "20px", "24px"}

# what each file holds today: raw colours, sizes off the scale, endless animations, raw colours in inline styles
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
}

COLOUR = re.compile(r"#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(")
SIZE = re.compile(r"font(?:-size)?:\s*([0-9.]+(?:px|em|rem|%))")
SIZE_SHORT = re.compile(r"font:\s*(?:[0-9]{3}\s+)?([0-9.]+px)/")
INFINITE = re.compile(r"animation(?:-iteration-count)?:[^;}]*\binfinite\b")
INLINE = re.compile(r"style=\{\{[^}]*\}\}")


def files(kind):
    out = []
    for top in ("web/src", "web/plugins"):
        for d, _, names in os.walk(os.path.join(ROOT, top)):
            out += [os.path.relpath(os.path.join(d, n), ROOT) for n in names if n.endswith(kind) and ".test." not in n]
    return sorted(out)


def text(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def css(rel):
    """a stylesheet without its comments, which name issues like #105"""
    return re.sub(r"/\*.*?\*/", "", text(rel), flags=re.S)


def colours(rel):
    return len(COLOUR.findall(css(rel)))


def off_scale(rel):
    s = css(rel)
    sizes = SIZE.findall(s) + SIZE_SHORT.findall(s)
    return sum(1 for v in sizes if v not in SCALE)


def endless(rel):
    return len(INFINITE.findall(css(rel)))


def inline_colours(rel):
    return sum(len(COLOUR.findall(m)) for m in INLINE.findall(text(rel)))


class DesignTokens(unittest.TestCase):
    """New UI uses the design system's tokens (docs/design.md): the counts of raw values only go down."""

    def ratchet(self, measure, kinds, allowed, what):
        over = []
        for rel in files(kinds):
            n, cap = measure(rel), allowed.get(rel, 0)
            if n > cap:
                over.append(f"{rel}: {n} {what} (at most {cap})")
        self.assertEqual(over, [], f"use a token from {DS} (docs/design.md) instead")

    def test_colours_only_in_the_design_system(self):
        self.ratchet(lambda rel: 0 if rel == DS else colours(rel), ".css", COLOURS, "raw colours")

    def test_type_sizes_on_the_scale(self):
        self.ratchet(off_scale, ".css", OFF_SCALE, "font sizes off the scale")

    def test_no_new_endless_animation(self):
        # an animation that never ends costs a phone's battery all day: it stops once its wait is over (docs/design.md, Motion)
        self.ratchet(endless, ".css", ENDLESS, "endless animations")

    def test_no_colours_in_inline_styles(self):
        self.ratchet(inline_colours, ".tsx", INLINE_COLOURS, "raw colours in inline styles")

    def test_the_counts_are_current(self):
        # a count above what the file holds now hides a regression: lower it with the change that removed them
        stale = []
        for allowed, measure in ((COLOURS, colours), (OFF_SCALE, off_scale), (ENDLESS, endless), (INLINE_COLOURS, inline_colours)):
            for rel, cap in allowed.items():
                if not os.path.exists(os.path.join(ROOT, rel)):
                    stale.append(f"{rel}: gone")
                elif measure(rel) < cap:
                    stale.append(f"{rel}: {measure(rel)} now, {cap} allowed")
        self.assertEqual(stale, [], "lower these counts in test/test_design.py")

    def test_the_document_names_real_tokens(self):
        # every --token docs/design.md names is defined in the design system or the app's stylesheets
        doc = text("docs/design.md")
        defined = set()
        for rel in files(".css"):
            defined |= set(re.findall(r"(--[a-z][a-z0-9-]*)\s*:", css(rel)))
        # and those the app sets from script (the chat's width, a dragged pane's)
        for rel in files(".ts"):
            defined |= set(re.findall(r"['\"`](--[a-z][a-z0-9-]*)['\"`]", text(rel)))
        named = set(re.findall(r"`(--[a-z][a-z0-9-]*)`", doc))
        self.assertEqual(sorted(named - defined), [])


if __name__ == "__main__":
    unittest.main()
