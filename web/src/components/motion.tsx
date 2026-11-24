// Motion pieces shared by every area. One curve (the page's one easing curve, --ease-fast in CSS), short durations, opacity + height/transform only.
// Nothing here animates on the 1.5s refresh: things animate once when they arrive and once when they leave.
import { useRef } from 'react'
import { AnimatePresence, m, useReducedMotion } from 'motion/react'

export const EASE = [0.62, 0.61, 0.02, 1] as const
const IN = { duration: 0.26, ease: EASE }
const OUT = { duration: 0.18, ease: EASE }
const POP_IN = { duration: 0.16, ease: EASE }
const POP_OUT = { duration: 0.12, ease: EASE }

/** A block that unfolds (height + fade) when it arrives and folds away when it leaves. Use inside <Rows> or <Appear>. */
export function Fold({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const hid = reduce ? { opacity: 0 } : { opacity: 0, height: 0 }
  const shown = reduce ? { opacity: 1 } : { opacity: 1, height: 'auto' }
  // Clip only while the height is moving, so focus rings and hover backgrounds are never cut at rest.
  const clip = (on: boolean) => () => ref.current?.classList.toggle('folding', on)
  return (
    <m.div ref={ref} className="fold" initial={hid} animate={shown} exit={{ ...hid, transition: OUT }} transition={IN}
      onAnimationStart={clip(true)} onAnimationComplete={clip(false)}>{children}</m.div>
  )
}

/** A list whose items come and go (each item a keyed <Fold>). Items already there on first paint don't animate. */
export function Rows({ children }: { children: React.ReactNode }) {
  return <AnimatePresence initial={false}>{children}</AnimatePresence>
}

/** One block that may or may not be there: unfolds when its data arrives, folds when it goes. Pass the block or null. */
export function Appear({ children }: { children: React.ReactNode }) {
  return <AnimatePresence initial={false}>{children ? <Fold key="a">{children}</Fold> : null}</AnimatePresence>
}

/** A menu that grows out of its button (set transform-origin in CSS) and leaves a little faster than it came. */
export function Pop({ open, children, ...rest }: { open: boolean; children: React.ReactNode; className?: string; id?: string; role?: string }) {
  const reduce = useReducedMotion()
  const hid = reduce ? { opacity: 0 } : { opacity: 0, transform: 'scale(0.97)' }
  const shown = reduce ? { opacity: 1 } : { opacity: 1, transform: 'scale(1)' }
  return (
    <AnimatePresence>
      {open && <m.div {...rest} initial={hid} animate={shown} exit={{ ...hid, transition: POP_OUT }} transition={POP_IN}>{children}</m.div>}
    </AnimatePresence>
  )
}
