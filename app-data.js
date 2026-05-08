(function () {
  const P = 'fastline_';

  function g(k) { try { const v = localStorage.getItem(P + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function s(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) {} }
  function r(k) { try { localStorage.removeItem(P + k); } catch (e) {} }

  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
    return 'h' + Math.abs(h).toString(36);
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function seedIfEmpty() {
    if (g('_seeded')) return;
    const users = [
      { id: 'u1', name: 'Amina Hassan', phone: '+255712100001', pass: hash('pass123'), handle: 'amina_h', bio: 'Biology student at UDSM', avatar: '', location: 'Dar es Salaam', online: false, lastSeen: Date.now() - 60000 },
      { id: 'u2', name: 'Joseph Mwangi', phone: '+255712100002', pass: hash('pass123'), handle: 'joseph_m', bio: 'Math & Physics tutor', avatar: '', location: 'Arusha', online: false, lastSeen: Date.now() - 120000 },
      { id: 'u3', name: 'Grace Mushi', phone: '+255712100003', pass: hash('pass123'), handle: 'grace_m', bio: 'Chemistry enthusiast', avatar: '', location: 'Mwanza', online: false, lastSeen: Date.now() - 300000 },
      { id: 'u4', name: 'David Kilonzo', phone: '+255712100004', pass: hash('pass123'), handle: 'david_k', bio: 'Physics & Engineering', avatar: '', location: 'Dodoma', online: false, lastSeen: Date.now() - 50000 },
      { id: 'u5', name: 'Sarah Lema', phone: '+255712100005', pass: hash('pass123'), handle: 'sarah_l', bio: 'Literature & Languages', avatar: '', location: 'Zanzibar', online: false, lastSeen: Date.now() - 90000 },
    ];
    s('users', users);
    s('_seeded', true);
  }

  const Data = {
    init() { seedIfEmpty(); },

    getUsers() { return g('users') || []; },
    getUser(id) { return (g('users') || []).find(u => u.id === id) || null; },
    getUserByPhone(phone) { return (g('users') || []).find(u => u.phone === phone) || null; },

    addUser(data) {
      const users = this.getUsers();
      if (users.find(u => u.phone === data.phone)) return null;
      const user = {
        id: uid(),
        name: data.name || 'User',
        phone: data.phone,
        pass: hash(data.pass),
        handle: data.name ? data.name.toLowerCase().replace(/\s+/g, '_').slice(0, 15) : 'user_' + uid().slice(0, 6),
        bio: data.bio || '',
        avatar: data.avatar || '',
        location: data.location || 'Tanzania',
        online: false,
        lastSeen: Date.now(),
      };
      users.push(user);
      s('users', users);
      return user;
    },

    updateUser(id, data) {
      const users = this.getUsers();
      const idx = users.findIndex(u => u.id === id);
      if (idx === -1) return null;
      Object.assign(users[idx], data);
      s('users', users);
      return users[idx];
    },

    verifyLogin(phone, pass) {
      const user = this.getUserByPhone(phone);
      if (!user) return null;
      if (user.pass !== hash(pass)) return null;
      return user;
    },

    getConversations(userId) {
      const all = g('conversations') || {};
      return Object.values(all).filter(c => c.participants.includes(userId));
    },

    getConversation(convId) {
      const all = g('conversations') || {};
      return all[convId] || null;
    },

    getOrCreateConversation(userId1, userId2) {
      const all = g('conversations') || {};
      const existing = Object.values(all).find(c =>
        c.participants.includes(userId1) && c.participants.includes(userId2)
      );
      if (existing) return existing.id;
      const conv = {
        id: uid(),
        participants: [userId1, userId2],
        messages: [],
        lastMessage: null,
        lastTime: Date.now(),
        createdAt: Date.now(),
      };
      all[conv.id] = conv;
      s('conversations', all);
      return conv.id;
    },

    sendMessage(convId, senderId, text) {
      const all = g('conversations') || {};
      const conv = all[convId];
      if (!conv) return null;
      const msg = {
        id: uid(),
        senderId,
        text,
        time: Date.now(),
        read: false,
      };
      conv.messages.push(msg);
      conv.lastMessage = text;
      conv.lastTime = Date.now();
      s('conversations', all);
      return msg;
    },

    getMessages(convId) {
      const all = g('conversations') || {};
      const conv = all[convId];
      return conv ? conv.messages : [];
    },

    markConversationRead(convId, userId) {
      const all = g('conversations') || {};
      const conv = all[convId];
      if (!conv) return;
      conv.messages.forEach(m => { if (m.senderId !== userId) m.read = true; });
      s('conversations', all);
    },

    getUnreadCount(convId, userId) {
      const all = g('conversations') || {};
      const conv = all[convId];
      if (!conv) return 0;
      return conv.messages.filter(m => m.senderId !== userId && !m.read).length;
    },

    getSetting(key, def) { const o = g('settings') || {}; return o[key] !== undefined ? o[key] : def; },
    setSetting(key, val) { const o = g('settings') || {}; o[key] = val; s('settings', o); },
    getAllSettings() { return g('settings') || {}; },
  };

  window.Data = Data;
})();
