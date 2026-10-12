"""Allow-list HTML sanitizer (pure python, no dependencies)."""
from html import escape
from html.parser import HTMLParser

ALLOWED = {
    "p", "br", "b", "strong", "i", "em", "u", "s", "strike", "del", "ins", "mark", "sub", "sup", "small",
    "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "code", "pre", "hr", "div", "span",
    "a", "table", "thead", "tbody", "tr", "th", "td", "input",
}
VOID = {"br", "hr", "input"}
DROP_CONTENT = {"script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math", "head", "title", "textarea", "select", "button", "form"}
SAFE_SCHEMES = ("http://", "https://", "mailto:", "tel:")


class _S(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.stack, self.skip = [], [], 0

    def handle_starttag(self, tag, attrs):
        if tag in DROP_CONTENT:
            if tag not in VOID:
                self.skip += 1
            return
        if self.skip or tag not in ALLOWED:
            return
        a = dict(attrs)
        if tag == "input":  # only render checklist checkboxes, inert
            if (a.get("type") or "").lower() == "checkbox":
                self.out.append('<input type="checkbox" disabled%s>' % (" checked" if "checked" in a else ""))
            return
        extra = ""
        if tag == "a":
            href = (a.get("href") or "").strip()
            if href.lower().startswith(SAFE_SCHEMES):
                extra = ' href="%s" rel="noopener noreferrer nofollow" target="_blank"' % escape(href, quote=True)
        if tag == "li" and "data-checked" in a:
            pass
        self.out.append("<%s%s>" % (tag, extra))
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag in DROP_CONTENT and tag not in VOID and self.skip:
            self.skip -= 1

    def handle_endtag(self, tag):
        if tag in DROP_CONTENT:
            if self.skip:
                self.skip -= 1
            return
        if self.skip or tag not in ALLOWED or tag in VOID:
            return
        if tag in self.stack:
            while self.stack:
                t = self.stack.pop()
                self.out.append("</%s>" % t)
                if t == tag:
                    break

    def handle_data(self, data):
        if not self.skip:
            self.out.append(escape(data, quote=False))

    def close_all(self):
        while self.stack:
            self.out.append("</%s>" % self.stack.pop())


def sanitize_html(html: str, limit: int = 2_000_000) -> str:
    p = _S()
    p.feed((html or "")[:limit])
    p.close()
    p.close_all()
    return "".join(p.out)
