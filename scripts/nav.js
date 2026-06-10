/** Safe in-app navigation (works in PWA + GitHub Pages subpaths) */
export function navigateTo(path) {
  window.location.replace(new URL(path, window.location.href).href);
}

export async function resolvePostAuthRoute(db, email) {
  const { doc, getDoc } = await import('firebase/firestore');
  const { emailToId, isProfileComplete } = await import('./session.js');
  const snap = await getDoc(doc(db, 'users', emailToId(email)));
  if (!snap.exists()) return 'login.html';
  return isProfileComplete(snap.data()) ? 'fast.html' : 'profile.html';
}
