'use strict';
/**
 * Simple but sensible bot players. Bots only look at their own hand and
 * public information (bids, trump, called cards, revealed partners, the trick).
 * The same logic auto-plays for anyone whose turn timer runs out or who goes offline.
 */
const { SUITS, suitOf, rankOf, rankValue, pointsOf, beats, trickWinner, buildDeck } = require('./game');

const HONOUR = { A: 14, K: 9, Q: 5, J: 3 };

function cardStrength(c) {
  return (HONOUR[rankOf(c)] || 0) + pointsOf(c) * 0.6;
}

function handStrength(hand) {
  let s = 0;
  const lengths = { S: 0, H: 0, C: 0, D: 0 };
  for (const c of hand) { s += cardStrength(c); lengths[suitOf(c)]++; }
  const longest = Math.max(...Object.values(lengths));
  s += Math.max(0, longest - hand.length / 4) * 10;
  return s;
}

const baselineCache = new Map();
function baselineStrength(n) {
  if (baselineCache.has(n)) return baselineCache.get(n);
  const { deck } = buildDeck(n);
  const total = deck.reduce((s, c) => s + cardStrength(c), 0);
  const handSize = deck.length / n;
  const base = total / n + Math.max(0, handSize * 0.12) * 10; // typical long-suit bonus
  baselineCache.set(n, base);
  return base;
}

/** How high this hand is comfortable bidding. */
function bidCeiling(hand, n) {
  const diff = handStrength(hand) - baselineStrength(n);
  const est = 118 + diff * 2.4 + (Math.random() * 16 - 8);
  return Math.min(250, Math.round(est / 5) * 5);
}

function botBid(round, pid) {
  const min = round.minNextBid();
  if (!round.canPass(pid)) return { type: 'bid', amount: Math.min(250, min) };
  if (min > 250) return { type: 'pass' };
  if (!round._ceiling) round._ceiling = {};
  if (round._ceiling[pid] === undefined) round._ceiling[pid] = bidCeiling(round.hands[pid], round.n);
  return round._ceiling[pid] >= min ? { type: 'bid', amount: min } : { type: 'pass' };
}

/** Human ran out of time during bidding: pass if allowed, otherwise open at minimum. */
function autoBid(round, pid) {
  return round.canPass(pid) ? { type: 'pass' } : { type: 'bid', amount: round.minNextBid() };
}

function botDeclare(round, pid) {
  const hand = round.hands[pid];
  let trump = 'S', best = -1;
  for (const s of SUITS) {
    const cs = hand.filter((c) => suitOf(c) === s);
    const score = cs.length * 10 + cs.reduce((a, c) => a + rankValue(c), 0);
    if (score > best) { best = score; trump = s; }
  }
  const avail = new Set(round.callableCards(pid));
  const priority = ['A' + trump];
  for (const s of SUITS) if (s !== trump) priority.push('A' + s);
  priority.push('K' + trump, '3S');
  for (const s of SUITS) if (s !== trump) priority.push('K' + s);
  priority.push('Q' + trump);
  const rest = [...avail].sort((a, b) => rankValue(b) - rankValue(a) || pointsOf(b) - pointsOf(a));
  const cards = [];
  for (const c of priority.concat(rest)) {
    if (avail.has(c) && !cards.includes(c)) cards.push(c);
    if (cards.length === round.partnerCount) break;
  }
  return { type: 'declare', trump, cards };
}

/** What a player can legitimately deduce about teams. */
function knowledge(round, pid) {
  const bidderId = round.bidding.bidderId;
  const iAmPartner = round.called.some((c) => c.holderId === pid);
  const myTeam = pid === bidderId || iAmPartner ? 'bid' : 'def';
  const revealed = new Set(round.called.filter((c) => c.revealed).map((c) => c.holderId));
  const allRevealed = round.called.every((c) => c.revealed);
  const teamOf = (other) => {
    if (other === pid) return myTeam;
    if (other === bidderId || revealed.has(other)) return 'bid';
    if (allRevealed) return 'def';
    return null;
  };
  return {
    myTeam,
    relation(other) {
      const t = teamOf(other);
      if (t === null) return 'unknown';
      return t === myTeam ? 'ally' : 'enemy';
    },
  };
}

