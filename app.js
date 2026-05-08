// ════════════════════════════════════════════════════
//  FastLine Chats — app.js
//  Main application logic
// ════════════════════════════════════════════════════

import { app, db, storage } from './scripts/firebase-config.js';
import { TypingIndicator, enableSwipeToReply, generateSmartReplies, renderSmartReplies, shouldShowDateSep, formatDateSep, markMessagesRead, updateTabTitle } from './components/chat.js';
import { setOnlineStatus, sendLocalNotification, requestNotificationPermission, ThemeManager } from './components/profile.js';
import { WebRTCCall, showIncomingCallUI, CallTimer } from './components/video-call.js';
import {
  collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, getDocs, limit
} from 'firebase/firestore';
import {
  ref as storageRef, uploadBytes, getDownloadURL
} from 'firebase/storage';

// ════════════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════════════

const $ = id => document.getElementById(id);
const emailToId = e => e.toLowerCase().replace(/[^a-z0-9]/g, '_');
const normalizeUsername = (value) => value.trim().toLowerCase();
const getSession = () => {
  const e = localStorage.getItem('fastline_session_email');
  const x = +localStorage.getItem('fastline_session_expiry');
  return (e && Date.now() < x) ? e : null;
};

function toast(msg, color = 'var(--accent)') {
  const t = document.createElement('div');
  t.className = 'toast-notif';
  t.style.borderLeftColor = color;
  t.innerHTML = `<i class="fas fa-bolt" style="color:${color}"></i> ${msg}`;
  $('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function formatTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatChatTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function isUsernameTaken(name, currentUserId) {
  const usernameLower = normalizeUsername(name);
  if (!usernameLower) return false;
  const snap = await getDocs(query(collection(db, 'users'), where('usernameLower', '==', usernameLower)));
  return snap.docs.some(d => d.id !== currentUserId);
}

// ════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════

let currentUser = null;        // { email, id, displayName, avatar, status }
let activeChatId = null;       // Current conversation ID
let activePeer = null;         // Peer user data
let msgUnsubscribe = null;     // Firestore realtime listener cleanup
let convsUnsubscribe = null;
let replyTarget = null;        // Message being replied to
let contextTarget = null;      // Message for context menu
let mediaRecorder = null;
let audioChunks = [];
let recInterval = null;
let peerChannel = null;        // RTCPeerConnection for video
let currentTab = 'chats';      // Current nav tab

// ════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════

async function init() {
  const email = getSession();
  if (!email) { window.location.href = 'login.html'; return; }

  const userId = emailToId(email);
  const userRef = doc(db, 'users', userId);
  const snap = await getDoc(userRef);

  if (!snap.exists()) { window.location.href = 'profile.html'; return; }

  currentUser = {
    email,
    id: userId,
    displayName: snap.data().username || email.split('@')[0],
    avatar: snap.data().avatar || 'images/default-profile.png',
    status: snap.data().status || 'Hey there! I\'m using FastLine.'
  };

  // Update online status
  await updateDoc(userRef, { online: true, lastSeen: serverTimestamp() });
  window.addEventListener('beforeunload', () => {
    updateDoc(userRef, { online: false, lastSeen: serverTimestamp() });
  });

  renderSidebarUser();
  listenConversations();
  setupUI();
  updateView();
  applyTheme();
  ThemeManager.restore();
  requestNotificationPermission();

  // Handle ?action=new-chat from manifest shortcut
  if (location.search.includes('action=new-chat')) openNewChatModal();
}

// ════════════════════════════════════════════════════
// USER + SIDEBAR
// ════════════════════════════════════════════════════

function renderSidebarUser() {
  $('sidebarName').textContent = currentUser.displayName;
  $('sidebarStatus').textContent = 'Online';
  $('sidebarAvatar').src = currentUser.avatar;
  $('profileAvatarImg').src = currentUser.avatar;
  $('profileDisplayName').value = currentUser.displayName;
  $('profileStatusMsg').value = currentUser.status;
  $('profileEmail').textContent = currentUser.email;
}

// ════════════════════════════════════════════════════
// CONVERSATIONS LIST
// ════════════════════════════════════════════════════

function listenConversations() {
  const q = query(
    collection(db, 'conversations'),
    where('members', 'array-contains', currentUser.id),
    orderBy('updatedAt', 'desc')
  );
  convsUnsubscribe = onSnapshot(q, async snap => {
    const list = $('conversationList');
    list.innerHTML = '';
    if (snap.empty) { list.innerHTML = buildEmptyState(); return; }

    for (const d of snap.docs) {
      const data = d.data();
      const peerId = data.members.find(m => m !== currentUser.id);
      if (!peerId) continue;
      const peerSnap = await getDoc(doc(db, 'users', peerId));
      if (!peerSnap.exists()) continue;
      const peer = peerSnap.data();
      const item = buildConvItem(d.id, peer, data);
      list.appendChild(item);
    }
  });
}

function buildEmptyState() {
  return `<div class="empty-state" id="emptyChats">
    <div class="empty-icon"><i class="fas fa-comment-slash"></i></div>
    <p>No conversations yet</p>
    <span>Start a new chat to begin</span>
  </div>`;
}

function buildConvItem(convId, peer, data) {
  const el = document.createElement('div');
  el.className = 'conv-item' + (convId === activeChatId ? ' active' : '');
  el.dataset.convId = convId;

  const lastMsg = data.lastMessage || 'Start chatting…';
  const lastTime = data.updatedAt ? formatTime(data.updatedAt) : '';
  const unread = (data.unreadCount?.[currentUser.id] || 0);

  el.innerHTML = `
    <div class="conv-avatar-wrap">
      <img class="conv-avatar" src="${peer.avatar || 'images/default-profile.png'}" alt="${peer.username || 'User'}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(peer.username||'U')}&background=00BFFF&color=000'" />
      ${peer.online ? '<span class="conv-online"></span>' : ''}
    </div>
    <div class="conv-body">
      <div class="conv-name">${peer.username || peer.email || 'Unknown'}</div>
      <div class="conv-last">${escapeHtml(lastMsg.substring(0, 50))}</div>
    </div>
    <div class="conv-meta">
      <span class="conv-time">${lastTime}</span>
      ${unread > 0 ? `<span class="conv-badge">${unread > 9 ? '9+' : unread}</span>` : ''}
    </div>
  `;

  el.addEventListener('click', () => openChat(convId, peer));
  return el;
}

// ════════════════════════════════════════════════════
// OPEN CHAT
// ════════════════════════════════════════════════════

async function openChat(convId, peer) {
  activeChatId = convId;
  activePeer   = peer;

  await updateDoc(doc(db, 'conversations', convId), {
    [`unreadCount.${currentUser.id}`]: 0
  });

  updateView();

  $('chatPeerName').textContent  = peer.username || peer.email || 'User';
  $('chatPeerAvatar').src        = peer.avatar || 'images/default-profile.png';
  $('chatPeerStatus').textContent = peer.online ? 'Online' : 'Offline';
  $('chatPeerStatus').className  = 'peer-status' + (peer.online ? ' online' : '');

  document.querySelectorAll('.conv-item').forEach(el => {
    el.classList.toggle('active', el.dataset.convId === convId);
  });

  $('sidebar').classList.remove('open');

  // Typing indicator
  if (window._typingIndicator) window._typingIndicator.destroy();
  window._typingIndicator = new TypingIndicator(
    db, convId, currentUser.id,
    peer.username || 'User',
    $('typingIndicator'), $('typingName')
  );
  window._typingIndicator.listen();

  // Wire typing on input
  $('msgInput').oninput = () => {
    window._typingIndicator?.userTyping();
    // Smart replies: hide when user types
    $('smartRepliesBar').classList.add('hidden');
  };

  // Swipe-to-reply
  enableSwipeToReply($('messagesArea'), (target) => {
    replyTarget = { id: target.id, text: target.text, senderName: target.senderName || peer.username };
    $('replyAuthor').textContent = replyTarget.senderName;
    $('replyText').textContent   = replyTarget.text || '[media]';
    $('replyPreview').classList.remove('hidden');
    $('msgInput').focus();
  });

  if (msgUnsubscribe) msgUnsubscribe();
  listenMessages(convId);

  onSnapshot(doc(db, 'users', peer.id || emailToId(peer.email)), peerSnap => {
    if (!peerSnap.exists()) return;
    const d = peerSnap.data();
    $('chatPeerStatus').textContent = d.online ? 'Online' : 'Last seen ' + (d.lastSeen ? formatTime(d.lastSeen) : 'recently');
    $('chatPeerStatus').className = 'peer-status' + (d.online ? ' online' : '');
    $('peerOnlineDot').style.display = d.online ? 'block' : 'none';
  });
}

// ════════════════════════════════════════════════════
// MESSAGES — Real-time listener
// ════════════════════════════════════════════════════

function listenMessages(convId) {
  const q = query(
    collection(db, 'conversations', convId, 'messages'),
    orderBy('timestamp', 'asc'),
    limit(100)
  );

  msgUnsubscribe = onSnapshot(q, snap => {
    const area = $('messagesArea');
    const wasAtBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 60;

    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        renderMessage(change.doc.id, change.doc.data(), area);
        const msgData = change.doc.data();
        // Mark as read if from peer
        if (msgData.senderId !== currentUser.id) {
          updateDoc(doc(db, 'conversations', convId, 'messages', change.doc.id), { status: 'read' });
          // Show smart replies
          if (msgData.type === 'text' && msgData.text) {
            const replies = generateSmartReplies(msgData.text);
            const bar = $('smartRepliesBar');
            renderSmartReplies(bar, replies, (reply) => {
              $('msgInput').textContent = reply;
              bar.classList.add('hidden');
              sendMessage();
            });
            bar.classList.remove('hidden');
          }
          // Local push notification if app not focused
          sendLocalNotification(
            activePeer?.username || 'FastLine',
            msgData.text || '[media]',
            activePeer?.avatar || 'images/icon-192.png'
          );
        }
      } else if (change.type === 'modified') {
        const existing = area.querySelector(`[data-msg-id="${change.doc.id}"]`);
        if (existing) {
          const newEl = createMessageEl(change.doc.id, change.doc.data());
          existing.replaceWith(newEl);
        }
      } else if (change.type === 'removed') {
        const existing = area.querySelector(`[data-msg-id="${change.doc.id}"]`);
        if (existing) existing.remove();
      }
    });

    if (wasAtBottom) area.scrollTop = area.scrollHeight;
  });
}

