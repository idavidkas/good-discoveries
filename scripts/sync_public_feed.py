"""Build public feed from researched stories and fresh open scholarly metadata.

API discovery never promotes an unreviewed paper into an editorial story.
Only standard library; sequential requests respect Crossref's public pool.
"""
from __future__ import annotations
import datetime as dt
import json
import re
import time
from email.utils import parsedate_to_datetime
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
UA = 'GoodDiscoveries/1.0 (https://github.com/idavidkas/good-discoveries)'
JOURNALS = ['0028-0836', '2375-2548', '1745-2473', '1078-8956', '1087-0156']
BLOCKED = re.compile(r'\b(retract\w*|correction|erratum|editorial|corrigendum|reply|review|protocol)\b', re.I)
RSS_SOURCES = {
    'Nature RSS': 'https://www.nature.com/nature.rss',
    'Nature Physics RSS': 'https://www.nature.com/nphys.rss',
    'Science Advances RSS': 'https://feeds.science.org/rss/science-advances.xml',
}

def parse_rss(payload, source):
    if b'<!DOCTYPE' in payload.upper() or b'<!ENTITY' in payload.upper():
        raise ValueError('XML entity declarations are not allowed')
    root = ET.fromstring(payload)
    found = []
    for node in root.iter():
        if node.tag.split('}')[-1] not in ('item','entry'):
            continue
        fields = {c.tag.split('}')[-1]: ''.join(c.itertext()).strip() for c in node}
        title = re.sub('<[^>]+>', '', fields.get('title','')).strip()
        if not title or BLOCKED.search(title):
            continue
        link = fields.get('link','')
        for child in node:
            if child.tag.split('}')[-1] == 'link' and child.attrib.get('href'):
                link = child.attrib['href']
        doi = fields.get('doi','').removeprefix('https://doi.org/').lower().strip()
        if not doi:
            match = re.search(r'10\.\d{4,9}/[^\s<>"?#]+', link)
            if match: doi = match.group().lower()
            elif 'nature.com/articles/' in link:
                doi = '10.1038/' + link.split('/articles/')[1].split('?')[0].split('#')[0]
        date = fields.get('date') or fields.get('published') or fields.get('pubDate') or fields.get('updated','')
        try:
            date = dt.date.fromisoformat(date[:10]).isoformat()
        except ValueError:
            try: date = parsedate_to_datetime(date).date().isoformat()
            except (TypeError,ValueError): continue
        if not re.fullmatch(r'10\.\d{4,9}/\S+',doi):
            continue
        found.append({'doi':doi,'title':title,'published_at':date,'source':source.removesuffix(' RSS'),
                      'url':'https://doi.org/'+quote(doi,safe='/'),'provider':source,'review_status':'needs_review'})
    return found

def get_rss(url, source):
    with urlopen(Request(url,headers={'User-Agent':UA,'Accept':'application/rss+xml, application/xml, text/xml'}),timeout=20) as response:
        payload = response.read(2_000_001)
    if len(payload) > 2_000_000:
        raise ValueError('RSS payload too large')
    return parse_rss(payload,source)

def get_json(url):
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'}), timeout=25) as r:
                return json.load(r)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)

def date_of(raw):
    for name in ('published-online', 'published-print', 'published', 'issued'):
        parts = raw.get(name, {}).get('date-parts', [[]])[0]
        if len(parts) == 3:
            try:
                return dt.date(*parts).isoformat()
            except ValueError:
                pass
    return None

def normalize_crossref(raw):
    doi = str(raw.get('DOI', '')).lower().strip()
    title = re.sub('<[^>]+>', '', ' '.join(raw.get('title', []))).strip()
    date = date_of(raw)
    if not re.fullmatch(r'10\.\d{4,9}/\S+', doi) or not title or BLOCKED.search(title) or not date:
        return None
    if raw.get('type') != 'journal-article' or raw.get('update-to'):
        return None
    return {'doi': doi, 'title': title, 'published_at': date,
            'source': ' · '.join(raw.get('container-title', [])),
            'url': 'https://doi.org/' + quote(doi, safe='/'), 'provider': 'Crossref',
            'review_status': 'needs_review'}