function botPlay(round, pid) {
  const valid = round.validCards(pid);
  if (valid.length === 1) return { type: 'play', card: valid[0] };
  const trump = round.trump;
  const plays = round.trick.plays;
  const know = knowledge(round, pid);
  const isTrump = (c) => (suitOf(c) === trump ? 1 : 0);
  const dumpOrder = (arr) => arr.slice().sort((a, b) =>
    isTrump(a) - isTrump(b) || pointsOf(a) - pointsOf(b) || rankValue(a) - rankValue(b));
  const pick = (card) => ({ type: 'play', card });

  if (plays.length === 0) {
    const aces = valid.filter((c) => rankOf(c) === 'A' && suitOf(c) !== trump);
    if (aces.length) return pick(aces[0]);
    if (know.myTeam === 'bid' && valid.includes('A' + trump)) return pick('A' + trump);
    const nonTrump = valid.filter((c) => suitOf(c) !== trump);
    return pick(dumpOrder(nonTrump.length ? nonTrump : valid)[0]);
  }

  const led = suitOf(plays[0].card);
  const winnerId = trickWinner(plays, trump);
  const winCard = plays.find((p) => p.playerId === winnerId).card;
  const trickPts = plays.reduce((s, p) => s + pointsOf(p.card), 0);
  const remaining = round.n - plays.length - 1;
  const rel = know.relation(winnerId);
  const trumpPlayed = plays.some((p) => suitOf(p.card) === trump);
  const strong = (suitOf(winCard) === trump && rankValue(winCard) >= 13)
    || (rankOf(winCard) === 'A' && suitOf(winCard) === led && !trumpPlayed && remaining <= 2);

  if (rel === 'ally' && (remaining === 0 || strong)) {
    const smear = valid.slice().sort((a, b) =>
      pointsOf(b) - pointsOf(a) || isTrump(a) - isTrump(b) || rankValue(a) - rankValue(b));
    return pick(smear[0]);
  }

  const winners = valid.filter((c) => beats(c, winCard, led, trump));
  if (winners.length && rel !== 'ally') {
    if (remaining === 0) {
      const best = winners.slice().sort((a, b) =>
        pointsOf(b) - pointsOf(a) || isTrump(a) - isTrump(b) || rankValue(a) - rankValue(b));
      return pick(best[0]);
    }
    const ledWinners = winners.filter((c) => suitOf(c) === led && suitOf(c) !== trump)
      .sort((a, b) => rankValue(b) - rankValue(a));
    if (ledWinners.length && (rankValue(ledWinners[0]) >= 13 || trickPts >= 10)) return pick(ledWinners[0]);
    const trumpWinners = winners.filter((c) => suitOf(c) === trump).sort((a, b) => rankValue(a) - rankValue(b));
    if (trumpWinners.length && (trickPts >= 10 || remaining <= 1)) {
      // Trump high enough not to be easily over-trumped when the trick is juicy
      const safe = trumpWinners.filter((c) => rankValue(c) >= 11);
      return pick(trickPts >= 20 && safe.length ? safe[0] : trumpWinners[0]);
    }
  }
  return pick(dumpOrder(valid)[0]);
}

function botAction(round, pid, { human = false } = {}) {
  switch (round.phase) {
    case 'bidding': return human ? autoBid(round, pid) : botBid(round, pid);
    case 'calling': return botDeclare(round, pid);
    case 'playing': return botPlay(round, pid);
    default: return null;
  }
}

module.exports = { botAction, botBid, botDeclare, botPlay, knowledge, handStrength, bidCeiling };