function renderMessage(msgId, data, container) {
  const el = createMessageEl(msgId, data);
  container.appendChild(el);
}

function createMessageEl(msgId, data) {
  const isSent = data.senderId === currentUser.id;
  const group = document.createElement('div');
  group.className = `msg-group ${isSent ? 'sent' : 'received'}`;
  group.dataset.msgId = msgId;

  const wrap = document.createElement('div');
  wrap.className = 'msg-bubble-wrap';

  if (!isSent) {
    const avatar = document.createElement('img');
    avatar.className = 'msg-bubble-avatar';
    avatar.src = activePeer?.avatar || 'images/default-profile.png';
    avatar.onerror = () => avatar.src = 'https://ui-avatars.com/api/?name=U&background=00BFFF&color=000';
    wrap.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';

  // Reply quote
  if (data.replyTo) {
    const quote = document.createElement('div');
    quote.className = 'reply-quote';
    quote.innerHTML = `<div class="reply-quote-author">${data.replyTo.senderName}</div>${escapeHtml(data.replyTo.text || '')}`;
    bubble.appendChild(quote);
  }

  // Content
  if (data.type === 'text') {
    const textNode = document.createElement('span');
    textNode.textContent = data.text || '';
    // Ticks
    if (isSent) {
      const ticks = document.createElement('span');
      ticks.className = 'msg-ticks';
      if (data.status === 'read')      ticks.innerHTML = '<i class="fas fa-check-double tick-read"></i>';
      else if (data.status === 'delivered') ticks.innerHTML = '<i class="fas fa-check-double tick-delivered"></i>';
      else                              ticks.innerHTML = '<i class="fas fa-check tick-sent"></i>';
      textNode.appendChild(document.createTextNode(' '));
      textNode.appendChild(ticks);
    }
    bubble.appendChild(textNode);
  } else if (data.type === 'image') {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'img-attach';
    imgWrap.innerHTML = `<img src="${data.url}" alt="Image" loading="lazy" />`;
    imgWrap.querySelector('img').addEventListener('click', () => window.open(data.url, '_blank'));
    bubble.appendChild(imgWrap);
    if (data.text) { const cap = document.createElement('div'); cap.textContent = data.text; bubble.appendChild(cap); }
  } else if (data.type === 'voice') {
    bubble.innerHTML += buildVoiceNote(data.url, data.duration);
  } else if (data.type === 'file') {
    bubble.innerHTML += `<div class="file-attach"><i class="fas fa-file-alt"></i><div class="file-info"><div class="file-name">${escapeHtml(data.fileName || 'File')}</div><div class="file-size">${data.fileSize || ''}</div></div><a href="${data.url}" target="_blank" style="margin-left:auto;color:var(--accent);font-size:.85rem"><i class="fas fa-download"></i></a></div>`;
  }

  // Reactions
  if (data.reactions && Object.keys(data.reactions).length > 0) {
    const reactionDiv = document.createElement('div');
    reactionDiv.className = 'msg-reactions';
    const counts = {};
    Object.values(data.reactions).forEach(e => { counts[e] = (counts[e] || 0) + 1; });
    Object.entries(counts).forEach(([emoji, count]) => {
      reactionDiv.innerHTML += `<span class="reaction-badge">${emoji}${count > 1 ? ' ' + count : ''}</span>`;
    });
    bubble.appendChild(reactionDiv);
  }

  // Context menu trigger
  bubble.addEventListener('contextmenu', e => { e.preventDefault(); showContextMenu(e, msgId, data); });
  bubble.addEventListener('touchstart', (() => {
    let timer;
    return e => { timer = setTimeout(() => showContextMenu(e, msgId, data), 500); };
  })());

  wrap.appendChild(bubble);
  group.appendChild(wrap);

  // Timestamp
  const timeDiv = document.createElement('div');
  timeDiv.className = 'msg-time';
  timeDiv.textContent = formatChatTime(data.timestamp);
  group.appendChild(timeDiv);

  return group;
}

function buildVoiceNote(url, duration) {
  return `<div class="voice-note">
    <button class="voice-play-btn" onclick="playVoice(this,'${url}')"><i class="fas fa-play"></i></button>
    <svg class="voice-waveform" viewBox="0 0 120 28" preserveAspectRatio="none">
      ${Array.from({length:20},(_,i)=>`<rect x="${i*6+2}" y="${14-Math.random()*10}" width="3" height="${5+Math.random()*14}" rx="1.5" fill="rgba(255,255,255,0.6)"/>`).join('')}
    </svg>
    <span class="voice-duration">${duration || '0:00'}</span>
  </div>`;
}

window.playVoice = function(btn, url) {
  const audio = new Audio(url);
  audio.play();
  btn.innerHTML = '<i class="fas fa-pause"></i>';
  audio.onended = () => btn.innerHTML = '<i class="fas fa-play"></i>';
};

// ════════════════════════════════════════════════════
// SEND MESSAGE
// ════════════════════════════════════════════════════

async function sendMessage(type = 'text', extraData = {}) {
  if (!activeChatId || !currentUser) return;

  const text = ($('msgInput').textContent || '').trim();
  if (type === 'text' && !text) return;

  $('msgInput').textContent = '';

  const msgData = {
    senderId: currentUser.id,
    senderName: currentUser.displayName,
    type,
    text: type === 'text' ? text : (extraData.caption || ''),
    timestamp: serverTimestamp(),
    status: 'sent',
    ...extraData
  };

  if (replyTarget) {
    msgData.replyTo = {
      msgId: replyTarget.id,
      text: replyTarget.text,
      senderName: replyTarget.senderName
    };
    clearReply();
  }

  try {
    await addDoc(collection(db, 'conversations', activeChatId, 'messages'), msgData);
    await updateDoc(doc(db, 'conversations', activeChatId), {
      lastMessage: type === 'text' ? text : `[${type}]`,
      updatedAt: serverTimestamp(),
      [`unreadCount.${activePeer?.id || ''}`]: (await getUnread()) + 1
    });
  } catch (e) {
    toast('Failed to send: ' + e.message, 'var(--error)');
  }
}

async function getUnread() {
  try {
    const snap = await getDoc(doc(db, 'conversations', activeChatId));
    return snap.data()?.unreadCount?.[activePeer?.id || ''] || 0;
  } catch { return 0; }
}

// ════════════════════════════════════════════════════
// CONTEXT MENU
// ════════════════════════════════════════════════════

function showContextMenu(e, msgId, data) {
  contextTarget = { id: msgId, data };
  const menu = $('contextMenu');
  menu.classList.remove('hidden');
  const x = Math.min(e.clientX || e.touches?.[0]?.clientX || 100, window.innerWidth - 180);
  const y = Math.min(e.clientY || e.touches?.[0]?.clientY || 100, window.innerHeight - 200);
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
  // Hide edit/delete if not own msg
  menu.querySelectorAll('[data-action="edit"],[data-action="delete"]').forEach(el => {
    el.style.display = (data.senderId !== currentUser.id) ? 'none' : 'flex';
  });
}

document.addEventListener('click', () => {
  $('contextMenu').classList.add('hidden');
  $('reactionPicker').classList.add('hidden');
});

$('contextMenu').addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]');
  if (!btn || !contextTarget) return;
  const { id, data } = contextTarget;

  switch (btn.dataset.action) {
    case 'reply':
      replyTarget = { id, text: data.text, senderName: data.senderName };
      $('replyAuthor').textContent = data.senderName;
      $('replyText').textContent   = data.text || '[media]';
      $('replyPreview').classList.remove('hidden');
      $('msgInput').focus();
      break;

    case 'react':
      showReactionPicker(e, id);
      break;

    case 'copy':
      if (data.text) { navigator.clipboard.writeText(data.text).then(() => toast('Copied!')); }
      break;

    case 'edit':
      if (data.senderId === currentUser.id && data.type === 'text') {
        const newText = prompt('Edit message:', data.text);
        if (newText !== null && newText.trim()) {
          await updateDoc(doc(db, 'conversations', activeChatId, 'messages', id), { text: newText.trim(), edited: true });
        }
      }
      break;

    case 'delete':
      if (data.senderId === currentUser.id) {
        await deleteDoc(doc(db, 'conversations', activeChatId, 'messages', id));
        toast('Message deleted');
      }
      break;
  }
});

