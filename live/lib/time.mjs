export const SECOND = 1000
export const MINUTE = 60 * SECOND
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

// Lets other work (like page requests) run before a long loop continues.
export const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve))
