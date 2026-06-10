// ════════════════════════════════════════════════════
//  FastLine Chats — app.js
//  Main application logic
// ════════════════════════════════════════════════════

import { app, db, storage } from './scripts/firebase-config.js';
import { TypingIndicator, enableSwipeToReply, generateSmartReplies, renderSmartReplies, shouldShowDateSep, formatDateSep, markMessagesRead, updateTabTitle, isMessageHiddenForUser, deleteMessageForMe, deleteMessageForEveryone, getSelectedTextInBubble } from './components/chat.js';
import { setOnlineStatus, sendLocalNotification, requestNotificationPermission, ThemeManager } from './components/profile.js';
import { WebRTCCall, showIncomingCallUI, CallTimer } from './components/video-call.js';
import { openImageCropper } from './components/image-cropper.js';
import { getSession, clearSession, emailToId, isProfileComplete } from './scripts/session.js';
import { navigateTo } from './scripts/nav.js';
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
const normalizeUsername = (value) => value.trim().toLowerCase();

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

let currentUser = null;        // { email, id, displayName, avatar, status, hiddenUsers }
let activeChatId = null;       // Current conversation ID
let activePeer = null;         // Peer user data
let msgUnsubscribe = null;     // Firestore realtime listener cleanup
let convsUnsubscribe = null;
let statusUnsubscribe = null;
let groupsUnsubscribe = null;
let incomingCallUnsubs = [];
let replyTarget = null;        // Message being replied to
let contextTarget = null;      // Message for context menu
let messageCache = new Map();  // msgId -> data for swipe reply meta
let lastMsgSnapshotKey = '';   // Detect new incoming messages for notifications
let groupSelectedMembers = []; // For group creation
let statusSelectedViewers = []; // For status audience picker
let statusAudience = 'all_contacts';
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
  if (!email) { navigateTo('login.html'); return; }

  const userId = emailToId(email);
  const userRef = doc(db, 'users', userId);
  const snap = await getDoc(userRef);

  if (!snap.exists()) { navigateTo('profile.html'); return; }
  if (!isProfileComplete(snap.data())) { navigateTo('profile.html'); return; }

  currentUser = {
    email,
    id: userId,
    displayName: snap.data().username || email.split('@')[0],
    avatar: snap.data().avatar || 'images/default-profile.png',
    status: snap.data().status || 'Hey there! I\'m using FastLine.',
    hiddenUsers: snap.data().hiddenUsers || []
  };

  // Update online status
  await updateDoc(userRef, { online: true, lastSeen: serverTimestamp() });
  window.addEventListener('beforeunload', () => {
    updateDoc(userRef, { online: false, lastSeen: serverTimestamp() });
  });

  renderSidebarUser();
  listenConversations();
  listenStatusUpdates();
  listenGroups();
  setupIncomingCalls();
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
  $('sidebarStatus').textContent = currentUser.status || 'Online';
  $('sidebarAvatar').src = currentUser.avatar;
  $('profileAvatarImg').src = currentUser.avatar;
  $('profileDisplayName').value = currentUser.displayName;
  $('profileStatusMsg').value = currentUser.status;
  $('profileEmail').textContent = currentUser.email;
  $('profileHeroName') && ($('profileHeroName').textContent = currentUser.displayName);

  const hasAvatar = !!(currentUser.avatar || '').trim();
  const fab = $('profileFab');
  const fabImg = $('profileFabImg');
  if (fab && fabImg) {
    fabImg.src = currentUser.avatar;
    fab.classList.toggle('hidden', !hasAvatar);
  }
}

async function getMyContactIds() {
  const snap = await getDocs(query(
    collection(db, 'conversations'),
    where('members', 'array-contains', currentUser.id)
  ));
  const ids = new Set();
  snap.docs.forEach(d => {
    const peerId = (d.data().members || []).find(m => m !== currentUser.id);
    if (peerId && !isUserHidden(peerId)) ids.add(peerId);
  });
  return [...ids];
}

function canViewStatus(statusData, viewerId) {
  if (!statusData) return false;
  if (statusData.userId === viewerId) return true;
  const audience = statusData.audience || 'all_contacts';
  if (audience === 'selected') {
    return (statusData.viewerIds || []).includes(viewerId);
  }
  return true;
}

function isRegisteredUser(user) {
  const hasUsername = !!(user?.username || '').trim();
  const hasAvatar = !!(user?.avatar || '').trim();
  return user?.profileCompleted === true || (hasUsername && hasAvatar);
}

function matchesUserSearch(user, filter) {
  if (!filter) return true;
  const q = filter.trim().toLowerCase();
  const username = (user.username || '').toLowerCase();
  const usernameLower = (user.usernameLower || normalizeUsername(user.username || '')).toLowerCase();
  return username.includes(q) || usernameLower.includes(q);
}

let loadUsersRequestId = 0;
let usersModalUnsub = null;