function showReactionPicker(e, msgId) {
  const picker = $('reactionPicker');
  picker.classList.remove('hidden');
  picker.style.left = Math.min(e.clientX, window.innerWidth - 280) + 'px';
  picker.style.top  = (e.clientY - 70) + 'px';
  picker.dataset.msgId = msgId;
}

$('reactionPicker').addEventListener('click', async e => {
  const opt = e.target.closest('.reaction-opt');
  if (!opt || !activeChatId) return;
  const msgId = $('reactionPicker').dataset.msgId;
  await updateDoc(doc(db, 'conversations', activeChatId, 'messages', msgId), {
    [`reactions.${currentUser.id}`]: opt.dataset.emoji
  });
  $('reactionPicker').classList.add('hidden');
});

// ════════════════════════════════════════════════════
// REPLY
// ════════════════════════════════════════════════════

function clearReply() {
  replyTarget = null;
  $('replyPreview').classList.add('hidden');
}

$('closeReply').addEventListener('click', clearReply);

// ════════════════════════════════════════════════════
// FILE UPLOAD
// ════════════════════════════════════════════════════

$('attachBtn').addEventListener('click', () => $('fileInput').click());

$('fileInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file || !activeChatId) return;
  toast('Uploading…');
  try {
    const path = `chats/${activeChatId}/${Date.now()}_${file.name}`;
    const sRef = storageRef(storage, path);
    await uploadBytes(sRef, file);
    const url = await getDownloadURL(sRef);
    const isImage = file.type.startsWith('image/');
    await sendMessage(isImage ? 'image' : 'file', {
      url, fileName: file.name, fileSize: formatBytes(file.size)
    });
  } catch (err) { toast('Upload failed: ' + err.message, 'var(--error)'); }
  $('fileInput').value = '';
});

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}

