// ════════════════════════════════════════════════════
//  FastLine Chats — pwa.js
//  PWA install prompt, offline detection,
//  and "Add to Home Screen" banner
// ════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Deferred install prompt ──
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBanner();
  });

  window.addEventListener('appinstalled', () => {
    hideBanner();
    deferredPrompt = null;
    console.log('[PWA] FastLine installed successfully');
  });

  // ── Install Banner ──
  function showInstallBanner() {
    if (localStorage.getItem('fastline_install_dismissed')) return;
    if (isStandalone()) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.innerHTML = `
      <div style="
        position:fixed;bottom:0;left:0;right:0;z-index:9999;
        background:linear-gradient(135deg,rgba(14,14,16,.98),rgba(20,20,28,.98));
        border-top:1px solid rgba(0,191,255,0.3);
        padding:14px 20px;display:flex;align-items:center;gap:14px;
        backdrop-filter:blur(16px);
        animation:slideInUp .4s cubic-bezier(.2,.9,.4,1);
        font-family:'DM Sans',sans-serif;
      ">
        <style>@keyframes slideInUp{from{transform:translateY(100%)}to{transform:none}}</style>
        <div style="width:44px;height:44px;border-radius:12px;background:rgba(0,191,255,.12);border:1.5px solid rgba(0,191,255,.3);display:flex;align-items:center;justify-content:center;color:#00BFFF;font-size:1.2rem;flex-shrink:0;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="#00BFFF"><path d="M13 3l3.5 3.5-1.42 1.42L13 5.83V15h-2V5.83L8.92 7.92 7.5 6.5 11 3h2zm-8 14v3h14v-3h2v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-3h2z"/></svg>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="color:#fff;font-weight:700;font-size:.9rem;font-family:'Syne',sans-serif;">Install FastLine</div>
          <div style="color:rgba(255,255,255,.5);font-size:.75rem;">Add to home screen for the best experience</div>
        </div>
        <button id="pwa-install-btn" style="background:linear-gradient(135deg,#00BFFF,#1E90FF);border:none;border-radius:10px;padding:9px 18px;color:#000;font-weight:700;font-size:.82rem;cursor:pointer;font-family:'Syne',sans-serif;white-space:nowrap;">
          Install
        </button>
        <button id="pwa-dismiss-btn" style="background:transparent;border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:9px 12px;color:rgba(255,255,255,.5);font-size:.82rem;cursor:pointer;">
          ✕
        </button>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById('pwa-install-btn').addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') {
        console.log('[PWA] User accepted install');
      }
      deferredPrompt = null;
      hideBanner();
    });

    document.getElementById('pwa-dismiss-btn').addEventListener('click', () => {
      localStorage.setItem('fastline_install_dismissed', '1');
      hideBanner();
    });
  }

  function hideBanner() {
    const b = document.getElementById('pwa-install-banner');
    if (b) b.remove();
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }

  // ── Offline / Online Detection ──
  function updateOnlineStatus() {
    const isOnline = navigator.onLine;
    let bar = document.getElementById('fastline-offline-bar');

    if (!isOnline) {
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'fastline-offline-bar';
        bar.innerHTML = `
          <div style="
            position:fixed;top:0;left:0;right:0;z-index:10000;
            background:linear-gradient(135deg,#FF6B00,#cc4400);
            color:#fff;text-align:center;font-size:.78rem;
            padding:8px;font-family:'DM Sans',sans-serif;font-weight:600;
            letter-spacing:.5px;display:flex;align-items:center;justify-content:center;gap:6px;
          ">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M1 1l22 22-1.41 1.41-2.72-2.72C17.29 22.46 14.7 23 12 23c-6.63 0-10-5.07-10-11 0-2.06.54-4 1.46-5.67L1 4.41 2.41 3 3 3.59 1 1zm11 18c1.85 0 3.57-.56 5-1.52L4.51 5.02A9 9 0 003 12c0 4.97 4.02 9 9 9zm9-9c0 1.55-.37 3.01-1.03 4.3l1.46 1.46A10.9 10.9 0 0023 12c0-5.09-2.86-9.5-7.05-11.48L14.5 2A9 9 0 0121 10z"/></svg>
            No internet connection — messages will be queued
          </div>
        `;
        document.body.prepend(bar);
      }
    } else {
      if (bar) {
        bar.style.animation = 'none';
        bar.remove();
      }
    }
  }

  window.addEventListener('online',  updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  document.addEventListener('DOMContentLoaded', updateOnlineStatus);

  // ── Service Worker Registration ──
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js')
        .then(reg => {
          console.log('[SW] Registered, scope:', reg.scope);
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateBanner(newWorker);
              }
            });
          });
        })
        .catch(err => console.warn('[SW] Registration failed:', err));
    });
  }

  // ── Update Available Banner ──
  function showUpdateBanner(worker) {
    const b = document.createElement('div');
    b.innerHTML = `
      <div style="
        position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:10001;
        background:rgba(14,14,16,.97);border:1px solid rgba(0,191,255,.35);
        border-radius:14px;padding:12px 20px;
        display:flex;align-items:center;gap:12px;
        font-family:'DM Sans',sans-serif;font-size:.83rem;color:#fff;
        box-shadow:0 8px 32px rgba(0,0,0,.5);backdrop-filter:blur(16px);
        white-space:nowrap;
      ">
        <span style="color:#00BFFF">⚡</span>
        <span>A new version of FastLine is available!</span>
        <button onclick="this.closest('div').parentElement.remove();worker.postMessage({type:'SKIP_WAITING'})" style="background:linear-gradient(135deg,#00BFFF,#1E90FF);border:none;border-radius:8px;padding:6px 14px;color:#000;font-weight:700;cursor:pointer;font-size:.8rem;">
          Update
        </button>
        <button onclick="this.closest('div').parentElement.remove()" style="background:transparent;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:1rem;">✕</button>
      </div>
    `;
    document.body.appendChild(b);
  }

})();