async function fetchRegisteredUsers() {
  const snap = await getDocs(query(collection(db, 'users')));
  return snap.docs
    .filter(d => d.id !== currentUser.id)
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(u => isRegisteredUser(u) && !isUserHidden(u.id))
    .sort((a, b) => (a.username || '').localeCompare(b.username || '', undefined, { sensitivity: 'base' }));
}

function isUserHidden(userId) {
  return (currentUser?.hiddenUsers || []).includes(userId);
}

async function refreshHiddenUsers() {
  const snap = await getDoc(doc(db, 'users', currentUser.id));
  if (snap.exists()) currentUser.hiddenUsers = snap.data().hiddenUsers || [];
  renderHiddenUsersList();
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
      if (isUserHidden(peerId)) continue;
      const peerSnap = await getDoc(doc(db, 'users', peerId));
      if (!peerSnap.exists()) continue;
      const peer = { ...peerSnap.data(), id: peerId };
      if (!isRegisteredUser(peer)) continue;
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
      <div class="conv-name">${escapeHtml(peer.username)}</div>
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
  activePeer   = { ...peer, id: peer.id || convId };
  lastMsgSnapshotKey = '';

  await updateDoc(doc(db, 'conversations', convId), {
    [`unreadCount.${currentUser.id}`]: 0
  });

  updateView();

  $('chatPeerName').textContent  = peer.username || 'User';
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

  // Swipe-to-reply (supports selected text)
  enableSwipeToReply($('messagesArea'), (target) => {
    replyTarget = { id: target.id, text: target.text, senderName: target.senderName || activePeer?.username || 'User' };
    $('replyAuthor').textContent = replyTarget.senderName;
    $('replyText').textContent   = replyTarget.text || '[media]';
    $('replyPreview').classList.remove('hidden');
    $('msgInput').focus();
  }, (msgId) => {
    const data = messageCache.get(msgId);
    return { senderName: data?.senderName || activePeer?.username };
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

    area.innerHTML = '';
    messageCache.clear();
    let prevData = null;

    snap.docs.forEach(docSnap => {
      const msgId = docSnap.id;
      const data = docSnap.data();
      if (isMessageHiddenForUser(data, currentUser.id)) return;

      messageCache.set(msgId, data);

      if (shouldShowDateSep(prevData, data)) {
        const sep = document.createElement('div');
        sep.className = 'date-separator';
        sep.innerHTML = `<span>${formatDateSep(data.timestamp)}</span>`;
        area.appendChild(sep);
      }

      renderMessage(msgId, data, area);
      prevData = data;

      if (data.senderId !== currentUser.id && data.status !== 'read') {
        updateDoc(doc(db, 'conversations', convId, 'messages', msgId), { status: 'read' });
      }
    });

    const snapKey = snap.docs.map(d => d.id).join(',');
    if (snapKey !== lastMsgSnapshotKey && lastMsgSnapshotKey) {
      const newDocs = snap.docs.filter(d => !lastMsgSnapshotKey.includes(d.id));
      newDocs.forEach(d => {
        const msgData = d.data();
        if (msgData.senderId !== currentUser.id && !isMessageHiddenForUser(msgData, currentUser.id)) {
          sendLocalNotification(
            activePeer?.username || 'FastLine',
            msgData.text || '[media]',
            activePeer?.avatar || 'images/icon-192.png'
          );
        }
      });
    }
    lastMsgSnapshotKey = snapKey;

    // Smart replies from last peer message
    const lastPeerMsg = [...snap.docs].reverse().map(d => d.data()).find(m =>
      m.senderId !== currentUser.id && m.type === 'text' && m.text && !isMessageHiddenForUser(m, currentUser.id)
    );
    const bar = $('smartRepliesBar');
    if (lastPeerMsg && activeChatId === convId) {
      const replies = generateSmartReplies(lastPeerMsg.text);
      renderSmartReplies(bar, replies, (reply) => {
        $('msgInput').textContent = reply;
        bar.classList.add('hidden');
        sendMessage();
      });
      bar.classList.remove('hidden');
    } else {
      bar.classList.add('hidden');
    }

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

  if (data.deletedForAll) {
    const wrap = document.createElement('div');
    wrap.className = 'msg-bubble-wrap';
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble msg-deleted';
    bubble.textContent = 'This message was deleted';
    wrap.appendChild(bubble);
    group.appendChild(wrap);
    return group;
  }

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
    quote.innerHTML = `<div class="reply-quote-author">${escapeHtml(data.replyTo.senderName)}</div>${escapeHtml(data.replyTo.text || '')}`;
    bubble.appendChild(quote);
  }

  // Content
  if (data.type === 'text') {
    const textNode = document.createElement('span');
    textNode.className = 'msg-text';
    textNode.textContent = data.text || '';
    bubble.appendChild(textNode);
    if (isSent) {
      const ticks = document.createElement('span');
      ticks.className = 'msg-ticks';
      if (data.status === 'read')      ticks.innerHTML = '<i class="fas fa-check-double tick-read"></i>';
      else if (data.status === 'delivered') ticks.innerHTML = '<i class="fas fa-check-double tick-delivered"></i>';
      else                              ticks.innerHTML = '<i class="fas fa-check tick-sent"></i>';
      bubble.appendChild(document.createTextNode(' '));
      bubble.appendChild(ticks);
    }
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
  const y = Math.min(e.clientY || e.touches?.[0]?.clientY || 100, window.innerHeight - 280);
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';

  const isOwn = data.senderId === currentUser.id;
  menu.querySelectorAll('[data-action="edit"]').forEach(el => {
    el.style.display = (isOwn && data.type === 'text' && !data.deletedForAll) ? 'flex' : 'none';
  });
  menu.querySelectorAll('[data-action="delete-all"]').forEach(el => {
    el.style.display = (isOwn && !data.deletedForAll) ? 'flex' : 'none';
  });
  menu.querySelectorAll('[data-action="delete-me"]').forEach(el => {
    el.style.display = data.deletedForAll ? 'none' : 'flex';
  });

  const bubbleEl = e.target?.closest?.('.msg-bubble') || document.querySelector(`[data-msg-id="${msgId}"] .msg-bubble`);
  const selected = bubbleEl ? getSelectedTextInBubble(bubbleEl) : null;
  const selBtn = $('ctxReplySelection');
  if (selected) {
    selBtn.classList.remove('hidden');
    selBtn.dataset.selectedText = selected;
  } else {
    selBtn.classList.add('hidden');
    delete selBtn.dataset.selectedText;
  }
}

document.addEventListener('click', () => {
  $('contextMenu').classList.add('hidden');
  $('reactionPicker').classList.add('hidden');
  $('chatDropdown')?.classList.add('hidden');
});

$('contextMenu').addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]');
  if (!btn || !contextTarget) return;
  const { id, data } = contextTarget;

  switch (btn.dataset.action) {
    case 'reply':
      replyTarget = { id, text: data.text, senderName: data.senderName || activePeer?.username };
      $('replyAuthor').textContent = replyTarget.senderName;
      $('replyText').textContent   = data.text || '[media]';
      $('replyPreview').classList.remove('hidden');
      $('msgInput').focus();
      break;

    case 'reply-selection': {
      const selected = $('ctxReplySelection').dataset.selectedText;
      replyTarget = { id, text: selected, senderName: data.senderName || activePeer?.username };
      $('replyAuthor').textContent = replyTarget.senderName;
      $('replyText').textContent   = selected;
      $('replyPreview').classList.remove('hidden');
      $('msgInput').focus();
      break;
    }

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

    case 'delete-me':
      await deleteMessageForMe(db, activeChatId, id, currentUser.id);
      toast('Message deleted for you');
      break;

    case 'delete-all':
      if (data.senderId === currentUser.id) {
        await deleteMessageForEveryone(db, activeChatId, id);
        toast('Message deleted for everyone');
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
  $('userSearchInput').value = '';
  $('userSearchInput').focus();
  loadAllUsers('');
  startUsersLiveRefresh();
}

function stopUsersLiveRefresh() {
  if (usersModalUnsub) {
    usersModalUnsub();
    usersModalUnsub = null;
  }
}

function startUsersLiveRefresh() {
  stopUsersLiveRefresh();
  usersModalUnsub = onSnapshot(query(collection(db, 'users')), () => {
    if (!$('newChatModal').classList.contains('hidden')) {
      loadAllUsers($('userSearchInput').value.trim(), { silent: true });
    }
  });
}

function renderUserResults(users, container) {
  container.innerHTML = '';
  users.slice(0, 50).forEach(data => {
    const el = document.createElement('div');
    el.className = 'user-result-item';
    el.innerHTML = `
      <div class="user-result-avatar-wrap">
        <img src="${data.avatar || 'default-profile.png'}" alt="${escapeHtml(data.username)}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(data.username||'U')}&background=00BFFF&color=000'" />
        ${data.online ? '<span class="user-result-online"></span>' : ''}
      </div>
      <div class="user-result-info">
        <div class="result-name">${escapeHtml(data.username)}</div>
        <div class="result-email">${escapeHtml(data.status || 'Available')}</div>
      </div>
      <button class="start-chat-btn"><i class="fas fa-comment"></i> Chat</button>
    `;
    el.querySelector('.start-chat-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      stopUsersLiveRefresh();
      startChatWith(data.id, data);
    });
    el.addEventListener('click', () => {
      stopUsersLiveRefresh();
      startChatWith(data.id, data);
    });
    container.appendChild(el);
  });
}

async function loadAllUsers(filter = '', opts = {}) {
  const reqId = ++loadUsersRequestId;
  const results = $('userSearchResults');
  const countEl = $('userSearchCount');

  if (!opts.silent) {
    results.innerHTML = '<div class="search-hint"><i class="fas fa-spinner fa-spin"></i> Loading users…</div>';
  }

  try {
    let users = await fetchRegisteredUsers();

    if (reqId !== loadUsersRequestId) return;

    if (filter) {
      users = users.filter(u => matchesUserSearch(u, filter));
    }

    if (countEl) {
      countEl.textContent = users.length
        ? `${users.length} registered user${users.length !== 1 ? 's' : ''}`
        : 'No matches';
    }

    if (users.length === 0) {
      results.innerHTML = filter
        ? `<div class="search-hint"><i class="fas fa-user-slash"></i> No users match "<strong>${escapeHtml(filter)}</strong>"<br><small>Try a different spelling or browse all users below</small></div>`
        : '<div class="search-hint"><i class="fas fa-info-circle"></i> No other registered users yet.<br><small>Ask friends to sign up and complete their profile.</small></div>';
      if (filter) {
        const allUsers = await fetchRegisteredUsers();
        if (reqId !== loadUsersRequestId) return;
        if (allUsers.length > 0) {
          const browse = document.createElement('div');
          browse.className = 'search-browse-all';
          browse.innerHTML = '<button type="button" class="btn-link" id="browseAllUsersBtn">Show all registered users</button>';
          results.appendChild(browse);
          browse.querySelector('#browseAllUsersBtn').addEventListener('click', () => {
            $('userSearchInput').value = '';
            loadAllUsers('');
          });
        }
      }
      return;
    }

    renderUserResults(users, results);
  } catch (err) {
    if (reqId !== loadUsersRequestId) return;
    results.innerHTML = `<div class="search-hint"><i class="fas fa-exclamation-circle"></i> Error: ${escapeHtml(err.message)}</div>`;
  }
}

$('userSearchInput').addEventListener('input', debounce(() => {
  loadAllUsers($('userSearchInput').value.trim());
}, 250));

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
  $('userSearchInput').value = '';
  stopUsersLiveRefresh();
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
  $('avatarInput').value = '';
  const blob = await openImageCropper(file, { shape: 'circle', size: 'medium' });
  if (!blob) return;
  toast('Uploading avatar…');
  try {
    const cropped = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
    const sRef = storageRef(storage, `avatars/${currentUser.id}`);
    await uploadBytes(sRef, cropped);
    const url = await getDownloadURL(sRef);
    $('profileAvatarImg').src = url;
    $('sidebarAvatar').src = url;
    currentUser.avatar = url;
    await updateDoc(doc(db, 'users', currentUser.id), { avatar: url, profileCompleted: true });
    toast('Avatar updated!');
  } catch (err) { toast('Upload failed', 'var(--error)'); }
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
    await updateDoc(doc(db, 'users', currentUser.id), {
      username: name,
      usernameLower: normalizeUsername(name),
      status,
      profileCompleted: !!(name && (currentUser.avatar || '').trim())
    });
    currentUser.displayName = name; currentUser.status = status;
    $('sidebarName').textContent = name;
    $('sidebarStatus').textContent = status || 'Online';
    toast('Profile saved!');
    $('profileModal').classList.add('hidden');
  } catch (err) { toast('Save failed: ' + err.message, 'var(--error)'); }
});

