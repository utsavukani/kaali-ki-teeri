'use strict';
/**
 * Kaali ki Teeri — pure rules engine (no networking).
 *
 * Card ids look like "AS" (Ace of Spades), "10H", "3S" (the Kaali ki Teeri).
 * Suits: S = Hukum (spades), H = Paan (hearts), C = Chidi (clubs), D = Eent (diamonds).
 */
const crypto = require('crypto');

const SUITS = ['S', 'H', 'C', 'D'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
// Zero-point cards removed so the deck divides evenly (never touches 3S or any point card).
const REMOVAL_ORDER = ['2C', '2D', '2H', '2S', '3C', '3D', '3H', '4C', '4D', '4H', '4S'];
const TOTAL_POINTS = 250;
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 10;

class GameError extends Error {}

const suitOf = (c) => c.slice(-1);
const rankOf = (c) => c.slice(0, -1);
const rankValue = (c) => RANK_VALUE[rankOf(c)];

function pointsOf(c) {
  if (c === '3S') return 30;
  const r = rankOf(c);
  if (r === 'A' || r === 'K' || r === 'Q' || r === 'J' || r === '10') return 10;
  if (r === '5') return 5;
  return 0;
}

function buildDeck(numPlayers) {
  const removeCount = 52 % numPlayers;
  const removed = REMOVAL_ORDER.slice(0, removeCount);
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) {
    const id = r + s;
    if (!removed.includes(id)) deck.push(id);
  }
  return { deck, removed };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Rotation of S,H,C,D keeps colours alternating; trump goes first. */
function suitOrder(trump) {
  const base = ['S', 'H', 'C', 'D'];
  if (!trump) return base;
  const i = base.indexOf(trump);
  return base.slice(i).concat(base.slice(0, i));
}

function sortHand(hand, trump) {
  const order = suitOrder(trump);
  return hand.slice().sort((a, b) =>
    order.indexOf(suitOf(a)) - order.indexOf(suitOf(b)) || rankValue(b) - rankValue(a));
}

/** Does card a beat card b, given the led suit and trump? */
function beats(a, b, led, trump) {
  const sa = suitOf(a), sb = suitOf(b);
  if (sa === sb) return rankValue(a) > rankValue(b);
  if (sa === trump) return true;
  if (sb === trump) return false;
  return false; // a is off-suit and not trump
}

function trickWinner(plays, trump) {
  const led = suitOf(plays[0].card);
  let best = plays[0];
  for (let i = 1; i < plays.length; i++) {
    if (beats(plays[i].card, best.card, led, trump)) best = plays[i];
  }
  return best.playerId;
}

function autoPartnerCount(n) {
  if (n <= 5) return 1;
  if (n <= 7) return 2;
  if (n <= 9) return 3;
  return 4;
}

function resolvePartnerCount(setting, n) {
  const k = setting === 'auto' ? autoPartnerCount(n) : Number(setting);
  return Math.max(1, Math.min(k, n - 2));
}

function defaultSettings() {
  return {
    minBid: 125,
    bidStep: 5,
    partnerCount: 'auto',
    bidderMultiplier: 2,
    partnersLoseOnFail: true,
    rounds: 'auto',
    turnTimer: 0,
    earlyFinish: false,
  };
}

const SETTING_RULES = {
  minBid: (v) => [100, 110, 120, 125, 130, 140, 150, 160, 175, 200].includes(v),
  bidStep: (v) => [5, 10].includes(v),
  partnerCount: (v) => v === 'auto' || [1, 2, 3, 4].includes(v),
  bidderMultiplier: (v) => [1, 2].includes(v),
  partnersLoseOnFail: (v) => typeof v === 'boolean',
  rounds: (v) => v === 'auto' || [0, 3, 5, 8, 10, 12, 15, 20].includes(v),
  turnTimer: (v) => [0, 20, 30, 45, 60, 90].includes(v),
  earlyFinish: (v) => typeof v === 'boolean',
};

function sanitizeSettings(current, patch) {
  const next = { ...current };
  if (!patch || typeof patch !== 'object') return next;
  for (const [key, check] of Object.entries(SETTING_RULES)) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (check(v)) next[key] = v;
    else throw new GameError(`Invalid value for ${key}`);
  }
  return next;
}

class Round {
  /**
   * @param {object} o
   * @param {string[]} o.seats player ids in seat order (clockwise)
   * @param {number} o.dealerSeat
   * @param {object} o.settings
   * @param {string[]} [o.deck] optional pre-ordered deck (tests)
   */
  constructor({ seats, dealerSeat, settings, deck }) {
    if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) {
      throw new GameError(`Need ${MIN_PLAYERS}–${MAX_PLAYERS} players`);
    }
    this.seats = seats.slice();
    this.n = seats.length;
    this.dealerSeat = dealerSeat % this.n;
    this.settings = { ...settings };
    this.partnerCount = resolvePartnerCount(settings.partnerCount, this.n);

