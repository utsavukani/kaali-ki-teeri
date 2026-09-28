'use strict';
/* Engine + bot simulation: plays thousands of rounds for 4–10 players and checks invariants. */
const assert = require('assert');
const G = require('../server/game');
const { botAction } = require('../server/bot');

function playRound(n, dealerSeat, settings) {
  const seats = Array.from({ length: n }, (_, i) => 'p' + i);
  const r = new G.Round({ seats, dealerSeat, settings });
  const originalHands = {};
  for (const p of seats) originalHands[p] = r.hands[p].slice();

  // deck checks
  const all = seats.flatMap((p) => r.hands[p]);
  assert.strictEqual(new Set(all).size, all.length, 'no duplicate cards');
  assert.strictEqual(all.length % n, 0);
  assert.ok(all.includes('3S'), '3S always in play');
  assert.strictEqual(all.reduce((s, c) => s + G.pointsOf(c), 0), G.TOTAL_POINTS, 'deck worth 250');
  for (const p of seats) assert.strictEqual(r.hands[p].length, all.length / n);

  let guard = 0;
  while (r.phase !== 'done') {
    if (++guard > 1000) throw new Error('stuck');
    if (r.pending) { r.collect(); continue; }
    const pid = r.turnId;
    const a = botAction(r, pid);
    if (a.type === 'bid') r.bid(pid, a.amount);
    else if (a.type === 'pass') r.pass(pid);
    else if (a.type === 'declare') r.declare(pid, a.trump, a.cards);
    else if (a.type === 'play') {
      // independent follow-suit check
      const plays = r.trick.plays;
      if (plays.length) {
        const led = G.suitOf(plays[0].card);
        const hasLed = r.hands[pid].some((c) => G.suitOf(c) === led);
        if (hasLed) assert.strictEqual(G.suitOf(a.card), led, 'bot must follow suit');
      }
      r.play(pid, a.card);
    }
  }
  const res = r.result;
  assert.ok(res.bid >= settings.minBid && res.bid <= 250);
  if (!settings.earlyFinish) {
    const total = Object.values(res.captured).reduce((s, v) => s + v, 0);
    assert.strictEqual(total, 250, 'all points captured');
    for (const p of seats) assert.strictEqual(r.hands[p].length, 0);
  }
  // team = bidder + holders of called cards
  const holders = res.called.map((c) => seats.find((p) => originalHands[p].includes(c.card)));
  assert.deepStrictEqual(new Set(res.teamIds), new Set([res.bidderId, ...holders]));
  assert.ok(!holders.includes(res.bidderId), 'bidder never calls own card');
  // scoring
  for (const p of seats) {
    const d = res.deltas[p];
    if (p === res.bidderId) assert.strictEqual(Math.abs(d), res.bid * settings.bidderMultiplier);
    else if (res.teamIds.includes(p)) assert.ok(Math.abs(d) === res.bid || d === 0);
    else assert.strictEqual(d, 0);
    assert.strictEqual(Math.sign(d) >= 0 || !res.success, true);
  }
  return res;
}

// --- rule unit checks ---
{
  const s = G.defaultSettings();
  const r = new G.Round({ seats: ['a', 'b', 'c', 'd', 'e', 'f'], dealerSeat: 0, settings: s });
  assert.strictEqual(r.turnId, 'b', 'bidding starts left of dealer');
  assert.throws(() => r.bid('c', 150), /not your turn/);
  assert.throws(() => r.bid('b', 120), /at least/);
  assert.throws(() => r.bid('b', 128), /steps/);
  r.bid('b', 130);
  assert.throws(() => r.bid('c', 130), /at least 135/);
  r.pass('c'); r.pass('d'); r.pass('e'); r.pass('f'); r.pass('a');
  assert.strictEqual(r.phase, 'calling');
  assert.strictEqual(r.turnId, 'b');
  assert.throws(() => r.declare('b', 'H', [r.hands.b[0], 'AS']), /own hand/);
  const callable = r.callableCards('b');
  assert.throws(() => r.declare('b', 'H', [callable[0]]), /exactly 2/);
  r.declare('b', 'H', callable.slice(0, 2));
  assert.strictEqual(r.phase, 'playing');
  assert.strictEqual(r.turnId, 'b', 'bidder leads');
}
{
  // everyone passes -> last player forced
  const r = new G.Round({ seats: ['a', 'b', 'c', 'd'], dealerSeat: 3, settings: G.defaultSettings() });
  r.pass('a'); r.pass('b'); r.pass('c');
  assert.strictEqual(r.canPass('d'), false);
  assert.throws(() => r.pass('d'), /must open/);
  r.bid('d', 125);
  assert.strictEqual(r.phase, 'calling');
}
{
  // bid of 250 ends bidding immediately
  const r = new G.Round({ seats: ['a', 'b', 'c', 'd', 'e'], dealerSeat: 0, settings: G.defaultSettings() });
  r.bid('b', 250);
  assert.strictEqual(r.phase, 'calling');
}
{
  // trick winner logic
  const plays = [
    { playerId: 'a', card: '10H' }, { playerId: 'b', card: 'AH' },
    { playerId: 'c', card: '2S' }, { playerId: 'd', card: 'KD' },
  ];
  assert.strictEqual(G.trickWinner(plays, 'S'), 'c', 'trump wins');
  assert.strictEqual(G.trickWinner(plays, 'C'), 'b', 'highest of led suit');
  // deck sizes
  for (const [n, size] of [[4, 13], [5, 10], [6, 8], [7, 7], [8, 6], [9, 5], [10, 5]]) {
    assert.strictEqual(G.buildDeck(n).deck.length / n, size, `hand size for ${n}`);
  }
  assert.deepStrictEqual(G.sortHand(['2S', 'AH', 'KS', '3C', 'QD'], 'H').map(G.suitOf), ['H', 'C', 'D', 'S', 'S']);
}

// --- big simulation ---
const stats = {};
const t0 = Date.now();
for (let n = 4; n <= 10; n++) {
  let made = 0, bids = 0, rounds = 0;
  for (let i = 0; i < 600; i++) {
    const settings = {
      ...G.defaultSettings(),
      bidderMultiplier: i % 2 ? 1 : 2,
      partnersLoseOnFail: i % 3 !== 0,
      earlyFinish: i % 5 === 0,
      bidStep: i % 7 === 0 ? 10 : 5,
      minBid: i % 7 === 0 ? 130 : 125,
    };
    const res = playRound(n, i % n, settings);
    rounds++; bids += res.bid; if (res.success) made++;
  }
  stats[n] = { rounds, avgBid: Math.round(bids / rounds), madePct: Math.round((made / rounds) * 100) };
}
console.log('engine tests passed in', Date.now() - t0, 'ms');
console.table(stats);
