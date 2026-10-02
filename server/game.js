'use strict';
/**
 * Kaali ki Teeri — pure rules engine (no networking).
 *
 * Card ids look like "AS" (Ace of Spades), "10H", "3S" (the Kaali ki Teeri).
 * Suits: S = Hukum (spades), H = Paan (hearts), C = Chidi (clubs), D = Eent (diamonds).
 *
 * Multi-deck support:
 *   ≤5 players  → 1 deck
 *   6–7 players → 2 decks
 *   8–10 players → 3 decks
 *
 * Removal order (to make total cards divisible by numPlayers):
 *   Remove 0-point cards in rank order 2, 4, 6, 8 within each suit,
 *   suit order: Diamond (D) → Chidi/Club (C) → Heart (H) → Kaali/Spade (S).
 *   3S (Kaali ki Teeri) is NEVER removed.
 *
 * When multiple decks are used, duplicate cards get a "#2" / "#3" suffix
 * (e.g. "AS#2") so every card id is unique, allowing normal Set/Array logic.
 */
const crypto = require('crypto');

const SUITS = ['S', 'H', 'C', 'D'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));

/**
 * Removal candidates in priority order: zero-point ranks (2,4,6,7)
 * in suit order D→C→H→S per rank tier.  3S is never in this list.
 * Order: ALL 2s exhausted first, then ALL 4s, then ALL 6s, then ALL 7s.
 */
const REMOVABLE_RANKS = ['2', '4', '6', '7'];
const REMOVAL_SUIT_ORDER = ['D', 'C', 'H', 'S'];

function buildRemovalOrder() {
  const order = [];
  for (const rank of REMOVABLE_RANKS) {
    for (const suit of REMOVAL_SUIT_ORDER) {
      const card = rank + suit;
      if (card !== '3S') order.push(card); // 3S can never be removed
    }
  }
  return order; // 16 removable cards per deck
}
const REMOVAL_ORDER_PER_DECK = buildRemovalOrder();

const TOTAL_POINTS = 250;
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 10;

class GameError extends Error {}

/**
 * Strip the deck-suffix (#2, #3) to get the real card id.
 * e.g. "AS#2" → "AS", "3S" → "3S"
 */
