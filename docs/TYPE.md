# Type and colour

## The three colours

```
blue    #0b4cc7    the colour the thing is
orange  #ff3d10    the one hot colour — state, never decoration
ink     #080808    type on blue, and the room
```

Used flat and used hard. No gradients between them, no tints of them,
nothing in the middle.

**The photograph is the exception.** A picture is judged against black and
nothing else, so the room around a specimen stays black and the blue lives
in the chrome. That is why the benches are blue and the stage is not: a
bench sits *over* the photograph and is open only while you are reading
controls, never while you are judging colour.

Where each one goes:

| | |
|---|---|
| **Blue** | the front page, the intake screen, the develop sheet, and the benches that open over the picture |
| **Orange** | the value you are changing, the stage that is on, the thing that is running. Never a heading, never a border for its own sake |
| **Ink** | the room behind a photograph, and type set on blue |

## The type scale

The lab used to have one problem above all others: **nothing in the working
screens was set above 16 px.** Every label was 10, every value 11, every
heading 10 uppercase at the same tracking. A screen with one size and one
weight has no hierarchy, and a screen with no hierarchy reads as a form.

So the scale in use now runs:

```
9  nano     the small print that really is small print
10 micro    notes under an instrument
11 tiny     a label
13 body     a stage name in the spine, the loaded stock
15 head     a stage name in the cook
21 title    a bench name
27 read     the number an instrument is showing
44 shout-s  a heading that has to carry a screen
58–184     the name
```

Numbers are set large because a darkroom is full of large numerals, and
because the number is what you are actually reading when you drag something.

## The face

**PP Mori** (Pangram Pangram) is the intended face. It is a licensed font:
it is **not bundled with this repository and it is not fetched at runtime**.

To use it, drop the files in:

```
public/fonts/PPMori-Regular.woff2
public/fonts/PPMori-SemiBold.woff2
public/fonts/PPMori-ExtraBold.woff2
```

`src/styles/type.css` already declares the `@font-face` rules pointing at
those paths, so the whole lab switches over as soon as they exist. Nothing
needs to change in code.

Until then the stack falls through:

```
'PP Mori' → 'Space Grotesk' → 'Archivo' → system grotesk
```

Space Grotesk and Archivo both load from Google Fonts. The design degrades
to a heavier fallback, not to a different design.

**A note on the screenshots in this repository's history:** the container
these were rendered in has no outbound access to Google Fonts, so every
screenshot taken during development is set in the system fallback (Arial).
Do not judge the typography from them.
