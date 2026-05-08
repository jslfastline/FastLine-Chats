// ════════════════════════════════════════════════════
//  FastLine Chats — components/chat.js
//  Chat feature helpers: typing indicator, read receipts,
//  message grouping, AI smart replies, swipe-to-reply
// ════════════════════════════════════════════════════

// ── Typing Indicator ──
export class TypingIndicator {
  constructor(db, convId, userId, peerName, uiEl, nameEl) {
    this.db       = db;
    this.convId   = convId;
    this.userId   = userId;
    this.peerName = peerName;
    this.uiEl     = uiEl;   // #typingIndicator
    this.nameEl   = nameEl; // #typingName
    this._timer   = null;
    this._unsub   = null;
  }

  // Call this when the local user types
  userTyping() {
    import('firebase/firestore').then(({ doc, updateDoc, serverTimestamp }) => {
      updateDoc(
        doc(this.db, 'conversations', this.convId),
        { [`typing.${this.userId}`]: serverTimestamp() }
      ).catch(() => {});
    });
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.userStoppedTyping(), 3000);
  }

  userStoppedTyping() {
    import('firebase/firestore').then(({ doc, updateDoc, deleteField }) => {
      updateDoc(
        doc(this.db, 'conversations', this.convId),
        { [`typing.${this.userId}`]: deleteField() }
      ).catch(() => {});
    });
  }

  // Call this to watch the peer's typing status
  listen() {
    import('firebase/firestore').then(({ doc, onSnapshot }) => {
      this._unsub = onSnapshot(
        doc(this.db, 'conversations', this.convId),
        (snap) => {
          if (!snap.exists()) return;
          const typing = snap.data().typing || {};
          const peerIds = Object.keys(typing).filter(id => id !== this.userId);
          const isTyping = peerIds.length > 0;
          this.uiEl.classList.toggle('hidden', !isTyping);
          if (isTyping) this.nameEl.textContent = this.peerName;
        }
      );
    });
  }

  destroy() {
    this._unsub?.();
    clearTimeout(this._timer);
  }
}

// ── Read Receipts ──
export async function markMessagesRead(db, convId, userId) {
  const { collection, query, where, getDocs, updateDoc, doc } =
    await import('firebase/firestore');
  const q = query(
    collection(db, 'conversations', convId, 'messages'),
    where('senderId', '!=', userId),
    where('status', '!=', 'read')
  );
  const snap = await getDocs(q);
  const updates = snap.docs.map(d =>
    updateDoc(doc(db, 'conversations', convId, 'messages', d.id), { status: 'read' })
  );
  await Promise.allSettled(updates);
}

// ── Message Grouping ──
// Groups consecutive messages from the same sender within 2 minutes
export function groupMessages(messages) {
  const groups = [];
  for (let i = 0; i < messages.length; i++) {
    const msg  = messages[i];
    const prev = messages[i - 1];
    const sameAuthor  = prev && prev.senderId === msg.senderId;
    const closeInTime = prev && getTimeDiff(prev.timestamp, msg.timestamp) < 120;
    if (sameAuthor && closeInTime) {
      groups[groups.length - 1].messages.push(msg);
    } else {
      groups.push({ senderId: msg.senderId, messages: [msg] });
    }
  }
  return groups;
}

function getTimeDiff(a, b) {
  const ta = a?.toDate ? a.toDate() : new Date(a || 0);
  const tb = b?.toDate ? b.toDate() : new Date(b || 0);
  return Math.abs(tb - ta) / 1000;
}

// ── Swipe-to-Reply (Touch) ──
export function enableSwipeToReply(container, onReply) {
  let startX = 0, startY = 0, target = null;

  container.addEventListener('touchstart', e => {
    startX  = e.touches[0].clientX;
    startY  = e.touches[0].clientY;
    target  = e.target.closest('.msg-group');
  }, { passive: true });

  container.addEventListener('touchmove', e => {
    if (!target) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    // Only trigger on rightward horizontal swipe
    if (Math.abs(dx) > Math.abs(dy) && dx > 40) {
      target.style.transform = `translateX(${Math.min(dx * 0.4, 50)}px)`;
      target.style.transition = 'none';
    }
  }, { passive: true });

  container.addEventListener('touchend', e => {
    if (!target) return;
    const dx = e.changedTouches[0].clientX - startX;
    target.style.transition = 'transform .25s cubic-bezier(.2,.9,.4,1)';
    target.style.transform  = '';
    if (dx > 60) {
      const msgId   = target.dataset.msgId;
      const bubbleEl = target.querySelector('.msg-bubble');
      const text    = bubbleEl?.textContent?.trim() || '[media]';
      const isSent  = target.classList.contains('sent');
      onReply({ id: msgId, text, senderName: isSent ? 'You' : '' });
    }
    target = null;
  });
}

