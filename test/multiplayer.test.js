'use strict';
/*
 * Live multiplayer test: boots the real server, connects 4 human socket clients + 3 bots
 * (7 players), plays a full 3-round game, and checks privacy, reconnects and auto-play.
 */
process.env.BOT_SPEED = '0.02';
const assert = require('assert');
const { io: ioc } = require('socket.io-client');
const { server, rooms } = require('../server/index');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name, token, url) {
  const s = ioc(url, { transports: ['websocket'], forceNew: true });
  const c = { s, name, token, state: null, fx: [], chat: [], errors: [] };
  s.on('state', (st) => { c.state = st; });
  s.on('fx', (ev) => c.fx.push(...ev));
  s.on('chat', (m) => c.chat.push(m));
  c.emit = (ev, data) => new Promise((res) => s.emit(ev, data, res));
  c.act = async (a) => {
    const r = await c.emit('action', a);
    if (!r.ok) c.errors.push(r.error);
    return r;
  };
  return c;
}

async function until(pred, ms = 8000, label = 'condition') {
  const t = Date.now();
  while (!pred()) {
    if (Date.now() - t > ms) throw new Error('Timed out waiting for ' + label);
    await wait(10);
  }
}

/** A dumb but legal human strategy driven only by the client's own state. */
async function humanMove(c) {
  const st = c.state;
  if (!st || !st.round || st.round.turnId !== st.you) return;
  const r = st.round;
  if (st.phase === 'bidding') {
    if (r.bidding.canPass && Math.random() < 0.6) return c.act({ type: 'pass' });
    if (r.bidding.minNext <= 250) return c.act({ type: 'bid', amount: r.bidding.minNext });
    return c.act({ type: 'pass' });
  }
  if (st.phase === 'calling') {
    return c.act({ type: 'declare', trump: 'H', cards: st.callable.slice(-r.partnerCount) });
  }
  if (st.phase === 'playing' && st.valid.length && !r.trick.complete) {
    return c.act({ type: 'play', card: st.valid[Math.floor(Math.random() * st.valid.length)] });
  }
}

