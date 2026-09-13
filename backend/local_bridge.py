"""Forward Kite's localhost redirect to the Netlify site.

Zerodha still has Redirect URL = http://127.0.0.1:8000/
This process must be running before you click Connect Zerodha.
"""

from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

NETLIFY = "https://celebrated-sunflower-7709a2.netlify.app/.netlify/functions/callback"


class Handler(BaseHTTPRequestHandler):
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        parsed = urlparse(self.path)
        dest = NETLIFY
        if parsed.query:
            dest = f"{NETLIFY}?{parsed.query}"
        self.send_response(302)
        self.send_header("Location", dest)
        self.end_headers()

    def log_message(self, fmt, *args):
        print(fmt % args)


if __name__ == "__main__":
    print("Kite bridge listening on http://127.0.0.1:8000/")
    print(f"Redirects to {NETLIFY}")
    HTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
