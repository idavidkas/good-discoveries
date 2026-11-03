"""Build static, relative-path-safe PWA for GitHub or GitLab Pages.

Only public assets are copied: never ship admin HTML, secret files or Python backend.
"""
from __future__ import annotations
import json
import os
import re
import shutil
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'static'
OUT = ROOT / 'public'
api = os.getenv('API_BASE_URL', '').strip().rstrip('/')
if api:
    url = urlsplit(api)
    if url.scheme != 'https' or not url.netloc or url.path not in ('', '/') or url.username or url.password or url.query or url.fragment:
        raise SystemExit('API_BASE_URL must be an HTTPS origin, e.g. https://api.example.com')
version = re.sub('[^A-Za-z0-9]', '', os.getenv('GITHUB_SHA', os.getenv('CI_COMMIT_SHA', 'local')))[:12] or 'local'
if OUT.exists():
    shutil.rmtree(OUT)
(OUT / 'assets').mkdir(parents=True)
for name in ('index.html', 'offline.html', 'manifest.webmanifest', 'demo-feed.json', 'researched-feed.json'):
    shutil.copy2(SRC / name, OUT / name)
for name in ('app.js', 'pwa.js', 'styles.css', 'favicon.svg', 'icon-180.png', 'icon-192.png',
             'icon-512.png', 'coral.svg', 'cells.svg', 'dna.svg', 'quantum.svg'):
    shutil.copy2(SRC / 'assets' / name, OUT / 'assets' / name)
(OUT / 'assets' / 'config.js').write_text(
    'window.GOOD_DISCOVERIES_API_BASE = ' + json.dumps(api, ensure_ascii=False) + ';\n', encoding='utf-8')
(OUT / 'sw.js').write_text((SRC / 'sw.js').read_text(encoding='utf-8').replace('__BUILD_VERSION__', version), encoding='utf-8')
print('Pages ready:', OUT)
print('API:', api or 'Public scholarly sources via scheduled Pages feed')
