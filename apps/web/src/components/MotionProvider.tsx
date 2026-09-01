import type { ReactNode } from "react";
import { LazyMotion, domAnimation } from "framer-motion";

/**
 * Loads framer-motion's DOM feature bundle once, at the app shell (SPO-241).
 *
 * Screens render the stripped `m` component (re-exported from `@/lib/motion`)
 * rather than `motion`. `motion` bundles the whole animation engine into
 * whichever chunk first touches it — on SPO-235 that was the Dashboard route
 * chunk, the first screen a signed-in creator sees, which went 6.4 kB -> 152 kB
 * for that reason alone. `m` ships the component shell only and gets its
 * behaviour from the features this provider supplies.
 *
 * `domAnimation` is the middle feature bundle: animations, variants, exit
 * animations and tap/hover/focus gestures. It deliberately excludes `domMax`'s
 * layout projection and drag, which nothing in the product uses — the Pipeline
 * board drags with dnd-kit, not framer. Adding a `layout` / `layoutId` prop or
 * a framer `drag` anywhere means switching this to `domMax` and re-measuring;
 * `scripts/verify-web-bundle-budget.mjs` is the backstop that notices.
 *
 * Loaded synchronously rather than via `features={() => import(...)}`: our
 * entrance animations start from `opacity: 0`, so an async feature bundle would
 * leave the first screen blank until it arrived.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <LazyMotion features={domAnimation}>{children}</LazyMotion>;
}

export default MotionProvider;
