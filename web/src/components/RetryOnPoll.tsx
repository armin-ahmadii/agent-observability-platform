// If drawing the page throws (e.g. odd data from the server), show nothing for now and try again on the next poll,
// instead of leaving the whole page blank until a reload.
import { Component } from 'react'
import { deck } from '../data/store'

type State = { failedAt: number | null } // the store version that failed
export class RetryOnPoll extends Component<{ children: React.ReactNode }, State> {
  state: State = { failedAt: null }
  private unsubscribe?: () => void
  static getDerivedStateFromError(): State { return { failedAt: deck.getVersion() } }
  componentDidMount() {
    this.unsubscribe = deck.subscribe(() => { if (this.state.failedAt !== null && deck.getVersion() !== this.state.failedAt) this.setState({ failedAt: null }) })
  }
  componentWillUnmount() { this.unsubscribe?.() }
  render() { return this.state.failedAt === null ? this.props.children : null }
}