// ── AI Smart Replies ──
const SMART_REPLY_TRIGGERS = {
  greet:    ['hello','hi','hey','good morning','good evening','howdy','sup','what\'s up'],
  thanks:   ['thanks','thank you','thx','ty','cheers','much appreciated'],
  ok:       ['ok','okay','alright','sure','got it','noted','understood','ack'],
  question: ['how are you','how\'s it going','how r u','you good','all good?'],
  bye:      ['bye','goodbye','later','see you','ttyl','take care','cya','good night'],
  agree:    ['agree','absolutely','exactly','right','true','correct','same','indeed'],
  laugh:    ['haha','lol','😂','lmao','😆','hehe','funny']
};

const SMART_REPLY_RESPONSES = {
  greet:    ["Hey! 👋", "Hi there! 😊", "Hello! How's it going?", "Hey, what's up?"],
  thanks:   ["You're welcome! 😊", "No problem at all!", "Anytime! 🙌", "Happy to help!"],
  ok:       ["Sounds good!", "Got it! 👍", "Perfect!", "Okay, noted!"],
  question: ["I'm doing great, thanks! 😊", "All good here! How about you?", "Pretty good! You?", "Doing well, cheers!"],
  bye:      ["Take care! 👋", "Bye! Talk later 😊", "See you soon!", "Good night! 🌙"],
  agree:    ["Exactly! 💯", "Totally agree!", "100%!", "Yep, same here!"],
  laugh:    ["😂 Right?!", "Haha so true!", "😂😂", "Lmaooo 💀"]
};

export function generateSmartReplies(messageText) {
  if (!messageText) return [];
  const lower = messageText.toLowerCase();
  for (const [key, triggers] of Object.entries(SMART_REPLY_TRIGGERS)) {
    if (triggers.some(t => lower.includes(t))) {
      const pool = SMART_REPLY_RESPONSES[key];
      // Return 3 random suggestions
      return [...pool].sort(() => Math.random() - .5).slice(0, 3);
    }
  }
  // Default generic replies
  return ['👍', 'Okay!', 'Got it!'];
}

// ── Render Smart Reply Chips ──
export function renderSmartReplies(container, replies, onSelect) {
  container.innerHTML = '';
  if (!replies || replies.length === 0) return;
  replies.forEach(reply => {
    const chip = document.createElement('button');
    chip.className = 'smart-reply-chip';
    chip.textContent = reply;
    chip.style.cssText = `
      background: rgba(0,191,255,.08);
      border: 1px solid rgba(0,191,255,.25);
      border-radius: 20px;
      padding: 6px 14px;
      color: #00BFFF;
      font-size: .8rem;
      cursor: pointer;
      font-family: 'DM Sans', sans-serif;
      transition: all .15s;
      white-space: nowrap;
    `;
    chip.addEventListener('mouseenter', () => {
      chip.style.background = 'rgba(0,191,255,.18)';
    });
    chip.addEventListener('mouseleave', () => {
      chip.style.background = 'rgba(0,191,255,.08)';
    });
    chip.addEventListener('click', () => onSelect(reply));
    container.appendChild(chip);
  });
}

// ── Date Separator Injection ──
export function shouldShowDateSep(prevMsg, currMsg) {
  if (!prevMsg) return true;
  const a = prevMsg.timestamp?.toDate ? prevMsg.timestamp.toDate() : new Date(prevMsg.timestamp || 0);
  const b = currMsg.timestamp?.toDate ? currMsg.timestamp.toDate() : new Date(currMsg.timestamp || 0);
  return a.toDateString() !== b.toDateString();
}

export function formatDateSep(ts) {
  if (!ts) return 'Today';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

// ── Message Search ──
export function filterMessages(messages, query) {
  if (!query || !query.trim()) return messages;
  const q = query.trim().toLowerCase();
  return messages.filter(m =>
    (m.text || '').toLowerCase().includes(q) ||
    (m.senderName || '').toLowerCase().includes(q)
  );
}

// ── Unread Count Badge ──
export function updateTabTitle(unreadCount) {
  document.title = unreadCount > 0
    ? `(${unreadCount}) FastLine Chats`
    : 'FastLine Chats';
}