// ════════════════════════════════════════════════════
// VOICE RECORDING
// ════════════════════════════════════════════════════

let recSeconds = 0;

$('voiceRecordBtn').addEventListener('click', async () => {
  if (!activeChatId) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    recSeconds = 0;
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.start();
    $('voiceRecordingBar').classList.remove('hidden');
    $('inputArea') && ($('inputArea').style.display = 'none');
    recInterval = setInterval(() => {
      recSeconds++;
      const m = Math.floor(recSeconds / 60), s = recSeconds % 60;
      $('recTimer').textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
    }, 1000);
  } catch { toast('Microphone access denied', 'var(--error)'); }
});

$('cancelRecBtn').addEventListener('click', () => {
  mediaRecorder?.stop();
  audioChunks = [];
  clearInterval(recInterval);
  $('voiceRecordingBar').classList.add('hidden');
});

$('sendRecBtn').addEventListener('click', async () => {
  if (!mediaRecorder) return;
  mediaRecorder.stop();
  clearInterval(recInterval);
  const duration = `0:${recSeconds < 10 ? '0' : ''}${recSeconds}`;
  mediaRecorder.onstop = async () => {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    const path = `voice/${activeChatId}/${Date.now()}.webm`;
    try {
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, blob);
      const url = await getDownloadURL(sRef);
      await sendMessage('voice', { url, duration });
    } catch (err) { toast('Voice send failed', 'var(--error)'); }
    $('voiceRecordingBar').classList.add('hidden');
    audioChunks = [];
  };
});

