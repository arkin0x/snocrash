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
