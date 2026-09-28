'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { Room } = require('./room');
const { GameError } = require('./game');

const PORT = Number(process.env.PORT || 3000);
const MAX_ROOMS = 500;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L, O to avoid confusion

const rooms = new Map();

const app = express();
app.disable('x-powered-by');
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '1h',
  setHeaders(res, file) {
    if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 9000,
  maxHttpBufferSize: 1e5,
});

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

io.on('connection', (socket) => {
  let ctx = null; // { room, id }

  const reply = (cb, data) => { if (typeof cb === 'function') cb(data); };
  const fail = (cb, e) => {
    if (!(e instanceof GameError)) console.error(e);
    reply(cb, { ok: false, error: e instanceof GameError ? e.message : 'Something went wrong — try again' });
  };
  const attach = (room, member) => {
    if (ctx && ctx.room !== room) {
      ctx.room.disconnect(socket.id);
      socket.leave(ctx.room.channel);
    }
    ctx = { room, id: member.id };
    socket.emit('chat_history', room.chat);
    room.broadcast();
  };

  socket.on('create_room', (payload, cb) => {
    try {
      if (rooms.size >= MAX_ROOMS) throw new GameError('Server is busy — try again in a bit');
      const room = new Room(io, newCode());
      const member = room.join(socket, payload || {});
      rooms.set(room.code, room);
      attach(room, member);
      reply(cb, { ok: true, code: room.code, id: member.id });
    } catch (e) { fail(cb, e); }
  });

  socket.on('join_room', (payload, cb) => {
    try {
      const p = payload || {};
      const code = String(p.code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      const room = rooms.get(code);
      if (!room) throw new GameError('Room not found — check the code');
      if (p.rejoinOnly && !room.findByToken(String(p.token || ''))) throw new GameError('not_member');
      const member = room.join(socket, p);
      attach(room, member);
      reply(cb, { ok: true, code: room.code, id: member.id });
    } catch (e) { fail(cb, e); }
  });

  socket.on('action', (a, cb) => {
    try {
      if (!ctx) throw new GameError('Join a room first');
      if (!a || typeof a !== 'object') throw new GameError('Bad request');
      ctx.room.handle(ctx.id, a);
      reply(cb, { ok: true });
    } catch (e) { fail(cb, e); }
  });

  socket.on('leave_room', (_, cb) => {
    if (ctx) {
      ctx.room.leave(ctx.id);
      socket.leave(ctx.room.channel);
      ctx = null;
    }
    reply(cb, { ok: true });
  });

  socket.on('disconnect', () => {
    if (ctx) ctx.room.disconnect(socket.id);
  });
});

const sweeper = setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.sweep()) {
      room.destroy();
      rooms.delete(code);
    }
  }
}, 60 * 1000);
sweeper.unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`Kaali ki Teeri is live on http://localhost:${PORT}`));
}

module.exports = { app, server, io, rooms };
