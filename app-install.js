(function () {
  let deferredPrompt = null;
  let installResolve = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    updateInstallUI(true);
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    updateInstallUI(false);
    const btn = document.getElementById('installAppBtn');
    if (btn) { btn.textContent = '✓ Installed'; btn.disabled = true; btn.style.opacity = '0.5'; }
  });

  function updateInstallUI(available) {
    const btn = document.getElementById('installAppBtn');
    if (!btn) return;
    if (available) {
      btn.textContent = '⬇ Install FastLine Chats App';
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.onclick = triggerInstall;
    } else if (!window.matchMedia('(display-mode: standalone)').matches) {
      btn.textContent = '⬇ Install FastLine Chats App';
      btn.disabled = false;
      btn.onclick = triggerInstall;
    } else {
      btn.textContent = '✓ Installed';
      btn.disabled = true;
      btn.style.opacity = '0.5';
    }
  }

  function triggerInstall() {
    if (!deferredPrompt) {
      showToast('⚙️ Open browser menu → "Add to Home Screen" to install');
      return;
    }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choice) => {
      if (choice.outcome === 'accepted') {
        showToast('✅ FastLine Chats installed!');
      } else {
        showToast('❌ Installation cancelled');
      }
      deferredPrompt = null;
      updateInstallUI(false);
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').then(reg => {
        reg.onupdatefound = () => {
          const installing = reg.installing;
          if (installing) {
            installing.onstatechange = () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                showToast('🔄 New version available! Refresh to update.');
              }
            };
          }
        };
      }).catch(() => {});
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => updateInstallUI(!!deferredPrompt), 500);
  });

  window.triggerInstall = triggerInstall;
})();
