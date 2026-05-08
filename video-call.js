// ════════════════════════════════════════════════════
//  FastLine Chats — components/video-call.js
//  WebRTC Peer-to-Peer Video & Voice Calls
//  Signalling via Firebase Firestore
// ════════════════════════════════════════════════════

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    // Add TURN servers here for production reliability:
    // { urls: 'turn:YOUR_TURN_SERVER', username: 'user', credential: 'pass' }
  ]
};

export class WebRTCCall {
  /**
   * @param {object} db         - Firestore instance
   * @param {string} convId     - Conversation document ID
   * @param {string} localUserId
   * @param {HTMLVideoElement} localVideo
   * @param {HTMLVideoElement} remoteVideo
   * @param {function} onStatusChange - (status: string) => void
   * @param {function} onEnd          - () => void
   */
  constructor(db, convId, localUserId, localVideo, remoteVideo, onStatusChange, onEnd) {
    this.db            = db;
    this.convId        = convId;
    this.localUserId   = localUserId;
    this.localVideo    = localVideo;
    this.remoteVideo   = remoteVideo;
    this.onStatusChange = onStatusChange || (() => {});
    this.onEnd         = onEnd          || (() => {});

    this.pc            = null;
    this.localStream   = null;
    this._unsubs       = [];
    this.callDocRef    = null;
    this.isAudioMuted  = false;
    this.isVideoOff    = false;
  }

  // ── Initiate a call (caller side) ──
  async startCall(videoEnabled = true) {
    await this._getUserMedia(videoEnabled);
    const { doc, collection, addDoc, onSnapshot, updateDoc, setDoc } =
      await import('firebase/firestore');

    this.pc = new RTCPeerConnection(ICE_SERVERS);
    this._attachLocalTracks();
    this._listenRemoteTracks();

    // Create Firestore call document
    this.callDocRef = doc(collection(this.db, 'calls'));
    const callerCandidates  = collection(this.callDocRef, 'callerCandidates');
    const calleeCandidates  = collection(this.callDocRef, 'calleeCandidates');

    // Send ICE candidates
    this.pc.onicecandidate = async e => {
      if (e.candidate) await addDoc(callerCandidates, e.candidate.toJSON());
    };

    // Create SDP offer
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    await setDoc(this.callDocRef, {
      callerId:  this.localUserId,
      offer:     { type: offer.type, sdp: offer.sdp },
      convId:    this.convId,
      video:     videoEnabled,
      createdAt: new Date().toISOString()
    });

    this.onStatusChange('Calling…');

    // Write call ID to conversation so peer gets notified
    await updateDoc(doc(this.db, 'conversations', this.convId), {
      activeCall: this.callDocRef.id
    });

    // Listen for answer
    const unsub = onSnapshot(this.callDocRef, async snap => {
      const data = snap.data();
      if (data?.answer && !this.pc.currentRemoteDescription) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        this.onStatusChange('Connected');
      }
    });
    this._unsubs.push(unsub);

    // Listen for callee ICE candidates
    const unsub2 = onSnapshot(calleeCandidates, snap => {
      snap.docChanges().forEach(async change => {
        if (change.type === 'added') {
          await this.pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        }
      });
    });
    this._unsubs.push(unsub2);

    return this.callDocRef.id;
  }

  // ── Answer an incoming call (callee side) ──
  async answerCall(callId, videoEnabled = true) {
    await this._getUserMedia(videoEnabled);
    const { doc, collection, addDoc, onSnapshot, updateDoc } =
      await import('firebase/firestore');

    this.pc = new RTCPeerConnection(ICE_SERVERS);
    this.callDocRef = doc(this.db, 'calls', callId);
    const callerCandidates = collection(this.callDocRef, 'callerCandidates');
    const calleeCandidates = collection(this.callDocRef, 'calleeCandidates');

    this._attachLocalTracks();
    this._listenRemoteTracks();

    // Send callee ICE candidates
    this.pc.onicecandidate = async e => {
      if (e.candidate) await addDoc(calleeCandidates, e.candidate.toJSON());
    };

    const snap = await (await import('firebase/firestore')).getDoc(this.callDocRef);
    const callData = snap.data();

    // Set remote offer
    await this.pc.setRemoteDescription(new RTCSessionDescription(callData.offer));

    // Create answer
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    await updateDoc(this.callDocRef, {
      answer: { type: answer.type, sdp: answer.sdp }
    });

    this.onStatusChange('Connected');

    // Listen for caller's ICE candidates
    const unsub = onSnapshot(callerCandidates, snap => {
      snap.docChanges().forEach(async change => {
        if (change.type === 'added') {
          await this.pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        }
      });
    });
    this._unsubs.push(unsub);
  }

  // ── End / Hang up ──
  async endCall() {
    this._unsubs.forEach(u => u());
    this._unsubs = [];

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    if (this.localVideo)  this.localVideo.srcObject  = null;
    if (this.remoteVideo) this.remoteVideo.srcObject = null;

    if (this.callDocRef) {
      const { updateDoc } = await import('firebase/firestore');
      await updateDoc(this.callDocRef, { ended: true }).catch(() => {});
    }

    if (this.convId) {
      const { doc, updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(this.db, 'conversations', this.convId), {
        activeCall: null
      }).catch(() => {});
    }

    this.onStatusChange('Call Ended');
    this.onEnd();
  }

  // ── Toggle Mute ──
  toggleMute() {
    if (!this.localStream) return;
    this.isAudioMuted = !this.isAudioMuted;
    this.localStream.getAudioTracks().forEach(t => { t.enabled = !this.isAudioMuted; });
    return this.isAudioMuted;
  }

  // ── Toggle Camera ──
  toggleCamera() {
    if (!this.localStream) return;
    this.isVideoOff = !this.isVideoOff;
    this.localStream.getVideoTracks().forEach(t => { t.enabled = !this.isVideoOff; });
    return this.isVideoOff;
  }

  // ── Private helpers ──
  async _getUserMedia(video) {
    this.localStream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
    if (this.localVideo) this.localVideo.srcObject = this.localStream;
  }

  _attachLocalTracks() {
    this.localStream.getTracks().forEach(track => {
      this.pc.addTrack(track, this.localStream);
    });
  }

  _listenRemoteTracks() {
    const remoteStream = new MediaStream();
    if (this.remoteVideo) this.remoteVideo.srcObject = remoteStream;
    this.pc.ontrack = e => { e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t)); };
    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.onStatusChange('Disconnected');
        this.endCall();
      }
    };
  }
}

