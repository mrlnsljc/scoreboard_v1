#!/usr/bin/env python3
"""
Tiny static dev server for the Scoreboard PWA.

Why not just `python3 -m http.server`? That also works (see README), but this
adds two dev conveniences:
  • `Cache-Control: no-store` so edits show up on a plain reload (no stale JS).
  • Correct MIME types for ES modules (.js) and the web app manifest.

Usage:  python3 devserver.py [port] [directory]
        python3 devserver.py 8770 .
"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8770
DIRECTORY = sys.argv[2] if len(sys.argv) > 2 else '.'


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # no-store keeps the browser from serving stale modules during dev
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self.send_header('Service-Worker-Allowed', '/')
        super().end_headers()

    def guess_type(self, path):
        p = str(path)
        if p.endswith('.webmanifest'):
            return 'application/manifest+json'
        if p.endswith('.js') or p.endswith('.mjs'):
            return 'text/javascript'
        return super().guess_type(path)


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    # Threaded so the browser's burst of parallel module + logo requests doesn't
    # choke a single-threaded server (which caused ERR_CONNECTION_RESET).
    with ThreadingHTTPServer(('127.0.0.1', PORT), Handler) as httpd:
        print(f'Scoreboard dev server: http://127.0.0.1:{PORT}  (serving {DIRECTORY})')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