// ════════════════════════════════════════════════════
// THEME
// ════════════════════════════════════════════════════

function applyTheme() {
  const isLight = localStorage.getItem('fastline_theme') === 'light';
  const themeName = isLight ? 'light' : (localStorage.getItem('fastline_theme_name') || 'cyberpunk');
  ThemeManager.apply(themeName);
  document.body.classList.toggle('dark-mode', !isLight);
  document.body.classList.toggle('light-mode', isLight);
  $('themeIcon').className = isLight ? 'fas fa-sun' : 'fas fa-moon';
  syncAppearanceButtons(isLight);
}

function syncAppearanceButtons(isLight) {
  $('darkModeBtn')?.classList.toggle('active', !isLight);
  $('lightModeBtn')?.classList.toggle('active', isLight);
}

function setAppearanceMode(mode) {
  const isLight = mode === 'light';
  localStorage.setItem('fastline_theme', isLight ? 'light' : 'dark');
  if (isLight) {
    ThemeManager.apply('light');
    document.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
    document.querySelector('.theme-option[data-theme="light"]')?.classList.add('active');
  } else {
    const saved = localStorage.getItem('fastline_theme_name') || 'cyberpunk';
    ThemeManager.apply(saved);
    document.querySelectorAll('.theme-option').forEach(b => b.classList.toggle('active', b.dataset.theme === saved));
  }
  applyTheme();
}

