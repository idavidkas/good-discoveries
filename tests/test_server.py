"""Run with: pytest -q. Uses a disposable SQLite database, no network calls."""
import datetime as dt
import importlib.util
import os
import sys
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

ROOT = Path(__file__).resolve().parents[1]
os.environ['ENABLE_POLLER'] = 'false'
os.environ['ADMIN_TOKEN'] = 'test_admin_token_123456'

spec = importlib.util.spec_from_file_location('good_server_under_test', ROOT / 'server.py')
server = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = server
spec.loader.exec_module(server)


@pytest.fixture
def client(tmp_path):
    server.DB = tmp_path / 'news.db'
    server.prepare_db()
    with TestClient(server.app) as c:
        yield c


def test_initial_feed_has_one_main_story_and_history(client):
    response = client.get('/api/news')
    assert response.status_code == 200
    data = response.json()
    assert len(data['items']) == 4
    assert data['items'][0]['doi'] == '10.1038/s41567-026-03486-y'
    assert data['items'][0]['title']
    assert data['items'][0]['source']
    assert data['poll_interval_seconds'] == 900
    assert not data['auto_publish_enabled']


def test_administration_requires_token(client):
    assert client.get('/api/admin/candidates').status_code == 401
    assert client.post('/api/admin/create', json={}).status_code == 401
    assert client.post('/api/admin/refresh').status_code == 401


def test_manual_publication_becomes_main_story(client):
    payload = {
        'doi': '10.9999/test.2026',
        'title': 'Эксперимент подтвердил новый способ восстановления лесов',
        'lead': 'Исследователи получили убедительный позитивный результат в контролируемом эксперименте.',
        'body': 'Несколько контролируемых наблюдений позволили оценить эффект подхода. Требуется дальнейшая проверка.',
        'limitations': 'Эксперимент ограничен небольшой выборкой.',
        'evidence': 'Рецензируемое исследование',
        'category': 'Природа',
        'source': 'Тестовый журнал',
        'published_at': '2026-11-02',
    }
    head = {'Authorization': 'Bearer test_admin_token_123456'}
    resp = client.post('/api/admin/create', json=payload, headers=head)
    assert resp.status_code == 200, resp.text
    feed = client.get('/api/news').json()['items']
    assert len(feed) == 5
    assert feed[0]['doi'] == payload['doi']
    assert feed[1]['doi'] == '10.1038/s41567-026-03486-y'
    assert client.post('/api/admin/create', json=payload, headers=head).status_code == 409
    assert client.delete('/api/admin/news/10.9999/test.2026', headers=head).status_code == 200
    assert len(client.get('/api/news').json()['items']) == 4


def test_manual_publication_bad_doi_rejected(client):
    head = {'Authorization': 'Bearer test_admin_token_123456'}
    payload = {
        'doi': 'fake', 'title': 'Это тестовая научная статья с достаточной длиной',
        'lead': 'Достаточно длинное описание тестовой научной статьи',
        'body': 'Достаточно длинное описание тестовой научной статьи с подробностями',
        'limitations': 'Ограничения тестовой публикации',
        'evidence': 'Рецензируемый эксперимент',
        'category': 'Технологии', 'source': 'Журнал', 'published_at': '2026-11-01',
    }
    assert client.post('/api/admin/create', json=payload, headers=head).status_code == 422
    payload['doi'] = '10.9999/example.valid'
    payload['published_at'] = '2099-01-01'
    assert client.post('/api/admin/create', json=payload, headers=head).status_code == 422


def test_crossref_metadata_date_and_html_cleaning():
    assert server.published_date({'published-online': {'date-parts': [[2026, 10, 23]]}}) == '2026-10-23'
    assert server.published_date({'published-print': {'date-parts': [[2024]]}}) == '2024-01-01'
    assert server.clean_abstract('<jats:p>Valid <b>result</b> &amp; evidence.</jats:p>') == 'Valid result & evidence.'
    assert server.is_recent('2099-01-01') is False