    const built = buildDeck(this.n);
    this.removed = built.removed;
    this.dealt = built.deck.slice();
    const cards = deck ? deck.slice() : shuffle(built.deck);
    this.handSize = cards.length / this.n;
    this.hands = {};
    this.seats.forEach((pid, i) => {
      this.hands[pid] = cards.slice(i * this.handSize, (i + 1) * this.handSize);
    });

    this.captured = {};
    this.tricksWon = {};
    for (const pid of this.seats) { this.captured[pid] = 0; this.tricksWon[pid] = 0; }

    this.phase = 'bidding';
    this.bidding = { high: 0, bidderId: null, passed: new Set(), history: [] };
    this.turnSeat = (this.dealerSeat + 1) % this.n;

    this.trump = null;
    this.called = []; // [{card, holderId, revealed, revealedAtTrick}]
    this.team = null; // Set of ids (server-side truth; hidden from clients until revealed)
    this.trick = null; // {leaderId, plays: [{playerId, card}]}
    this.pending = null; // completed trick waiting to be collected: {winnerId, points}
    this.lastTrick = null;
    this.trickNo = 0;
    this.result = null;
  }

  seatOf(pid) { return this.seats.indexOf(pid); }

  get turnId() {
    if (this.phase === 'bidding' || this.phase === 'calling') return this.seats[this.turnSeat];
    if (this.phase === 'playing' && !this.pending) return this.seats[this.turnSeat];
    return null;
  }

  _assertTurn(pid, phase) {
    if (this.phase !== phase) throw new GameError('Not the right time for that');
    if (this.turnId !== pid) throw new GameError("It's not your turn");
  }

  // ---------- Bidding ----------
  minNextBid() {
    const { high } = this.bidding;
    return high ? high + this.settings.bidStep : this.settings.minBid;
  }

  canPass(pid) {
    if (this.bidding.high) return true;
    // Nobody has bid yet: the last player standing must open at the minimum.
    return this.seats.some((p) => p !== pid && !this.bidding.passed.has(p));
  }

  bid(pid, amount) {
    this._assertTurn(pid, 'bidding');
    if (!Number.isInteger(amount)) throw new GameError('Bid must be a number');
    const min = this.minNextBid();
    if (amount < min) throw new GameError(`Bid at least ${min}`);
    if (amount > TOTAL_POINTS) throw new GameError(`Maximum bid is ${TOTAL_POINTS}`);
    if (amount % this.settings.bidStep !== 0) throw new GameError(`Bids go up in steps of ${this.settings.bidStep}`);
    this.bidding.high = amount;
    this.bidding.bidderId = pid;
    this.bidding.history.push({ playerId: pid, action: 'bid', amount });
    this._advanceBidding();
  }

  pass(pid) {
    this._assertTurn(pid, 'bidding');
    if (!this.canPass(pid)) throw new GameError(`Everyone passed — you must open at ${this.settings.minBid}`);
    this.bidding.passed.add(pid);
    this.bidding.history.push({ playerId: pid, action: 'pass' });
    this._advanceBidding();
  }

  _advanceBidding() {
    const b = this.bidding;
    if (b.high >= TOTAL_POINTS) return this._endBidding();
    const active = this.seats.filter((p) => !b.passed.has(p));
    if (b.bidderId && active.length === 1 && active[0] === b.bidderId) return this._endBidding();
    let s = this.turnSeat;
    for (let k = 0; k < this.n; k++) {
      s = (s + 1) % this.n;
      if (!b.passed.has(this.seats[s])) break;
    }
    this.turnSeat = s;
  }

  _endBidding() {
    this.phase = 'calling';
    this.turnSeat = this.seatOf(this.bidding.bidderId);
  }

  // ---------- Trump + partner calling ----------
  callableCards(pid) {
    const own = new Set(this.hands[pid]);
    return this.dealt.filter((c) => !own.has(c));
  }

  holderOf(card) {
    return this.seats.find((p) => this.hands[p].includes(card)) || null;
  }

  declare(pid, trump, cards) {
    this._assertTurn(pid, 'calling');
    if (!SUITS.includes(trump)) throw new GameError('Pick a trump suit');
    if (!Array.isArray(cards)) throw new GameError('Pick partner cards');
    const uniq = [...new Set(cards)];
    if (uniq.length !== this.partnerCount) {
      throw new GameError(`Call exactly ${this.partnerCount} partner card${this.partnerCount > 1 ? 's' : ''}`);
    }
    const allowed = new Set(this.callableCards(pid));
    for (const c of uniq) {
      if (!allowed.has(c)) throw new GameError("You can't call a card from your own hand");
    }
    this.trump = trump;
    this.called = uniq.map((card) => ({ card, holderId: this.holderOf(card), revealed: false, revealedAtTrick: null }));
    this.team = new Set([pid, ...this.called.map((c) => c.holderId)]);
    this.phase = 'playing';
    this.trickNo = 1;
    this.trick = { leaderId: pid, plays: [] };
    this.turnSeat = this.seatOf(pid); // bidder leads the first trick
  }

  // ---------- Trick play ----------
  validCards(pid) {
    const hand = this.hands[pid] || [];
    if (this.phase !== 'playing' || !this.trick || this.trick.plays.length === 0) return hand.slice();
    const led = suitOf(this.trick.plays[0].card);
    const follow = hand.filter((c) => suitOf(c) === led);
    return follow.length ? follow : hand.slice();
  }

  play(pid, card) {
    this._assertTurn(pid, 'playing');
    const hand = this.hands[pid];
    if (!hand.includes(card)) throw new GameError("That card isn't in your hand");
    if (!this.validCards(pid).includes(card)) {
      throw new GameError(`You must follow ${suitOf(this.trick.plays[0].card)} if you have it`);
    }
    hand.splice(hand.indexOf(card), 1);
    this.trick.plays.push({ playerId: pid, card });
    const events = [{ type: 'card_played', playerId: pid, card, trickNo: this.trickNo }];

    for (const c of this.called) {
      if (c.card === card && !c.revealed) {
        c.revealed = true;
        c.revealedAtTrick = this.trickNo;
        events.push({ type: 'partner_revealed', playerId: pid, card, bidderId: this.bidding.bidderId });
      }
    }

    if (this.trick.plays.length === this.n) {
      const winnerId = trickWinner(this.trick.plays, this.trump);
      const points = this.trick.plays.reduce((s, p) => s + pointsOf(p.card), 0);
      this.pending = { winnerId, points };
      events.push({ type: 'trick_won', winnerId, points, trickNo: this.trickNo });
    } else {
      this.turnSeat = (this.turnSeat + 1) % this.n;
    }
    return events;
  }

  /** Move a completed trick into the winner's pile and set up the next one. */
  collect() {
    if (!this.pending) return [];
    const { winnerId, points } = this.pending;
    this.captured[winnerId] += points;
    this.tricksWon[winnerId] += 1;
    this.lastTrick = { plays: this.trick.plays.slice(), winnerId, points, trickNo: this.trickNo };
    this.pending = null;

    const handsEmpty = this.seats.every((p) => this.hands[p].length === 0);
    if (handsEmpty || (this.settings.earlyFinish && this._decided())) {
      this._finish(!handsEmpty);
      return [{ type: 'round_end' }];
    }
    this.trickNo += 1;
    this.trick = { leaderId: winnerId, plays: [] };
    this.turnSeat = this.seatOf(winnerId);
    return [];
  }

  teamPoints() {
    let s = 0;
    for (const p of this.team || []) s += this.captured[p];
    return s;
  }

  _decided() {
    const bid = this.bidding.high;
    const teamPts = this.teamPoints();
    const collected = this.seats.reduce((s, p) => s + this.captured[p], 0);
    const defensePts = collected - teamPts;
    return teamPts >= bid || defensePts > TOTAL_POINTS - bid;
  }

  _finish(early = false) {
    const bid = this.bidding.high;
    const bidderId = this.bidding.bidderId;
    const teamIds = this.seats.filter((p) => this.team.has(p));
    const teamPoints = this.teamPoints();
    const success = teamPoints >= bid;
    const mult = this.settings.bidderMultiplier;
    const deltas = {};
    for (const p of this.seats) {
      let d = 0;
      if (p === bidderId) d = success ? bid * mult : -bid * mult;
      else if (this.team.has(p)) d = success ? bid : (this.settings.partnersLoseOnFail ? -bid : 0);
      deltas[p] = d;
    }
    for (const c of this.called) c.revealed = true;
    this.result = {
      bid,
      bidderId,
      trump: this.trump,
      called: this.called.map((c) => ({ card: c.card, holderId: c.holderId })),
      teamIds,
      teamPoints,
      success,
      early,
      deltas,
      captured: { ...this.captured },
      tricksWon: { ...this.tricksWon },
    };
    this.phase = 'done';
  }
}

module.exports = {
  SUITS, RANKS, TOTAL_POINTS, MIN_PLAYERS, MAX_PLAYERS,
  GameError, Round,
  suitOf, rankOf, rankValue, pointsOf, beats, trickWinner, sortHand, suitOrder,
  buildDeck, shuffle, autoPartnerCount, resolvePartnerCount, defaultSettings, sanitizeSettings,
};
