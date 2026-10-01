# HandCricket: multiplayer with video calling

A mobile-first Hand Cricket game with a built-in group audio/video call. Up to 6 friends join the same room, play the same live rounds, and see and hear each other while they play.

## Run it locally

```bash
npm install
npm start
# open http://localhost:3000
```

1. Enter your name and tap **CREATE ROOM**.
2. Open the menu (☰) and tap **Copy invite link**, then send the link to your friend. They can also type the 5-letter room code.
3. Tap the camera button in the header to start the call. Your friend's button pulses; they tap it (or the toast) to join.

## Play with someone in another city

Browsers only allow camera and microphone on **HTTPS** (or `localhost`), so for remote play the app needs a public HTTPS address. There are two easy options.

**Option A: deploy for free (recommended).** Push this folder to GitHub, then create a *Web Service* on Render.com (or Railway or Fly.io):
- Build command: `npm install`
- Start command: `npm start`

You get an `https://…` URL that anyone can open.

**Option B: tunnel from your laptop.** Keep `npm start` running, then run:

```bash
npx cloudflared tunnel --url http://localhost:3000
# or: ngrok http 3000
```

Share the `https://` URL it prints.

### If the call won't connect on some networks

Calls use free Google STUN servers, which work on most home Wi-Fi and 4G. Some strict office or carrier networks also need a **TURN** relay. You can get one free from Metered.ca or Twilio, then set:

```bash
TURN_URL=turn:your.turn.server:3478 TURN_USER=xxx TURN_PASS=yyy npm start
```

## Game rules

- Each round runs 15 seconds of betting, then the fists shake, then the result shows.
- Blue and Red each throw a random hand from 1 to 6, generated on the server so nobody can cheat.
- **Winner:** Blue or Red pays 1.98x, and Tie pays 5.94x. On a tie, Blue and Red bets are refunded.
- **Total sum:** Odd or Even pays 1.98x. Over 7 means 8–12, and Under 7 means 2–6, both paying 1.98x. A total of exactly 7 refunds Over/Under bets.
- Everyone starts with 1000 virtual coins. The menu shows a live leaderboard and the last results. If you drop below 50 coins, you can refill. Coins are for fun only; there is no real money.

## Project structure

```
server.js          Express + Socket.IO: rooms, round timer, bet settlement, WebRTC signaling
public/index.html  UI (header, arena, bet panel, call strip, menu drawer, lobby)
public/style.css   Styling that matches the reference design
public/app.js      Game client + WebRTC mesh call (mute, camera on/off, switch camera)
```

You can tune timings, starting coins and the max room size at the top of `server.js`.
