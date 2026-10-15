/**
 * tileStats.ts - the line under a feed tile's title: what the object is made
 * of, how it is drawn, and at what scale (arkinox, 2026-10-15).
 */
import type { ShardModel } from 'sno-core/shards'

export function tileStats(shard: Pick<ShardModel, 'vertices' | 'faces' | 'parts' | 'mode' | 'unit'>): string {
  const parts = shard.parts?.length ? [`${shard.parts.length} obj`] : []
  return [`${shard.vertices.length} v`, `${shard.faces.length} f`, ...parts, shard.mode.toUpperCase(), `unit 2^${shard.unit}`].join(' · ')
}
