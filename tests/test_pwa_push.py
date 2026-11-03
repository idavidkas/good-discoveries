"""PWA and 72h Web Push digest contract: no external network required."""
import asyncio
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from test_server import server, ROOT, client

PUSH = {
    'endpoint': 'https://fcm.googleapis.com/fcm/send/a-valid-browser-generated-token',
    'keys': {'p256dh': 'A' * 87, 'auth': 'B' * 22},
}


def _vapid(monkeypatch, tmp_path):
    key = ec.generate_private_key(ec.SECP256R1())
    path = tmp_path / 'vapid-private.pem'
    path.write_bytes(key.private_bytes(serialization.Encoding.PEM,
                                       serialization.PrivateFormat.TraditionalOpenSSL,
                                       serialization.NoEncryption()))
    monkeypatch.setattr(server, 'VAPID_KEY_FILE', str(path))
    monkeypatch.setattr(server, 'VAPID_SUBJECT', 'mailto:tests@example.com')


def test_push_requires_backend_key(client, monkeypatch):
    monkeypatch.setattr(server, 'VAPID_KEY_FILE', '')
    assert client.get('/api/push/public-key').json()['enabled'] is False
    assert client.post('/api/push/subscribe', json=PUSH).status_code == 503


def test_push_subscription_72h_and_unsubscribe(client, monkeypatch, tmp_path):
    _vapid(monkeypatch, tmp_path)
    cfg = client.get('/api/push/public-key').json()
    assert cfg['enabled'] is True
    assert len(cfg['publicKey']) == 87
    assert cfg['digest_interval_hours'] == 72
    r = client.post('/api/push/subscribe', json=PUSH)
    assert r.status_code == 201
    with server.db() as con:
        item = con.execute('SELECT * FROM push_subscriptions').fetchone()
        assert item is not None
        due = dt.datetime.fromisoformat(item['next_due_at'])
        created = dt.datetime.fromisoformat(item['created_at'])
        assert due - created == dt.timedelta(hours=72)
    # Duplicate browser subscription is idempotent: should not reset delivery deadline.
    assert client.post('/api/push/subscribe', json=PUSH).json()['next_digest_at'] == r.json()['next_digest_at']
    assert client.post('/api/push/unsubscribe', json={'endpoint': PUSH['endpoint']}).status_code == 200
    with server.db() as con:
        assert con.execute('SELECT COUNT(*) FROM push_subscriptions').fetchone()[0] == 0


def test_reject_push_endpoint_for_ssrf(client, monkeypatch, tmp_path):
    _vapid(monkeypatch, tmp_path)
    bad = dict(PUSH, endpoint='https://127.0.0.1/private-data')
    assert client.post('/api/push/subscribe', json=bad).status_code == 422
    bad = dict(PUSH, endpoint='https://evil.example.org/post')
    assert client.post('/api/push/subscribe', json=bad).status_code == 422


def test_digest_delivers_and_reschedules(client, monkeypatch, tmp_path):
    _vapid(monkeypatch, tmp_path)
    client.post('/api/push/subscribe', json=PUSH)
    t = dt.datetime.now(dt.timezone.utc)
    with server.db() as con:
        con.execute('UPDATE push_subscriptions SET created_at=?,next_due_at=?',
                    ((t - dt.timedelta(hours=73)).isoformat(timespec='seconds'),
                     (t - dt.timedelta(minutes=1)).isoformat(timespec='seconds')))
    received = []
    monkeypatch.setattr(server, 'send_web_push', lambda sub, digest: received.append(digest))
    result = asyncio.run(server.dispatch_due_digests())
    assert result['sent'] == 1
    assert len(received) == 1
    assert received[0]['count'] == 0
    assert 'без новых' in received[0]['title'].lower()
    with server.db() as con:
        new = con.execute('SELECT next_due_at,last_sent_at FROM push_subscriptions').fetchone()
        assert dt.datetime.fromisoformat(new['next_due_at']) - dt.datetime.fromisoformat(new['last_sent_at']) == dt.timedelta(hours=72)
    assert asyncio.run(server.dispatch_due_digests())['sent'] == 0


def test_digest_includes_only_new_approved_news(client):
    stamp = server.now()
    with server.db() as con:
        con.execute('''INSERT INTO news (doi,title,lead,body,limitations,evidence,
            category,published_at,added_at,source,url,image,editorial)
            VALUES ('10.9999/fresh','Новый прорыв в исследовании клеток','lead','body',
            'limitations','evidence','Биология','2026-11-03',?,'Science','https://doi.org/10.9999/fresh',
            'cells.svg','manual_review')''', (stamp,))
        old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=3)).isoformat()
        future = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=2)).isoformat()
        digest = server.build_digest(con, old, future)
    assert digest['count'] == 1
    assert 'Новый прорыв' in digest['body']


def test_pages_build_is_clean_and_scoped(tmp_path):
    import os
    env = dict(os.environ, API_BASE_URL='https://api.example.org', CI_COMMIT_SHA='abcdef1234567890', GITHUB_SHA='abcdef1234567890')
    subprocess.run([sys.executable, 'scripts/build_pages.py'], cwd=ROOT, env=env, check=True)
    public = ROOT / 'public'
    assert (public / 'index.html').is_file()
    assert (public / 'manifest.webmanifest').is_file()
    assert (public / 'sw.js').is_file()
    assert not (public / 'admin.html').exists()
    assert not (public / 'assets/admin.js').exists()
    assert json.loads((public / 'manifest.webmanifest').read_text(encoding='utf-8'))['scope'] == './'
    assert 'abcdef123456' in (public / 'sw.js').read_text(encoding='utf-8')
    assert 'https://api.example.org' in (public / 'assets/config.js').read_text(encoding='utf-8')
    assert 'href="./assets/styles.css"' in (public / 'index.html').read_text(encoding='utf-8')