$('themeToggleBtn').addEventListener('click', () => {
  const isLight = document.body.classList.contains('dark-mode');
  setAppearanceMode(isLight ? 'light' : 'dark');
});

// ════════════════════════════════════════════════════
// STATUS UPDATES (Stories)
// ════════════════════════════════════════════════════

function listenStatusUpdates() {
  statusUnsubscribe = onSnapshot(query(collection(db, 'statusUpdates')), async snap => {
    const list = $('statusList');
    const now = Date.now();
    const items = [];

    const myContacts = await getMyContactIds();

    for (const d of snap.docs) {
      const data = d.data();
      if (data.expiresAt && data.expiresAt < now) continue;
      if (isUserHidden(data.userId)) continue;
      if (!canViewStatus(data, currentUser.id)) continue;
      if (data.userId !== currentUser.id && !myContacts.includes(data.userId)) continue;

      const userSnap = await getDoc(doc(db, 'users', data.userId));
      if (!userSnap.exists() || !isRegisteredUser(userSnap.data())) continue;
      const user = userSnap.data();
      items.push({ id: d.id, ...data, user });
    }

    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (items.length === 0) {
      list.innerHTML = `<div class="empty-state">
        <div class="empty-icon"><i class="fas fa-circle-notch"></i></div>
        <p>No statuses yet</p>
        <span>Share your status with friends</span>
      </div>`;
      return;
    }

    list.innerHTML = '';
    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'status-item';
      el.innerHTML = `
        <div class="status-ring"><img src="${item.user.avatar || 'default-profile.png'}" alt="" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(item.user.username)}&background=00BFFF&color=000'" /></div>
        <div class="status-info">
          <div class="status-name">${escapeHtml(item.user.username)}</div>
          <div class="status-preview">${escapeHtml(item.text || (item.imageUrl ? '📷 Photo status' : ''))}</div>
          <div class="status-time">${formatTime(item.createdAt)}</div>
        </div>
      `;
      el.addEventListener('click', () => {
        if (item.imageUrl) window.open(item.imageUrl, '_blank');
        else toast(`${item.user.username}: ${item.text}`);
      });
      list.appendChild(el);
    });
  });
}

