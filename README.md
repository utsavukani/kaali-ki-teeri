# Kaali ki Teeri

Online multiplayer **Kaali ki Teeri** (3 of Spades) for 4–10 players, built for 6–10.
Friends open a link, type a name and play. No accounts, works on phones and laptops.

## Features

- **Rooms with 4-letter codes** plus copy-link, WhatsApp and native share buttons
- **Server-authoritative game.** Each player only ever receives their own cards, so nobody can peek at hands through the browser.
- **Full rules:** deck trimming for any player count, bidding, trump choice, secret partner cards, follow-suit enforcement, partner reveals, scoring across rounds
- **Bots** to fill empty seats or to practise alone
- **Reconnect safely.** Refresh or lose signal and you rejoin your own seat with your hand intact. Offline players are auto-played after 15 seconds so the table never stalls.
- **Host controls:** table rules, add or remove players, reorder seats, deal next round, end the game. Host passes automatically if they drop out.
- **Optional turn timer** (20–90 s) with auto-play on timeout
- **Chat, quick phrases and emoji reactions** that pop up over the player's seat
- **Scorecard, last-trick viewer, game log**, final leaderboard
- **Responsive:** phone portrait, phone landscape, tablet and laptop (chat docks to the side on wide screens)
- Sound effects, vibration on your turn, optional four-colour suits and point badges on cards
- Installable to the home screen (web manifest)

## Run it on your laptop

Needs Node.js 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000.

### Play over the same Wi-Fi (hostel, home)

1. Run `npm start` on one laptop.
2. Find that laptop's local IP: `ipconfig` on Windows, `ifconfig` or `ip addr` on Mac/Linux. It looks like `192.168.x.x` or `10.x.x.x`.
3. Everyone on the same Wi-Fi opens `http://<that-ip>:3000`.

Some campus networks block device-to-device traffic. If friends can't connect, deploy it online instead (below).

## Put it online for free (Render)

1. Push this folder to a GitHub repository.
2. On [render.com](https://render.com), choose **New → Blueprint** and pick the repo. `render.yaml` sets everything up.
   Or choose **New → Web Service**: Build command `npm install`, Start command `npm start`, instance type Free.
3. Share the `https://<your-app>.onrender.com` link.

Notes about the free plan:

- The service sleeps after 15 minutes with no requests or WebSocket messages. The first visit after that takes a little while to wake it up. An ongoing game keeps it awake.
- Rooms live in server memory, so a restart or redeploy ends games in progress.

Any Node host with WebSocket support works the same way (Railway, Fly.io, a VPS). The server reads `PORT` from the environment.

## How the game works

| Card | Points |
|---|---|
| 3♠ (Kaali ki Teeri) | 30 |
| Each A, K, Q, J, 10 | 10 |
| Each 5 | 5 |
| Everything else | 0 |

Total: 250 points. To deal evenly, zero-point 2s and 3s are removed (never the 3♠):

| Players | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|
| Cards each | 13 | 10 | 8 | 7 | 6 | 5 | 5 |
| Partner cards (auto) | 1 | 1 | 2 | 2 | 3 | 3 | 4 |

1. **Bid.** Starting left of the dealer, each player bids or passes. Passing takes you out of the bidding. If everyone passes, the last player must open at the minimum.
2. **Trump and partners.** The highest bidder picks trump (Hukum ♠, Paan ♥, Chidi ♣, Eent ♦) and calls cards they don't hold. Whoever holds a called card is secretly on their team until that card is played.
3. **Play.** The bidder leads first. Follow suit if you can. Highest trump wins, otherwise the highest card of the led suit. The winner leads next.
4. **Score.** If the bidding team's points reach the bid, the bidder gains the bid (×2 by default) and each partner gains the bid. Otherwise they lose the same. Defenders score 0.

### Table rules the host can change

| Setting | Default | Options |
|---|---|---|
| Opening bid | 125 | 100–200 |
| Raise bids by | 5 | 5, 10 |
| Partner cards called | Auto (table above) | 1–4 |
| Bidder wins or loses | Double the bid | The bid, double the bid |
| Partners lose on a failed bid | Yes | Yes, No |
| Rounds | One deal each | 3–20, keep playing |
| Turn timer | Off | 20–90 seconds |
| End round once result is certain | No | Yes, No |

## Project layout

```
server/
  game.js    rules engine (pure, no networking)
  bot.js     bot player and auto-play logic
  room.js    rooms, host controls, timers, per-player views
  index.js   Express + Socket.IO server
public/
  index.html, styles.css, app.js   the client (no build step)
test/
  engine.test.js        4,200 simulated rounds across 4–10 players
  multiplayer.test.js   real socket clients play a 3-round game with a disconnect/reconnect
```

## Tests

```bash
npm test
```
