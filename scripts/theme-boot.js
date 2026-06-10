/**
 * FastLine global theme boot — run in <head> on every page for consistent light/dark + accent.
 */
(function () {
  const THEMES = {
    cyberpunk: {
      '--accent': '#00BFFF', '--accent2': '#FF6B00', '--bg': '#0E0E10',
      '--surface': '#14141A', '--surface-2': '#1C1C24', '--surface-3': '#232330',
      '--sent-bubble': 'linear-gradient(135deg,#1E90FF,#00BFFF)', '--recv-bubble': '#2F2F33',
      '--text': '#FFFFFF', '--text-muted': 'rgba(255,255,255,0.45)',
      '--text-soft': 'rgba(255,255,255,0.7)', '--border': 'rgba(0,191,255,0.15)',
      '--input-bg': 'rgba(0,191,255,0.05)', '--shadow': '0 8px 32px rgba(0,0,0,0.5)'
    },
    light: {
      '--accent': '#00BFFF', '--accent2': '#FF6B00', '--bg': '#F5F6FA',
      '--surface': '#FFFFFF', '--surface-2': '#F0F2F8', '--surface-3': '#E8EAEF',
      '--sent-bubble': 'linear-gradient(135deg,#1E90FF,#00BFFF)', '--recv-bubble': '#E8EAEF',
      '--text': '#0E0E10', '--text-muted': 'rgba(14,14,16,0.45)',
      '--text-soft': 'rgba(14,14,16,0.7)', '--border': 'rgba(0,191,255,0.2)',
      '--input-bg': 'rgba(0,191,255,0.05)', '--shadow': '0 4px 24px rgba(0,0,0,0.1)'
    },
    minimal: {
      '--accent': '#6C63FF', '--accent2': '#FF6584', '--bg': '#0A0A0F',
      '--surface': '#111118', '--surface-2': '#18181F', '--surface-3': '#1F1F28',
      '--sent-bubble': 'linear-gradient(135deg,#6C63FF,#9B59B6)', '--recv-bubble': '#1F1F28',
      '--text': '#FFFFFF', '--text-muted': 'rgba(255,255,255,0.45)',
      '--text-soft': 'rgba(255,255,255,0.7)', '--border': 'rgba(108,99,255,0.2)',
      '--input-bg': 'rgba(108,99,255,0.06)', '--shadow': '0 8px 32px rgba(0,0,0,0.5)'
    },
    nature: {
      '--accent': '#2ECC71', '--accent2': '#F39C12', '--bg': '#0A0F0C',
      '--surface': '#101810', '--surface-2': '#182018', '--surface-3': '#1A2A1A',
      '--sent-bubble': 'linear-gradient(135deg,#27AE60,#2ECC71)', '--recv-bubble': '#1A2A1A',
      '--text': '#FFFFFF', '--text-muted': 'rgba(255,255,255,0.45)',
      '--text-soft': 'rgba(255,255,255,0.7)', '--border': 'rgba(46,204,113,0.2)',
      '--input-bg': 'rgba(46,204,113,0.06)', '--shadow': '0 8px 32px rgba(0,0,0,0.5)'
    }
  };

  const isLight = localStorage.getItem('fastline_theme') === 'light';
  const savedName = localStorage.getItem('fastline_theme_name') || 'cyberpunk';
  const themeName = isLight ? 'light' : savedName;
  const theme = THEMES[themeName] || THEMES.cyberpunk;
  const root = document.documentElement;
  Object.entries(theme).forEach(([k, v]) => root.style.setProperty(k, v));

  const applyBody = () => {
    document.body?.classList.toggle('light-mode', isLight);
    document.body?.classList.toggle('dark-mode', !isLight);
  };
  if (document.body) applyBody();
  else document.addEventListener('DOMContentLoaded', applyBody);

  window.FastLineTheme = {
    isLight: () => localStorage.getItem('fastline_theme') === 'light',
    toggle() {
      const next = localStorage.getItem('fastline_theme') === 'light' ? 'dark' : 'light';
      localStorage.setItem('fastline_theme', next);
      location.reload();
    },
    setMode(mode) {
      localStorage.setItem('fastline_theme', mode);
      location.reload();
    }
  };
})();