def sync(output=None, fetch=get_json, today=None, rss_fetch=get_rss):
    today = today or dt.datetime.now(dt.timezone.utc).date()
    stamp = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    feed = json.loads((ROOT / 'static' / 'researched-feed.json').read_text(encoding='utf-8'))
    errors, candidates, providers = [], {}, []
    reviewed = {a['doi'].lower() for a in feed['items']}
    since = (today - dt.timedelta(days=30)).isoformat()
    for issn in JOURNALS:
        params = urlencode({'filter': f'from-pub-date:{since},until-pub-date:{today},type:journal-article',
                            'sort': 'published', 'order': 'desc', 'rows': 12})
        try:
            rows = fetch(f'https://api.crossref.org/journals/{issn}/works?{params}')['message']['items']
            if 'Crossref' not in providers:
                providers.append('Crossref')
            for raw in rows:
                item = normalize_crossref(raw)
                if item and since <= item['published_at'] <= today.isoformat() and item['doi'] not in reviewed:
                    candidates[item['doi']] = item
        except Exception as exc:
            errors.append(f'Crossref {issn}: {type(exc).__name__}')
        time.sleep(0.25)
    query = f'FIRST_PDATE:[{since} TO {today}] AND SRC:MED AND (TITLE:regeneration OR TITLE:restoration OR TITLE:vaccine OR TITLE:therapy)'
    try:
        response = fetch('https://www.ebi.ac.uk/europepmc/webservices/rest/search?' + urlencode(
            {'query': query, 'format': 'json', 'resultType': 'core', 'pageSize': 20, 'sort': 'FIRST_PDATE_D desc'}))
        providers.append('Europe PMC')
        for raw in response['resultList']['result']:
            doi = str(raw.get('doi', '')).lower().strip()
            title = raw.get('title', '')
            date = raw.get('firstPublicationDate', '')
            types = raw.get('pubTypeList', {}).get('pubType', [])
            if (not re.fullmatch(r'10\.\d{4,9}/\S+', doi) or doi in reviewed or not title
                    or not since <= date <= today.isoformat() or BLOCKED.search(title)
                    or any(BLOCKED.search(t) or 'Preprint' in t for t in types) or raw.get('isRetracted') == 'Y'):
                continue
            candidates.setdefault(doi, {'doi': doi, 'title': title, 'published_at': date,
                'source': raw.get('journalInfo', {}).get('journal', {}).get('title', 'PubMed'),
                'url': 'https://doi.org/' + quote(doi, safe='/'), 'provider': 'Europe PMC',
                'review_status': 'needs_review'})
    except Exception as exc:
        errors.append(f'Europe PMC: {type(exc).__name__}')
    rss_status = []
    for name,url in RSS_SOURCES.items():
        try:
            rows = rss_fetch(url,name)
            providers.append(name)
            accepted = 0
            for item in rows:
                if since <= item['published_at'] <= today.isoformat() and item['doi'] not in reviewed:
                    accepted += 1
                    if item['doi'] in candidates:
                        candidates[item['doi']]['provider'] += ' · ' + name
                    else:
                        candidates[item['doi']] = item
            rss_status.append({'name':name,'url':url,'status':'ok','items':accepted})
        except Exception as exc:
            errors.append(f'{name}: {type(exc).__name__}')
            rss_status.append({'name':name,'url':url,'status':'unavailable','items':0})
    if not providers:
        raise RuntimeError('All scholarly APIs unavailable; keep the previous successful deployment.')
    feed.update({'demo': False, 'mode': 'public_sources', 'last_checked_at': stamp,
                 'providers': providers, 'rss_sources':rss_status, 'source_errors': errors, 'poll_interval_seconds': 1800,
                 'candidates': sorted(candidates.values(), key=lambda a: (a['published_at'], a['doi']), reverse=True)[:24]})
    target = output or ROOT / 'public' / 'feed.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(feed, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Public sources: {providers}; researched stories: {len(feed["items"])}; candidates: {len(feed["candidates"])}; errors: {errors}')
    return feed

if __name__ == '__main__':
    sync()