// ── Listen for incoming calls ──
export function listenForIncomingCalls(db, convId, currentUserId, onIncoming) {
  return new Promise(async resolve => {
    const { doc, onSnapshot } = await import('firebase/firestore');
    const unsub = onSnapshot(doc(db, 'conversations', convId), snap => {
      const data = snap.data();
      if (data?.activeCall && !data?.callHandled) {
        onIncoming(data.activeCall);
      }
    });
    resolve(unsub);
  });
}

// ── Incoming call notification UI ──
export function showIncomingCallUI(callerName, onAccept, onDecline) {
  const el = document.createElement('div');
  el.id = 'incoming-call-ui';
  el.innerHTML = `
    <div style="
      position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:10000;
      background:rgba(14,14,16,.98);border:1px solid rgba(0,191,255,.35);
      border-radius:20px;padding:20px 24px;min-width:280px;
      display:flex;flex-direction:column;align-items:center;gap:14px;
      box-shadow:0 24px 60px rgba(0,0,0,.7);backdrop-filter:blur(20px);
      font-family:'DM Sans',sans-serif;
      animation:slideInDown .4s cubic-bezier(.2,.9,.4,1.1);
    ">
      <style>
        @keyframes slideInDown{from{opacity:0;transform:translateX(-50%) translateY(-30px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        .call-ring-anim{animation:ringPulse 1s ease-in-out infinite}
        @keyframes ringPulse{0%,100%{box-shadow:0 0 0 0 rgba(0,191,255,.4)}50%{box-shadow:0 0 0 16px rgba(0,191,255,0)}}
      </style>
      <div class="call-ring-anim" style="width:60px;height:60px;border-radius:50%;background:rgba(0,191,255,.12);border:2px solid #00BFFF;display:flex;align-items:center;justify-content:center;color:#00BFFF;font-size:1.4rem;">
        📹
      </div>
      <div style="text-align:center;">
        <div style="color:#fff;font-weight:700;font-size:1rem;font-family:'Syne',sans-serif;">${callerName}</div>
        <div style="color:rgba(255,255,255,.5);font-size:.8rem;margin-top:2px;">Incoming video call…</div>
      </div>
      <div style="display:flex;gap:16px;">
        <button id="decline-call-btn" style="width:52px;height:52px;border-radius:50%;border:none;background:#FF3366;color:#fff;font-size:1.2rem;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;">📵</button>
        <button id="accept-call-btn"  style="width:52px;height:52px;border-radius:50%;border:none;background:#00E676;color:#000;font-size:1.2rem;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;">📞</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  document.getElementById('accept-call-btn').addEventListener('click',  () => { el.remove(); onAccept();  });
  document.getElementById('decline-call-btn').addEventListener('click', () => { el.remove(); onDecline(); });
  // Auto-dismiss after 30s
  setTimeout(() => { el.remove(); onDecline(); }, 30000);
  return el;
}

// ── Call Duration Timer ──
export class CallTimer {
  constructor(displayEl) {
    this.displayEl = displayEl;
    this.seconds   = 0;
    this.interval  = null;
  }
  start() {
    this.seconds  = 0;
    this.interval = setInterval(() => {
      this.seconds++;
      const m = Math.floor(this.seconds / 60);
      const s = this.seconds % 60;
      if (this.displayEl) this.displayEl.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
    }, 1000);
  }
  stop() {
    clearInterval(this.interval);
    this.interval = null;
  }
}
