(() => {
  'use strict';

  // ================= constants & helpers =================
  const SUITS = ['S', 'H', 'C', 'D'];
  const SYM = { S: '♠', H: '♥', C: '♣', D: '♦' };
  const SUIT_NAME = { S: 'Hukum', H: 'Paan', C: 'Chidi', D: 'Eent' };
  const SUIT_EN = { S: 'Spades', H: 'Hearts', C: 'Clubs', D: 'Diamonds' };
  const RANK_NAME = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack' };
  const RANKS_DESC = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
  const REACTIONS = ['🔥', '😂', '👏', '😮', '😡', '🙏', '🤝', '😎'];
  const PHRASES = ['Partner kaun hai? 🤔', 'Teeri kiske paas hai? 👀', 'Sahi khele! 👏', 'Jaldi chalo ⏩', 'Bach gaye 😅', 'Bas ek haath aur', 'GG 🙌'];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const suitOf = (c) => c.slice(-1);
  const rankOf = (c) => c.slice(0, -1);
  const isRed = (s) => s === 'H' || s === 'D';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#a4aad0');
  const initial = (name) => (Array.from(String(name || '?').trim())[0] || '?').toUpperCase();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function pointsOf(c) {
    if (c === '3S') return 30;
    const r = rankOf(c);
    if (r === 'A' || r === 'K' || r === 'Q' || r === 'J' || r === '10') return 10;
    if (r === '5') return 5;
    return 0;
  }
  const cardName = (c) => `${RANK_NAME[rankOf(c)] || rankOf(c)} of ${SUIT_EN[suitOf(c)]}`;
  const cardText = (c) => `<span class="cl s-${suitOf(c)} ${isRed(suitOf(c)) ? 'red' : ''}">${rankOf(c)}${SYM[suitOf(c)]}</span>`;
  const suitText = (s) => `<span class="cl s-${s} ${isRed(s) ? 'red' : ''}">${SYM[s]}</span> ${SUIT_NAME[s]}`;

  function cardHTML(c) {
    const s = suitOf(c), r = rankOf(c);
    const cls = ['card', 's-' + s];
    if (isRed(s)) cls.push('red');
    if (c === '3S') cls.push('teeri');
    let center;
    if (c === '3S') center = '<span class="pips3"><i>♠</i><i>♠</i><i>♠</i></span>';
    else if (r === 'J' || r === 'Q' || r === 'K') center = `<span class="face">${r}</span>`;
    else center = `<span class="pip">${SYM[s]}</span>`;
    const pts = pointsOf(c);
    return `<div class="${cls.join(' ')}"><span class="idx tl"><b>${r}</b><i>${SYM[s]}</i></span>${center}<span class="idx br"><b>${r}</b><i>${SYM[s]}</i></span>${pts ? `<span class="pts">${pts}</span>` : ''}</div>`;
  }

  // ================= storage, identity, prefs =================
  const store = {
    get(k, d) { try { const v = localStorage.getItem('kkt_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('kkt_' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  function makeToken() {
    const a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let token = store.get('token', null);
  if (!token) { token = makeToken(); store.set('token', token); }
  const prefs = Object.assign({ sound: true, vibrate: true, fourColor: false, badges: true }, store.get('prefs', {}));
  function applyPrefs() {
    document.body.classList.toggle('four-color', !!prefs.fourColor);
    document.body.classList.toggle('no-badges', !prefs.badges);
  }
  applyPrefs();

  // ================= sound =================
  const Sound = (() => {
    let ctx = null;
    function ensure() {
      if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        ctx = new C();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(freq, dur, { type = 'sine', gain = 0.07, when = 0, slide = 0 } = {}) {
      const c = ensure(); if (!c) return;
      const t = c.currentTime + when;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
    }
    function snap(gain = 0.12) {
      const c = ensure(); if (!c) return;
      const len = Math.floor(c.sampleRate * 0.06);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.8;
      g.gain.value = gain; src.buffer = buf;
      src.connect(f).connect(g).connect(c.destination); src.start();
    }
    return {
      unlock: ensure,
      play(kind) {
        if (!prefs.sound) return;
        switch (kind) {
          case 'card': snap(); break;
          case 'deal': for (let i = 0; i < 5; i++) setTimeout(() => snap(0.07), i * 60); break;
          case 'turn': tone(660, 0.12, { gain: 0.06 }); tone(990, 0.18, { gain: 0.06, when: 0.12 }); break;
          case 'bid': tone(520, 0.08, { type: 'triangle', gain: 0.05 }); break;
          case 'pass': tone(300, 0.1, { type: 'triangle', gain: 0.035, slide: 0.8 }); break;
          case 'trick': tone(440, 0.09, { type: 'triangle', gain: 0.05 }); tone(660, 0.12, { type: 'triangle', gain: 0.05, when: 0.08 }); break;
          case 'mine': [523, 659, 784].forEach((f, i) => tone(f, 0.14, { type: 'triangle', gain: 0.06, when: i * 0.07 })); break;
          case 'reveal': [784, 988, 1175].forEach((f, i) => tone(f, 0.22, { gain: 0.05, when: i * 0.09 })); break;
          case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, { type: 'triangle', gain: 0.07, when: i * 0.11 })); break;
          case 'fail': [392, 330, 262].forEach((f, i) => tone(f, 0.3, { type: 'sawtooth', gain: 0.03, when: i * 0.14 })); break;
          case 'chat': tone(880, 0.07, { gain: 0.03 }); break;
          case 'tick': tone(1200, 0.04, { type: 'square', gain: 0.02 }); break;
          default: break;
        }
      },
    };
  })();
  const vibrate = (p) => { if (prefs.vibrate && navigator.vibrate) try { navigator.vibrate(p); } catch (e) { /* ignore */ } };
  window.addEventListener('pointerdown', () => Sound.unlock(), { once: true });

  // ================= app state =================
  const S = {
    st: null, code: null, offset: 0,
    selected: null, bidAmount: null,
    callTrump: null, callCards: [], callShowAll: false,
    modal: null, sideOpen: false, sideTab: 'chat', unread: 0,
    chat: [], log: [],
    collectKey: null, resultKey: null, lastTickSec: null,
    replaced: false, booted: false,
  };

  const socket = io({ transports: ['websocket', 'polling'] });
  const emit = (ev, data) => new Promise((res) => socket.emit(ev, data, (r) => res(r || { ok: false, error: 'No response' })));
  async function act(a) {
    const r = await emit('action', a);
    if (!r.ok) toast(r.error, 'bad');
    return r;
  }

  // ================= toasts =================
  function toast(text, kind = '', ms = 2800) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = text;
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
  }

  // ================= screens =================
  function showScreen(name) {
    for (const id of ['home', 'lobby', 'game']) $('#' + id).classList.toggle('hidden', id !== name);
  }

  function nameOf(id) {
    const st = S.st;
    if (!st || !id) return '?';
    const p = st.players.find((x) => x.id === id) || st.spectators.find((x) => x.id === id);
    return p ? p.name : (st.names[id] || '?');
  }
  const isHost = () => S.st && S.st.hostId === S.st.you;
  const inviteLink = () => `${location.origin}/?room=${S.code}`;

  // ================= connection & room =================
  socket.on('connect', () => {
    $('#conn').classList.add('hidden');
    if (S.code && !S.replaced) rejoin(S.code, false);
    else if (!S.booted) boot();
  });
  socket.on('disconnect', () => { if (S.code) $('#conn').classList.remove('hidden'); });
  socket.on('state', onState);
  socket.on('fx', onFx);
  socket.on('chat', onChat);
  socket.on('chat_history', (msgs) => { S.chat = Array.isArray(msgs) ? msgs : []; renderChat(); });
  socket.on('kicked', () => exitRoom('The host removed you from the room'));
  socket.on('replaced', () => { S.replaced = true; exitRoom('This room is now open in another tab', true); });

  function boot() {
    S.booted = true;
    const url = new URL(location.href);
    const linkCode = (url.searchParams.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    const last = store.get('lastRoom', null);
    $('#name-input').value = store.get('name', '');
    if (linkCode) $('#code-input').value = linkCode;
    const target = linkCode || last;
    if (target) rejoin(target, !!linkCode);
    else showScreen('home');
  }

  async function rejoin(code, fromLink) {
    const r = await emit('join_room', { code, token, rejoinOnly: true });
    if (r.ok) return enterRoom(r.code);
    if (S.code) return exitRoom(r.error === 'not_member' ? 'You are no longer in this room' : r.error);
    store.set('lastRoom', null);
    showScreen('home');
    if (fromLink) {
      $('#code-input').value = code;
      if (r.error !== 'not_member') homeError(r.error);
      setTimeout(() => $('#name-input').focus(), 50);
    }
  }

  function enterRoom(code) {
    S.code = code;
    store.set('lastRoom', code);
    history.replaceState(null, '', '/?room=' + code);
  }

  function exitRoom(msg, keepLast) {
    S.code = null; S.st = null; S.modal = null; S.log = []; S.chat = [];
    if (!keepLast) store.set('lastRoom', null);
    history.replaceState(null, '', '/');
    closeModal(); setSide(false);
    $('#seats').innerHTML = ''; $('#trick').innerHTML = ''; $('#hand').innerHTML = '';
    showScreen('home');
    if (msg) toast(esc(msg), 'bad', 4000);
  }

  // ================= home =================
  function homeError(msg) { $('#home-error').textContent = msg || ''; }
  function getName() {
    const n = $('#name-input').value.replace(/\s+/g, ' ').trim();
    if (!n) { homeError('Enter your name first'); $('#name-input').focus(); return null; }
    store.set('name', n);
    return n;
  }
  $('#create-btn').addEventListener('click', async () => {
    const name = getName(); if (!name) return;
    homeError('');
    const btn = $('#create-btn'); btn.disabled = true;
    const r = await emit('create_room', { name, token });
    btn.disabled = false;
    if (r.ok) enterRoom(r.code); else homeError(r.error);
  });
  async function joinFromHome() {
    const name = getName(); if (!name) return;
    const code = $('#code-input').value.toUpperCase().replace(/[^A-Z]/g, '');
    if (code.length !== 4) { homeError('Room codes are 4 letters'); $('#code-input').focus(); return; }
    homeError('');
    const btn = $('#join-btn'); btn.disabled = true;
    const r = await emit('join_room', { code, name, token });
    btn.disabled = false;
    if (r.ok) enterRoom(r.code); else homeError(r.error);
  }
  $('#join-btn').addEventListener('click', joinFromHome);
  $('#code-input').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });
  $('#code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinFromHome(); });
  $('#name-input').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if ($('#code-input').value.length === 4) joinFromHome(); else $('#create-btn').click();
  });

  // ================= state handling =================
  function onState(st) {
    const prev = S.st;
    S.st = st;
    S.offset = st.serverTime - Date.now();
    const r = st.round;
    const prevR = prev && prev.round;

    // New round dealt
    if (r && (!prevR || prevR.number !== r.number || (prev.phase === 'lobby'))) {
      S.selected = null; S.callTrump = null; S.callCards = [];
      if (S.modal && S.modal.type === 'result') closeModal();
      $('#hand').innerHTML = '';
      $('#trick').innerHTML = '';
      Sound.play('deal');
      logSep(`Round ${r.number}${r.total ? ' of ' + r.total : ''}`);
    }
    // My turn started
    const myTurn = r && r.turnId === st.you;
    const wasMyTurn = prevR && prevR.turnId === prev.you && prev.phase === st.phase;
    if (myTurn && !wasMyTurn) {
      Sound.play('turn'); vibrate(60);
      if (st.phase === 'bidding') S.bidAmount = r.bidding.minNext;
    }
    if (st.phase === 'bidding' && myTurn) S.bidAmount = clamp(S.bidAmount || r.bidding.minNext, r.bidding.minNext, 250);
    // Calling modal for the bidder
    if (st.phase === 'calling' && myTurn && (!prev || prev.phase !== 'calling')) {
      S.callTrump = null; S.callCards = [];
      openModal('calling');
    }
    // Round result
    if ((st.phase === 'roundEnd' || st.phase === 'gameOver') && r) {
      const key = `${r.number}-${st.phase}`;
      if (S.resultKey !== key) {
        S.resultKey = key;
        const wasPlaying = prev && prev.phase === 'playing';
        setTimeout(() => {
          if (S.st && (S.st.phase === 'roundEnd' || S.st.phase === 'gameOver')) {
            openModal('result');
            if (S.st.phase === 'gameOver') confetti();
          }
        }, wasPlaying ? 1100 : 0);
      }
    }
    if (st.phase === 'lobby' && S.modal && ['result', 'calling', 'lastTrick'].includes(S.modal.type)) closeModal();
    render();
  }

  function render() {
    const st = S.st;
    if (!st) return;
    if (st.phase === 'lobby') { showScreen('lobby'); renderLobby(st); }
    else { showScreen('game'); renderGame(st); }
    if (S.modal) renderModal();
  }

  // ================= lobby =================
  function renderLobby(st) {
    const host = st.hostId === st.you;
    $('#lobby-code').textContent = st.code;
    $('#code-big').textContent = st.code;
    $('#wa-link').href = 'https://wa.me/?text=' + encodeURIComponent(`Kaali ki Teeri khelne aa jao! Room code: ${st.code}\n${inviteLink()}`);
    $('#native-share').hidden = !navigator.share;
    $('#player-count').textContent = `${st.players.length} of 10`;
    $('#lobby-players').innerHTML = st.players.map((p, i) => `
      <li class="prow ${p.connected ? '' : 'offline'}">
        <span class="seatno">${i + 1}</span>
        <span class="av" style="--c:${safeColor(p.color)}">${esc(initial(p.name))}</span>
        <span class="pinfo"><span class="pname">${esc(p.name)}${p.id === st.you ? ' <em>(you)</em>' : ''}</span><span class="ptags">${p.isHost ? '<span class="tag host">Host</span>' : ''}${p.isBot ? '<span class="tag">Bot</span>' : ''}${!p.connected ? '<span class="tag off">Away</span>' : ''}</span></span>
        ${host ? `<span class="prow-tools">
          <button type="button" data-move="${p.id}" data-dir="-1" aria-label="Move ${esc(p.name)} up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" data-move="${p.id}" data-dir="1" aria-label="Move ${esc(p.name)} down" ${i === st.players.length - 1 ? 'disabled' : ''}>↓</button>
          ${p.id !== st.you ? `<button type="button" data-kick="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button>` : '<span style="width:32px"></span>'}
        </span>` : '<span></span>'}
      </li>`).join('');
    $('#spectator-box').innerHTML = st.spectators.length
      ? `Watching: ${st.spectators.map((s) => esc(s.name)).join(', ')}` : '';
    $('#host-seat-tools').classList.toggle('hidden', !host);
    for (const sel of $$('#settings select')) {
      const key = sel.dataset.key;
      if (key === 'partnerCount') sel.options[0].textContent = `Auto (${st.partnerPreview})`;
      if (key === 'rounds') sel.options[0].textContent = `One deal each (${st.players.length})`;
      sel.value = String(st.settings[key]);
      sel.disabled = !host;
    }
    $('#settings-note').textContent = host ? 'You are the host. Changes apply for everyone.' : `Only ${nameOf(st.hostId)} (host) can change these.`;
    const n = st.players.length;
    const startBtn = $('#start-btn');
    startBtn.classList.toggle('hidden', !host);
    startBtn.disabled = n < 4;
    let hint;
    if (!host) hint = `Waiting for ${esc(nameOf(st.hostId))} to deal`;
    else if (n < 4) hint = `Need ${4 - n} more to start. Invite friends or add bots.`;
    else if (n < 6) hint = `${n} players ready. The game is best with 6 to 10.`;
    else hint = `${n} players ready`;
    $('#start-hint').innerHTML = hint;
  }

  $('#lobby').addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-key]');
    if (!sel) return;
    let v = sel.value;
    if (v === 'true') v = true; else if (v === 'false') v = false; else if (v !== 'auto') v = Number(v);
    act({ type: 'settings', settings: { [sel.dataset.key]: v } });
  });
  $('#lobby').addEventListener('click', (e) => {
    const kick = e.target.closest('[data-kick]');
    if (kick) return act({ type: 'kick', playerId: kick.dataset.kick });
    const mv = e.target.closest('[data-move]');
    if (mv) return act({ type: 'move_seat', playerId: mv.dataset.move, dir: Number(mv.dataset.dir) });
  });

  // ================= game =================
  function renderGame(st) {
    renderTopbar(st);
    renderSeats(st);
    renderTrick(st);
    renderCenter(st);
    renderAction(st);
    renderHand(st);
  }

  function renderTopbar(st) {
    const r = st.round;
    $('#tb-round').textContent = r ? `Round ${r.number}${r.total ? ' of ' + r.total : ''}` : '';
    $('#tb-code').textContent = `Room ${st.code}`;
    let chips = '';
    if (r && r.bidding.bidderId && st.phase !== 'bidding') {
      if (r.trump) {
        chips += `<span class="chip trump"><span class="k">Trump</span><span class="sym s-${r.trump} ${isRed(r.trump) ? 'red' : ''}">${SYM[r.trump]}</span>${SUIT_NAME[r.trump]}</span>`;
      }
      chips += `<span class="chip"><span class="k">Bid</span><b>${r.bidding.high}</b>${esc(nameOf(r.bidding.bidderId))}</span>`;
      for (const c of r.called) {
        chips += `<span class="chip called ${c.revealed ? 'revealed' : ''}">${cardText(c.card)}${c.revealed ? `<span class="who">${esc(nameOf(c.holderId))}</span>` : '<span class="q">hidden</span>'}</span>`;
      }
    } else if (r && st.phase === 'bidding') {
      chips += `<span class="chip"><span class="k">Dealer</span>${esc(nameOf(r.dealerId))}</span>`;
      chips += `<span class="chip"><span class="k">Partners</span>${r.partnerCount}</span>`;
    }
    $('#tb-info').innerHTML = chips;
    $('#tb-info-m').innerHTML = chips;
  }

  function seatMap(st) {
    const ids = st.players.map((p) => p.id);
    const meIdx = ids.indexOf(st.you);
    const base = meIdx >= 0 ? meIdx : 0;
    const n = ids.length;
    const map = {};
    ids.forEach((id, i) => { map[id] = (i - base + n) % n; });
    return { map, n };
  }

  function tableGeom() {
    const t = $('#table');
    const w = t.clientWidth || 1, h = t.clientHeight || 1;
    const aspect = w / h;
    if (aspect > 1.5) return { rx: 44, ry: 38 };
    if (aspect > 1.05) return { rx: 43, ry: 40 };
    return { rx: 40, ry: 42 };
  }

  function posFor(rel, n, scale = 1, geom = tableGeom()) {
    const a = Math.PI / 2 + (rel * 2 * Math.PI) / n;
    return { x: 50 + geom.rx * scale * Math.cos(a), y: 50 + geom.ry * scale * Math.sin(a) };
  }

  function renderSeats(st) {
    const box = $('#seats');
    const { map, n } = seatMap(st);
    const geom = tableGeom();
    const r = st.round;
    const seen = new Set();
    for (const p of st.players) {
      seen.add(p.id);
      let el = box.querySelector(`.seat[data-id="${p.id}"]`);
      if (!el) {
        el = document.createElement('div');
        el.className = 'seat';
        el.dataset.id = p.id;
        box.appendChild(el);
      }
      const pos = posFor(map[p.id], n, 1, geom);
      el.style.left = pos.x + '%';
      el.style.top = pos.y + '%';
      el.style.setProperty('--c', safeColor(p.color));
      const turn = r && r.turnId === p.id;
      el.className = 'seat' + (turn ? ' turn' : '') + (p.id === st.you ? ' me' : '')
        + (!p.connected || p.left ? ' offline' : '') + (st.phase === 'bidding' && p.passed ? ' passed' : '')
        + (pos.x > 58 ? ' bub-left' : '') + (turn && r.deadline ? ' timed' : '');

      let bubble = '';
      if (st.phase === 'bidding' && r) {
        if (turn) bubble = '<div class="bubble think">…</div>';
        else if (p.lastBid === 'pass') bubble = '<div class="bubble pass">Pass</div>';
        else if (p.lastBid != null) bubble = `<div class="bubble">${p.lastBid}</div>`;
      } else if (st.phase === 'calling' && turn) {
        bubble = '<div class="bubble think">Choosing…</div>';
      }
      let meta = '';
      if (r && p.inRound) {
        const inPlay = st.phase === 'playing' || st.phase === 'roundEnd' || st.phase === 'gameOver';
        meta = `<div class="meta">${inPlay ? `<span class="cap"><b>${p.captured}</b> pts</span>` : ''}<span><b>${p.cardsLeft}</b> cards</span></div>`;
      }
      const tags = (p.isDealer ? '<span class="t-d" title="Dealer">D</span>' : '')
        + (p.isBidder ? '<span class="t-b" title="Bidder">Bid</span>' : '')
        + (p.isPartner ? '<span class="t-p" title="Partner">P</span>' : '');
      el.innerHTML = `
        <div class="avatar"><span class="ring"></span>${esc(initial(p.name))}${p.isBot ? '<span class="botmark" aria-label="bot">🤖</span>' : ''}</div>
        ${bubble}
        <div class="nm">${p.id === st.you ? 'You' : esc(p.name)}</div>
        ${meta}
        <div class="tags">${tags}</div>`;
    }
    for (const el of $$('.seat', box)) if (!seen.has(el.dataset.id)) el.remove();
    tick();
  }

  function hashCard(c) { let h = 0; for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }

  function renderTrick(st) {
    const box = $('#trick');
    const r = st.round;
    const plays = r && st.phase === 'playing' && r.trick ? r.trick.plays : [];
    const { map, n } = seatMap(st);
    const geom = tableGeom();
    const keys = new Set(plays.map((p) => p.card));
    for (const el of $$('.tcard', box)) if (!keys.has(el.dataset.card)) el.remove();
    plays.forEach((p, i) => {
      let el = box.querySelector(`.tcard[data-card="${p.card}"]`);
      if (el && el.classList.contains('collect')) return;
      const target = posFor(map[p.playerId], n, 0.5, geom);
      if (!el) {
        el = document.createElement('div');
        el.className = 'tcard';
        el.dataset.card = p.card;
        el.innerHTML = cardHTML(p.card);
        el.style.setProperty('--rot', ((hashCard(p.card) % 15) - 7) + 'deg');
        const from = posFor(map[p.playerId], n, 1, geom);
        el.style.left = from.x + '%';
        el.style.top = from.y + '%';
        el.style.opacity = '0';
        box.appendChild(el);
        void el.offsetWidth; // start transition from the player's seat
      }
      el.style.zIndex = String(10 + i);
      el.style.left = target.x + '%';
      el.style.top = target.y + '%';
      el.style.opacity = '1';
    });
    if (r && st.phase === 'playing' && r.trick && r.trick.complete) {
      const win = r.trick.plays.find((p) => p.playerId === r.trick.winnerId);
      if (win) {
        const wEl = box.querySelector(`.tcard[data-card="${win.card}"]`);
        if (wEl) wEl.classList.add('win');
      }
      const key = `${r.number}-${r.trickNo}`;
      if (S.collectKey !== key) {
        S.collectKey = key;
        const trickCards = new Set(r.trick.plays.map((p) => p.card));
        setTimeout(() => {
          const cur = S.st;
          if (!cur || !cur.round) return;
          const m = seatMap(cur);
          const to = posFor(m.map[r.trick.winnerId], m.n, 1);
          for (const el of $$('.tcard', box)) {
            if (!trickCards.has(el.dataset.card)) continue;
            el.classList.add('collect');
            el.style.left = to.x + '%';
            el.style.top = to.y + '%';
            el.style.opacity = '0';
          }
        }, 1000);
      }
    }
  }

  function renderCenter(st) {
    const r = st.round;
    const c = $('#center');
    if (!r) { c.innerHTML = ''; return; }
    const bidder = r.bidding.bidderId;
    let html = '';
    if (st.phase === 'bidding') {
      html = r.bidding.high
        ? `<div class="c-label">Highest bid</div><div class="c-big">${r.bidding.high}</div><div class="c-sub"><b>${esc(nameOf(bidder))}</b></div>`
        : `<div class="c-label">Bidding opens at</div><div class="c-big">${r.bidding.minNext}</div><div class="c-sub">${esc(nameOf(r.turnId))} goes first</div>`;
    } else if (st.phase === 'calling') {
      html = `<div class="c-label">${esc(nameOf(bidder))} won at</div><div class="c-big">${r.bidding.high}</div><div class="c-sub">Picking trump and partners</div>`;
    } else if (st.phase === 'playing' || st.phase === 'roundEnd' || st.phase === 'gameOver') {
      const pct = clamp((r.knownTeamPoints / r.bidding.high) * 100, 0, 100);
      const made = r.knownTeamPoints >= r.bidding.high;
      html = `${r.trump ? `<div class="c-trump ${isRed(r.trump) ? 'red' : ''}">${SYM[r.trump]}</div>` : ''}
        <div class="c-sub">${st.phase === 'playing' ? `Trick <b>${r.trickNo}</b> of ${r.handSize}` : 'Round over'}</div>
        <div class="c-target ${made ? 'made' : ''}"><div class="progress"><i style="width:${pct}%"></i></div><span>Bid team <b>${r.knownTeamPoints}</b> of ${r.bidding.high}</span></div>`;
    }
    c.innerHTML = html;
  }

  function renderAction(st) {
    const box = $('#action');
    const r = st.round;
    if (st.isSpectator) {
      box.innerHTML = '<span class="a-text">You are watching this round. You will be dealt in next round.</span>';
      return;
    }
    if (!r) { box.innerHTML = ''; return; }
    const myTurn = r.turnId === st.you;
    const turnName = esc(nameOf(r.turnId));
    const timer = myTurn && r.deadline ? ' <span class="timer-text" id="my-timer"></span>' : '';
    let html = '';
    if (st.phase === 'bidding') {
      if (myTurn) {
        const min = r.bidding.minNext;
        const step = st.settings.bidStep;
        const amt = clamp(S.bidAmount || min, min, 250);
        S.bidAmount = amt;
        const quick = [min, 150, 175, 200, 225, 250].filter((v, i, a) => v >= min && v <= 250 && a.indexOf(v) === i && (v - min) % step === 0).slice(0, 4);
        html = `<div class="bidbox">
          <div class="row-top"><span class="a-your">Your bid</span>${timer}<span class="a-text">${r.bidding.high ? `Highest is <b>${r.bidding.high}</b> by ${esc(nameOf(r.bidding.bidderId))}` : 'No bids yet'}</span></div>
          <button type="button" class="btn ghost" data-act="pass" ${r.bidding.canPass ? '' : 'disabled title="Everyone passed, you must open"'}>Pass</button>
          <div style="display:flex;flex-direction:column;align-items:center;gap:6px">
            <div class="stepper">
              <button type="button" data-bid-step="-1" aria-label="Lower bid" ${amt <= min ? 'disabled' : ''}>−</button>
              <output aria-live="polite">${amt}</output>
              <button type="button" data-bid-step="1" aria-label="Raise bid" ${amt >= 250 ? 'disabled' : ''}>+</button>
            </div>
            <div class="quick">${quick.map((v) => `<button type="button" data-bid-set="${v}" class="${v === amt ? 'on' : ''}">${v}</button>`).join('')}</div>
          </div>
          <button type="button" class="btn primary" data-act="bid">Bid ${amt}</button>
        </div>`;
      } else {
        html = `<span class="a-text">Waiting for <b>${turnName}</b> to bid</span>`;
      }
    } else if (st.phase === 'calling') {
      html = myTurn
        ? `<button type="button" class="btn primary" data-open="calling">Choose trump and partners</button>${timer}`
        : `<span class="a-text"><b>${esc(nameOf(r.bidding.bidderId))}</b> is picking trump and partner cards</span>`;
    } else if (st.phase === 'playing') {
      const role = st.myRole === 'bidder' ? '<span class="role-pill bidder">You bid</span>'
        : st.myRole === 'partner' ? '<span class="role-pill partner">Secret partner</span>'
          : st.myRole === 'defender' ? '<span class="role-pill">Defending</span>' : '';
      if (myTurn && !r.trick.complete) {
        const led = r.trick.plays.length ? suitOf(r.trick.plays[0].card) : null;
        const mustFollow = led && st.hand.some((c) => suitOf(c) === led);
        const sel = S.selected && st.valid.includes(S.selected) ? S.selected : null;
        html = `${role}<span class="a-your">Your turn</span>${timer}`
          + (sel ? `<button type="button" class="btn primary small" data-act="play">Play ${cardText(sel)}</button>`
            : `<span class="a-text">${mustFollow ? `Follow ${suitText(led)}` : led ? 'Any card (no ' + SYM[led] + ')' : 'You lead'}. Tap a card twice to play.</span>`);
      } else if (r.trick.complete) {
        html = `${role}<span class="a-text"><b>${esc(nameOf(r.trick.winnerId))}</b> takes the trick${r.trick.points ? ` (+${r.trick.points})` : ''}</span>`;
      } else {
        html = `${role}<span class="a-text"><b>${turnName}</b> is playing</span>`;
      }
    } else if (st.phase === 'roundEnd' || st.phase === 'gameOver') {
      html = `<button type="button" class="btn primary" data-open="result">${st.phase === 'gameOver' ? 'Final scores' : 'Round results'}</button>`;
    }
    box.innerHTML = html;
  }

  function renderHand(st) {
    const box = $('#hand');
    const r = st.round;
    const hand = st.hand || [];
    const myTurn = st.phase === 'playing' && r && r.turnId === st.you && !r.trick.complete;
    const valid = new Set(st.valid || []);
    if (S.selected && !hand.includes(S.selected)) S.selected = null;
    const existing = new Map($$('.hc', box).map((el) => [el.dataset.card, el]));
    const ordered = hand.map((c, i) => {
      let el = existing.get(c);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'hc deal';
        el.dataset.card = c;
        el.setAttribute('aria-label', cardName(c));
        el.innerHTML = cardHTML(c);
        el.style.setProperty('--i', i);
        el.addEventListener('animationend', () => el.classList.remove('deal'), { once: true });
      }
      existing.delete(c);
      el.classList.toggle('sel', S.selected === c);
      el.classList.toggle('playable', myTurn && valid.has(c));
      el.classList.toggle('dim', myTurn && !valid.has(c));
      return el;
    });
    for (const el of existing.values()) el.remove();
    $$('.hand-empty', box).forEach((e) => e.remove());
    ordered.forEach((el, i) => { if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null); });
    if (!hand.length && st.phase !== 'lobby') {
      const m = document.createElement('span');
      m.className = 'hand-empty';
      m.textContent = st.isSpectator ? 'Watching' : (st.phase === 'playing' ? 'No cards left' : '');
      box.appendChild(m);
    }
    layoutHand();
  }

  function layoutHand() {
    const box = $('#hand');
    const cards = $$('.hc', box);
    if (!cards.length) return;
    const W = box.clientWidth - 8;
    const cw = cards[0].getBoundingClientRect().width || 60;
    const n = cards.length;
    const gap = 4;
    const need = n * cw + (n - 1) * gap;
    const ml = need <= W ? gap : -((n * cw - W) / (n - 1));
    box.style.setProperty('--ml', ml.toFixed(1) + 'px');
  }

  // ---- dock interactions ----
  $('#hand').addEventListener('click', (e) => {
    const btn = e.target.closest('.hc');
    if (!btn || !S.st) return;
    const st = S.st, r = st.round;
    const c = btn.dataset.card;
    const myTurn = st.phase === 'playing' && r && r.turnId === st.you && !r.trick.complete;
    const valid = (st.valid || []).includes(c);
    if (S.selected === c && myTurn && valid) { playCard(c); return; }
    if (myTurn && !valid) {
      const led = suitOf(r.trick.plays[0].card);
      toast(`You have ${SYM[led]} ${SUIT_NAME[led]}, so you must follow suit`, 'bad', 2200);
      vibrate([30, 40, 30]);
    }
    S.selected = S.selected === c ? null : c;
    renderHand(st); renderAction(st);
  });

  function playCard(c) {
    S.selected = null;
    Sound.play('card');
    act({ type: 'play', card: c });
  }

  $('#action').addEventListener('click', (e) => {
    const st = S.st; if (!st) return;
    const r = st.round;
    const step = e.target.closest('[data-bid-step]');
    if (step) {
      S.bidAmount = clamp((S.bidAmount || r.bidding.minNext) + Number(step.dataset.bidStep) * st.settings.bidStep, r.bidding.minNext, 250);
      return renderAction(st);
    }
    const set = e.target.closest('[data-bid-set]');
    if (set) { S.bidAmount = Number(set.dataset.bidSet); return renderAction(st); }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'bid') act({ type: 'bid', amount: S.bidAmount });
    else if (a.dataset.act === 'pass') act({ type: 'pass' });
    else if (a.dataset.act === 'play' && S.selected) playCard(S.selected);
  });

  // ================= timer ticker =================
  function tick() {
    const st = S.st;
    const r = st && st.round;
    for (const el of $$('.seat.timed')) {
      if (!r || !r.deadline || el.dataset.id !== r.turnId) el.classList.remove('timed', 'urgent');
    }
    if (!r || !r.deadline || !r.turnId) return;
    const total = (st.phase === 'calling' ? st.settings.turnTimer * 2 : st.settings.turnTimer) * 1000;
    const left = r.deadline - (Date.now() + S.offset);
    const p = clamp(left / total, 0, 1);
    const seat = $(`.seat[data-id="${r.turnId}"]`);
    if (seat) {
      seat.style.setProperty('--p', p.toFixed(3));
      seat.classList.toggle('urgent', left < 6000);
    }
    const sec = Math.max(0, Math.ceil(left / 1000));
    for (const t of $$('.timer-text')) {
      t.textContent = sec + 's';
      t.classList.toggle('urgent', left < 6000);
    }
    if (r.turnId === st.you && left < 5500 && left > 0 && S.lastTickSec !== sec) {
      S.lastTickSec = sec;
      Sound.play('tick');
    }
  }
  setInterval(tick, 250);

  // ================= modals =================
  function openModal(type, data) { S.modal = Object.assign({ type }, data || {}); renderModal(); }
  function closeModal() {
    S.modal = null;
    $('#modal').classList.add('hidden');
    $('#modal-card').innerHTML = '';
  }

  const CLOSE_BTN = '<button type="button" class="m-close" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';

  function renderModal() {
    const m = S.modal;
    if (!m) return;
    const st = S.st;
    let html = '';
    switch (m.type) {
      case 'calling':
        if (!st || st.phase !== 'calling' || !st.round || st.round.turnId !== st.you) { closeModal(); return; }
        html = modalCalling(st); break;
      case 'result':
        if (!st || !st.round || !st.round.result || (st.phase !== 'roundEnd' && st.phase !== 'gameOver')) { closeModal(); return; }
        html = st.phase === 'gameOver' ? modalGameOver(st) : modalResult(st); break;
      case 'scores': if (!st) { closeModal(); return; } html = modalScores(st); break;
      case 'lastTrick': if (!st) { closeModal(); return; } html = modalLastTrick(st); break;
      case 'menu': html = modalMenu(st); break;
      case 'rules': html = modalRules(st); break;
      case 'confirm-leave': html = modalConfirmLeave(st); break;
      case 'confirm-lobby': html = `<h2>End this game?</h2><p>Everyone goes back to the lobby and scores reset when you deal again.</p>
        <div class="m-actions"><button type="button" class="btn ghost" data-close>Keep playing</button><button type="button" class="btn danger" data-act="back-to-lobby">End game</button></div>`; break;
      default: closeModal(); return;
    }
    const card = $('#modal-card');
    const sameType = $('#modal').dataset.type === m.type && !$('#modal').classList.contains('hidden');
    const scroll = sameType ? card.scrollTop : 0;
    card.innerHTML = CLOSE_BTN + html;
    card.scrollTop = scroll;
    $('#modal').classList.remove('hidden');
    $('#modal').dataset.type = m.type;
  }

  function modalCalling(st) {
    const r = st.round;
    const k = r.partnerCount;
    const chosen = S.callCards.filter((c) => (st.callable || []).includes(c));
    S.callCards = chosen;
    const callable = new Set(st.callable || []);
    const hand = st.hand;
    const tp = SUITS.map((s) => {
      const cs = hand.filter((c) => suitOf(c) === s);
      const pts = cs.reduce((a, c) => a + pointsOf(c), 0);
      return `<button type="button" class="tp s-${s} ${isRed(s) ? 'red' : ''} ${S.callTrump === s ? 'on' : ''}" data-trump="${s}" aria-pressed="${S.callTrump === s}">
        <span class="tp-sym">${SYM[s]}</span><span class="tp-name">${SUIT_NAME[s]}</span><span class="tp-meta">${cs.length} card${cs.length === 1 ? '' : 's'}<br>${pts} pts</span></button>`;
    }).join('');
    const rows = SUITS.map((s) => {
      const cards = RANKS_DESC.map((rk) => rk + s)
        .filter((c) => callable.has(c) && (S.callShowAll || pointsOf(c) > 0 || chosen.includes(c)));
      if (!cards.length) return '';
      return `<div class="call-row"><span class="call-suit s-${s} ${isRed(s) ? 'red' : ''}">${SYM[s]}</span><div class="call-cards">${cards.map((c) => {
        const on = chosen.includes(c);
        return `<button type="button" class="mini ${on ? 'on' : ''}" data-call="${c}" aria-pressed="${on}" aria-label="${cardName(c)}" ${!on && chosen.length >= k ? 'disabled' : ''}>${cardHTML(c)}</button>`;
      }).join('')}</div></div>`;
    }).join('');
    const ready = S.callTrump && chosen.length === k;
    const label = ready ? `Confirm ${SYM[S.callTrump]} ${SUIT_NAME[S.callTrump]} with ${chosen.map((c) => rankOf(c) + SYM[suitOf(c)]).join(', ')}` : !S.callTrump ? 'Pick a trump suit' : `Pick ${k - chosen.length} more card${k - chosen.length > 1 ? 's' : ''}`;
    return `<h2>You won the bid at ${r.bidding.high}</h2>
      <p>Choose trump, then call ${k} card${k > 1 ? 's' : ''} you don't hold. Whoever holds ${k > 1 ? 'them' : 'it'} secretly joins your team. ${r.deadline ? '<span class="timer-text"></span> left' : ''}</p>
      <h3>Your hand</h3>
      <div class="mini-hand">${hand.map(cardHTML).join('')}</div>
      <h3>Trump suit</h3>
      <div class="trump-pick">${tp}</div>
      <h3>Partner cards <span class="count">${chosen.length} of ${k}</span></h3>
      <div class="call-grid">${rows}</div>
      <button type="button" class="link-btn call-more" data-act="call-show-all">${S.callShowAll ? 'Show only point cards' : 'Show all cards (including 0-point ones)'}</button>
      <div class="m-actions"><button type="button" class="btn primary wide" data-act="declare" ${ready ? '' : 'disabled'}>${label}</button></div>`;
  }

  function teamList(st, ids, res) {
    const calledBy = {};
    for (const c of res.called) (calledBy[c.holderId] = calledBy[c.holderId] || []).push(c.card);
    return ids
      .slice().sort((a, b) => (res.captured[b] || 0) - (res.captured[a] || 0))
      .map((id) => {
        const role = id === res.bidderId ? 'bidder' : calledBy[id] ? `partner via ${calledBy[id].map(cardText).join(' ')}` : '';
        return `<li><span>${esc(nameOf(id))}${id === st.you ? ' (you)' : ''} ${role ? `<span class="r">${role}</span>` : ''}</span><b>${res.captured[id] || 0}</b></li>`;
      }).join('');
  }

  function resultSummary(st) {
    const res = st.round.result;
    const team = new Set(res.teamIds);
    const allIds = Object.keys(res.captured);
    const def = allIds.filter((id) => !team.has(id));
    const defPts = def.reduce((s, id) => s + (res.captured[id] || 0), 0);
    return `
      <div class="result-head"><span class="stamp ${res.success ? 'ok' : 'bad'}">${res.success ? 'Bid made' : 'Bid failed'}</span></div>
      <p><b style="color:var(--text)">${esc(nameOf(res.bidderId))}</b> bid ${res.bid} in ${suitText(res.trump)} and the team collected <b style="color:var(--text)">${res.teamPoints}</b>.${res.early ? ' Ended early once the result was certain.' : ''}</p>
      <div class="teams">
        <div class="team bid"><h4>Bidding team <b>${res.teamPoints}</b></h4><ul>${teamList(st, res.teamIds, res)}</ul></div>
        <div class="team"><h4>Defenders <b>${defPts}</b></h4><ul>${teamList(st, def, res)}</ul></div>
      </div>`;
  }

  function modalResult(st) {
    const res = st.round.result;
    const rows = st.players.slice().sort((a, b) => b.score - a.score).map((p) => {
      const d = res.deltas[p.id] || 0;
      return `<tr class="${p.id === st.you ? 'me' : ''}"><td>${esc(p.name)}</td><td class="${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${d > 0 ? '+' : ''}${d}</td><td class="total">${p.score}</td></tr>`;
    }).join('');
    const host = st.hostId === st.you;
    const hostP = st.players.find((p) => p.id === st.hostId);
    const canDeal = host || !hostP || !hostP.connected;
    return `${resultSummary(st)}
      <h3>Scores</h3>
      <div class="table-scroll"><table class="score-table"><thead><tr><th>Player</th><th>This round</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="m-actions">
        ${canDeal ? '<button type="button" class="btn primary" data-act="next-round">Deal next round</button>' : ''}
        ${host ? '<button type="button" class="btn ghost" data-act="end-game">End game</button>' : ''}
      </div>
      ${canDeal ? '' : `<p class="m-foot">Waiting for ${esc(nameOf(st.hostId))} to deal round ${st.round.number + 1}</p>`}`;
  }

  function modalGameOver(st) {
    const sorted = st.players.slice().sort((a, b) => b.score - a.score);
    let rank = 0, prevScore = null;
    const podium = sorted.map((p, i) => {
      if (p.score !== prevScore) { rank = i + 1; prevScore = p.score; }
      return `<li class="${rank === 1 ? 'first' : ''}"><span class="rank">${rank}</span><span class="av" style="--c:${safeColor(p.color)}">${esc(initial(p.name))}</span><span>${esc(p.name)}${p.id === st.you ? ' (you)' : ''}</span><span class="pts">${p.score}</span></li>`;
    }).join('');
    const winners = sorted.filter((p) => p.score === sorted[0].score).map((p) => esc(p.name));
    return `<h2>${winners.join(' & ')} ${winners.length > 1 ? 'win' : 'wins'} the game</h2>
      <p>${st.history.length} round${st.history.length === 1 ? '' : 's'} played.</p>
      <ol class="podium">${podium}</ol>
      <h3>Last round</h3>
      ${resultSummary(st)}
      <div class="m-actions">
        ${st.hostId === st.you ? '<button type="button" class="btn primary" data-act="back-to-lobby">Play again</button>' : ''}
        <button type="button" class="btn ghost" data-open="scores">Full scorecard</button>
        <button type="button" class="btn ghost" data-act="leave">Leave room</button>
      </div>
      ${st.hostId === st.you ? '' : `<p class="m-foot">${esc(nameOf(st.hostId))} can start a new game</p>`}`;
  }

  function modalScores(st) {
    const hist = st.history;
    const players = st.players.slice().sort((a, b) => b.score - a.score);
    const head = hist.map((h) => `<th title="${esc(nameOf(h.bidderId))} bid ${h.bid}">R${h.round}</th>`).join('');
    const body = players.map((p) => `<tr class="${p.id === st.you ? 'me' : ''}"><td>${esc(p.name)}</td>${hist.map((h) => {
      const d = h.deltas[p.id];
      if (d === undefined) return '<td class="muted">–</td>';
      return `<td class="${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${d > 0 ? '+' : ''}${d || 0}</td>`;
    }).join('')}<td class="total">${p.score}</td></tr>`).join('');
    const list = hist.slice().reverse().map((h) => `<li>Round ${h.round}: <b>${esc(nameOf(h.bidderId))}</b> bid ${h.bid} in ${suitText(h.trump)}, team got ${h.teamPoints}. <span class="${h.success ? 'ok' : 'bad'}">${h.success ? 'Made' : 'Failed'}</span></li>`).join('');
    return `<h2>Scorecard</h2>
      ${hist.length ? `<div class="table-scroll"><table class="score-table"><thead><tr><th>Player</th>${head}<th>Total</th></tr></thead><tbody>${body}</tbody></table></div>
      <ul class="round-list">${list}</ul>` : '<p>No rounds finished yet. Scores show up here after the first round.</p>'}`;
  }

  function modalLastTrick(st) {
    const lt = st.round && st.round.lastTrick;
    if (!lt) return '<h2>Last trick</h2><p>No tricks played yet this round.</p>';
    return `<h2>Trick ${lt.trickNo}</h2>
      <p><b style="color:var(--text)">${esc(nameOf(lt.winnerId))}</b> won it${lt.points ? ` for ${lt.points} points` : ' (no points)'}.</p>
      <div class="last-trick">${lt.plays.map((p, i) => `<div class="lt-item ${p.playerId === lt.winnerId ? 'win' : ''}">${cardHTML(p.card)}<span>${i === 0 ? 'Led: ' : ''}${esc(nameOf(p.playerId))}</span></div>`).join('')}</div>`;
  }

  function modalMenu(st) {
    const sw = (key, label) => `<div class="toggle"><span>${label}</span><button type="button" class="switch" role="switch" aria-checked="${!!prefs[key]}" aria-label="${label}" data-pref="${key}"></button></div>`;
    const host = st && st.hostId === st.you;
    return `<h2>Menu</h2>
      ${st ? `<p>Room <b style="color:var(--text);letter-spacing:.1em">${esc(st.code)}</b></p>
      <div class="m-actions" style="margin-top:6px"><button type="button" class="btn small" data-act="copy-link">Copy invite link</button><button type="button" class="btn small" data-open="rules">How to play</button></div>` : ''}
      <h3>On this device</h3>
      <div class="toggles">
        ${sw('sound', 'Sound effects')}
        ${sw('vibrate', 'Vibrate on your turn')}
        ${sw('badges', 'Show points on cards')}
        ${sw('fourColor', 'Four-colour suits (green ♣, blue ♦)')}
      </div>
      <div class="m-actions">
        ${host && st.phase !== 'lobby' ? '<button type="button" class="btn danger" data-open="confirm-lobby">End game for everyone</button>' : ''}
        <button type="button" class="btn ghost" data-open="confirm-leave">Leave room</button>
      </div>`;
  }

  function modalConfirmLeave(st) {
    const mid = st && st.phase !== 'lobby' && st.phase !== 'gameOver' && !st.isSpectator;
    return `<h2>Leave the room?</h2>
      <p>${mid ? 'A bot will play your cards until this round ends, then your seat is freed.' : 'You can rejoin with the same code while the room is open.'}</p>
      <div class="m-actions"><button type="button" class="btn ghost" data-close>Stay</button><button type="button" class="btn danger" data-act="leave">Leave</button></div>`;
  }

  function modalRules(st) {
    const s = st ? st.settings : { minBid: 125, bidStep: 5, bidderMultiplier: 2, partnersLoseOnFail: true };
    return `<div class="rules"><h2>How to play</h2>
      <p>Kaali ki Teeri is a trick-taking game for 4 to 10 players (best with 6 to 10). The deck is worth 250 points in total.</p>
      <h3>Points</h3>
      <div class="pts-table"><div><b>30</b>${cardText('3S')} Kaali ki Teeri</div><div><b>10</b>each A, K, Q, J, 10</div><div><b>5</b>each 5</div></div>
      <p>Everything else is worth 0. A few 2s and 3s (never the 3♠) are removed so everyone gets the same number of cards.</p>
      <h3>1. Bid</h3>
      <p>Starting left of the dealer, each player bids how many points their team will collect, or passes. The opening bid is ${s.minBid}, raises go up by ${s.bidStep}, and the maximum is 250. Once you pass you are out of the bidding. If everyone passes, the last player must open.</p>
      <h3>2. Trump and partners</h3>
      <p>The highest bidder picks a trump suit (Hukum ♠, Paan ♥, Chidi ♣ or Eent ♦) and calls one or more cards they don't hold. Whoever holds a called card is secretly on the bidder's team. Nobody knows who the partners are until the called card is played.</p>
      <h3>3. Play</h3>
      <ul>
        <li>The bidder leads the first trick. The winner of each trick leads the next.</li>
        <li>You must follow the suit that was led if you can. If you can't, play anything, including a trump.</li>
        <li>The highest trump wins. If no trump was played, the highest card of the led suit wins.</li>
      </ul>
      <h3>4. Score</h3>
      <ul>
        <li>If the bidding team collects at least the bid, the bidder gets ${s.bidderMultiplier === 2 ? 'double the bid' : 'the bid'} and each partner gets the bid.</li>
        <li>If they fall short, the bidder loses ${s.bidderMultiplier === 2 ? 'double the bid' : 'the bid'}${s.partnersLoseOnFail ? ' and each partner loses the bid' : ''}.</li>
        <li>Defenders score nothing either way. Their job is to stop the bid.</li>
      </ul>
      <h3>Tips</h3>
      <ul>
        <li>Partners: once your team is known, throw your points onto tricks your side is winning.</li>
        <li>Defenders: watch which called cards are still hidden. Anyone could be a partner.</li>
        <li>Tap a card to lift it, tap it again to play. The last trick button in the top bar shows what just happened.</li>
      </ul></div>`;
  }

  // modal interactions
  $('#modal').addEventListener('click', async (e) => {
    if (e.target.id === 'modal') {
      if (S.modal && S.modal.type !== 'calling') closeModal();
      else closeModal();
      return;
    }
    if (e.target.closest('[data-close]')) return closeModal();
    const t = e.target.closest('[data-trump]');
    if (t) { S.callTrump = t.dataset.trump; return renderModal(); }
    const c = e.target.closest('[data-call]');
    if (c) {
      const card = c.dataset.call;
      const k = S.st.round.partnerCount;
      if (S.callCards.includes(card)) S.callCards = S.callCards.filter((x) => x !== card);
      else if (S.callCards.length < k) S.callCards.push(card);
      return renderModal();
    }
    const p = e.target.closest('[data-pref]');
    if (p) {
      const key = p.dataset.pref;
      prefs[key] = !prefs[key];
      store.set('prefs', prefs);
      applyPrefs();
      if (key === 'sound' && prefs.sound) Sound.play('bid');
      return renderModal();
    }
  });

  // ================= global click actions =================
  document.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) {
      const type = open.dataset.open;
      if (type === 'calling') { S.callTrump = S.callTrump || null; }
      openModal(type);
      return;
    }
    const a = e.target.closest('[data-act]');
    if (!a || a.closest('#action')) return;
    switch (a.dataset.act) {
      case 'declare': {
        const r = await act({ type: 'declare', trump: S.callTrump, cards: S.callCards });
        if (r.ok) closeModal();
        break;
      }
      case 'next-round': act({ type: 'next_round' }); break;
      case 'end-game': act({ type: 'end_game' }); break;
      case 'back-to-lobby': { const r = await act({ type: 'back_to_lobby' }); if (r.ok) closeModal(); break; }
      case 'leave': await emit('leave_room'); exitRoom(); break;
      case 'leave-confirm': openModal('confirm-leave'); break;
      case 'start': act({ type: 'start' }); break;
      case 'add-bot': act({ type: 'add_bot' }); break;
      case 'shuffle-seats': act({ type: 'shuffle_seats' }); break;
      case 'copy-link': copyLink(); break;
      case 'native-share':
        try { await navigator.share({ title: 'Kaali ki Teeri', text: `Join my Kaali ki Teeri room: ${S.code}`, url: inviteLink() }); } catch (err) { /* cancelled */ }
        break;
      case 'toggle-side': setSide(!S.sideOpen); break;
      case 'call-show-all': S.callShowAll = !S.callShowAll; renderModal(); break;
      default: break;
    }
  });

  async function copyLink() {
    const link = inviteLink();
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = link; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Invite link copied'); } catch (err) { toast(esc(link)); }
      ta.remove();
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (S.modal) closeModal();
      else if (S.sideOpen) setSide(false);
    }
  });

  // ================= side panel: chat + log =================
  const desktopSide = () => window.matchMedia('(min-width: 1100px)').matches;
  function setSide(open) {
    S.sideOpen = open;
    $('#side').classList.toggle('open', open);
    let bd = $('.side-backdrop');
    if (open && !desktopSide()) {
      if (!bd) {
        bd = document.createElement('div');
        bd.className = 'side-backdrop';
        bd.addEventListener('click', () => setSide(false));
        document.body.appendChild(bd);
      }
    } else if (bd) bd.remove();
    if (open && S.sideTab === 'chat') { S.unread = 0; updateBadge(); scrollChat(); }
  }
  function setTab(tab) {
    S.sideTab = tab;
    $$('#side .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('#chat-pane').classList.toggle('hidden', tab !== 'chat');
    $('#log-pane').classList.toggle('hidden', tab !== 'log');
    if (tab === 'chat') { S.unread = 0; updateBadge(); scrollChat(); }
    else scrollLog();
  }
  $$('#side .tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  function updateBadge() {
    const b = $('#chat-badge');
    b.hidden = !S.unread;
    b.textContent = S.unread > 9 ? '9+' : String(S.unread);
  }
  function chatVisible() { return (desktopSide() || S.sideOpen) && S.sideTab === 'chat'; }
  function scrollChat() { const l = $('#chat-list'); l.scrollTop = l.scrollHeight; }
  function scrollLog() { const l = $('#log-list'); l.scrollTop = l.scrollHeight; }

  function renderChat() {
    const list = $('#chat-list');
    list.innerHTML = S.chat.length
      ? S.chat.map((m) => `<li><b style="color:${safeColor(m.color)}">${esc(m.name)}</b>${esc(m.text)}</li>`).join('')
      : '<li class="empty">No messages yet. Say hi to the table.</li>';
    scrollChat();
  }
  function onChat(msg) {
    S.chat.push(msg);
    if (S.chat.length > 150) S.chat.shift();
    renderChat();
    const mine = S.st && msg.playerId === S.st.you;
    if (!chatVisible() && !mine) { S.unread++; updateBadge(); }
    if (!mine) Sound.play('chat');
    floatAtSeat(msg.playerId, `<div class="float-chat">${esc(msg.text)}</div>`, 3700);
  }
  $('#reactions').innerHTML = REACTIONS.map((r) => `<button type="button" data-react="${r}" aria-label="React ${r}">${r}</button>`).join('');
  $('#phrases').innerHTML = PHRASES.map((p) => `<button type="button" data-phrase="${esc(p)}">${esc(p)}</button>`).join('');
  $('#side').addEventListener('click', (e) => {
    const r = e.target.closest('[data-react]');
    if (r) { act({ type: 'react', emoji: r.dataset.react }); return; }
    const p = e.target.closest('[data-phrase]');
    if (p) act({ type: 'chat', text: p.dataset.phrase });
  });
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    act({ type: 'chat', text });
  });

  function addLog(html, cls = '') {
    S.log.push({ html, cls });
    if (S.log.length > 200) S.log.shift();
    const list = $('#log-list');
    const li = document.createElement('li');
    li.className = cls;
    li.innerHTML = html;
    list.appendChild(li);
    while (list.children.length > 200) list.firstChild.remove();
    scrollLog();
  }
  function logSep(text) { addLog(esc(text), 'sep'); }

  function floatAtSeat(playerId, html, ms) {
    const st = S.st;
    if (!st || st.phase === 'lobby') return;
    const { map, n } = seatMap(st);
    if (map[playerId] === undefined) return;
    const pos = posFor(map[playerId], n, 1);
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const el = wrap.firstElementChild;
    el.style.left = pos.x + '%';
    el.style.top = (pos.y - 4) + '%';
    $('#floats').appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // ================= fx (events from server) =================
  function onFx(events) {
    const st = S.st;
    const you = st && st.you;
    for (const e of events) {
      const who = `<b>${esc(nameOf(e.playerId) || e.name)}</b>`;
      const auto = e.auto ? ' <span class="muted">(auto)</span>' : '';
      switch (e.type) {
        case 'joined': addLog(`<b>${esc(e.name)}</b> joined${e.spectator ? ' to watch' : ''}`); if (st && st.phase === 'lobby' && e.playerId !== you) toast(`${esc(e.name)} joined`); break;
        case 'rejoined': addLog(`<b>${esc(e.name)}</b> is back`); break;
        case 'left': addLog(`<b>${esc(e.name)}</b> ${e.kicked ? 'was removed' : 'left'}`); if (e.playerId !== you) toast(`${esc(e.name)} ${e.kicked ? 'was removed' : 'left the room'}`); break;
        case 'host_changed': addLog(`<b>${esc(e.name)}</b> is now the host`, 'hl'); toast(e.playerId === you ? 'You are now the host' : `${esc(e.name)} is now the host`); break;
        case 'notice': toast(esc(e.text), '', 4000); addLog(esc(e.text), 'hl'); break;
        case 'round_start': addLog(`<b>${esc(nameOf(e.dealerId))}</b> dealt`); break;
        case 'bid': addLog(`${who} bid <b>${e.amount}</b>${auto}`); if (e.playerId !== you) Sound.play('bid'); break;
        case 'pass': addLog(`${who} passed${auto}`); if (e.playerId !== you) Sound.play('pass'); break;
        case 'bidding_won':
          addLog(`${who} won the bid at <b>${e.amount}</b>`, 'hl');
          toast(e.playerId === you ? `You won the bid at ${e.amount}` : `${esc(nameOf(e.playerId))} won the bid at ${e.amount}`, 'gold');
          Sound.play('reveal');
          break;
        case 'declared':
          addLog(`Trump is ${suitText(e.trump)}. Partner cards: ${e.cards.map(cardText).join(' ')}${auto}`, 'hl');
          toast(`Trump ${SYM[e.trump]} ${SUIT_NAME[e.trump]}. Partner cards ${e.cards.map((c) => rankOf(c) + SYM[suitOf(c)]).join(' ')}`, '', 4200);
          break;
        case 'card_played': if (e.playerId !== you) Sound.play('card'); if (e.auto) addLog(`${who} played ${cardText(e.card)}${auto}`); break;
        case 'partner_revealed':
          addLog(`${who} is a partner (${cardText(e.card)})`, 'hl');
          toast(e.playerId === you ? `You're revealed as ${esc(nameOf(e.bidderId))}'s partner` : `${esc(nameOf(e.playerId))} is ${esc(nameOf(e.bidderId))}'s partner`, 'gold', 3500);
          Sound.play('reveal');
          break;
        case 'trick_won':
          addLog(`${who} won trick ${e.trickNo}${e.points ? ` (+${e.points})` : ''}`);
          Sound.play(e.playerId === you ? 'mine' : 'trick');
          break;
        case 'round_end': {
          const res = S.st && S.st.round && S.st.round.result;
          addLog(`${esc(nameOf(e.bidderId))} ${e.success ? 'made' : 'missed'} the bid of ${e.bid} (${e.teamPoints})`, 'hl');
          const onTeam = res ? res.teamIds.includes(you) : e.bidderId === you;
          Sound.play(e.success === onTeam ? 'win' : 'fail');
          break;
        }
        case 'react': floatAtSeat(e.playerId, `<div class="float-emoji">${esc(e.emoji)}</div>`, 1900); break;
        case 'game_over': break;
        default: break;
      }
    }
  }

  // ================= confetti =================
  function confetti() {
    const box = document.createElement('div');
    box.className = 'confetti';
    const colors = ['#f2a922', '#fbf6ea', '#c8283b', '#58b4ff', '#6fdc8c'];
    for (let i = 0; i < 90; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = 2.2 + Math.random() * 2 + 's';
      p.style.animationDelay = Math.random() * .8 + 's';
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 5500);
  }

  // ================= resize =================
  let rz = null;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (S.st && S.st.phase !== 'lobby') { renderSeats(S.st); renderTrick(S.st); layoutHand(); }
      if (desktopSide() && $('.side-backdrop')) $('.side-backdrop').remove();
    }, 80);
  });

  renderChat();
})();
