/* HandCricket client */
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const socket = io({ autoConnect: true });

  const MARKET_LABEL = { blue: 'Blue', red: 'Red', tie: 'Tie', odd: 'Odd', even: 'Even', over: 'Over 7', under: 'Under 7' };

  const S = {
    me: null, name: '', code: '', state: null, offset: 0,
    selected: null, amount: 50, myBets: {}, lastRoundId: null, balance: 0,
  };

  // ---------------- Fist artwork (SVG) ----------------
  function fistSVG(id, c) {
    return `
    <svg viewBox="0 0 120 150" aria-hidden="true">
      <defs>
        <linearGradient id="g${id}" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stop-color="${c.hi}"/><stop offset=".45" stop-color="${c.mid}"/><stop offset="1" stop-color="${c.lo}"/>
        </linearGradient>
        <linearGradient id="k${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${c.hi}"/><stop offset="1" stop-color="${c.mid}"/>
        </linearGradient>
        <linearGradient id="s${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f7c49c"/><stop offset="1" stop-color="#e79d6e"/>
        </linearGradient>
      </defs>
      <g stroke="#0a0d24" stroke-width="3" stroke-linejoin="round">
        <path d="M36 112 H84 V138 Q84 147 60 147 Q36 147 36 138 Z" fill="url(#s${id})"/>
        <path d="M14 46 Q14 20 40 18 H84 Q108 20 108 48 V80 Q108 106 82 108 H42 Q16 106 14 82 Z" fill="url(#g${id})"/>
        <rect x="17" y="14" width="24" height="50" rx="12" fill="url(#k${id})"/>
        <rect x="39" y="10" width="24" height="54" rx="12" fill="url(#k${id})"/>
        <rect x="61" y="11" width="24" height="53" rx="12" fill="url(#k${id})"/>
        <rect x="83" y="17" width="23" height="47" rx="11.5" fill="url(#k${id})"/>
        <path d="M12 56 Q6 84 30 88 H80 Q94 88 94 76 Q94 64 80 64 H44 Q32 64 28 52 Q20 46 12 56 Z" fill="url(#g${id})"/>
        <rect x="26" y="100" width="68" height="20" rx="8" fill="${c.lo}"/>
      </g>
      <g fill="#fff" opacity=".45">
        <ellipse cx="27" cy="26" rx="4" ry="7"/><ellipse cx="49" cy="22" rx="4" ry="7"/>
        <ellipse cx="71" cy="23" rx="4" ry="7"/><ellipse cx="92" cy="28" rx="3.5" ry="6"/>
        <ellipse cx="40" cy="70" rx="10" ry="2.6"/>
      </g>
      <path d="M30 104 H90" stroke="#fff" stroke-opacity=".3" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`;
  }
  $('#fistBlue').insertAdjacentHTML('afterbegin', fistSVG('b', { hi: '#9cc2ff', mid: '#2f6cf0', lo: '#1537a8' }));
  $('#fistRed').insertAdjacentHTML('afterbegin', fistSVG('r', { hi: '#ffa396', mid: '#e8261f', lo: '#a30e13' }));

  // ---------------- Tiny sound effects ----------------
  let actx;
  function beep(freq = 600, dur = 0.08, type = 'sine', vol = 0.06) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
    } catch (_) { /* audio not available */ }
  }
  const sfx = {
    bet: () => beep(880, 0.07, 'triangle'),
    tick: () => beep(1200, 0.03, 'square', 0.03),
    reveal: () => { beep(220, 0.12, 'sawtooth', 0.04); setTimeout(() => beep(330, 0.12, 'sawtooth', 0.04), 120); },
    win: () => [660, 880, 1320].forEach((f, i) => setTimeout(() => beep(f, 0.12, 'triangle', 0.07), i * 110)),
    lose: () => beep(180, 0.25, 'sine', 0.05),
  };

  // ---------------- Toasts ----------------
  function toast(text, kind = '', ms = 2600) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    $('#toasts').appendChild(el);
    while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
    setTimeout(() => el.remove(), ms);
    return el;
  }

  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

  // ---------------- Lobby ----------------
  const params = new URLSearchParams(location.search);
  $('#nameInput').value = localStorageGet('hc_name') || '';
  if (params.get('room')) $('#codeInput').value = params.get('room').toUpperCase();

  function localStorageGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

  function join(code) {
    const name = $('#nameInput').value.trim();
    if (!name) { $('#lobbyErr').textContent = 'Please enter your name.'; $('#nameInput').focus(); return; }
    localStorageSet('hc_name', name);
    $('#lobbyErr').textContent = '';
    socket.emit('join-room', { code, name }, (res) => {
      if (!res.ok) { $('#lobbyErr').textContent = res.error; return; }
      S.me = res.id; S.name = res.name; S.code = res.state.code;
      $('#lobby').classList.add('hidden');
      $('#username').textContent = S.name;
      $('#roomCode').textContent = S.code;
      history.replaceState(null, '', `?room=${S.code}`);
      applyState(res.state);
      if (!code) toast(`Room ${S.code} created. Open the menu to invite a friend.`, '', 4200);
    });
  }
  $('#createBtn').onclick = () => join('');
  $('#joinBtn').onclick = () => {
    const c = $('#codeInput').value.trim().toUpperCase();
    if (c.length < 5) { $('#lobbyErr').textContent = 'Enter the 5-letter room code.'; return; }
    join(c);
  };
  $('#codeInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('#joinBtn').click());
  $('#nameInput').addEventListener('keydown', (e) => e.key === 'Enter' && ($('#codeInput').value.trim() ? $('#joinBtn') : $('#createBtn')).click());

  socket.on('connect', () => {
    // auto-rejoin after a network blip
    if (S.code && S.name) {
      socket.emit('join-room', { code: S.code, name: S.name }, (res) => {
        if (res.ok) { S.me = res.id; applyState(res.state); if (call.active) { endCall(); toast('Reconnected. Tap the camera button to rejoin the call.'); } }
        else { toast('Connection lost. Please rejoin.', 'err'); $('#lobby').classList.remove('hidden'); }
      });
    }
  });

  // ---------------- Game state ----------------
  socket.on('state', applyState);
  socket.on('toast', ({ text }) => toast(text));
  socket.on('bet-feed', ({ name, market, amount }) => toast(`${name} bet ${fmt(amount)} on ${MARKET_LABEL[market]}`, '', 1800));

  function applyState(st) {
    const prevPhase = S.state && S.state.phase;
    S.state = st;
    S.offset = st.serverNow - Date.now();
    const me = st.players.find((p) => p.id === S.me);
    if (me) setBalance(me.balance);

    if (st.roundId !== S.lastRoundId) { // new round
      S.lastRoundId = st.roundId;
      S.myBets = {};
      renderStakes();
      resetArena();
    }
    $('#roundId').textContent = st.roundId || '—';

    const arena = $('.arena');
    if (st.phase === 'reveal') {
      if (prevPhase !== 'reveal') { arena.classList.add('shaking'); sfx.reveal(); }
      $('#centerCap').textContent = 'Revealing';
      $('#centerNum').textContent = '…';
    } else if (st.phase === 'result' && st.result) {
      showResult(st.result, prevPhase !== 'result');
    } else if (st.phase === 'betting') {
      $('#centerCap').textContent = 'Place bets';
    }
    $('.panel').classList.toggle('closed', st.phase !== 'betting');
    updatePlaceBtn();
    renderPlayers(st);
    renderHistory(st.history);
    updateCallButton(st);
  }

  function resetArena() {
    const arena = $('.arena');
    arena.classList.remove('shaking');
    ['#fistBlue', '#fistRed'].forEach((s) => $(s).classList.remove('win', 'lose', 'tie'));
    ['#numBlue', '#numRed'].forEach((s) => { $(s).classList.remove('show'); $(s).textContent = ''; });
    $$('.mkt').forEach((m) => m.classList.remove('won'));
    $('#centerNum').classList.remove('pop');
  }

  function showResult(r, fresh) {
    $('.arena').classList.remove('shaking');
    $('#numBlue').textContent = r.blue; $('#numBlue').classList.add('show');
    $('#numRed').textContent = r.red; $('#numRed').classList.add('show');
    $('#fistBlue').classList.add(r.winner === 'blue' ? 'win' : r.winner === 'red' ? 'lose' : 'tie');
    $('#fistRed').classList.add(r.winner === 'red' ? 'win' : r.winner === 'blue' ? 'lose' : 'tie');
    $('#centerNum').textContent = r.sum;
    $('#centerNum').classList.add('pop');
    $('#centerCap').textContent = r.winner === 'tie' ? 'Tie' : `${r.winner} wins`;
    // highlight winning markets
    const won = [r.winner, r.sum % 2 ? 'odd' : 'even'];
    if (r.sum > 7) won.push('over'); if (r.sum < 7) won.push('under');
    won.forEach((m) => $(`.mkt[data-m="${m}"]`) && $(`.mkt[data-m="${m}"]`).classList.add('won'));
  }

  socket.on('payout', (p) => {
    if (!p) return;
    if (p.net > 0) { toast(`You won +${fmt(p.net)} coins!`, 'win', 3200); sfx.win(); }
    else if (p.net < 0) { toast(`You lost ${fmt(-p.net)} coins`, 'lose', 2600); sfx.lose(); }
    else toast('Your bets were refunded', '', 2200);
  });

  function setBalance(b) {
    if (b !== S.balance) {
      const el = $('#balance');
      el.classList.add('bump'); setTimeout(() => el.classList.remove('bump'), 250);
    }
    S.balance = b;
    $('#balance').textContent = fmt(b);
  }

  // progress bar + countdown
  let lastSec = null;
  function frame() {
    const st = S.state;
    if (st) {
      const now = Date.now() + S.offset;
      const bar = $('#progress');
      if (st.phase === 'betting') {
        const left = Math.max(0, st.endsAt - now);
        bar.style.width = `${(left / st.betMs) * 100}%`;
        bar.classList.toggle('urgent', left < 4000);
        const sec = Math.ceil(left / 1000);
        $('#centerNum').textContent = sec;
        if (sec !== lastSec && sec <= 3 && sec > 0) sfx.tick();
        lastSec = sec;
      } else {
        bar.style.width = '0%';
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------------- Betting UI ----------------
  $$('.mkt').forEach((btn) => btn.addEventListener('click', () => {
    S.selected = S.selected === btn.dataset.m ? null : btn.dataset.m;
    $$('.mkt').forEach((b) => b.classList.toggle('selected', b.dataset.m === S.selected));
    updatePlaceBtn();
  }));

  function setAmount(a, fromInput = false) {
    a = Math.max(1, Math.min(100000, Math.round((Number(a) || 0) * 100) / 100));
    S.amount = a;
    if (!fromInput) $('#amountInput').value = a;
    $$('.amt-chips .amt-chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.a) === a));
    updatePlaceBtn();
  }
  $$('.amt-chips .amt-chip').forEach((c) => (c.onclick = () => setAmount(Number(c.dataset.a))));
  $('#halfBtn').onclick = () => setAmount(S.amount / 2);
  $('#dblBtn').onclick = () => setAmount(S.amount * 2);
  $('#amountInput').addEventListener('input', (e) => setAmount(e.target.value, true));
  $('#amountInput').addEventListener('blur', () => setAmount(S.amount));

  function updatePlaceBtn() {
    const btn = $('#placeBtn');
    const open = S.state && S.state.phase === 'betting';
    btn.textContent = `PLACE BET · ${fmt(S.amount)}`;
    btn.disabled = !open || !S.selected || S.amount > S.balance;
  }

  $('#placeBtn').onclick = () => {
    if (!S.selected) return;
    const market = S.selected, amount = S.amount;
    $('#placeBtn').disabled = true;
    socket.emit('bet', { market, amount }, (res) => {
      if (!res.ok) { toast(res.error, 'err'); updatePlaceBtn(); return; }
      sfx.bet();
      setBalance(res.balance);
      S.myBets = {};
      res.bets.forEach((b) => (S.myBets[b.market] = (S.myBets[b.market] || 0) + b.amount));
      renderStakes();
      toast(`Bet ${fmt(amount)} on ${MARKET_LABEL[market]}`, '', 1500);
      updatePlaceBtn();
    });
  };

  function renderStakes() {
    $$('.mkt').forEach((m) => {
      const s = m.querySelector('.stake');
      const v = S.myBets[m.dataset.m];
      s.textContent = v ? fmt(v) : '';
      s.classList.toggle('on', !!v);
    });
  }

  // ---------------- Header buttons & drawer ----------------
  $('#fsBtn2').onclick = () => $('#fsBtn').onclick();
  $('#fsBtn').onclick = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  };
  const openDrawer = (o) => {
    $('#drawer').classList.toggle('open', o);
    $('#drawer').setAttribute('aria-hidden', String(!o));
    $('#scrim').classList.toggle('hidden', !o);
  };
  $('#menuBtn').onclick = () => openDrawer(true);
  $('#closeDrawer').onclick = () => openDrawer(false);
  $('#scrim').onclick = () => openDrawer(false);

  $('#inviteBtn').onclick = async () => {
    const link = `${location.origin}${location.pathname}?room=${S.code}`;
    try {
      if (navigator.share && /Mobi/i.test(navigator.userAgent)) await navigator.share({ title: 'HandCricket', text: `Join my HandCricket room ${S.code}`, url: link });
      else { await navigator.clipboard.writeText(link); toast('Invite link copied'); }
    } catch (_) { toast(`Room code: ${S.code}`); }
  };
  $('#refillBtn').onclick = () => socket.emit('refill', (r) => toast(r.ok ? 'Coins refilled to 1000' : (r.error || 'Not available'), r.ok ? 'win' : 'err'));
  $('#leaveBtn').onclick = () => {
    if (call.active) endCall();
    socket.emit('leave-room');
    S.code = ''; S.state = null; S.lastRoundId = null;
    history.replaceState(null, '', location.pathname);
    openDrawer(false);
    $('#lobby').classList.remove('hidden');
  };

  function renderPlayers(st) {
    const list = [...st.players].sort((a, b) => b.balance - a.balance);
    $('#players').innerHTML = list.map((p, i) => `
      <li><span class="rank">${i + 1}</span>
      <span class="pn">${esc(p.name)}${p.id === S.me ? '<span class="you">YOU</span>' : ''}</span>
      ${p.inCall ? '<span class="cam" title="In call">🎥</span>' : ''}
      <span class="pb">${fmt(p.balance)}</span></li>`).join('');
  }
  function renderHistory(h) {
    $('#history').innerHTML = [...h].reverse().map((r) =>
      `<div class="hdot ${r.winner}" title="Blue ${r.blue} : Red ${r.red}">${r.sum}</div>`).join('') || '<span style="color:#9aa3c7;font-size:13px">No rounds yet</span>';
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // =====================================================================
  //  AUDIO / VIDEO CALL  (WebRTC mesh, signaling via Socket.IO)
  // =====================================================================
  const call = { active: false, stream: null, peers: new Map(), ice: null, facing: 'user' };

  async function iceServers() {
    if (call.ice) return call.ice;
    try { call.ice = await (await fetch('/api/ice')).json(); } catch (_) { call.ice = [{ urls: 'stun:stun.l.google.com:19302' }]; }
    return call.ice;
  }

  function updateCallButton(st) {
    const othersInCall = st.players.some((p) => p.inCall && p.id !== S.me);
    $('#callBtn').classList.toggle('in-call', call.active);
    $('#callBtn').classList.toggle('ringing', !call.active && othersInCall);
  }

  $('#callBtn').onclick = () => (call.active ? toggleDockSize() : startCall());
  $('#endBtn').onclick = () => endCall();

  async function getMedia() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('insecure');
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: call.facing, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      const a = await navigator.mediaDevices.getUserMedia({ audio: true });
      toast('Camera not available, so you joined with audio only', 'err');
      return a;
    }
  }

  async function startCall() {
    if (!S.code) return;
    try { call.stream = await getMedia(); }
    catch (e) {
      toast(e.message === 'insecure'
        ? 'Calling needs HTTPS (or localhost). See the README.'
        : 'Microphone/camera permission was denied', 'err', 4500);
      return;
    }
    await iceServers();
    call.active = true;
    $('#callDock').classList.remove('hidden');
    addTile('self', 'You', call.stream, true);
    syncCtrlButtons();
    socket.emit('call-join', async (others) => {
      if (!others.length) toast('You are in the call. Waiting for others to join…');
      for (const o of others) {
        const pc = createPeer(o.id, o.name);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('signal', { to: o.id, data: { sdp: pc.localDescription } });
      }
    });
  }

  function endCall() {
    socket.emit('call-leave');
    for (const id of [...call.peers.keys()]) removePeer(id);
    if (call.stream) call.stream.getTracks().forEach((t) => t.stop());
    call.stream = null; call.active = false;
    $('#tiles').innerHTML = '';
    $('#callDock').classList.add('hidden');
    $('#callBtn').classList.remove('in-call');
  }

  function createPeer(id, name) {
    const pc = new RTCPeerConnection({ iceServers: call.ice });
    call.stream.getTracks().forEach((t) => pc.addTrack(t, call.stream));
    pc.onicecandidate = (e) => e.candidate && socket.emit('signal', { to: id, data: { candidate: e.candidate } });
    pc.ontrack = (e) => addTile(id, name, e.streams[0]);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') { toast(`Couldn't connect media with ${name}. A TURN server may be needed.`, 'err', 5000); removePeer(id); }
    };
    call.peers.set(id, { pc, name, queue: [] });
    return pc;
  }

  function removePeer(id) {
    const p = call.peers.get(id);
    if (p) { try { p.pc.close(); } catch (_) {} call.peers.delete(id); }
    const t = document.getElementById(`tile-${id}`);
    if (t) { stopMeter(t); t.remove(); }
  }

  socket.on('signal', async ({ from, name, data }) => {
    if (!call.active) return;
    let peer = call.peers.get(from);
    try {
      if (data.sdp) {
        if (data.sdp.type === 'offer') {
          if (!peer) { createPeer(from, name); peer = call.peers.get(from); }
          await peer.pc.setRemoteDescription(data.sdp);
          await flush(peer);
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          socket.emit('signal', { to: from, data: { sdp: peer.pc.localDescription } });
        } else if (peer) {
          await peer.pc.setRemoteDescription(data.sdp);
          await flush(peer);
        }
      } else if (data.candidate) {
        if (!peer) return;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate);
        else peer.queue.push(data.candidate);
      } else if (data.mute !== undefined) {
        const t = document.getElementById(`tile-${from}`);
        if (t) { t.classList.toggle('mic-off', !!data.mute.mic); t.classList.toggle('novideo', !!data.mute.cam); }
      }
    } catch (err) { console.warn('signal error', err); }
  });
  async function flush(peer) { while (peer.queue.length) await peer.pc.addIceCandidate(peer.queue.shift()); }

  socket.on('call-peer-joined', ({ name }) => {
    if (!call.active) {
      const t = toast(`📞 ${name} started a video call. Tap here to join.`, 'win', 6000);
      t.style.cursor = 'pointer'; t.onclick = () => { t.remove(); startCall(); };
    } else toast(`${name} joined the call`);
  });
  socket.on('call-peer-left', ({ id }) => removePeer(id));

  function addTile(id, name, stream, self = false) {
    let t = document.getElementById(`tile-${id}`);
    if (!t) {
      t = document.createElement('div');
      t.className = `tile${self ? ' self' : ''}`;
      t.id = `tile-${id}`;
      t.innerHTML = `<video autoplay playsinline ${self ? 'muted' : ''}></video>
        <div class="avatar">${esc((name || '?')[0].toUpperCase())}</div>
        <div class="nm">${esc(name)}</div><div class="muted-ic">🔇</div>`;
      self ? $('#tiles').prepend(t) : $('#tiles').appendChild(t);
    }
    const v = t.querySelector('video');
    if (v.srcObject !== stream) { v.srcObject = stream; v.play().catch(() => {}); }
    const hasVideo = stream.getVideoTracks().some((tr) => tr.enabled && tr.readyState === 'live');
    t.classList.toggle('novideo', !hasVideo);
    startMeter(t, stream);
  }

  // speaking indicator
  function startMeter(tile, stream) {
    if (tile._meter || !stream.getAudioTracks().length) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const src = actx.createMediaStreamSource(stream);
      const an = actx.createAnalyser(); an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      tile._meter = setInterval(() => {
        an.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
        tile.classList.toggle('speaking', avg > 18);
      }, 200);
    } catch (_) {}
  }
  function stopMeter(tile) { clearInterval(tile._meter); }

  function broadcastMute() {
    const a = call.stream.getAudioTracks()[0], v = call.stream.getVideoTracks()[0];
    const mute = { mic: !a || !a.enabled, cam: !v || !v.enabled };
    for (const id of call.peers.keys()) socket.emit('signal', { to: id, data: { mute } });
    const self = $('#tile-self');
    if (self) { self.classList.toggle('mic-off', mute.mic); self.classList.toggle('novideo', mute.cam); }
  }
  function syncCtrlButtons() {
    const a = call.stream.getAudioTracks()[0], v = call.stream.getVideoTracks()[0];
    $('#micBtn').classList.toggle('off', !a || !a.enabled);
    $('#camBtn').classList.toggle('off', !v || !v.enabled);
    $('#flipBtn').classList.toggle('hidden', !v);
  }
  $('#micBtn').onclick = () => {
    const a = call.stream?.getAudioTracks()[0]; if (!a) return;
    a.enabled = !a.enabled; syncCtrlButtons(); broadcastMute();
  };
  $('#camBtn').onclick = () => {
    const v = call.stream?.getVideoTracks()[0]; if (!v) return toast('No camera available', 'err');
    v.enabled = !v.enabled; syncCtrlButtons(); broadcastMute();
  };
  $('#flipBtn').onclick = async () => {
    const old = call.stream?.getVideoTracks()[0]; if (!old) return;
    call.facing = call.facing === 'user' ? 'environment' : 'user';
    try {
      const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: call.facing } });
      const nt = ns.getVideoTracks()[0];
      for (const { pc } of call.peers.values()) {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender) await sender.replaceTrack(nt);
      }
      call.stream.removeTrack(old); old.stop(); call.stream.addTrack(nt);
      $('#tile-self').classList.toggle('back', call.facing === 'environment');
      addTile('self', 'You', call.stream, true);
    } catch (_) { toast('Could not switch camera', 'err'); call.facing = call.facing === 'user' ? 'environment' : 'user'; }
  };

  function toggleDockSize() { $('#callDock').classList.toggle('dock-min'); }

  // tap the video strip to shrink / expand it
  $('#tiles').addEventListener('click', toggleDockSize);

  window.addEventListener('beforeunload', () => { if (call.active) socket.emit('call-leave'); });
})();
