from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
MOCK_TAG = '<script src="/tests/browser-fixture-mocks.js?v=76112"></script>'
TARGET_TAG = '<script src="shared-workspace.js?v=7617"></script>'


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if urlsplit(self.path).path == '/available-spaces.html':
            source = (ROOT / 'available-spaces.html').read_text(encoding='utf-8')
            body = source.replace(TARGET_TAG, MOCK_TAG).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 4178), Handler).serve_forever()
