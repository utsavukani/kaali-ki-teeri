'use strict';
/**
 * A game room: players, host controls, settings, rounds, timers and
 * per-player state views (each player only ever receives their own hand).
 */
const G = require('./game');
const { botAction } = require('./bot');


const BOT_NAMES = ['Raju', 'Pinky', 'Chintu', 'Munna', 'Guddu', 'Tinku', 'Bablu', 'Sonu', 'Pappu', 'Dolly', 'Bunty', 'Rinku'];
const COLORS = ['#f2a922', '#58b4ff', '#ff6f86', '#6fdc8c', '#b793ff', '#ff9f4a', '#3fd0c0', '#ff79d0', '#c3e35a', '#9aa8ff', '#ff8a6a', '#63d9ff'];
const REACTIONS = ['🔥', '😂', '👏', '😮', '😡', '🙏', '🤝', '😎'];

const SPEED = Number(process.env.BOT_SPEED || 1); // tests shrink every delay
const TRICK_PAUSE_MS = 1700;
const OFFLINE_GRACE_MS = 15000;
const HOST_GRACE_MS = 20000;
const OFFLINE_REMOVE_MS = 3 * 60 * 1000;
const ABANDON_MS = 20 * 60 * 1000;

function cleanName(name) {
  return String(name || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
}

class Room {
  constructor(io, code) {
    this.io = io;
    this.code = code;
    this.players = [];
    this.spectators = [];
    this.names = {}; // id -> last known name (for history of departed players)
    this.banned = new Set();
    this.hostId = null;
    this.settings = G.defaultSettings();
    this.phase = 'lobby'; // lobby | round | roundEnd | gameOver
    this.round = null;
    this.roundNumber = 0;
    this.totalRounds = 0;
    this.dealerSeat = -1;
    this.history = [];
    this.chat = [];
    this.chatSeq = 0;
    this.version = 0;
    this.turnTimer = null;
    this.collectTimer = null;
    this.hostTimer = null;
    this.deadline = null;
    this.sched = null;
    this.nextId = 1;
    this.lastHumanSeen = Date.now();
  }

  get channel() { return 'room:' + this.code; }

  // ---------- membership ----------
  members() { return this.players.concat(this.spectators); }
  getPlayer(id) { return this.players.find((p) => p.id === id) || null; }
  getMember(id) { return this.members().find((p) => p.id === id) || null; }
  findByToken(token) { return token ? this.members().find((p) => !p.isBot && p.token === token) || null : null; }
  connectedHumans() { return this.members().filter((p) => !p.isBot && p.connected); }

  _newId() { return 'u' + this.nextId++ + Math.random().toString(36).slice(2, 6); }

  _color() {
    const used = new Set(this.members().map((p) => p.color));
    return COLORS.find((c) => !used.has(c)) || COLORS[this.nextId % COLORS.length];
  }

  _uniqueName(name, selfId) {
    const taken = new Set(this.members().filter((p) => p.id !== selfId).map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 100; i++) {
      const candidate = `${name.slice(0, 13)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return name;
  }

  join(socket, { name, token } = {}) {
    const clean = cleanName(name);
    token = String(token || '').slice(0, 64);
    if (token && this.banned.has(token)) throw new G.GameError('The host removed you from this room');
    const existing = this.findByToken(token);
    if (existing) {
      if (existing.socketId && existing.socketId !== socket.id) {
        this.io.to(existing.socketId).emit('replaced');
      }
      existing.connected = true;
      existing.socketId = socket.id;
      existing.offlineSince = null;
      existing.left = false;
      if (clean) existing.name = this._uniqueName(clean, existing.id);
      this.names[existing.id] = existing.name;
      socket.join(this.channel);
      this.emitFx([{ type: 'rejoined', playerId: existing.id, name: existing.name }]);
      this.scheduleTurn();
      return existing;
    }
    if (!clean) throw new G.GameError('Enter your name first');
    if (!token) throw new G.GameError('Missing session token');
    const rec = {
      id: this._newId(), token, name: this._uniqueName(clean), isBot: false, connected: true,
      socketId: socket.id, score: 0, color: this._color(), lastChatAt: 0, lastReactAt: 0,
      left: false, offlineSince: null,
    };
    if (this.phase === 'lobby' && this.players.length < G.MAX_PLAYERS) {
      this.players.push(rec);
    } else if (this.spectators.length < 20) {
      rec.spectator = true;
      this.spectators.push(rec);
    } else {
      throw new G.GameError('Room is full');
    }
    this.names[rec.id] = rec.name;
    if (!this.hostId) this.hostId = rec.id;
    socket.join(this.channel);
    this.emitFx([{ type: 'joined', playerId: rec.id, name: rec.name, spectator: !!rec.spectator }]);
    return rec;
  }

  disconnect(socketId) {
    const m = this.members().find((p) => p.socketId === socketId);
    if (!m) return;
    m.connected = false;
    m.socketId = null;
    m.offlineSince = Date.now();
    if (m.id === this.hostId) this._scheduleHostCheck();
    this.scheduleTurn();
    this.broadcast();
  }

  leave(id) {
    const m = this.getMember(id);
    if (!m) return;
    if (m.spectator) {
      this.spectators = this.spectators.filter((s) => s.id !== id);
    } else if (this.phase === 'lobby' || this.phase === 'gameOver') {
      this.players = this.players.filter((p) => p.id !== id);
    } else {
      m.left = true; // bots play for them until the round ends, then the seat is freed
      m.connected = false;
      m.socketId = null;
      m.offlineSince = Date.now();
    }
    this.emitFx([{ type: 'left', playerId: id, name: m.name }]);
    if (this.hostId === id) this._migrateHost();
    this.scheduleTurn();
    this.broadcast();
  }

  _scheduleHostCheck() {
    clearTimeout(this.hostTimer);
    this.hostTimer = setTimeout(() => {
      const host = this.getMember(this.hostId);
      if (!host || !host.connected) this._migrateHost();
      this.broadcast();
    }, HOST_GRACE_MS * SPEED);
  }

  _migrateHost() {
    const next = this.players.find((p) => !p.isBot && p.connected && !p.left)
      || this.spectators.find((p) => p.connected);
    const prev = this.hostId;
    this.hostId = next ? next.id : (this.players.find((p) => !p.isBot && !p.left) || {}).id || null;
    if (this.hostId && this.hostId !== prev) {
      this.emitFx([{ type: 'host_changed', playerId: this.hostId, name: this.names[this.hostId] }]);
    }
  }

  /** Periodic cleanup of long-offline members; returns true if room is abandoned. */
  sweep() {
    const now = Date.now();
    if (this.connectedHumans().length) this.lastHumanSeen = now;
    let changed = false;
    const stale = (p) => !p.isBot && !p.connected && p.offlineSince && now - p.offlineSince > OFFLINE_REMOVE_MS;
    const sBefore = this.spectators.length;
    this.spectators = this.spectators.filter((s) => !stale(s));
    if (this.spectators.length !== sBefore) changed = true;
    if (this.phase === 'lobby') {
      const before = this.players.length;
      this.players = this.players.filter((p) => !stale(p));
      if (this.players.length !== before) changed = true;
    }
    if (!this.getMember(this.hostId) || !this.getMember(this.hostId).connected) {
      const h = this.getMember(this.hostId);
      if (!h || (h.offlineSince && now - h.offlineSince > HOST_GRACE_MS)) { this._migrateHost(); changed = true; }
    }
    if (changed) this.broadcast();
    return now - this.lastHumanSeen > ABANDON_MS;
  }

  destroy() {
    clearTimeout(this.turnTimer);
    clearTimeout(this.collectTimer);
    clearTimeout(this.hostTimer);
  }

  // ---------- host actions ----------
  _requireHost(id) {
    if (id !== this.hostId) throw new G.GameError('Only the host can do that');
  }

  addBot(id) {
    this._requireHost(id);
    if (this.phase !== 'lobby') throw new G.GameError('Add bots from the lobby');
    if (this.players.length >= G.MAX_PLAYERS) throw new G.GameError(`Table is full (${G.MAX_PLAYERS} max)`);
    const used = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `Bot ${this.nextId}`;
    const bot = { id: this._newId(), name, isBot: true, connected: true, score: 0, color: this._color(), left: false };
    this.players.push(bot);
    this.names[bot.id] = bot.name;
    this.broadcast();
  }

  kick(id, targetId) {
    this._requireHost(id);
    if (this.phase === 'round') throw new G.GameError('Wait for the round to finish');
    if (targetId === id) throw new G.GameError("You can't remove yourself");
    const t = this.getMember(targetId);
    if (!t) return;
    this.players = this.players.filter((p) => p.id !== targetId);
    this.spectators = this.spectators.filter((p) => p.id !== targetId);
    if (!t.isBot) {
      this.banned.add(t.token);
      if (t.socketId) {
        this.io.to(t.socketId).emit('kicked');
        const s = this.io.sockets.sockets.get(t.socketId);
        if (s) s.leave(this.channel);
      }
    }
    this.emitFx([{ type: 'left', playerId: targetId, name: t.name, kicked: true }]);
    if (this.phase === 'roundEnd' && this.players.length < G.MIN_PLAYERS) this._toLobby();
    this.broadcast();
  }

  shuffleSeats(id) {
    this._requireHost(id);
    if (this.phase !== 'lobby') throw new G.GameError('Seats can only change in the lobby');
    G.shuffle(this.players);
    this.broadcast();
  }

  moveSeat(id, targetId, dir) {
    this._requireHost(id);
    if (this.phase !== 'lobby') throw new G.GameError('Seats can only change in the lobby');
    const i = this.players.findIndex((p) => p.id === targetId);
    const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= this.players.length) return;
    [this.players[i], this.players[j]] = [this.players[j], this.players[i]];
    this.broadcast();
  }

  updateSettings(id, patch) {
    this._requireHost(id);
    if (this.phase === 'round') throw new G.GameError('Change settings between rounds');
    this.settings = G.sanitizeSettings(this.settings, patch);
    this.broadcast();
  }

  start(id) {
    this._requireHost(id);
    if (this.phase !== 'lobby') throw new G.GameError('Game already started');
    const n = this.players.length;
    if (n < G.MIN_PLAYERS) throw new G.GameError(`Need at least ${G.MIN_PLAYERS} players — add bots to fill seats`);
    if (n > G.MAX_PLAYERS) throw new G.GameError(`At most ${G.MAX_PLAYERS} players`);
    for (const p of this.players) p.score = 0;
    this.history = [];
    this.roundNumber = 0;
    this.totalRounds = this.settings.rounds === 'auto' ? n : this.settings.rounds;
    this.dealerSeat = Math.floor(Math.random() * n) - 1;
    this._startRound();
  }

  nextRound(id) {
    const host = this.getMember(this.hostId);
    if (id !== this.hostId && host && host.connected) throw new G.GameError('Waiting for the host to deal');
    if (this.phase !== 'roundEnd') throw new G.GameError('Round is not over yet');
    this._startRound();
  }

  endGame(id) {
    this._requireHost(id);
    if (this.phase !== 'roundEnd') throw new G.GameError('Finish the current round first');
    this.phase = 'gameOver';
    this.emitFx([{ type: 'game_over' }]);
    this._changed();
  }

  backToLobby(id) {
    this._requireHost(id);
    this._toLobby();
    this._changed();
  }

  _toLobby() {
    clearTimeout(this.collectTimer);
    this.phase = 'lobby';
    this.round = null;
    this.players = this.players.filter((p) => !p.left);
    this._seatSpectators();
  }

  _seatSpectators() {
    const waiting = this.spectators.filter((s) => s.connected);
    for (const s of waiting) {
      if (this.players.length >= G.MAX_PLAYERS) break;
      delete s.spectator;
      s.score = 0;
      this.players.push(s);
      this.spectators = this.spectators.filter((x) => x.id !== s.id);
    }
  }

  _startRound() {
    clearTimeout(this.collectTimer);
    this.players = this.players.filter((p) => !p.left);
    this._seatSpectators();
    if (this.players.length < G.MIN_PLAYERS) {
      this._toLobby();
      this.emitFx([{ type: 'notice', text: `Not enough players — need ${G.MIN_PLAYERS}. Back in the lobby.` }]);
      this._changed();
      return;
    }
    this.roundNumber += 1;
    this.dealerSeat = (this.dealerSeat + 1) % this.players.length;
    this.round = new G.Round({ seats: this.players.map((p) => p.id), dealerSeat: this.dealerSeat, settings: this.settings });
    this.phase = 'round';
    this.emitFx([{ type: 'round_start', roundNumber: this.roundNumber, dealerId: this.round.seats[this.round.dealerSeat] }]);
    this._changed();
  }

  // ---------- gameplay ----------
  act(id, a, auto = false) {
    const r = this.round;
    if (this.phase !== 'round' || !r) throw new G.GameError('No round in progress');
    if (r.turnId !== id) throw new G.GameError("It's not your turn");
    const events = [];
    const endBidding = () => {
      if (r.phase === 'calling') events.push({ type: 'bidding_won', playerId: r.bidding.bidderId, amount: r.bidding.high });
    };
    switch (a.type) {
      case 'bid': {
        const amount = Number(a.amount);
        r.bid(id, amount);
        events.push({ type: 'bid', playerId: id, amount, auto });
        endBidding();
        break;
      }
      case 'pass':
        r.pass(id);
        events.push({ type: 'pass', playerId: id, auto });
        endBidding();
        break;
      case 'declare':
        r.declare(id, String(a.trump || ''), Array.isArray(a.cards) ? a.cards.map(String) : []);
        events.push({ type: 'declared', playerId: id, trump: r.trump, cards: r.called.map((c) => c.card), auto });
        break;
      case 'play':
        events.push(...r.play(id, String(a.card || '')).map((e) => ({ ...e, auto })));
        break;
      default:
        throw new G.GameError('Unknown move');
    }
    this.emitFx(events);
    if (r.pending) this._scheduleCollect();
    this._changed();
  }

  _scheduleCollect() {
    clearTimeout(this.collectTimer);
    this.collectTimer = setTimeout(() => {
      this.collectTimer = null;
      const r = this.round;
      if (!r || !r.pending || this.phase !== 'round') return;
      r.collect();
      if (r.phase === 'done') this._finishRound();
      else this._changed();
    }, TRICK_PAUSE_MS * SPEED);
  }

  _finishRound() {
    const res = this.round.result;
    for (const p of this.players) p.score += res.deltas[p.id] || 0;
    this.history.push({
      round: this.roundNumber, bidderId: res.bidderId, bid: res.bid, trump: res.trump,
      success: res.success, teamPoints: res.teamPoints, teamIds: res.teamIds, called: res.called,
      deltas: { ...res.deltas },
    });
    const over = this.totalRounds > 0 && this.roundNumber >= this.totalRounds;
    this.phase = over ? 'gameOver' : 'roundEnd';
    this.emitFx([{ type: 'round_end', success: res.success, bidderId: res.bidderId, bid: res.bid, teamPoints: res.teamPoints, gameOver: over }]);
    this._changed();
  }

  _changed() {
    this.version += 1;
    this.scheduleTurn();
    this.broadcast();
  }

  scheduleTurn() {
    const r = this.round;
    const actorId = this.phase === 'round' && r ? r.turnId : null;
    const actor = actorId ? this.getPlayer(actorId) : null;
    const key = actor ? `${this.version}|${actorId}|${actor.isBot || actor.connected}` : null;
    if (key && this.sched === key) return; // unchanged: keep the running countdown
    clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.deadline = null;
    this.sched = key;
    if (!actor) return;
    const v = this.version;
    let delay = Infinity;
    if (actor.isBot) {
      delay = (r.phase === 'calling' ? 1800 : 750 + Math.random() * 800) * SPEED;
    } else {
      const t = this.settings.turnTimer;
      if (t > 0) {
        const ms = (r.phase === 'calling' ? t * 2 : t) * 1000;
        this.deadline = Date.now() + ms;
        delay = ms;
      }
      if (actor.left) {
        delay = 1200 * SPEED; // they left the game: play on their behalf quickly
      } else if (!actor.connected) {
        const offlineFor = Date.now() - (actor.offlineSince || Date.now());
        delay = Math.min(delay, Math.max(1500 * SPEED, OFFLINE_GRACE_MS * SPEED - offlineFor));
      }
    }
    if (delay !== Infinity) this.turnTimer = setTimeout(() => this._autoAct(actorId, v), delay);
  }

  _autoAct(id, v) {
    if (v !== this.version) return;
    const r = this.round;
    if (!r || r.turnId !== id || this.phase !== 'round') return;
    const p = this.getPlayer(id);
    if (!p) return;
    const a = botAction(r, id, { human: !p.isBot });
    try {
      this.act(id, a, !p.isBot);
    } catch (e) {
      console.error('auto-move failed', e);
    }
  }

  // ---------- social ----------
  sendChat(id, text) {
    const m = this.getMember(id);
    const clean = String(text || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!clean) return;
    const now = Date.now();
    if (now - m.lastChatAt < 500) throw new G.GameError('Slow down a little');
    m.lastChatAt = now;
    const msg = { id: ++this.chatSeq, playerId: id, name: m.name, color: m.color, text: clean, ts: now };
    this.chat.push(msg);
    if (this.chat.length > 120) this.chat.shift();
    this.io.to(this.channel).emit('chat', msg);
  }

  react(id, emoji) {
    const m = this.getMember(id);
    if (!REACTIONS.includes(emoji)) return;
    const now = Date.now();
    if (now - (m.lastReactAt || 0) < 350) return;
    m.lastReactAt = now;
    this.emitFx([{ type: 'react', playerId: id, emoji }]);
  }

  // ---------- dispatch ----------
  handle(id, a) {
    if (!this.getMember(id)) throw new G.GameError("You're not in this room");
    switch (a.type) {
      case 'bid': case 'pass': case 'declare': case 'play': {
        const m = this.getPlayer(id);
        if (!m) throw new G.GameError('Spectators can only watch');
        return this.act(id, a);
      }
      case 'start': return this.start(id);
      case 'next_round': return this.nextRound(id);
      case 'end_game': return this.endGame(id);
      case 'back_to_lobby': return this.backToLobby(id);
      case 'settings': return this.updateSettings(id, a.settings);
      case 'add_bot': return this.addBot(id);
      case 'kick': return this.kick(id, String(a.playerId || ''));
      case 'shuffle_seats': return this.shuffleSeats(id);
      case 'move_seat': return this.moveSeat(id, String(a.playerId || ''), Number(a.dir));
      case 'chat': return this.sendChat(id, a.text);
      case 'react': return this.react(id, String(a.emoji || ''));
      default: throw new G.GameError('Unknown action');
    }
  }

  // ---------- output ----------
  emitFx(events) {
    if (events.length) this.io.to(this.channel).emit('fx', events);
  }

  broadcast() {
    for (const m of this.members()) {
      if (!m.isBot && m.connected && m.socketId) this.io.to(m.socketId).emit('state', this.view(m.id));
    }
  }

  publicPhase() {
    if (this.phase === 'round' && this.round) return this.round.phase === 'done' ? 'roundEnd' : this.round.phase;
    return this.phase;
  }

  view(forId) {
    const r = this.phase === 'lobby' ? null : this.round;
    const me = this.getMember(forId);
    const bidderId = r ? r.bidding.bidderId : null;
    const players = this.players.map((p, seat) => {
      const o = {
        id: p.id, name: p.name, color: p.color, isBot: p.isBot, seat,
        connected: p.isBot ? true : p.connected, left: !!p.left, score: p.score, isHost: p.id === this.hostId,
      };
      if (r && r.hands[p.id]) {
        const last = [...r.bidding.history].reverse().find((h) => h.playerId === p.id);
        Object.assign(o, {
          inRound: true,
          cardsLeft: r.hands[p.id].length,
          captured: r.captured[p.id],
          tricks: r.tricksWon[p.id],
          isDealer: r.seats[r.dealerSeat] === p.id,
          passed: r.bidding.passed.has(p.id),
          lastBid: last ? (last.action === 'bid' ? last.amount : 'pass') : null,
          isBidder: r.phase !== 'bidding' && bidderId === p.id,
          isPartner: r.result
            ? r.result.teamIds.includes(p.id) && p.id !== bidderId
            : r.called.some((c) => c.revealed && c.holderId === p.id),
        });
      }
      return o;
    });

    let round = null;
    if (r) {
      const knownTeam = new Set([bidderId, ...r.called.filter((c) => c.revealed).map((c) => c.holderId)]);
      round = {
        number: this.roundNumber,
        total: this.totalRounds,
        phase: r.phase,
        dealerId: r.seats[r.dealerSeat],
        removed: r.removed,
        handSize: r.handSize,
        n: r.n,
        partnerCount: r.partnerCount,
        totalPoints: r.totalPoints,
        bidding: {
          high: r.bidding.high,
          bidderId,
          history: r.bidding.history.slice(-40),
          minNext: r.minNextBid(),
          canPass: r.phase === 'bidding' ? r.canPass(forId) : false,
        },
        trump: r.trump,
        called: r.called.map((c) => ({ card: c.baseCard, targetOrdinal: c.targetOrdinal, revealed: c.revealed, holderId: c.revealed ? c.holderId : null })),
        trick: r.trick ? {
          leaderId: r.trick.leaderId,
          plays: r.trick.plays,
          complete: !!r.pending,
          winnerId: r.pending ? r.pending.winnerId : null,
          points: r.pending ? r.pending.points : 0,
        } : null,
        lastTrick: r.lastTrick,
        trickNo: r.trickNo,
        numDecks: r.numDecksUsed,
        teamSplit: r.teamSplit,
        cardCounts: (() => {
          const counts = {};
          if (r.dealt) {
            for (const c of r.dealt) {
              const b = G.baseCard(c);
              counts[b] = (counts[b] || 0) + 1;
            }
          }
          return counts;
        })(),
        turnId: this.phase === 'round' ? r.turnId : null,
        deadline: this.deadline,
        knownTeamPoints: r.bidding.bidderId ? [...knownTeam].reduce((s, id) => s + (r.captured[id] || 0), 0) : 0,
        result: r.result,
      };
    }

    const inHand = r && r.hands[forId];
    let myRole = null;
    if (r && inHand && (r.phase === 'playing' || r.phase === 'done')) {
      myRole = forId === bidderId ? 'bidder' : r.called.some((c) => c.holderId === forId) ? 'partner' : 'defender';
    }

    return {
      code: this.code,
      you: forId,
      isSpectator: !!(me && me.spectator),
      hostId: this.hostId,
      phase: this.publicPhase(),
      settings: this.settings,
      partnerPreview: G.resolvePartnerCount(this.settings.partnerCount, Math.max(G.MIN_PLAYERS, this.players.length), this.settings.teamSplit !== 'auto' ? this.settings.teamSplit : null),
      roundsPreview: this.settings.rounds === 'auto' ? this.players.length : this.settings.rounds,
      minBidPreview: (() => {
        if (this.settings.minBid !== 'auto') return this.settings.minBid;
        const n = Math.max(G.MIN_PLAYERS, this.players.length);
        const preferredCpp = this.settings.cardsPerPlayer !== 'auto' ? Number(this.settings.cardsPerPlayer) : undefined;
        const cfg = G.getDeckConfig(n, preferredCpp);
        return Math.ceil(G.TOTAL_POINTS * cfg.numDecks / 2);
      })(),
      deckInfo: (() => {
        const n = Math.max(G.MIN_PLAYERS, this.players.length);
        const preferredCpp = this.settings.cardsPerPlayer !== 'auto' ? Number(this.settings.cardsPerPlayer) : undefined;
        const cfg = G.getDeckConfig(n, preferredCpp);
        return {
          numDecks: cfg.numDecks,
          cardsPerPlayer: cfg.cardsPerPlayer,
          teamOptions: cfg.teamOptions,
          cppOptions: cfg.cppOptions,
          teamSplit: this.settings.teamSplit,
        };
      })(),
      players,
      spectators: this.spectators.map((s) => ({ id: s.id, name: s.name, color: s.color, connected: s.connected })),
      round,
      hand: inHand ? G.sortHand(r.hands[forId], r.trump) : [],
      valid: r && r.phase === 'playing' && r.turnId === forId && this.phase === 'round' ? r.validCards(forId) : [],
      callable: r && r.phase === 'calling' && r.turnId === forId && this.phase === 'round' ? r.callableCards(forId) : null,
      myRole,
      history: this.history,
      names: this.names,
      serverTime: Date.now(),
    };
  }
}

module.exports = { Room, REACTIONS };
