# SNOCRASH

Make, publish, browse and remix small 3D objects on nostr.

An object is a **Simple Nostr Object**: a list of vertices on an integer
lattice, one RGB colour per vertex, triangles by index, and a word saying how
to draw it. No textures, no materials, no animation, and no file to fetch. The
object is the event.

- Format: [DECK-0004](https://github.com/arkin0x/cyberspace/blob/master/decks/DECK-0004-sno.md)
- Event kind: `33331`, addressable, one per author per `d`
- Reference validator: [`sno-reference.py`](https://github.com/arkin0x/cyberspace/blob/master/decks/sno-reference.py), dependency free

## What it does

| | |
|---|---|
| **Make** | the editor: stamps, points, selections, faces, undo, on an exact integer grid |
| **Publish** | sign and send. One button, no coordinates, no keys to compute, nothing hidden anywhere |
| **Feed** | every object the relays have, each one drawn |
| **Remix** | open someone's object as your own copy, with its own id, so publishing never touches theirs |
| **Export** | PLY with vertex colours, which Blender, MeshLab and every scanner read |

## What it does not do

No coordinate system, no movement, no encryption, no regions, no keys to
compute. Those belong to [Cyberspace](https://github.com/arkin0x/cyberspace),
which is where this format came from and where the same objects can be hidden
at real places. Here an object is just an object.

## Keys

Either a nostr browser extension (NIP-07), or a key this app generates and
keeps in your browser's local storage. The second is a real key with real
consequences and the app says so rather than pretending to be a login.

## Running it

```
npm install
npm run dev
```

`npm test` runs the suite, `npm run build` produces `dist/`.
