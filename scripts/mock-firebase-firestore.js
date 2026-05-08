const DB_KEY = 'fastline_db';
const _listeners = [];
let _pollInterval = null;

export function _getDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return _initDB();
}

export function _saveDB(data) {
  data._version = (data._version || 0) + 1;
  data._savedAt = Date.now();
  localStorage.setItem(DB_KEY, JSON.stringify(data));
  _notifyListeners(data);
}

function _initDB() {
  const data = {
    users: {},
    conversations: {},
    messages: {},
    storage: {},
    calls: {},
    _version: 0,
    _savedAt: Date.now()
  };
  const demos = [
    { id: 'amina_hassan', username: 'Amina Hassan', email: 'amina@fastline.app', status: 'Form 6 student | Science lover', avatar: '', online: true, phone: '+255700000001' },
    { id: 'joseph_mwanga', username: 'Joseph Mwanga', email: 'joseph@fastline.app', status: 'Teacher | Math & Physics', avatar: '', online: false, phone: '+255700000002' },
    { id: 'grace_mbwana', username: 'Grace Mbwana', email: 'grace@fastline.app', status: 'Biology & Chemistry | STEM', avatar: '', online: true, phone: '+255700000003' },
    { id: 'david_kimaro', username: 'David Kimaro', email: 'david@fastline.app', status: 'CS student | Tech enthusiast', avatar: '', online: false, phone: '+255700000004' },
    { id: 'sarah_john', username: 'Sarah John', email: 'sarah@fastline.app', status: 'Hey there! using FastLine.', avatar: '', online: true, phone: '+255700000005' }
  ];
  demos.forEach(u => {
    data.users[u.id] = { ...u, lastSeen: Date.now() - Math.random() * 3600000, createdAt: Date.now() - 86400000 };
  });
  localStorage.setItem(DB_KEY, JSON.stringify(data));
  return data;
}

function _notifyListeners(data) {
  _listeners.forEach(l => {
    try {
      const snap = l.type === 'doc' ? _buildDocSnap(data, l.path) : _buildQuerySnap(data, l.query);
      if (snap._version !== l._lastVersion) {
        l._lastVersion = snap._version;
        l.callback(snap);
      }
    } catch(e) {}
  });
}

export function _startPolling() {
  if (_pollInterval) return;
  _pollInterval = setInterval(() => {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      _notifyListeners(data);
    } catch(e) {}
  }, 200);
}

function _parseDocPath(pathStr) {
  const parts = pathStr.split('/').filter(Boolean);
  const collections = [];
  for (let i = 0; i < parts.length; i += 2) {
    collections.push({ collection: parts[i], id: parts[i+1] || null });
  }
  return collections;
}

function _getDataAtPath(data, pathStr) {
  const collections = _parseDocPath(pathStr);
  let current = data;
  for (const seg of collections) {
    if (!current[seg.collection]) return null;
    if (seg.id) {
      current = current[seg.collection][seg.id];
      if (!current) return null;
    } else {
      current = current[seg.collection];
    }
  }
  return current;
}

function _buildDocSnap(data, path) {
  const docData = _getDataAtPath(data, path);
  const id = path.split('/').pop();
  return {
    id,
    exists: () => docData !== null && docData !== undefined,
    data: () => docData || {},
    _version: data._version
  };
}

function _buildQuerySnap(data, queryObj) {
  const { base, constraints } = queryObj;
  const pathStr = typeof base === 'string' ? base : base.path;
  let docs = [];
  const collData = _getDataAtPath(data, pathStr);
  if (collData && typeof collData === 'object' && !Array.isArray(collData)) {
    docs = Object.entries(collData).map(([id, docData]) => ({
      id,
      data: () => docData || {}
    }));
  }

  // Apply where constraints
  constraints.forEach(c => {
    if (c.type === 'where') {
      if (c.op === 'array-contains') {
        docs = docs.filter(d => {
          const val = d.data()[c.field];
          return Array.isArray(val) && val.includes(c.value);
        });
      } else if (c.op === '==') {
        docs = docs.filter(d => d.data()[c.field] === c.value);
      } else if (c.op === '!=') {
        docs = docs.filter(d => d.data()[c.field] !== c.value);
      } else if (c.op === '>') {
        docs = docs.filter(d => (d.data()[c.field] || 0) > c.value);
      } else if (c.op === '<') {
        docs = docs.filter(d => (d.data()[c.field] || 0) < c.value);
      } else if (c.op === '>=') {
        docs = docs.filter(d => (d.data()[c.field] || 0) >= c.value);
      } else if (c.op === '<=') {
        docs = docs.filter(d => (d.data()[c.field] || 0) <= c.value);
      }
    }
  });

  // Apply orderBy
  constraints.forEach(c => {
    if (c.type === 'orderBy') {
      const dir = c.direction === 'desc' ? -1 : 1;
      docs.sort((a, b) => {
        const va = a.data()[c.field] || 0;
        const vb = b.data()[c.field] || 0;
        return va > vb ? dir : va < vb ? -dir : 0;
      });
    }
  });

  // Apply limit
  constraints.forEach(c => {
    if (c.type === 'limit') {
      docs = docs.slice(0, c.n);
    }
  });

  return {
    docs,
    empty: docs.length === 0,
    forEach: (fn) => docs.forEach(fn),
    size: docs.length,
    _version: data._version
  };
}