// ════════════════════════════════════════════════════
// NEW CHAT / USER SEARCH
// ════════════════════════════════════════════════════

function openNewChatModal() {
  $('newChatModal').classList.remove('hidden');
  $('userSearchInput').focus();
  // Load all users immediately
  loadAllUsers();
}

async function loadAllUsers(filter = '') {
  const results = $('userSearchResults');
  results.innerHTML = '<div class="search-hint"><i class="fas fa-spinner fa-spin"></i> Loading users…</div>';
  try {
    const snap = await getDocs(query(collection(db, 'users'), limit(50)));
    let users = snap.docs.filter(d => d.id !== currentUser.id).map(d => ({ id: d.id, ...d.data() }));
    if (filter) {
      const q = filter.toLowerCase();
      users = users.filter(u =>
        (u.username || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q)
      );
    }
    if (users.length === 0) {
      results.innerHTML = '<div class="search-hint"><i class="fas fa-info-circle"></i> No users found</div>';
      return;
    }
    results.innerHTML = '';
    users.slice(0, 20).forEach(data => {
      const el = document.createElement('div');
      el.className = 'user-result-item';
      el.innerHTML = `
        <img src="${data.avatar || 'default-profile.png'}" alt="${data.username}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(data.username||'U')}&background=00BFFF&color=000'" />
        <div class="user-result-info">
          <div class="result-name">${escapeHtml(data.username || 'User')}</div>
          <div class="result-email">${escapeHtml(data.email || '')}</div>
        </div>
        <button class="start-chat-btn">Chat</button>
      `;
      el.querySelector('.start-chat-btn').addEventListener('click', () => startChatWith(data.id, data));
      results.appendChild(el);
    });
  } catch (err) {
    results.innerHTML = `<div class="search-hint">Error: ${err.message}</div>`;
  }
}

