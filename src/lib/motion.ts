// Motion tokens from the design (design/*.html). Every animation uses these, so the app moves one way.
// The same curves exist as CSS (`ease-pop`, `ease-settle`, ... in globals.css) for plain transitions.

type Bezier = [number, number, number, number];

export const ease = {
  /** Small overshoot: buttons growing under a drag, the after-swipe toast arriving. */
  pop: [0.2, 0.9, 0.3, 1.2] as Bezier,
  /** No overshoot: progress bars, back cards moving up, content settling. */
  settle: [0.2, 0.9, 0.3, 1] as Bezier,
  /** A released card springing back to the centre. */
  spring: [0.2, 0.9, 0.3, 1.15] as Bezier,
  /** Accelerating out: a committed card leaving the screen. */
  exit: [0.4, 0, 1, 1] as Bezier,
  /** Big overshoot, used once: the opening animation. */
  bounce: [0.34, 1.56, 0.64, 1] as Bezier,
  /** Fades. */
  out: [0, 0, 0.58, 1] as Bezier,
};

/** Durations in seconds (Framer Motion units). */
export const duration = {
  press: 0.2,
  fade: 0.24,
  exit: 0.26,
  back: 0.3,
  segment: 0.3,
  /** Progress segments on the applications list, and the daily-usage bar. */
  segmentSlow: 0.4,
  toast: 0.38,
  spring: 0.42,
  word: 0.48,
  bar: 0.9,
};

export const transition = {
  press: { duration: duration.press, ease: ease.pop },
  fade: { duration: duration.fade, ease: ease.out },
  cardExit: { duration: duration.exit, ease: ease.exit },
  cardReturn: { duration: duration.spring, ease: ease.spring },
  backCard: { duration: duration.back, ease: ease.settle },
  toastIn: { duration: duration.toast, ease: ease.pop },
  segment: { duration: duration.segment, ease: ease.settle },
  segmentSlow: { duration: duration.segmentSlow, ease: ease.settle },
  bar: { duration: duration.bar, ease: ease.settle },
} as const;

/** Swipe deck physics, in CSS pixels at the 390 px design width. */
export const swipe = {
  /** Release past this distance commits the swipe; less springs back. */
  commitAt: 90,
  /** Degrees of rotation per pixel dragged (the design uses dx / 24). */
  rotatePerPx: 1 / 24,
  /** Rotation of a committed card on its way out. */
  exitRotate: 10,
  /** How far a committed card travels before it is removed. */
  exitDistance: 520,
  /** The card behind the top one: scale and drop while the top card rests. */
  backScale: 0.95,
  backOffsetY: 10,
  /** How much the Apply or Skip button grows at full drag. */
  buttonGrow: 0.08,
} as const;
