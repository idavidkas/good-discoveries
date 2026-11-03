'use strict';

const els = {
  story: document.getElementById('main-story'),
  archive: document.getElementById('archive-strip'),
  archiveCount: document.getElementById('archive-count'),
  indexCount: document.getElementById('index-count'),
  clock: document.getElementById('clock'),
  status: document.getElementById('refresh-status'),
  modal: document.getElementById('modal'),
  modalContent: document.getElementById('modal-content'),
  modalClose: document.getElementById('modal-close'),
  toast: document.getElementById('toast'),
};

const icons = {
  arrow: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-7-7 7 7-7 7"/></svg>`,
  arrowUp: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>`,
  shield: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>`,
  chevron: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`,
  book: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2Z"/></svg>`,
};

let articles = [];
let newestDoi = null;
let expanded = false;
let lastFocus = null;
let checkStatus = null;
let toastTimer = null;
const mosDate = new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Moscow' });
const mosDateTime = new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'Europe/Moscow' });
const mosTime = new Intl.DateTimeFormat('ru-RU', { hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Europe/Moscow' });

function safe(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function lineBreaks(s) { return safe(s).split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${p.replace(/\n/g,'<br>')}</p>`).join(''); }
function dateStr(s) { const d = new Date(String(s || '').length === 10 ? `${s}T12:00:00Z` : s); return isNaN(+d) ? 'Дата не указана' : mosDate.format(d); }
function dateTimeStr(s) { const d = new Date(s); return isNaN(+d) ? 'Дата не указана' : mosDateTime.format(d); }
function image(s) { const name = ['quantum.svg','coral.svg','dna.svg','cells.svg'].includes(s) ? s : 'quantum.svg'; return `./assets/${name}`; }
function externalUrl(value) { try { const url = new URL(String(value)); return url.protocol === 'https:' && (url.hostname === 'doi.org' || url.hostname.endsWith('.doi.org')) ? url.href : '#'; } catch { return '#'; } }
function reviewUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' && ['www.nature.com','arxiv.org','pubmed.ncbi.nlm.nih.gov','www.nejm.org','www.nih.gov','www.ox.ac.uk'].includes(url.hostname) ? url.href : '#'; } catch { return '#'; } }
function researchMarkup(a) { return a.reviewed_at ? `<div class="research-note"><strong>Проверка источников · ${safe(a.reviewed_at)}</strong><p>Сопоставлены результат, дата и ограничения. Это проверка публикации, а не независимое повторение эксперимента.</p>${(a.review_sources || []).map((url,i)=>`<a href="${reviewUrl(url)}" target="_blank" rel="noopener noreferrer">Источник ${i+1} ↗</a>`).join(' · ')}</div>` : ''; }
function currentTime() { els.clock.textContent = `МОСКВА · ${mosTime.format(new Date())}`; }

function mainMarkup(a) {
  return `<article class="feature-card">
    <div class="feature-body">
      <div class="feature-meta"><span class="topic-tag"><span class="topic-dot"></span>${safe(a.category)}</span><span class="meta-divider"></span><span class="date-meta">${dateStr(a.published_at)}</span></div>
      <div class="story-copy"><div class="feature-small-label">ХОРОШАЯ НОВОСТЬ №${String(articles.length).padStart(2,'0')}</div><h1>${safe(a.title)}</h1><p class="feature-lead">${safe(a.lead)}</p>
        <div class="read-more-wrap"><div class="body-preview ${expanded ? 'is-expanded' : ''}" id="body-preview">${lineBreaks(a.body)}</div><button type="button" class="expand-button" id="expand-btn" aria-expanded="${expanded}" aria-controls="body-preview">${expanded ? 'Свернуть текст' : 'Читать подробнее'} <span class="expand-icon ${expanded ? 'up' : ''}">${icons.chevron}</span></button></div>
      </div>
      <div class="feature-bottom"><div class="source-block"><span class="source-icon">${icons.book}</span><span><span class="source-label">ПЕРВОИСТОЧНИК</span><strong>${safe(a.source)}</strong></span></div><a class="source-link" href="${externalUrl(a.url)}" target="_blank" rel="noopener noreferrer" aria-label="Открыть оригинальное исследование в новой вкладке">Исследование ${icons.arrowUp}</a></div>
    </div>
    <div class="feature-media"><img src="${image(a.image)}" alt="Научная иллюстрация: ${safe(a.category)}" decoding="async"><div class="image-grain" aria-hidden="true"></div><div class="image-gradient" aria-hidden="true"></div><div class="media-topline"><span class="media-tag"><span class="media-tag-star">✳</span> THE BRIGHT SIDE</span><span class="media-counter">01 / ${String(articles.length).padStart(2,'0')}</span></div><div class="image-footer"><span>НАУКА, КОТОРАЯ ДЕЛАЕТ МИР ЛУЧШЕ</span><span class="image-sparkle">✦</span></div></div>
  </article><div class="evidence-bar"><span class="evidence-item">${icons.shield}<span>${safe(a.evidence)}</span></span><span class="evidence-dot">·</span><span class="evidence-limits">Честно об ограничениях: <button type="button" class="evidence-button" id="limits-btn">показать</button></span><span class="publish-stamp">На сайте: ${dateTimeStr(a.added_at)}</span></div>`;
}

function archiveMarkup(a, i) {
  return `<button class="archive-card" type="button" data-index="${i}" aria-label="Открыть предыдущую новость: ${safe(a.title)}">
    <img src="${image(a.image)}" alt="" loading="lazy" decoding="async">
    <span class="archive-card-shade"></span><span class="archive-card-index">${String(i+1).padStart(2,'0')}</span><span class="archive-card-arrow">${icons.arrowUp}</span>
    <span class="archive-tooltip" role="tooltip"><span class="tooltip-category">${safe(a.category)} · ${dateStr(a.published_at)}</span><span class="tooltip-title">${safe(a.title)}</span><span class="tooltip-source">${safe(a.source)}</span></span>
  </button>`;
}

function render({announce = false} = {}) {
  if (!articles.length) {
    els.story.innerHTML = `<div class="empty-state"><span>✳</span><h3>Мы ищем хорошую новость.</h3><p>Пока нет публикаций, которые прошли нашу проверку. Мы лучше подождём, чем опубликуем сомнительную сенсацию.</p></div>`;
    els.archive.innerHTML = `<div class="empty-archive">История откроется, когда появится второе исследование.</div>`;
  } else {
    els.story.innerHTML = mainMarkup(articles[0]);
    els.archive.innerHTML = articles.length > 1 ? articles.slice(1).map((a,i) => archiveMarkup(a,i+1)).join('') : `<div class="empty-archive">Другие открытия появятся здесь.</div>`;
    if (announce) {
      els.story.classList.remove('new-arrival'); void els.story.offsetWidth; els.story.classList.add('new-arrival');
      notify('Новое хорошее открытие — уже на главной ✳');
    }
  }
  els.archiveCount.textContent = String(Math.max(articles.length-1,0));
  if (els.indexCount) els.indexCount.textContent = `01 / ${String(articles.length || 0).padStart(2,'0')}`;
  const expandButton = document.getElementById('expand-btn');
  if (expandButton) expandButton.addEventListener('click', () => { expanded = !expanded; render(); document.getElementById('expand-btn')?.focus(); });
  document.getElementById('limits-btn')?.addEventListener('click', () => showArticle(articles[0], 'limits'));
  els.archive.querySelectorAll('.archive-card').forEach(btn => btn.addEventListener('click', () => showArticle(articles[Number(btn.dataset.index)])));
}

function showArticle(a, tab='article') {
  if (!a) return;
  lastFocus = document.activeElement;
  els.modalContent.innerHTML = `<div class="modal-art"><img src="${image(a.image)}" alt="Научная иллюстрация: ${safe(a.category)}"></div><div class="modal-inner">
    <div class="modal-meta"><span class="topic-tag"><span class="topic-dot"></span>${safe(a.category)}</span><span>${dateStr(a.published_at)}</span></div>
    <h2 id="modal-title">${safe(a.title)}</h2><p class="modal-lead">${safe(a.lead)}</p>
    <div class="modal-body">${lineBreaks(a.body)}</div>
    <div class="limits-panel" ${tab==='limits'?'data-highlight="true"':''}><div class="limits-heading">${icons.shield}<strong>Что доказано и где ограничения</strong></div><p>${safe(a.limitations)}</p><p class="evidence-small">Уровень материала: ${safe(a.evidence)}. Рецензирование само по себе не означает независимого повторения результатов.</p></div>
    ${researchMarkup(a)}<div class="modal-source"><div><small>НАУЧНЫЙ ИСТОЧНИК</small><strong>${safe(a.source)}</strong><span>DOI: ${safe(a.doi)}</span></div><a href="${externalUrl(a.url)}" target="_blank" rel="noopener noreferrer">Открыть исследование ${icons.arrowUp}</a></div>
  </div>`;
  els.modal.hidden = false;
  els.modal.setAttribute('aria-hidden','false');
  document.body.classList.add('dialog-open');
  els.modalClose.focus();
}

function showInfo() {
  lastFocus = document.activeElement;
  els.modalContent.innerHTML = `<div class="modal-inner info-dialog"><div class="modal-info-icon">✳</div><div class="feature-small-label">НАШ РЕДАКЦИОННЫЙ ПРИНЦИП</div><h2 id="modal-title">Научный оптимизм.<br>Без самообмана.</h2><p class="modal-lead">Мы показываем одну позитивную научную новость, а не бесконечную ленту громких заголовков.</p><div class="info-steps"><div><span>01</span><strong>Поиск</strong><p>Crossref, Europe PMC и RSS научных журналов проверяются примерно каждые 30 минут. Новые работы появляются в научном радаре. Расписание иногда может задерживаться.</p></div><div><span>02</span><strong>Проверка</strong><p>Для главной ленты сопоставляем первоисточники, результаты и ограничения. У каждой новости есть дата проверки и ссылки. Автоматически найденная работа сама по себе ещё не становится проверенной новостью.</p></div><div><span>03</span><strong>Публикация</strong><p>Новые одобренные новости попадают в главную карточку, старые — в архив. Если подходящей статьи нет, ничего не меняется.</p></div></div><p class="info-note">Важно: автоматизированная редактура по метаданным не может установить независимую воспроизводимость исследования. Мы не называем одиночные результаты «окончательно доказанными».</p></div>`;
  els.modal.hidden = false;
  els.modal.setAttribute('aria-hidden','false');
  document.body.classList.add('dialog-open');
  els.modalClose.focus();
}

function closeModal() { if (els.modal.hidden) return; els.modal.hidden = true; els.modal.setAttribute('aria-hidden','true'); document.body.classList.remove('dialog-open'); lastFocus?.focus?.(); }
function notify(message) { els.toast.textContent = message; els.toast.classList.add('shown'); clearTimeout(toastTimer); toastTimer = setTimeout(()=>els.toast.classList.remove('shown'),4000); }

async function loadFeed() {
  try {
    const api = (window.GOOD_DISCOVERIES_API_BASE || '').replace(/\/$/, '');
    const res = await fetch(api ? `${api}/api/news` : './feed.json', {headers: {'Accept':'application/json'}, cache:'no-store'});
    if (!res.ok) throw new Error(`Ошибка HTTP ${res.status}`);
    const json = await res.json();
    const next = Array.isArray(json.items) ? json.items : [];
    const updated = next[0]?.doi && next[0].doi !== newestDoi;
    const firstLoad = newestDoi === null;
    articles = next;
    newestDoi = next[0]?.doi || '';
    checkStatus = json;
    renderRadar(json.candidates || []);
    if (firstLoad || updated) { expanded = false; render({announce: updated && !firstLoad}); }
    else if (next.length !== Number(els.archiveCount.textContent) + 1) render();
    updateStatus();
  } catch (err) {
    if (newestDoi === null) {
      // Pages alone cannot run our API: clearly label the curated offline sample.
      try {
        const sample = await fetch('./researched-feed.json', {cache:'no-store'});
        if (!sample.ok) throw new Error('Demo unavailable');
        const demo = await sample.json();
        articles = demo.items || [];
        newestDoi = articles[0]?.doi || '';
        checkStatus = {...demo, offline: true};
        render();
      } catch {
        els.story.innerHTML = `<div class="empty-state"><span>↻</span><h3>Не удалось загрузить новости.</h3><p>Сервер временно недоступен.</p><button id="retry-btn" class="retry-button">Повторить</button></div>`;
        document.getElementById('retry-btn')?.addEventListener('click', loadFeed);
      }
    }
    els.status.textContent = articles.length ? 'Сохранённые материалы · обновление временно недоступно' : 'Нет соединения · пробуем снова';
  }
}

function updateStatus() {
  if (checkStatus?.mode === 'public_sources') {
    const date = new Date(checkStatus.last_checked_at);
    els.status.textContent = `Источники проверены ${dateTimeStr(date)} · обновление примерно каждые 30 минут` + (checkStatus.source_errors?.length ? ' · часть источников недоступна' : '');
    const live = document.querySelector('.live-indicator span:last-child');
    if (live) live.textContent = 'Научные источники подключены';
    return;
  }
  if (checkStatus?.demo) { els.status.textContent = 'Демонстрационные статьи · обновление пока не подключено'; return; }
  const d = checkStatus?.last_checked_at ? new Date(checkStatus.last_checked_at) : null;
  const base = d && !isNaN(+d) ? `Проверено в ${mosTime.format(d)} (МСК)` : 'Проверяем научные источники';
  els.status.textContent = base + ' · каждые 15 минут';
  els.status.title = checkStatus?.last_error ? 'Последняя проверка завершилась с ошибками; опубликованные новости сохранены.' : '';
}

function renderRadar(items) {
  let radar = document.getElementById('science-radar');
  if (!radar) {
    radar = document.createElement('section'); radar.id = 'science-radar'; radar.className = 'science-radar';
    document.querySelector('main').append(radar);
  }
  radar.innerHTML = `<h2>Научный радар</h2><p>Свежие работы из научных каталогов и RSS журналов. Заголовки на языке оригинала; результаты ещё требуют редакционной проверки.</p><div class="radar-grid">${items.slice(0,6).map(a=>`<a class="radar-card" href="${externalUrl(a.url)}" target="_blank" rel="noopener noreferrer"><small>${safe(a.source)} · ${dateStr(a.published_at)}</small><strong>${safe(a.title)}</strong><span>Открыть публикацию ↗</span></a>`).join('') || '<p>Новых работ для проверки пока нет.</p>'}</div>`;
}

document.getElementById('info-btn').addEventListener('click', showInfo);
els.modalClose.addEventListener('click', closeModal);
els.modal.addEventListener('click', e => { if (e.target.dataset.close === 'true') closeModal(); });
document.addEventListener('keydown', e => {
  if (els.modal.hidden) return;
  if (e.key === 'Escape') { closeModal(); return; }
  if (e.key === 'Tab') {
    const focusable = [...els.modal.querySelectorAll('a[href],button:not([disabled])')].filter(el => el.getClientRects().length);
    if (focusable.length === 0) return;
    const first=focusable[0], last=focusable[focusable.length-1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

currentTime(); setInterval(currentTime,30_000); loadFeed(); setInterval(loadFeed,60_000);