$('userSearchInput').addEventListener('input', debounce(() => {
  const q = $('userSearchInput').value.trim();
  loadAllUsers(q);
}, 400));

async function startChatWith(peerId, peerData) {
  // Find or create conversation
  const members = [currentUser.id, peerId].sort();
  const convId = members.join('_');
  const convRef = doc(db, 'conversations', convId);
  const snap = await getDoc(convRef);
  if (!snap.exists()) {
    await setDoc(convRef, {
      members,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: '',
      unreadCount: {}
    });
  }
  $('newChatModal').classList.add('hidden');
  openChat(convId, { ...peerData, id: peerId });
}

// ════════════════════════════════════════════════════
// EMOJI PICKER
// ════════════════════════════════════════════════════

const EMOJIS = ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','😘','🥰','😗','😙','😚','🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','😷','🤒','🤕','🤢','🤠','😈','👿','💀','💩','🤡','👹','👺','👻','👽','👾','🤖','🦊','🐶','🐱','🐭','🐹','🐼','🐻','🦁','🐯','🐨','😸','😹','😺','😻','😼','😽','🙀','😿','😾','🙈','🙉','🙊','❤️','🧡','💛','💚','💙','💜','🖤','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','🔥','✨','🌟','⭐','🌙','☀️','🌈','☁️','⚡','❄️','🌸','🌺','🌻','🌹','🍀','🎉','🎊','🎁','🎈','🎶','🎵','🎤','🎧','🎮','🏆','🥇','⚽','🏀','🍕','🍔','🍟','🌮','🍜','🍣','🍰','☕','🍺','🥂','👍','👎','👏','🙌','🤝','🤜','✌️','🤞','👋','🤚','✋','🖐','🖖','👌','🤌','🤏','👈','👉','👆','👇','☝️','🫵','💪','🦾','🦵','🦶','👁','👅','💋','💅','🧠','👫','👭','👬','🧑‍🤝‍🧑','💏','💑','👨‍👩‍👦','🏠','🏡','🌆','🌇','🌃','🌌','🌉','🏖','🏝','🗺','✈️','🚀','🛸','🚁','🚗','🏎','🛻','🚌','🚢','🛥','🏄'];

function buildEmojiGrid(filter = '') {
  const grid = $('emojiGrid');
  const list = filter ? EMOJIS.filter(e => e.includes(filter)) : EMOJIS;
  grid.innerHTML = list.slice(0, 120).map(e => `<span title="${e}">${e}</span>`).join('');
  grid.querySelectorAll('span').forEach(el => {
    el.addEventListener('click', () => {
      const inp = $('msgInput');
      inp.focus();
      const sel = window.getSelection();
      const range = sel.getRangeAt(0);
      range.insertNode(document.createTextNode(el.textContent));
      range.collapse(false);
      $('emojiPicker').classList.add('hidden');
    });
  });
}

$('emojiBtn').addEventListener('click', e => {
  e.stopPropagation();
  const picker = $('emojiPicker');
  picker.classList.toggle('hidden');
  if (!picker.classList.contains('hidden')) buildEmojiGrid();
});

$('emojiSearch').addEventListener('input', () => buildEmojiGrid($('emojiSearch').value));

// ════════════════════════════════════════════════════
// VIDEO CALL (WebRTC)
// ════════════════════════════════════════════════════

