/**
 * App.tsx - SNOCRASH.
 *
 * The workshop is the whole app. ONOSENDAI's editor UI came across as it is,
 * because it is good: overlay chips instead of a sidebar, panels that open
 * over the bench rather than taking space from it, and the tools where a thumb
 * already is. What changed is what the chips do. There is no coordinate system
 * here, no movement, no encryption and no region key: an object is made, then
 * published, then other people's objects are in the FEED.
 */

import { useEffect } from 'react'
import { Workshop } from './ui/Workshop'
import { useNostr } from './store/useNostr'
import { useWorkshop } from './store/useWorkshop'

export function App(): JSX.Element {
  useEffect(() => { void useNostr.getState().init() }, [])
  // Always something to edit, so the bench is never an empty room.
  useEffect(() => {
    const w = useWorkshop.getState()
    if (w.shards.length === 0) w.select(w.create('first object'))
    else if (!w.currentId) w.select(w.shards[0].id)
    if (!w.open) w.openWorkshop()
  }, [])
  return <Workshop />
}
