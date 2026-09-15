/**
 * Make.tsx - the editor, and the one button that turns an object into an event.
 *
 * The bench underneath is ONOSENDAI's, lifted whole: the same tools, the same
 * integer lattice, the same undo. What is different here is what surrounds it.
 * There is no coordinate, no region, no key to compute and nothing hidden
 * anywhere: an object is made and then it is published, and that is the entire
 * lifecycle.
 */

import { Plus, Redo2, Save, Undo2 } from 'lucide-react'
import { Bench } from './Bench'
import { useWorkshop, type Tool } from '../store/useWorkshop'
import { useNostr } from '../store/useNostr'

const TOOLS: Array<{ tool: Tool; label: string; hint: string }> = [
  { tool: 'stamp', label: 'STAMP', hint: 'Place a whole shape' },
  { tool: 'add', label: 'ADD', hint: 'One point at a time' },
  { tool: 'select', label: 'SELECT', hint: 'Move, colour or delete points together' },
  { tool: 'face', label: 'FACE', hint: 'Pick corners and fill them' },
  { tool: 'view', label: 'VIEW', hint: 'Look without changing anything' },
]

export function Make(): JSX.Element {
  const w = useWorkshop
  const shard = useWorkshop((s) => s.current())
  const shards = useWorkshop((s) => s.shards)
  const tool = useWorkshop((s) => s.tool)
  const canUndo = useWorkshop((s) => s.past.length > 0)
  const canRedo = useWorkshop((s) => s.future.length > 0)
  const publishing = useNostr((s) => s.publishing)
  const signer = useNostr((s) => s.signer)

  return (
    <section className="make">
      <div className="make__bench">
        <Bench />
      </div>

      <div className="make__side">
        <div className="row">
          <input
            className="name"
            value={shard?.name ?? ''}
            placeholder="name this object"
            onChange={(e) => { if (shard) w.getState().rename(shard.id, e.target.value) }}
            aria-label="Object name"
            spellCheck={false}
          />
          <button className="icon" title="Undo" aria-label="Undo" disabled={!canUndo} onClick={() => w.getState().undo()}><Undo2 size={16} strokeWidth={2.25} /></button>
          <button className="icon" title="Redo" aria-label="Redo" disabled={!canRedo} onClick={() => w.getState().redo()}><Redo2 size={16} strokeWidth={2.25} /></button>
        </div>

        {shard && <p className="stat">{shard.vertices.length} vertices · {shard.faces.length} faces · one unit is 2^{shard.unit}</p>}

        <div className="tools">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              className={`tool ${tool === t.tool ? 'is-on' : ''}`}
              aria-pressed={tool === t.tool}
              title={t.hint}
              onClick={() => w.getState().setTool(t.tool)}
            >{t.label}</button>
          ))}
        </div>

        <button
          className="publish"
          disabled={publishing || !shard || shard.vertices.length === 0}
          onClick={() => { if (shard) void useNostr.getState().publish(shard) }}
          title={signer === 'none' ? 'Pick a key first, above' : 'Publish this object as a nostr event'}
        >
          <Save size={16} strokeWidth={2.25} /> {publishing ? 'PUBLISHING' : 'PUBLISH'}
        </button>

        <div className="row row--wrap">
          <button className="btn" onClick={() => w.getState().create()}><Plus size={16} strokeWidth={2.25} /> NEW</button>
          {shards.map((s) => (
            <button
              key={s.id}
              className={`chip ${s.id === shard?.id ? 'is-on' : ''}`}
              onClick={() => w.getState().select(s.id)}
              title={`${s.vertices.length} vertices`}
            >{s.name}</button>
          ))}
        </div>
      </div>
    </section>
  )
}