// ════════════════════════════════════════════════════
// VIDEO CALL (WebRTC via components/video-call.js)
// ════════════════════════════════════════════════════

let activeCall = null;
const callTimer = new CallTimer($('callStatus'));

async function initiateCall(videoEnabled = true) {
  if (!activePeer) return;
  $('callPeerName').textContent = activePeer.username || 'User';
  $('callStatus').textContent   = 'Connecting…';
  $('videoCallModal').classList.remove('hidden');

  try {
    const localStream = await navigator.mediaDevices.getUserMedia({ video: videoEnabled, audio: true });
    $('localVideo').srcObject = localStream;

    activeCall = new WebRTCCall(
      db, activeChatId, currentUser.id,
      $('localVideo'), $('remoteVideo'),
      (status) => {
        $('callStatus').textContent = status;
        if (status === 'Connected') callTimer.start();
      },
      () => {
        $('videoCallModal').classList.add('hidden');
        callTimer.stop();
        activeCall = null;
      }
    );
    await activeCall.startCall(videoEnabled);
  } catch (err) {
    toast('Could not start call: ' + err.message, 'var(--error)');
    $('videoCallModal').classList.add('hidden');
  }
}

$('videoCallBtn').addEventListener('click', () => initiateCall(true));
$('voiceCallBtn').addEventListener('click', () => initiateCall(false));

$('endCallBtn').addEventListener('click', () => {
  activeCall ? activeCall.endCall() : (($('videoCallModal').classList.add('hidden')), callTimer.stop());
  if ($('localVideo').srcObject)  $('localVideo').srcObject.getTracks().forEach(t => t.stop());
  if ($('remoteVideo').srcObject) $('remoteVideo').srcObject.getTracks().forEach(t => t.stop());
  activeCall = null;
});

$('muteBtn').addEventListener('click', () => {
  if (activeCall) {
    const muted = activeCall.toggleMute();
    $('muteBtn').innerHTML = muted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
  } else {
    const stream = $('localVideo').srcObject;
    if (!stream) return;
    stream.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    $('muteBtn').innerHTML = stream.getAudioTracks()[0]?.enabled
      ? '<i class="fas fa-microphone"></i>'
      : '<i class="fas fa-microphone-slash"></i>';
  }
});

$('camBtn').addEventListener('click', () => {
  if (activeCall) {
    const off = activeCall.toggleCamera();
    $('camBtn').innerHTML = off ? '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>';
  } else {
    const stream = $('localVideo').srcObject;
    if (!stream) return;
    stream.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
    $('camBtn').innerHTML = stream.getVideoTracks()[0]?.enabled
      ? '<i class="fas fa-video"></i>'
      : '<i class="fas fa-video-slash"></i>';
  }
});

// ════════════════════════════════════════════════════
// PROFILE
// ════════════════════════════════════════════════════

$('avatarUploadBtn').addEventListener('click', () => $('avatarInput').click());
$('profileThumb').addEventListener('click', () => { $('profileModal').classList.remove('hidden'); });

$('avatarInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  toast('Uploading avatar…');
  try {
    const sRef = storageRef(storage, `avatars/${currentUser.id}`);
    await uploadBytes(sRef, file);
    const url = await getDownloadURL(sRef);
    $('profileAvatarImg').src = url;
    $('sidebarAvatar').src = url;
    currentUser.avatar = url;
    await updateDoc(doc(db, 'users', currentUser.id), { avatar: url });
    toast('Avatar updated!');
  } catch (err) { toast('Upload failed', 'var(--error)'); }
  $('avatarInput').value = '';
});

$('saveProfileBtn').addEventListener('click', async () => {
  const name   = $('profileDisplayName').value.trim();
  const status = $('profileStatusMsg').value.trim();
  if (!name) { toast('Display name required', 'var(--error)'); return; }
  try {
    if (await isUsernameTaken(name, currentUser.id)) {
      toast('Username already taken. Choose another.', 'var(--error)');
      return;
    }
    await updateDoc(doc(db, 'users', currentUser.id), { username: name, usernameLower: normalizeUsername(name), status });
    currentUser.displayName = name; currentUser.status = status;
    $('sidebarName').textContent = name;
    toast('Profile saved!');
    $('profileModal').classList.add('hidden');
  } catch (err) { toast('Save failed: ' + err.message, 'var(--error)'); }
});

// ════════════════════════════════════════════════════
// THEME
// ════════════════════════════════════════════════════