async function postStatus() {
  const text = $('statusTextInput').value.trim();
  const imageFile = $('statusImageInput').files[0];
  if (!text && !imageFile) { toast('Add text or a photo', 'var(--error)'); return; }

  if (statusAudience === 'selected' && statusSelectedViewers.length === 0) {
    toast('Select at least one person to share with', 'var(--error)');
    return;
  }

  let imageUrl = null;
  if (imageFile) {
    const path = `status/${currentUser.id}/${Date.now()}_${imageFile.name}`;
    const sRef = storageRef(storage, path);
    await uploadBytes(sRef, imageFile);
    imageUrl = await getDownloadURL(sRef);
  }

  await addDoc(collection(db, 'statusUpdates'), {
    userId: currentUser.id,
    text: text || '',
    imageUrl,
    audience: statusAudience,
    viewerIds: statusAudience === 'selected' ? statusSelectedViewers.map(v => v.id) : [],
    createdAt: serverTimestamp(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000
  });

  const viewerCount = statusSelectedViewers.length;
  const audience = statusAudience;

  $('statusTextInput').value = '';
  $('statusImageInput').value = '';
  statusSelectedViewers = [];
  renderStatusViewerChips();
  $('addStatusModal').classList.add('hidden');
  toast(audience === 'all_contacts' ? 'Status shared with all contacts!' : `Status shared with ${viewerCount} people!`);
}

function renderStatusViewerChips() {
  const chips = $('statusViewerChips');
  if (!chips) return;
  chips.innerHTML = statusSelectedViewers.map(v => `
    <span class="member-chip">${escapeHtml(v.username)}<button type="button" data-id="${v.id}">&times;</button></span>
  `).join('');
  chips.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      statusSelectedViewers = statusSelectedViewers.filter(v => v.id !== btn.dataset.id);
      renderStatusViewerChips();
      loadStatusViewerSearch($('statusViewerSearch')?.value?.trim() || '');
    });
  });
}

async function loadStatusViewerSearch(filter = '') {
  const results = $('statusViewerResults');
  if (!results) return;
  const contactIds = await getMyContactIds();
  if (contactIds.length === 0) {
    results.innerHTML = '<div class="search-hint">No contacts yet. Start a chat first.</div>';
    return;
  }

  const users = [];
  for (const id of contactIds) {
    const snap = await getDoc(doc(db, 'users', id));
    if (snap.exists() && isRegisteredUser(snap.data())) {
      users.push({ id, ...snap.data() });
    }
  }

  let filtered = users.filter(u => !statusSelectedViewers.some(s => s.id === u.id));
  if (filter) filtered = filtered.filter(u => matchesUserSearch(u, filter));

  if (filtered.length === 0) {
    results.innerHTML = '<div class="search-hint">No contacts match</div>';
    return;
  }

  results.innerHTML = '';
  filtered.forEach(u => {
    const el = document.createElement('div');
    el.className = 'user-result-item';
    el.innerHTML = `
      <img src="${u.avatar || 'default-profile.png'}" alt="" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(u.username)}&background=00BFFF&color=000'" />
      <div class="user-result-info"><div class="result-name">${escapeHtml(u.username)}</div></div>
      <button class="start-chat-btn"><i class="fas fa-plus"></i> Add</button>
    `;
    el.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!statusSelectedViewers.some(s => s.id === u.id)) {
        statusSelectedViewers.push({ id: u.id, username: u.username });
        renderStatusViewerChips();
        loadStatusViewerSearch(filter);
      }
    });
    results.appendChild(el);
  });
}