const baseCard = (c) => c.replace(/#\d+$/, '');
const suitOf = (c) => baseCard(c).slice(-1);
const rankOf = (c) => baseCard(c).slice(0, -1);
const rankValue = (c) => RANK_VALUE[rankOf(c)];

function pointsOf(c) {
  if (baseCard(c) === '3S') return 30;
  const r = rankOf(c);
  if (r === 'A' || r === 'K' || r === 'Q' || r === 'J' || r === '10') return 10;
  if (r === '5') return 5;
  return 0;
}

/**
 * Returns deck configuration for a given player count.
 *
 * @param {number} n - player count
 * @param {number} [preferredCpp] - preferred cardsPerPlayer (only honoured for n=9)
 * @returns {{ numDecks, cardsPerPlayer, teamOptions, cppOptions }}
 *
 * Table:
 *   n ≤5 → 1 deck,  floor(52/n) cards
 *   n=6  → 2 decks, 15 cards, [3,3]
 *   n=7  → 2 decks, 13 cards, [3,4] or [4,3]  (15 is mathematically impossible)
 *   n=8  → 3 decks, 15 cards, [4,4]
 *   n=9  → 3 decks, 13 OR 15 cards, [4,5] or [5,4]
 *   n=10 → 3 decks, 13 cards, [5,5]
 */
function getDeckConfig(n, preferredCpp) {
  if (n <= 5) {
    return { numDecks: 1, cardsPerPlayer: Math.floor(52 / n), teamOptions: null, cppOptions: null };
  }
  switch (n) {
    case 6:  return { numDecks: 2, cardsPerPlayer: 15, teamOptions: [[3, 3]], cppOptions: null };
    case 7:  return { numDecks: 2, cardsPerPlayer: 13, teamOptions: [[3, 4], [4, 3]], cppOptions: null };
    case 8:  return { numDecks: 3, cardsPerPlayer: 15, teamOptions: [[4, 4]], cppOptions: null };
    case 9: {
      const valid = [13, 15];
      const cpp = valid.includes(preferredCpp) ? preferredCpp : 15;
      return { numDecks: 3, cardsPerPlayer: cpp, teamOptions: [[4, 5], [5, 4]], cppOptions: valid };
    }
    case 10: return { numDecks: 3, cardsPerPlayer: 13, teamOptions: [[5, 5]], cppOptions: null };
    default: return { numDecks: 1, cardsPerPlayer: Math.floor(52 / n), teamOptions: null, cppOptions: null };
  }
}

/**
 * Builds a shuffleable multi-deck array of unique card ids.
 * Duplicates across decks get a suffix: "AS", "AS#2", "AS#3".
 * Cards are removed in the defined order (D→C→H→S, even ranks first)
 * until the total is exactly numPlayers × cardsPerPlayer.
 *
 * @param {number} numPlayers
 * @param {number} [cardsPerPlayer] - if omitted, uses getDeckConfig
 * @returns {{ deck: string[], removed: string[], numDecks: number }}
 */
function buildDeck(numPlayers, cardsPerPlayer) {
  const config = getDeckConfig(numPlayers);
  const nDecks = config.numDecks;
  const cpp = cardsPerPlayer || config.cardsPerPlayer;
  const totalNeeded = numPlayers * cpp;

  // Build all card ids across all decks (unique via suffix)
  const allCards = [];
  const deckCount = {}; // base card → how many times seen so far
  for (let d = 0; d < nDecks; d++) {
    for (const s of SUITS) {
      for (const r of RANKS) {
        const base = r + s;
        deckCount[base] = (deckCount[base] || 0) + 1;
        const id = deckCount[base] === 1 ? base : base + '#' + deckCount[base];
        allCards.push(id);
      }
    }
  }

  // Removal traversal: rank → deck → suit
  // For each rank (2, 4, 6, 8):
  //   Round 1 (deck 1): remove 1 card from each suit D→C→H→S
  //   Round 2 (deck 2): remove 1 card from each suit D→C→H→S  (only if still needed)
  //   Round 3 (deck 3): ...
  //
  // Example for 6 players, 2 decks, removing 14 cards:
  //   Rank 2, deck1: 2D, 2C, 2H, 2S  (4 cards, 4 total)
  //   Rank 2, deck2: 2D#2, 2C#2, 2H#2, 2S#2  (4 cards, 8 total)
  //   Rank 4, deck1: 4D, 4C, 4H, 4S  (4 cards, 12 total)
  //   Rank 4, deck2: 4D#2, 4C#2  (2 cards → 14 total → STOP)
  //   Kept: 4H#2, 4S#2 (balanced — 1 copy of each stays)
  const allCardsSet = new Set(allCards);
  const removalList = [];
  for (const rank of REMOVABLE_RANKS) {
    for (let d = 1; d <= nDecks; d++) {
      for (const suit of REMOVAL_SUIT_ORDER) {
        const base = rank + suit;
        if (base === '3S') continue; // 3S is never removed
        const id = d === 1 ? base : base + '#' + d;
        if (allCardsSet.has(id)) removalList.push(id);
      }
    }
  }


  const toRemove = allCards.length - totalNeeded;
  if (toRemove < 0) throw new GameError(`Cannot deal ${cpp} cards to ${numPlayers} players with ${nDecks} deck(s)`);
  const removed = removalList.slice(0, toRemove);
  const removedSet = new Set(removed);
  const deck = allCards.filter((c) => !removedSet.has(c));

  return { deck, removed, numDecks: nDecks };
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
  if (sa === sb) return rankValue(a) >= rankValue(b);
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

/**
 * Returns the number of partners the bidder calls.
 * For multi-deck games the bidding team size minus 1 (the bidder) = partner count.
 * teamSplit is like '3v4' meaning bidTeam=3, defTeam=4.
 */
function autoPartnerCount(n) {
  const cfg = getDeckConfig(n);
  if (cfg.teamOptions && cfg.teamOptions.length > 0) {
    // Use first option's bid-team size, minus 1 for the bidder
    return cfg.teamOptions[0][0] - 1;
  }
  // 1-deck fallback
  if (n <= 5) return 1;
  return 1;
}

/**
 * Given a teamSplit string like '3v4', returns { bidTeam, defTeam }.
 * Falls back to the first option from getDeckConfig.
 */
function parseTeamSplit(teamSplit, n) {
  const cfg = getDeckConfig(n);
  if (teamSplit && typeof teamSplit === 'string') {
    const parts = teamSplit.split('v').map(Number);
    if (parts.length === 2 && parts[0] > 0 && parts[1] > 0 && parts[0] + parts[1] === n) {
      return { bidTeam: parts[0], defTeam: parts[1] };
    }
  }
  // fallback
  if (cfg.teamOptions && cfg.teamOptions.length > 0) {
    return { bidTeam: cfg.teamOptions[0][0], defTeam: cfg.teamOptions[0][1] };
  }
  return { bidTeam: Math.ceil(n / 2), defTeam: Math.floor(n / 2) };
}

function resolvePartnerCount(setting, n, teamSplit) {
  if (setting !== 'auto') {
    const k = Number(setting);
    return Math.max(1, Math.min(k, n - 2));
  }
  // In multi-deck mode, derive from teamSplit
  const cfg = getDeckConfig(n);
  if (cfg.teamOptions && cfg.teamOptions.length > 0) {
    const { bidTeam } = parseTeamSplit(teamSplit, n);
    return Math.max(1, bidTeam - 1); // bidder + partners = bidTeam
  }
  return autoPartnerCount(n);
}

function defaultSettings() {
  return {
    minBid: 'auto',  // 'auto' = half of total points (125 / 250 / 375 per deck count)
    bidStep: 5,
    partnerCount: 'auto',
    teamSplit: 'auto',
    cardsPerPlayer: 'auto',
    bidderMultiplier: 2,
    partnersLoseOnFail: true,
    rounds: 'auto',
    turnTimer: 0,
    earlyFinish: false,
  };
}

const SETTING_RULES = {
  minBid: (v) => v === 'auto' || (Number.isInteger(v) && v >= 100 && v <= 750 && v % 5 === 0),
  bidStep: (v) => [5, 10].includes(v),
  partnerCount: (v) => v === 'auto' || [1, 2, 3, 4].includes(v),
  teamSplit: (v) => v === 'auto' || (typeof v === 'string' && /^\d+v\d+$/.test(v)),
  cardsPerPlayer: (v) => v === 'auto' || [13, 15].includes(v),
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

    // Resolve team split (for multi-deck games with odd-side options)
    const preferredCpp = settings.cardsPerPlayer !== 'auto' ? Number(settings.cardsPerPlayer) : undefined;
    const cfg = getDeckConfig(this.n, preferredCpp);
    const ts = settings.teamSplit && settings.teamSplit !== 'auto' ? settings.teamSplit : null;
    this.teamSplit = parseTeamSplit(ts, this.n);
    this.numDecks = cfg.numDecks;
    this.cardsPerPlayer = cfg.cardsPerPlayer;

    this.partnerCount = resolvePartnerCount(settings.partnerCount, this.n, ts);

    const built = buildDeck(this.n, this.cardsPerPlayer);
    this.removed = built.removed;
    this.numDecksUsed = built.numDecks;
    this.totalPoints = TOTAL_POINTS * this.numDecksUsed; // 250 / 500 / 750
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
    this.playedCounts = {};
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
  /** Resolve the configured minBid to an actual number (handles 'auto'). */
  resolvedMinBid() {
    return this.settings.minBid === 'auto' ? Math.ceil(this.totalPoints / 2) : this.settings.minBid;
  }

  minNextBid() {
    const { high } = this.bidding;
    return high ? high + this.settings.bidStep : this.resolvedMinBid();
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
    if (amount > this.totalPoints) throw new GameError(`Maximum bid is ${this.totalPoints}`);
    if (amount % 5 !== 0) throw new GameError(`Bids must be a multiple of 5`);
    this.bidding.high = amount;
    this.bidding.bidderId = pid;
    this.bidding.history.push({ playerId: pid, action: 'bid', amount });
    this._advanceBidding();
  }

  pass(pid) {
    this._assertTurn(pid, 'bidding');
    if (!this.canPass(pid)) throw new GameError(`Everyone passed — you must open at ${this.resolvedMinBid()}`);
    this.bidding.passed.add(pid);
    this.bidding.history.push({ playerId: pid, action: 'pass' });
    this._advanceBidding();
  }

  _advanceBidding() {
    const b = this.bidding;
    if (b.high >= this.totalPoints) return this._endBidding();
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
    // Parse cards like "AS_1", "3S_1"
    const parsed = uniq.map(c => {
      const parts = c.split('_');
      return { base: parts[0] || c, ord: Number(parts[1]) || 1 };
    });

    const hand = this.hands[pid];
    for (const p of parsed) {
      const totalInPlay = this.dealt.filter(c => baseCard(c) === p.base).length;
      const inHand = hand.filter(c => baseCard(c) === p.base).length;
      const callableCount = totalInPlay - inHand;
      const calledCount = parsed.filter(x => x.base === p.base).length;
      if (calledCount > callableCount) {
        throw new GameError(`You can't call more copies of ${p.base} than exist outside your hand`);
      }
      if (p.ord < 1 || p.ord > totalInPlay) {
        throw new GameError(`Invalid ordinal ${p.ord} for ${p.base}`);
      }
    }

    this.trump = trump;
    this.called = parsed.map(p => ({
      baseCard: p.base,
      targetOrdinal: p.ord,
      holderId: null,
      revealed: false,
      revealedAtTrick: null
    }));
    this.team = new Set([pid]);
    this.phase = 'playing';
    this.trickNo = 1;
    this.trick = { leaderId: pid, plays: [] };
    this.turnSeat = this.seatOf(pid);
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

    const base = baseCard(card);
    this.playedCounts[base] = (this.playedCounts[base] || 0) + 1;
    const thisOrdinal = this.playedCounts[base];

    for (const c of this.called) {
      if (c.baseCard === base && c.targetOrdinal === thisOrdinal && !c.revealed) {
        c.holderId = pid;
        c.revealed = true;
        c.revealedAtTrick = this.trickNo;
        this.team.add(pid);
        events.push({ type: 'partner_revealed', playerId: pid, card, bidderId: this.bidding.bidderId, ordinal: thisOrdinal });
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
    
    if (teamPts >= bid) return true;
    
    const allRevealed = this.called.every(c => c.revealed);
    if (allRevealed && defensePts > this.totalPoints - bid) return true;
    
    return false;
  }

  _finish(early = false) {
    // Resolve any hidden partners if game ended early
    for (const c of this.called) {
      if (!c.revealed) {
        const base = c.baseCard;
        const played = this.playedCounts[base] || 0;
        const needed = c.targetOrdinal - played;
        
        if (needed > 0) {
          const bidderSeat = this.seatOf(this.bidding.bidderId);
          let foundCount = 0;
          for (let i = 1; i <= this.n; i++) {
            const pid = this.seats[(bidderSeat + i) % this.n];
            const countInHand = this.hands[pid].filter(card => baseCard(card) === base).length;
            for (let j = 0; j < countInHand; j++) {
              foundCount++;
              if (foundCount === needed) {
                c.holderId = pid;
                c.revealed = true;
                this.team.add(pid);
                break;
              }
            }
            if (c.revealed) break;
          }
        }
      }
    }

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
    this.result = {
      bid,
      bidderId,
      trump: this.trump,
      called: this.called.map((c) => ({ card: c.baseCard, ordinal: c.targetOrdinal, holderId: c.holderId })),
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
  baseCard, suitOf, rankOf, rankValue, pointsOf, beats, trickWinner, sortHand, suitOrder,
  buildDeck, getDeckConfig, parseTeamSplit, shuffle,
  autoPartnerCount, resolvePartnerCount, defaultSettings, sanitizeSettings,
};
