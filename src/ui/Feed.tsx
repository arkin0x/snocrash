/**
 * Feed.tsx - what other people made.
 *
 * Every object is a kind 33331 event and nothing more, so the feed is a relay
 * query and a wall of tiles. Each tile can do the three things worth doing to
 * someone else's object: open it in the editor as your own copy, take the
 * payload to the clipboard, or save it as a PLY that Blender will open.
 *
 * Remixing is a copy and never a reference. The copy gets its own id, so
 * publishing it writes a new addressable object under your key rather than
 * touching theirs, which is what "remix" has to mean when the wire has no
 * notion of a parent.
 */

import { useEffect } from 'react'
import { Copy, Download, GitFork, RefreshCw } from 'lucide-react'
import { useNostr, type FeedObject } from '../store/useNostr'
import { useWorkshop } from '../store/useWorkshop'
import { toPayload } from 'sno-core/shards'
import { fileNameFor, toPly } from '../lib/ply'
import { Preview } from './Preview'
import { ProfilePic } from './ProfilePic'

function shortKey(pk: string): string {
  return `${pk.slice(0, 8)}…${pk.slice(-4)}`
}

function save(text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function Tile({ o, onOpen }: { o: FeedObject; onOpen: () => void }): JSX.Element {
  const say = useNostr((s) => s.say)
  const remix = (): void => {
    // A copy with an id of its own: publishing it never touches the original.
    const id = useWorkshop.getState().importShard(o.shard)
    useWorkshop.getState().select(id)
    say(`"${o.shard.name}" is yours to edit now. Publishing it makes a new object.`)
    onOpen()
  }
  return (
    <article className="tile">
      <Preview shard={o.shard} />
      <div className="tile__bar">
        <ProfilePic pubkey={o.pubkey} size={28} />
        <div className="tile__who">
          <span className="tile__name">{o.shard.name}</span>
          <span className="tile__meta">{o.shard.vertices.length} v · {o.shard.faces.length} f · {shortKey(o.pubkey)}</span>
        </div>
        <div className="tile__acts">
          <button className="icon" title="Open a copy in the editor" aria-label={`Remix ${o.shard.name}`} onClick={remix}><GitFork size={16} strokeWidth={2.25} /></button>
          <button className="icon" title="Copy the object to the clipboard" aria-label={`Copy ${o.shard.name}`} onClick={() => {
            void navigator.clipboard.writeText(JSON.stringify(toPayload(o.shard))).then(() => say('Copied.'), () => say('The clipboard is not available here.'))
          }}><Copy size={16} strokeWidth={2.25} /></button>
          <button className="icon" title="Save as a PLY that Blender reads" aria-label={`Download ${o.shard.name}`} onClick={() => {
            save(toPly(o.shard), fileNameFor(o.shard, 'ply'), 'text/plain')
          }}><Download size={16} strokeWidth={2.25} /></button>
        </div>
      </div>
    </article>
  )
}

export function Feed({ onOpen }: { onOpen: () => void }): JSX.Element {
  const feed = useNostr((s) => s.feed)
  const loading = useNostr((s) => s.loading)
  const load = useNostr((s) => s.loadFeed)

  useEffect(() => { void load() }, [load])

  return (
    <section className="feed">
      <header className="feed__head">
        <h2>{loading ? 'Reading the relays' : `${feed.length} object${feed.length === 1 ? '' : 's'}`}</h2>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} strokeWidth={2.25} /> REFRESH
        </button>
      </header>
      {!loading && feed.length === 0 && (
        <p className="empty">
          Nothing yet. Make something and publish it, and it will be the first object here.
        </p>
      )}
      <div className="grid">
        {feed.map((o) => <Tile key={`${o.pubkey}:${o.d}`} o={o} onOpen={onOpen} />)}
      </div>
    </section>
  )
}
