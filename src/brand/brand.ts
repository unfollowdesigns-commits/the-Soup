/* ============================================================
   THE SOUP — identity
   One place for every string that carries the name, so the
   product never says two different things about itself.
   ============================================================ */

export const BRAND = {
  name: 'SOUP',
  full: 'THE SOUP',
  /* what it is, in one line, in the product's own voice */
  line: 'A darkroom for people who ruin film on purpose.',
  /* the longer form, used once, on the way in */
  blurb:
    'Bring a picture. Decide what it was shot on, how it was developed, and what happened to it afterwards. Chemistry, heat, dirt, light that got in. Then keep the recipe.',
  /* section names — the product has benches, not tabs */
  benches: {
    lab: 'LAB',
    stock: 'STOCK',
    cook: 'COOK',
    trace: 'TRACE',
    press: 'PRESS',
    book: 'BOOK',
  },
  /* the voice: lower case for prose, caps for labels, no adjectives
     doing work that a number could do */
  verbs: {
    load: 'LOAD',
    cook: 'COOK',
    ruin: 'RUIN',
    keep: 'KEEP',
    print: 'PRINT',
    pull: 'PULL',
  },
} as const;

/* used on the entry screen and in the press */
export const COLOPHON = 'SOUP — a film lab that runs in a browser';