function setStatusAudience(mode) {
  statusAudience = mode;
  $('statusAudienceAll')?.classList.toggle('active', mode === 'all_contacts');
  $('statusAudienceSelected')?.classList.toggle('active', mode === 'selected');
  $('statusViewerPicker')?.classList.toggle('hidden', mode !== 'selected');
  if (mode === 'selected') loadStatusViewerSearch();
}

// ════════════════════════════════════════════════════
// GROUPS
// ════════════════════════════════════════════════════

function listenGroups() {
  const q = query(
    collection(db, 'groups'),
    where('members', 'array-contains', currentUser.id)
  );
  groupsUnsubscribe = onSnapshot(q, snap => {
    const list = $('groupsList');
    if (snap.empty) {
      list.innerHTML = `<div class="empty-state">
        <div class="empty-icon"><i class="fas fa-users"></i></div>
        <p>No groups yet</p>
        <span>Create your first group to get started</span>
      </div>`;
      return;
    }
    list.innerHTML = '';
    snap.docs.forEach(d => {
      const data = d.data();
      const el = document.createElement('div');
      el.className = 'group-item';
      el.innerHTML = `
        <div class="status-ring no-update"><i class="fas fa-users" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--accent);font-size:1.2rem;"></i></div>
        <div class="status-info">
          <div class="status-name">${escapeHtml(data.name)}</div>
          <div class="status-preview">${data.members.length} members</div>
        </div>
      `;
      el.addEventListener('click', () => openGroupChat(d.id, data));
      list.appendChild(el);
    });
  });
}

async function openGroupChat(groupId, groupData) {
  const convId = `group_${groupId}`;
  const convRef = doc(db, 'conversations', convId);
  const snap = await getDoc(convRef);
  if (!snap.exists()) {
    await setDoc(convRef, {
      members: groupData.members,
      type: 'group',
      groupId,
      groupName: groupData.name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: '',
      unreadCount: {}
    });
  }
  currentTab = 'chats';
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'chats'));
  openChat(convId, { id: groupId, username: groupData.name, avatar: '', isGroup: true });
}

function renderGroupMemberChips() {
  const chips = $('groupMemberChips');
  chips.innerHTML = groupSelectedMembers.map(m => `
    <span class="member-chip">${escapeHtml(m.username)}<button type="button" data-id="${m.id}">&times;</button></span>
  `).join('');
  chips.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      groupSelectedMembers = groupSelectedMembers.filter(m => m.id !== btn.dataset.id);
      renderGroupMemberChips();
    });
  });
}

async function loadGroupMemberSearch(filter = '') {
  const results = $('groupMemberResults');
  let users = await fetchRegisteredUsers();
  users = users.filter(u => !groupSelectedMembers.some(m => m.id === u.id));

  if (filter) {
    users = users.filter(u => matchesUserSearch(u, filter));
  }

  if (users.length === 0) {
    results.innerHTML = '<div class="search-hint">No registered users found</div>';
    return;
  }

  results.innerHTML = '';
  renderUserResults(users.slice(0, 15).map(u => ({
    ...u,
    status: u.status || 'Tap to add'
  })), results);

  results.querySelectorAll('.user-result-item').forEach(el => {
    const name = el.querySelector('.result-name')?.textContent;
    const user = users.find(u => u.username === name);
    if (!user) return;
    el.querySelector('.start-chat-btn').textContent = 'Add';
    el.querySelector('.start-chat-btn').innerHTML = '<i class="fas fa-plus"></i> Add';
    const addUser = () => {
      if (!groupSelectedMembers.some(m => m.id === user.id)) {
        groupSelectedMembers.push({ id: user.id, username: user.username });
        renderGroupMemberChips();
        loadGroupMemberSearch($('groupMemberSearch').value.trim());
      }
    };
    el.querySelector('.start-chat-btn').onclick = (e) => { e.stopPropagation(); addUser(); };
    el.onclick = addUser;
  });
}

async function createGroup() {
  const name = $('groupNameInput').value.trim();
  if (!name) { toast('Group name required', 'var(--error)'); return; }
  if (groupSelectedMembers.length === 0) { toast('Add at least one member', 'var(--error)'); return; }

  const members = [currentUser.id, ...groupSelectedMembers.map(m => m.id)];
  const groupRef = await addDoc(collection(db, 'groups'), {
    name,
    members,
    admin: currentUser.id,
    createdAt: serverTimestamp()
  });

  groupSelectedMembers = [];
  $('groupNameInput').value = '';
  renderGroupMemberChips();
  $('createGroupModal').classList.add('hidden');
  toast(`Group "${name}" created!`);
  openGroupChat(groupRef.id, { name, members });
}

// ════════════════════════════════════════════════════
// HIDE USERS & CHAT MENU
// ════════════════════════════════════════════════════