function _genId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }

// ── Public API ──

export function getFirestore(app) {
  return { app, _mock: true, _type: 'firestore' };
}

export function collection(db, path, ...ids) {
  const fullPath = [path, ...ids].join('/');
  return { type: 'collection', path: fullPath, db };
}

export function doc(db, path, ...ids) {
  const fullPath = [path, ...ids].join('/');
  return { type: 'doc', path: fullPath, db };
}

export async function getDoc(ref) {
  const data = _getDB();
  return _buildDocSnap(data, ref.path);
}

export async function setDoc(ref, data, options) {
  const db = _getDB();
  const collections = _parseDocPath(ref.path);
  let current = db;
  for (let i = 0; i < collections.length; i++) {
    const seg = collections[i];
    if (!current[seg.collection]) current[seg.collection] = {};
    if (seg.id) {
      if (i === collections.length - 1) {
        const merged = options?.merge ? { ...(current[seg.collection][seg.id] || {}), ...data } : data;
        current[seg.collection][seg.id] = merged;
      } else {
        if (!current[seg.collection][seg.id]) current[seg.collection][seg.id] = {};
        current = current[seg.collection][seg.id];
      }
    } else {
      current = current[seg.collection];
    }
  }
  _saveDB(db);
}

export async function addDoc(ref, data) {
  const id = _genId();
  const db = _getDB();
  const collections = _parseDocPath(ref.path);
  let current = db;
  for (const seg of collections) {
    if (!current[seg.collection]) current[seg.collection] = {};
    if (seg.id) {
      if (!current[seg.collection][seg.id]) current[seg.collection][seg.id] = {};
      current = current[seg.collection][seg.id];
    } else {
      current = current[seg.collection];
    }
  }
  current[id] = data;
  _saveDB(db);
  return { id };
}

export async function updateDoc(ref, data) {
  const db = _getDB();
  const target = _getDataAtPath(db, ref.path);
  if (target) {
    Object.entries(data).forEach(([k, v]) => {
      // Handle dot notation for nested fields (e.g. "unreadCount.user123")
      if (k.includes('.')) {
        const dotIdx = k.indexOf('.');
        const parent = k.substring(0, dotIdx);
        const child = k.substring(dotIdx + 1);
        if (v === '__DELETE_FIELD__') {
          if (target[parent]) delete target[parent][child];
        } else {
          if (!target[parent]) target[parent] = {};
          target[parent][child] = v;
        }
      } else if (v === '__DELETE_FIELD__') {
        delete target[k];
      } else {
        target[k] = v;
      }
    });
  }
  _saveDB(db);
}

export async function deleteDoc(ref) {
  const db = _getDB();
  const path = ref.path;
  const parts = path.split('/');
  const parentPath = parts.slice(0, -1).join('/');
  const id = parts[parts.length - 1];
  const parent = _getDataAtPath(db, parentPath);
  if (parent) delete parent[id];
  _saveDB(db);
}

export function query(base, ...constraints) {
  const path = typeof base === 'string' ? base : base.path;
  return { type: 'query', base: path, constraints };
}

export function where(field, op, value) {
  return { type: 'where', field, op, value };
}

export function orderBy(field, direction) {
  return { type: 'orderBy', field, direction: direction || 'asc' };
}

export function limit(n) {
  return { type: 'limit', n };
}

export async function getDocs(queryRef) {
  const data = _getDB();
  return _buildQuerySnap(data, queryRef);
}

export function onSnapshot(ref, callback) {
  _startPolling();
  const listener = {
    type: ref.type === 'doc' ? 'doc' : 'query',
    path: ref.path || (ref.base || ''),
    query: ref,
    callback,
    _lastVersion: -1
  };
  _listeners.push(listener);

  // Fire immediately with current data
  const data = _getDB();
  const snap = listener.type === 'doc' ? _buildDocSnap(data, ref.path) : _buildQuerySnap(data, ref);
  listener._lastVersion = snap._version;
  setTimeout(() => callback(snap), 50);

  return () => {
    const idx = _listeners.indexOf(listener);
    if (idx !== -1) _listeners.splice(idx, 1);
  };
}

export function serverTimestamp() {
  return Date.now();
}

export function deleteField() {
  return '__DELETE_FIELD__';
}