(async () => {
  await new Promise((res) => server.listen(0, res));
  const url = `http://localhost:${server.address().port}`;

  const host = client('Yash', 'tok-host', url);
  const created = await host.emit('create_room', { name: 'Yash', token: 'tok-host' });
  assert.ok(created.ok, created.error);
  const code = created.code;
  assert.match(code, /^[A-Z]{4}$/);

  const others = ['Aman', 'Priya', 'Rohan'].map((n, i) => client(n, 'tok-' + i, url));
  for (const c of others) assert.ok((await c.emit('join_room', { code, name: c.name, token: c.token })).ok);

  // bad joins
  const ghost = client('x', 'tok-x', url);
  assert.strictEqual((await ghost.emit('join_room', { code: 'ZZZZ', name: 'x', token: 'tok-x' })).ok, false);
  assert.strictEqual((await ghost.emit('join_room', { code, token: 'tok-x', rejoinOnly: true })).error, 'not_member');
  ghost.s.close();

  // only host can manage
  assert.strictEqual((await others[0].act({ type: 'add_bot' })).ok, false);
  for (let i = 0; i < 3; i++) assert.ok((await host.act({ type: 'add_bot' })).ok);
  assert.ok((await host.act({ type: 'settings', settings: { rounds: 3, minBid: 130, earlyFinish: false } })).ok);
  assert.strictEqual((await host.act({ type: 'settings', settings: { minBid: 7 } })).ok, false);
  await until(() => host.state && host.state.players.length === 7, 3000, '7 players');
  assert.strictEqual(host.state.partnerPreview, 2);

  // duplicate names get a suffix
  const dup = client('Aman', 'tok-dup', url);
  await dup.emit('join_room', { code, name: 'Aman', token: 'tok-dup' });
  await until(() => dup.state, 2000, 'dup state');
  assert.ok(dup.state.players.some((p) => p.name === 'Aman 2'));
  await dup.emit('leave_room');
  dup.s.close();
  await until(() => host.state.players.length === 7, 2000, 'dup removed');

  assert.ok((await host.act({ type: 'start' })).ok);
  const humans = [host, ...others];
  await until(() => humans.every((c) => c.state && c.state.phase === 'bidding'), 3000, 'bidding');

  // privacy: each client only sees their own cards, handSize 7 for 7 players
  for (const c of humans) {
    assert.strictEqual(c.state.hand.length, 7);
    const json = JSON.stringify(c.state);
    for (const o of humans) {
      if (o === c) continue;
      for (const card of o.state.hand) {
        assert.ok(!json.includes(`"${card}"`) || c.state.hand.includes(card), 'no leaked cards');
      }
    }
  }

  let reconnectTested = false;
  let offlineAutoPlayed = false;
  const t0 = Date.now();
  while (!humans.every((c) => c.state.phase === 'gameOver')) {
    if (Date.now() - t0 > 60000) throw new Error('game did not finish');
    for (const c of humans) await humanMove(c);

    const st = host.state;
    if (st.phase === 'playing') {
      // called partners' holders are hidden until revealed
      for (const cc of st.round.called) if (!cc.revealed) assert.strictEqual(cc.holderId, null);
    }

    // Mid-round of round 2: Rohan drops, gets auto-played, then reconnects with his token.
    if (!reconnectTested && st.phase === 'playing' && st.round.number === 2 && st.round.trickNo === 2) {
      reconnectTested = true;
      const rohan = others[2];
      const handBefore = rohan.state.hand.length;
      rohan.s.close();
      await until(() => host.state.players.find((p) => p.name === 'Rohan').connected === false, 3000, 'offline flag');
      const movesBefore = host.fx.filter((e) => e.auto && e.playerId === rohan.state.you).length;
      const tWait = Date.now();
      while (!(host.fx.filter((e) => e.auto && e.playerId === rohan.state.you).length > movesBefore
        || host.state.phase !== 'playing')) {
        if (Date.now() - tWait > 8000) throw new Error('offline auto play did not happen');
        for (const c of humans) if (c !== rohan) await humanMove(c);
        await wait(10);
      }
      offlineAutoPlayed = true;
      const back = client('Rohan', rohan.token, url);
      const rj = await back.emit('join_room', { code, token: rohan.token, rejoinOnly: true });
      assert.ok(rj.ok, rj.error);
      await until(() => back.state, 2000, 'rejoin state');
      assert.strictEqual(back.state.you, rohan.state.you, 'same seat after rejoin');
      assert.ok(back.state.hand.length <= handBefore);
      others[2] = back;
      humans[3] = back;
    }

    if (st.phase === 'roundEnd') {
      const res = st.round.result;
      const total = Object.values(res.captured).reduce((s, v) => s + v, 0);
      assert.strictEqual(total, 250);
      assert.ok((await host.act({ type: 'next_round' })).ok);
      await until(() => host.state.phase !== 'roundEnd', 3000, 'next round');
    }
    await wait(5);
  }

  const final = host.state;
  assert.strictEqual(final.history.length, 3);
  const scoreSum = final.players.reduce((s, p) => s + p.score, 0);
  const deltaSum = final.history.reduce((s, h) => s + Object.values(h.deltas).reduce((a, b) => a + b, 0), 0);
  assert.strictEqual(scoreSum, deltaSum, 'scores match history');
  assert.ok(reconnectTested && offlineAutoPlayed, 'reconnect path exercised');

  // chat + reactions
  await host.act({ type: 'chat', text: 'Partner kaun hai? 😂' });
  await host.act({ type: 'react', emoji: '🔥' });
  await until(() => others[0].chat.some((m) => m.text.includes('Partner')), 2000, 'chat');
  await until(() => others[0].fx.some((e) => e.type === 'react'), 2000, 'react');

  // play again -> lobby, scores reset on start
  assert.ok((await host.act({ type: 'back_to_lobby' })).ok);
  await until(() => host.state.phase === 'lobby', 2000, 'lobby');

  // kick + ban
  const aman = others[0];
  assert.ok((await host.act({ type: 'kick', playerId: aman.state.you })).ok);
  const rejoin = await client('Aman', aman.token, url).emit('join_room', { code, name: 'Aman', token: aman.token });
  assert.strictEqual(rejoin.ok, false);

  console.log(`multiplayer test passed: room ${code}, 3 rounds, reconnect + auto-play + chat + kick OK`);
  console.log('round results:', final.history.map((h) => `${final.names[h.bidderId]} bid ${h.bid} → ${h.teamPoints} ${h.success ? 'MADE' : 'FAILED'}`).join(' | '));
  for (const c of humans) c.s.close();
  server.close();
  for (const r of rooms.values()) r.destroy();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