async function hideUser(userId) {
  const hidden = [...new Set([...(currentUser.hiddenUsers || []), userId])];
  await updateDoc(doc(db, 'users', currentUser.id), { hiddenUsers: hidden });
  currentUser.hiddenUsers = hidden;
  if (activePeer?.id === userId) {
    activeChatId = null;
    activePeer = null;
    updateView();
  }
  renderHiddenUsersList();
  toast('User hidden');
}

async function unhideUser(userId) {
  const hidden = (currentUser.hiddenUsers || []).filter(id => id !== userId);
  await updateDoc(doc(db, 'users', currentUser.id), { hiddenUsers: hidden });
  currentUser.hiddenUsers = hidden;
  renderHiddenUsersList();
  toast('User unhidden');
}

async function renderHiddenUsersList() {
  const list = $('hiddenUsersList');
  if (!list) return;
  const hidden = currentUser.hiddenUsers || [];
  if (hidden.length === 0) {
    list.innerHTML = '<p style="font-size:.8rem;color:var(--text-muted);">No hidden users</p>';
    return;
  }
  list.innerHTML = '';
  for (const uid of hidden) {
    const snap = await getDoc(doc(db, 'users', uid));
    const name = snap.exists() ? (snap.data().username || uid) : uid;
    const row = document.createElement('div');
    row.className = 'hidden-user-row';
    row.innerHTML = `<span>${escapeHtml(name)}</span><button type="button">Unhide</button>`;
    row.querySelector('button').addEventListener('click', () => unhideUser(uid));
    list.appendChild(row);
  }
}

async function clearChatForMe() {
  if (!activeChatId) return;
  const snap = await getDocs(collection(db, 'conversations', activeChatId, 'messages'));
  await Promise.allSettled(snap.docs.map(d =>
    deleteMessageForMe(db, activeChatId, d.id, currentUser.id)
  ));
  toast('Chat cleared for you');
}

function setupChatMenu() {
  $('chatMenuBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!activeChatId) return;
    if (activePeer?.isGroup) { toast('Group chat options coming soon'); return; }
    const menu = $('chatDropdown');
    menu.classList.remove('hidden');
    const rect = $('chatMenuBtn').getBoundingClientRect();
    menu.style.left = Math.min(rect.left, window.innerWidth - 220) + 'px';
    menu.style.top = (rect.bottom + 8) + 'px';
  });

  $('chatDropdown').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-chat-action]');
    if (!btn) return;
    $('chatDropdown').classList.add('hidden');

    switch (btn.dataset.chatAction) {
      case 'view-profile':
        if (activePeer) {
          $('profileModal').classList.add('hidden');
          toast(`${activePeer.username}: ${activePeer.status || 'No status'}`);
        }
        break;
      case 'search-chat':
        $('searchChatModal').classList.remove('hidden');
        $('chatSearchInput').focus();
        break;
      case 'mute': {
        const key = `fastline_mute_${activeChatId}`;
        const muted = localStorage.getItem(key) === '1';
        localStorage.setItem(key, muted ? '0' : '1');
        toast(muted ? 'Notifications unmuted' : 'Notifications muted');
        break;
      }
      case 'clear-chat':
        if (confirm('Clear all messages for you in this chat?')) await clearChatForMe();
        break;
      case 'hide-user':
        if (activePeer?.id && confirm(`Hide ${activePeer.username}?`)) await hideUser(activePeer.id);
        break;
    }
  });

  $('chatSearchInput')?.addEventListener('input', debounce(async () => {
    const q = $('chatSearchInput').value.trim().toLowerCase();
    const results = $('chatSearchResults');
    if (!q || !activeChatId) { results.innerHTML = ''; return; }
    const snap = await getDocs(collection(db, 'conversations', activeChatId, 'messages'));
    const matches = snap.docs.filter(d => {
      const data = d.data();
      return !isMessageHiddenForUser(data, currentUser.id) &&
        (data.text || '').toLowerCase().includes(q);
    });
    results.innerHTML = matches.length ? matches.map(d => {
      const data = d.data();
      return `<div class="user-result-item" style="cursor:pointer" data-msg-id="${d.id}">
        <div class="user-result-info">
          <div class="result-name">${escapeHtml(data.senderName || '')}</div>
          <div class="result-email">${escapeHtml((data.text || '').substring(0, 80))}</div>
        </div>
      </div>`;
    }).join('') : '<div class="search-hint">No matches</div>';
    results.querySelectorAll('[data-msg-id]').forEach(el => {
      el.addEventListener('click', () => {
        const target = document.querySelector(`[data-msg-id="${el.dataset.msgId}"]`);
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target?.classList.add('highlight-msg');
        setTimeout(() => target?.classList.remove('highlight-msg'), 2000);
        $('searchChatModal').classList.add('hidden');
      });
    });
  }, 300));
}

// ════════════════════════════════════════════════════
// INCOMING CALLS
// ════════════════════════════════════════════════════

