# SNOCRASH

Make, publish, browse and remix small 3D objects on nostr.

An object is a **Simple Nostr Object**: a list of vertices on an integer
lattice, one color per vertex, triangles by index, and a word saying how to
draw it. No textures, no materials, no animation, and no file to fetch. The
object is the event.

A color is a single byte: an index into a 256-color palette, which is the
built-in `cyberspace-neon-256` unless the object names a palette event of its
own. That is what made a color on every face affordable as well as on every
vertex.

- Format: [DECK-0003](https://github.com/arkin0x/cyberspace/blob/master/decks/DECK-0003-sno.md)
- Event kind: `33331`, addressable, one per author per `d`
- Palette events: kind `3367`, colors as `c` tags in index order
- Reference validator: [`sno-reference.py`](https://github.com/arkin0x/cyberspace/blob/master/decks/sno-reference.py), dependency free
- Shared with ONOSENDAI through [sno-core](https://github.com/arkin0x/sno-core)

## What it does

| | |
|---|---|
| **Make** | the editor: stamps, points, selections, faces, undo, on an exact integer grid |
| **Publish** | sign and send. One button, no coordinates, no keys to compute, nothing hidden anywhere |
| **Feed** | every object the relays have, each one drawn |
| **Remix** | open someone's object as your own copy, with its own id, so publishing never touches theirs |
| **Export** | PLY with vertex colors, which Blender, MeshLab and every scanner read |

## What it does not do

No coordinate system, no movement, no encryption, no regions, no keys to
compute. Those belong to [Cyberspace](https://github.com/arkin0x/cyberspace),
which is where this format came from and where the same objects can be hidden
at real places. Here an object is just an object.

## Keys

Four ways in, which are the four ways nostr has: a key this app generates and
keeps in your browser, an `nsec` pasted in, an encrypted `ncryptsec` unlocked
with its password, or a signer that is not this app at all, a browser extension
(NIP-07) or a remote bunker (NIP-46).

None of them is a login. There is no account and no server that knows you:
there is a key, and whoever holds it is you. A key this app made lives in one
browser and is one cleared cache from gone, taking everything signed with it
out of reach, so it can be exported encrypted (NIP-49) and the password is not
optional.

## Running it

```
npm install
npm run dev
```

`npm test` runs the suite, `npm run build` produces `dist/`.

## Disclaimer

This software is experimental. It is provided "as is", without warranty of any kind. Use it at your own risk.

- **Your keys, funds and agents are your responsibility.** Anyone who has your private key, your signer or your wallet connection string can act as you or spend from your wallet. Keep them safe and keep backups. Nobody can recover them for you.
- **Lightning payments are final.** A payment that has been sent cannot be reversed, and nobody has to refund it.
- **Not financial advice.** Nothing in this software or its documentation is financial, investment, legal or tax advice.
- **Other people's services can fail.** This software relies on things the author does not run: nostr relays, Lightning wallets and nodes, ecash mints, hosting and other services. They can go down, lose data, refuse service or change without notice.
- **Nostr is public.** What you publish can be copied by anyone and may never be fully deleted.
- **AI agents make mistakes.** If you connect an AI agent to this software, you are responsible for everything it does, including what it publishes, signs and pays for.
- **No liability.** To the fullest extent the law allows, the author (arkinox) and the contributors are not liable for any loss or damage of any kind that comes from using this software, including lost funds, keys, data or work, whether it is caused by a bug, a relay, a mint, a wallet, another service, an AI agent or anything else.

This is a plain-language summary. The license in this repository governs, and its disclaimer of warranties and limitation of liability apply in full.

## License

The code is © 2026 arkinox, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), the same as ONOSENDAI. The full legal code is in `LICENSE`.
