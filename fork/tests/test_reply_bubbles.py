"""Reply bubbles show their message (dmalis/shepherdr#51): a "Replying to" line over the suggested replies, a tapped one
sent as a reply to its message, and agents told that each bubble names what it is about.

Pins the upstream seams the patch hangs on, so the next sync sees a break at once: the chat's message box (the bubbles'
call site), send()'s quote for a message that goes alone, the service turning a reply's message id into the agent's
<hc reply-to> line, and the words in the templates and the Settings block. Its behaviour is tested in
web/plugins/chat/reply-bubbles.test.tsx."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME)

import inspect  # noqa: E402
import unittest  # noqa: E402

sys.path.insert(0, os.path.join(ROOT, "mods", "tasks", "bin"))
from herdr_task import assistant_settings, settings  # noqa: E402

NAMES = ('Each makes sense alone and names what it is about ("Add the Everything hint", "Merge the zoom patch"), never only a '
         'pointer back to the chat ("Do those three", "Yes, that one").')
AS_REPLY = "sent with one tap as a reply to that message"
SETTING = "makes sense alone and names what it is about; shown as bubbles to tap, a tapped one sent as a reply to that message"


def read(*path):
    with open(os.path.join(ROOT, *path)) as f:
        return f.read()


class Seams(unittest.TestCase):
    def test_the_message_box_shows_the_label_and_sends_a_reply(self):
        src = read("web", "plugins", "chat", "client.tsx")
        self.assertIn("import { bubbleQuote, ReplyingTo } from './reply-bubbles.tsx'", src)
        self.assertIn("{sug && <ReplyingTo chat={chat} id={sug.id} />}\n    {sug && <Replies texts={sug.texts}", src)
        self.assertIn("send(key, key, t, false, true, undefined, bubbleQuote(chat, sug.id))", src)
        # upstream's bubbles: the newest agent message's, { id, texts }
        self.assertIn("return texts.length ? { id: m.id, texts } : null", read("web", "plugins", "chat", "suggest.ts"))

    def test_send_takes_a_quote_for_a_message_that_goes_alone(self):
        src = read("web", "src", "send.ts")
        self.assertIn("how?: 'typed' | 'dictated' | 'bubble', quote?: ReplyQuote & { id: string })", src)
        self.assertIn("const reply = alone ? quote : ", src)
        self.assertIn("{ reply: o.reply?.id }", src)  # what goes to the service: the message's id

    def test_the_service_gives_the_agent_the_reply_to_line(self):
        self.assertIn('typeof b.reply === "string" ? r?.conv?.items?.find((x: any) => x.id === b.reply)?.text',
                      read("service", "actions.ts"))
        self.assertIn('const reply = quote ? `<hc reply-to="${excerpt(quote, 80)}"', read("core", "send.js"))

    def test_the_templates_ask_for_bubbles_that_name_their_thing(self):
        for name in ("assistant.md", "worker.md"):
            src = read("templates", name)
            self.assertIn(NAMES, src, name)
            self.assertIn(AS_REPLY, src, name)
            self.assertIn("Each at most 30 characters, a hard limit", src, name)

    def test_the_settings_line_says_it(self):
        self.assertIn(SETTING, inspect.getsource(settings))
        self.assertIn(SETTING, inspect.getsource(assistant_settings))


if __name__ == "__main__":
    unittest.main()
