'use strict';
(() => {
  const installBtn = document.getElementById('install-app');
  const pushBtn = document.getElementById('push-toggle');
  const message = document.getElementById('pwa-message');
  const apiBase = () => (window.GOOD_DISCOVERIES_API_BASE || '').replace(/\/$/, '');
  const apiUrl = path => `${apiBase()}${path}`;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let installPrompt = null;
  let registration = null;
  let publicKey = '';
  const show = text => { message.textContent = text; };

  function decodeKey(str) {
    const padding = '='.repeat((4 - (str.length % 4)) % 4);
    const raw = atob((str + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }

  async function getPublicKey() {
    if (publicKey) return publicKey;
    const r = await fetch(apiUrl('/api/push/public-key'), { cache: 'no-store' });
    if (!r.ok) throw new Error(`Сервер ответил ${r.status}`);
    const config = await r.json();
    if (!config.enabled || !config.publicKey) throw new Error('Отправка уведомлений на сервере ещё не настроена');
    publicKey = config.publicKey;
    return publicKey;
  }

  function supported() {
    return window.isSecureContext && ('serviceWorker' in navigator) &&
      ('PushManager' in window) && ('Notification' in window);
  }

  async function reflectSubscription() {
    if (!supported() || !registration) {
      pushBtn.textContent = '♧ Дайджест каждые 3 дня';
      return;
    }
    const active = await registration.pushManager.getSubscription();
    pushBtn.textContent = active ? '✓ Дайджест подключён · отключить' : '♧ Дайджест каждые 3 дня';
    pushBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  async function togglePush() {
    if (!supported()) { show('Этот браузер не поддерживает Web Push. Попробуй современный Safari, Chrome или Edge.'); return; }
    if (isIos && !standalone()) {
      show('На iPhone сначала открой сайт в Safari → Поделиться → На экран «Домой». Затем открой иконку приложения.');
      return;
    }
    if (!apiBase()) { show('Сначала нужно подключить сервер для регулярной отправки уведомлений.'); return; }
    // Invoke the permission request immediately from the click gesture (iOS Safari requirement).
    const permissionPromise = Notification.permission === 'default'
      ? Notification.requestPermission() : Promise.resolve(Notification.permission);
    pushBtn.disabled = true;
    try {
      if (!registration) registration = await navigator.serviceWorker.ready;
      const active = await registration.pushManager.getSubscription();
      if (active) {
        const response = await fetch(apiUrl('/api/push/unsubscribe'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: active.endpoint })
        });
        if (!response.ok) throw new Error('Не удалось отключить подписку на сервере');
        await active.unsubscribe();
        show('Дайджест отключён. Уведомления больше не будут приходить.');
      } else {
        // Must be called from the user click, before awaiting a network request.
        if (Notification.permission === 'denied') {
          throw new Error('Уведомления заблокированы в настройках телефона или браузера');
        }
        const permission = await permissionPromise;
        if (permission !== 'granted') throw new Error('Для дайджеста нужно разрешить уведомления');
        const key = await getPublicKey();
        const sub = await registration.pushManager.subscribe({
          userVisibleOnly: true, applicationServerKey: decodeKey(key)
        });
        const result = await fetch(apiUrl('/api/push/subscribe'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub.toJSON())
        });
        if (!result.ok) {
          const info = await result.json().catch(() => ({}));
          await sub.unsubscribe();
          throw new Error(info.detail || `Не удалось подключить дайджест: ${result.status}`);
        }
        const info = await result.json();
        show(`Подписка включена. Первый дайджест примерно через 72 часа${info.next_digest_at ? ' после подписки' : ''}.`);
      }
    } catch (err) { show(err.message || 'Не удалось изменить подписку'); }
    finally { pushBtn.disabled = false; await reflectSubscription(); }
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event;
    if (!standalone()) installBtn.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    installBtn.hidden = true; show('Приложение установлено на устройство.');
  });
  installBtn.addEventListener('click', async () => {
    if (standalone()) { show('Приложение уже установлено.'); return; }
    if (installPrompt) {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') show('Приложение добавлено.');
      installPrompt = null;
    } else if (isIos) {
      show('На iPhone: открой в Safari → Поделиться → На экран «Домой». После установки открой приложение с иконки.');
    } else {
      show('Открой меню браузера → «Установить приложение» или «Добавить на главный экран».');
    }
  });
  pushBtn.addEventListener('click', togglePush);

  async function init() {
    if (standalone()) installBtn.hidden = true;
    if (!('serviceWorker' in navigator)) { show('Для установки приложения нужен браузер с поддержкой Service Worker.'); return; }
    try {
      registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      await reflectSubscription();
      if (apiBase()) getPublicKey().catch(() => {}); // Warm up for later user-initiated subscription.
    } catch (err) { show('Не удалось включить офлайн-режим: ' + err.message); }
  }
  init();
})();
