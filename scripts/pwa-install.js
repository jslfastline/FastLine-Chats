/**
 * Shared PWA install button — hides permanently after install.
 */
export function initPwaInstallButton(buttonId = 'installPwaBtn') {
  const btn = document.getElementById(buttonId);
  if (!btn) return;

  let deferredPrompt = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  const hideBtn = () => {
    btn.classList.add('hidden');
    btn.style.display = 'none';
    localStorage.setItem('fastline_pwa_installed', '1');
  };

  const canShow = () =>
    !isStandalone() && localStorage.getItem('fastline_pwa_installed') !== '1';

  if (isStandalone() || localStorage.getItem('fastline_pwa_installed') === '1') {
    hideBtn();
    return;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (canShow()) {
      btn.classList.remove('hidden');
      btn.style.display = 'flex';
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideBtn();
  });

  btn.addEventListener('click', async () => {
    if (isStandalone()) { hideBtn(); return; }
    if (!deferredPrompt) {
      showInstallToast('Use browser menu → Install app / Add to Home Screen');
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') hideBtn();
  });

  if (canShow()) {
    setTimeout(() => {
      if (canShow()) {
        btn.classList.remove('hidden');
        btn.style.display = 'flex';
      }
    }, 2000);
  }
}

function showInstallToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast-notif';
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:9999;background:rgba(14,14,16,.95);border:1px solid rgba(0,191,255,.3);border-radius:12px;padding:10px 20px;font-size:.85rem;color:#fff;font-family:"DM Sans",sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.5);backdrop-filter:blur(12px);white-space:nowrap;max-width:90vw;text-align:center;';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}
