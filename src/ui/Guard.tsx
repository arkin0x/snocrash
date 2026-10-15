/**
 * Guard.tsx - a render error kept to the part of the screen it happened in.
 *
 * snocrash has no error boundary above its views, so a throw while drawing
 * anything blanks the whole app. The feed draws what strangers published,
 * listings and their sellers' handlers included: a Guard around the feed,
 * and one around each listing, keeps one bad event from taking the workshop
 * with it.
 */

import { Component, type ReactNode } from 'react'

interface Props {
  /** What it guards, for the console. */
  where: string
  /** What stands in its place after a throw; `retry` draws it again. */
  fallback: (retry: () => void) => ReactNode
  children: ReactNode
}

export class Guard extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error): void {
    console.warn(`snocrash: ${this.props.where} could not be drawn`, error)
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback(() => this.setState({ failed: false })) : this.props.children
  }
}
