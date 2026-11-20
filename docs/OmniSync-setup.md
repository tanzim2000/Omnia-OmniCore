# OmniSync Wi-Fi setup

> © 2026 Tanzim Ahmed. All rights reserved. You may read and link to this
> document and quote short passages with credit. Its code examples are
> 0BSD: copy them into your own work freely. See
> [LICENSING.md](https://github.com/tanzim2000/Omnia-OmniCore/blob/main/LICENSING.md).

How OmniSync gives a server its Wi-Fi when the server has lost it (since
OmniCore 2.0.0). This is for whoever builds OmniSync: everything OmniCore
does is already in place, so OmniSync only has to follow this page.
OmniCore's half is `core/omnisync.js` (the messages) and
`core/network-hotspot.js` (the hotspot and the routes).

## What happens

1. The server's Wi-Fi is disconnected. Every face shows the takeover,
   "Wi-Fi disconnected".
2. If the server's Wi-Fi card can run a network of its own, OmniCore starts
   one (the setup hotspot) with a name and password made up for this round,
   and the takeover shows a QR code. The name and password are never shown
   in words.
3. OmniSync scans the QR code, reads the hotspot's name and password from
   it, and joins the hotspot.
4. OmniSync asks which Wi-Fi the server should use (or already knows it),
   encrypts its name and password for this one server, and sends them to
   `http://10.42.0.1:3000/omnicore-network/omnisync`.
5. OmniCore answers `202` at once, turns the hotspot off (the phone drops
   off it), joins the Wi-Fi, and waits up to a minute for the internet. If
   that doesn't work, the old network is put back and a new round starts,
   with a new QR code.

"Set up manually" under the QR code turns the hotspot off and shows the
nearby networks instead. A card that can't run a hotspot goes straight
there.

## Rounds

A hotspot runs for ten minutes at most. While it runs, the server can't
reconnect to its old network by itself, so after ten minutes everything is
put back and the server gets a minute to find a network it knows. Still
disconnected: a new round, with a new name, password, session and QR code.
A QR code is only good for its own round.

## The QR code

The QR code's text is:

```
OMNISYNC:1:<base64url of nonce + sealed>
```

- `1` is the version of this format.
- base64url is RFC 4648 §5, without `=` padding.
- `nonce` is 12 random bytes.
- `sealed` is AES-256-GCM of the JSON below, with the 16-byte tag at the
  end, under `QR_KEY` and `nonce`, with no additional data.
- `QR_KEY` is SHA-256 of the UTF-8 text `OmniSync setup QR, version 1`.

The JSON inside:

```json
{
	"v": 1,
	"ssid": "OmniCore-7kQm2x",
	"password": "a3Kp9wXr2mTq8vLn",
	"host": "10.42.0.1",
	"port": 3000,
	"session": "<base64url, 12 bytes>",
	"key": "<base64url, 32 bytes: OmniCore's X25519 public key for this session>"
}
```

The hotspot is WPA2-Personal (on 2.4 GHz, channel 6, when wpa_supplicant
looks after the server's Wi-Fi; NetworkManager picks its own). It hands out
addresses but has no DNS and no internet, so a phone may say "No internet"
and want to leave it: OmniSync has to stay on it until the reply is sent.
Use `host` and `port` from the QR code rather than assuming them.

**What the QR key does and doesn't do.** Every OmniCore and every copy of
OmniSync has the same `QR_KEY`, so it only keeps an ordinary camera app from
reading the code. It is not a secret from someone who takes OmniSync apart.
What protects the hotspot is that its password is new every round and is
only on the server's screen: you have to be standing in front of it.

## The reply

OmniSync makes an X25519 key pair of its own for this reply, then:

1. `secret` = X25519(OmniSync's private key, OmniCore's `key` from the QR
   code).
2. `aesKey` = HKDF-SHA256(secret, salt = the `session` text as UTF-8,
   info = `OmniSync Wi-Fi, version 1` as UTF-8, length 32).
3. `nonce` = 12 random bytes.
4. `data` = AES-256-GCM of the network's JSON under `aesKey` and `nonce`,
   with the 16-byte tag at the end, and no additional data.

The network's JSON:

```json
{ "ssid": "Home", "password": "correct horse battery", "auth": "psk" }
```

- `auth` is optional: `"psk"` (WPA/WPA2), `"sae"` (WPA3 only) or `"open"`.
  Left out, it's `"psk"` with a password and `"open"` without one.
- A WPA password is 8 to 63 characters.

The request:

```
POST http://10.42.0.1:3000/omnicore-network/omnisync
Content-Type: application/json

{ "session": "<from the QR code>", "key": "<OmniSync's public key, base64url, 32 bytes>", "nonce": "<base64url>", "data": "<base64url>" }
```

Only the OmniCore that showed the QR code, in that round, can read it:
someone listening on the hotspot sees the JSON above and nothing in it is
readable without OmniCore's private key, which never leaves the server.

## The answers

| Status | Body | Meaning |
| --- | --- | --- |
| `202` | `{ "accepted": true }` | Read. The hotspot turns off now, and the phone loses it. |
| `400` | `{ "error": "..." }` | Doesn't read (wrong session's key, changed on the way), or isn't a network that can be joined (a password too short). A network that's refused for what's in it can be sent again, fixed, in the same round. |
| `409` | `{ "error": "..." }` | Nothing is waiting: the Wi-Fi isn't disconnected, the code on screen is from another round, or this round's reply was already taken. |
| `415` | `{ "error": "Send this as JSON." }` | Not sent as JSON. |

A session takes one reply that reads: a second one, even the same one again,
gets `409`. The body can be 8 KB at most.

After a `202`, OmniSync can't hear how it went (the hotspot is gone). If the
Wi-Fi works, the server's screen shows it and the server is back on the home
network; if it doesn't, a new round starts and the screen shows a new QR
code to try again.

## A worked example

`core/omnisync.js` has both sides in Node.js: `qrText()` and `readReply()`
are OmniCore's, `readQr()` and `makeReply()` are OmniSync's, written out so
the two can't drift apart. `test/network-hotspot.test.js` uses them together.

```js
const omnisync = require("./core/omnisync");

// What OmniSync does with the text it scanned
const qr = omnisync.readQr(scannedText);
// ...join qr.ssid with qr.password, then:
const body = omnisync.makeReply(qr, { ssid: "Home", password: "correct horse battery" });
await fetch(`http://${qr.host}:${qr.port}/omnicore-network/omnisync`, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(body)
});
```
