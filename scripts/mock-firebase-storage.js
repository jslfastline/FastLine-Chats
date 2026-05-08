import { _getDB, _saveDB } from './mock-firebase-firestore.js';

export function getStorage() {
  return { app: null, host: 'mock' };
}

export function ref(storage, path) {
  return { bucket: storage.host, fullPath: path, name: path.split('/').pop() };
}

export async function uploadBytes(storageRef, blob) {
  const db = _getDB();
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = function() {
      db.storage[storageRef.fullPath] = reader.result;
      _saveDB(db);
      resolve({ ref: storageRef, metadata: { size: blob.size, contentType: blob.type } });
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function getDownloadURL(storageRef) {
  const db = _getDB();
  const data = db.storage[storageRef.fullPath];
  if (data) return data;
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
}