function applyTheme() {
  const isLight = localStorage.getItem('fastline_theme') === 'light';
  const themeName = isLight ? 'light' : 'cyberpunk';
  ThemeManager.apply(themeName);
  document.body.classList.toggle('dark-mode', !isLight);
  document.body.classList.toggle('light-mode', isLight);
  $('themeIcon').className = isLight ? 'fas fa-sun' : 'fas fa-moon';
}

$('themeToggleBtn').addEventListener('click', () => {
  const isNowLight = document.body.classList.contains('dark-mode');
  localStorage.setItem('fastline_theme', isNowLight ? 'light' : 'dark');
  applyTheme();
});

// ════════════════════════════════════════════════════
// VIEW MANAGEMENT
// ════════════════════════════════════════════════════

function updateView() {
  // Hide all main views
  $('welcomeScreen').classList.add('hidden');
  $('chatWindow').classList.add('hidden');
  $('groupsView').classList.add('hidden');
  $('statusView').classList.add('hidden');

  // Show conversation list only for chats
  $('conversationList').style.display = currentTab === 'chats' ? '' : 'none';

  if (currentTab === 'chats') {
    if (activeChatId) {
      $('chatWindow').classList.remove('hidden');
    } else {
      $('welcomeScreen').classList.remove('hidden');
    }
  } else if (currentTab === 'groups') {
    $('groupsView').classList.remove('hidden');
  } else if (currentTab === 'status') {
    $('statusView').classList.remove('hidden');
  }
}

// ════════════════════════════════════════════════════
// UI SETUP
// ════════════════════════════════════════════════════

function setupUI() {
  // Send on Enter (not Shift+Enter)
  $('msgInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  $('sendBtn').addEventListener('click', () => sendMessage());
  $('newChatBtn').addEventListener('click', openNewChatModal);
  $('welcomeNewChat').addEventListener('click', openNewChatModal);
  $('profileBtn').addEventListener('click', () => $('profileModal').classList.remove('hidden'));
  $('settingsBtn').addEventListener('click', () => $('settingsModal').classList.remove('hidden'));

  // Back button (mobile)
  $('backBtn').addEventListener('click', () => {
    activeChatId = null;
    activePeer = null;
    updateView();
    $('sidebar').classList.add('open');
  });

  // Close modals
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.modal)?.classList.add('hidden');
    });
  });

  // Close modal on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });

  // Nav tabs
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      updateView();
    });
  });

  // Sidebar hamburger on mobile (header logo click)
  $('sidebar').querySelector('.sidebar-logo').addEventListener('click', () => {
    $('sidebar').classList.toggle('open');
  });

  // Search conversations
  $('searchInput').addEventListener('input', () => {
    const q = $('searchInput').value.toLowerCase();
    document.querySelectorAll('.conv-item').forEach(el => {
      const name = el.querySelector('.conv-name')?.textContent.toLowerCase() || '';
      el.style.display = name.includes(q) ? '' : 'none';
    });
  });

  // Settings modal
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      ThemeManager.apply(theme);
      document.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Update localStorage for light/dark
      if (theme === 'light') {
        localStorage.setItem('fastline_theme', 'light');
      } else {
        localStorage.setItem('fastline_theme', 'dark');
      }
      applyTheme(); // To update icon and class
    });
  });

  // Set active theme option
  const currentTheme = localStorage.getItem('fastline_theme_name') || 'cyberpunk';
  document.querySelector(`.theme-option[data-theme="${currentTheme}"]`)?.classList.add('active');

  // Notifications toggle
  $('notifToggle').addEventListener('change', async () => {
    const enabled = $('notifToggle').checked;
    localStorage.setItem('fastline_notifications', enabled ? 'enabled' : 'disabled');
    if (enabled) {
      const result = await requestNotificationPermission();
      if (result === 'granted') {
        toast('Notifications enabled!');
      } else {
        toast('Notification permission denied', 'var(--error)');
        $('notifToggle').checked = false;
      }
    } else {
      toast('Notifications disabled');
    }
  });

  // Restore notification toggle state
  if (localStorage.getItem('fastline_notifications') === 'enabled') {
    $('notifToggle').checked = true;
  }

  $('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('fastline_session_email');
    localStorage.removeItem('fastline_session_expiry');
    window.location.href = 'login.html';
  });

  // Groups and Status buttons
  $('createGroupBtn').addEventListener('click', () => {
    toast('Group creation coming soon!', 'var(--accent2)');
  });

  $('addStatusBtn').addEventListener('click', () => {
    toast('Status updates coming soon!', 'var(--accent2)');
  });
}

// ════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

// ════════════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════════════

init().catch(err => {
  console.error('FastLine init error:', err);
  toast('Startup error: ' + err.message, 'var(--error)');
});