async function setupIncomingCalls() {
  incomingCallUnsubs.forEach(u => u());
  incomingCallUnsubs = [];

  const convSnap = await getDocs(query(
    collection(db, 'conversations'),
    where('members', 'array-contains', currentUser.id)
  ));

  convSnap.docs.forEach(convDoc => {
    const unsub = onSnapshot(doc(db, 'conversations', convDoc.id), async snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (!data.activeCall || data.callHandledBy === currentUser.id) return;
      if (activeCall) return;

      const callSnap = await getDoc(doc(db, 'calls', data.activeCall));
      if (!callSnap.exists() || callSnap.data().ended) return;
      if (callSnap.data().callerId === currentUser.id) return;

      const callerSnap = await getDoc(doc(db, 'users', callSnap.data().callerId));
      const callerName = callerSnap.exists() ? callerSnap.data().username : 'Someone';

      showIncomingCallUI(callerName, async () => {
        await updateDoc(doc(db, 'conversations', convDoc.id), { callHandledBy: currentUser.id });
        const peerSnap = await getDoc(doc(db, 'users', callSnap.data().callerId));
        if (peerSnap.exists()) openChat(convDoc.id, { ...peerSnap.data(), id: callSnap.data().callerId });

        $('callPeerName').textContent = callerName;
        $('callStatus').textContent = 'Connecting…';
        $('videoCallModal').classList.remove('hidden');

        try {
          const videoEnabled = callSnap.data().video !== false;
          const localStream = await navigator.mediaDevices.getUserMedia({ video: videoEnabled, audio: true });
          $('localVideo').srcObject = localStream;

          activeCall = new WebRTCCall(
            db, convDoc.id, currentUser.id,
            $('localVideo'), $('remoteVideo'),
            (status) => { $('callStatus').textContent = status; if (status === 'Connected') callTimer.start(); },
            () => { $('videoCallModal').classList.add('hidden'); callTimer.stop(); activeCall = null; }
          );
          await activeCall.answerCall(data.activeCall, videoEnabled);
        } catch (err) {
          toast('Could not answer call: ' + err.message, 'var(--error)');
          $('videoCallModal').classList.add('hidden');
        }
      }, async () => {
        await updateDoc(doc(db, 'conversations', convDoc.id), { activeCall: null, callHandledBy: currentUser.id });
      });
    });
    incomingCallUnsubs.push(unsub);
  });
}

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
  $('settingsBtn').addEventListener('click', () => {
    $('settingsModal').classList.remove('hidden');
    renderHiddenUsersList();
    syncAppearanceButtons(localStorage.getItem('fastline_theme') === 'light');
  });

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
      const modalId = btn.dataset.modal;
      document.getElementById(modalId)?.classList.add('hidden');
      if (modalId === 'newChatModal') stopUsersLiveRefresh();
    });
  });

  // Close modal on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        overlay.classList.add('hidden');
        if (overlay.id === 'newChatModal') stopUsersLiveRefresh();
      }
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

  // Appearance (Dark / Light)
  $('darkModeBtn')?.addEventListener('click', () => setAppearanceMode('dark'));
  $('lightModeBtn')?.addEventListener('click', () => setAppearanceMode('light'));
  syncAppearanceButtons(localStorage.getItem('fastline_theme') === 'light');

  // Color theme presets
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      ThemeManager.apply(theme);
      localStorage.setItem('fastline_theme_name', theme);
      document.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (theme === 'light') {
        localStorage.setItem('fastline_theme', 'light');
      } else {
        localStorage.setItem('fastline_theme', 'dark');
      }
      applyTheme();
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
    clearSession();
    navigateTo('login.html');
  });

  // Groups and Status buttons
  $('createGroupBtn').addEventListener('click', () => {
    groupSelectedMembers = [];
    renderGroupMemberChips();
    $('groupNameInput').value = '';
    $('createGroupModal').classList.remove('hidden');
    loadGroupMemberSearch();
  });

  $('addStatusBtn').addEventListener('click', () => {
    $('statusTextInput').value = '';
    $('statusImageInput').value = '';
    statusSelectedViewers = [];
    statusAudience = 'all_contacts';
    setStatusAudience('all_contacts');
    renderStatusViewerChips();
    $('addStatusModal').classList.remove('hidden');
  });

  $('statusAudienceAll')?.addEventListener('click', () => setStatusAudience('all_contacts'));
  $('statusAudienceSelected')?.addEventListener('click', () => setStatusAudience('selected'));
  $('statusViewerSearch')?.addEventListener('input', debounce(() => {
    loadStatusViewerSearch($('statusViewerSearch').value.trim());
  }, 300));

  $('confirmAddStatusBtn').addEventListener('click', () => postStatus().catch(err => toast(err.message, 'var(--error)')));

  $('profileFab')?.addEventListener('click', () => $('profileModal').classList.remove('hidden'));
  $('confirmCreateGroupBtn').addEventListener('click', () => createGroup().catch(err => toast(err.message, 'var(--error)')));
  $('groupMemberSearch')?.addEventListener('input', debounce(() => {
    loadGroupMemberSearch($('groupMemberSearch').value.trim());
  }, 300));

  setupChatMenu();
  refreshHiddenUsers();
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
