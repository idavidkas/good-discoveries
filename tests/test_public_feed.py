import datetime as dt
import importlib.util
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('public_feed', ROOT / 'scripts/sync_public_feed.py')
feed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(feed)

def raw(doi='10.9999/fresh', title='New restoration experiment', date=(2026, 11, 2)):
    return {'DOI': doi, 'title': [title], 'type': 'journal-article',
            'published-online': {'date-parts': [list(date)]}, 'container-title': ['Test Journal']}

def test_discovery_deduplicates_and_never_promotes(tmp_path, monkeypatch):
    monkeypatch.setattr(feed.time, 'sleep', lambda _: None)
    def fetch(url):
        if 'crossref.org' in url:
            return {'message': {'items': [raw(), raw(title='Retraction: old result'), raw('10.9999/future', date=(2027,1,1))]}}
        return {'resultList': {'result': [{'doi':'10.9999/fresh','title':'New restoration experiment',
            'firstPublicationDate':'2026-11-02','journalInfo':{'journal':{'title':'Test Journal'}}}]}}
    result = feed.sync(tmp_path / 'feed.json', fetch=fetch, today=dt.date(2026,11,3), rss_fetch=lambda *args: [])
    assert len(result['candidates']) == 1
    assert result['candidates'][0]['review_status'] == 'needs_review'
    assert all(a['doi'] != '10.9999/fresh' for a in result['items'])
    assert all(a['review_sources'] and a['reviewed_at'] for a in result['items'])
    assert result['demo'] is False
    assert {'Crossref','Europe PMC'} <= set(result['providers'])

def test_total_outage_keeps_previous_successful_feed(tmp_path, monkeypatch):
    monkeypatch.setattr(feed.time, 'sleep', lambda _: None)
    output = tmp_path / 'feed.json'
    output.write_text('previous successful feed', encoding='utf-8')
    def fail(url):
        raise TimeoutError()
    with pytest.raises(RuntimeError):
        feed.sync(output, fetch=fail, rss_fetch=lambda *args: fail('rss'))
    assert output.read_text(encoding='utf-8') == 'previous successful feed'

def test_nonarticle_updates_and_missing_dates_rejected():
    item = raw(); item['update-to'] = [{'type':'retraction'}]
    assert feed.normalize_crossref(item) is None

def test_rss_supports_namespaces_and_rejects_xml_entities():
    payload = b'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/"><item><title>New research result</title><link>https://www.nature.com/articles/s41586-026-11223-x</link><dc:date>2026-10-28</dc:date><prism:doi>10.1038/s41586-026-11223-x</prism:doi></item></rdf:RDF>'
    rows = feed.parse_rss(payload, 'Nature RSS')
    assert rows[0]['doi'] == '10.1038/s41586-026-11223-x'
    assert rows[0]['review_status'] == 'needs_review'
    with pytest.raises(ValueError):
        feed.parse_rss(b'<!DOCTYPE rss><rss/>','Nature RSS')
    item = raw(); item['type'] = 'posted-content'
    assert feed.normalize_crossref(item) is None
