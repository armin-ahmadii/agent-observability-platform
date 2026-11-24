// A small progress ring (16×16, starts at 12 o'clock via CSS rotate). Used by agent rows and the weekly limit.
const R = 6.25
const CIRCUMFERENCE = 2 * Math.PI * R

export function Ring({ className, frac, fgClass = 'fg', hideEmpty }: { className: string; frac: number; fgClass?: string; hideEmpty?: boolean }) {
  return <svg className={className} viewBox="0 0 16 16" aria-hidden="true"><circle className="bg" cx="8" cy="8" r={R} />
    {(frac > 0 || !hideEmpty) && <circle className={fgClass} cx="8" cy="8" r={R} strokeDasharray={`${(frac * CIRCUMFERENCE).toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}`} />}</svg>
}
