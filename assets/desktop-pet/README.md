# Desktop Pet Animation Assets

Place optional approved desktop-pet animation assets in this directory. The application currently
works without them by animating the imported character portrait.

## Preferred Format: Codex v2 Atlas

Place these two files directly in one folder:

- `pet.json`
- `spritesheet.webp` (static WebP, not animated)

The atlas must be exactly 1536 x 2288 pixels: 8 columns by 11 rows, with 192 x 208 pixel cells.
It contains the nine standard Codex animation rows and sixteen clockwise look directions. Example:

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "A short description",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp"
}
```

## Compatible Format: Separate Action Files

- Transparent animated WebP (recommended) or static PNG
- One complete action per file; do not combine actions into a sprite sheet
- Every action uses the same square canvas and character scale
- Recommended frame size: 512 x 512 pixels
- Recommended rate: 8-15 frames per second
- Keep the feet or lower body on a consistent baseline
- No text, background, watermark, baked-in shadow or UI controls

## Required Action Set

1. `idle.webp`: breathing and blinking, 24-48 looping frames
2. `walk-left.webp`: walking left, 8-16 looping frames
3. `walk-right.webp`: walking right, 8-16 looping frames
4. `greet.webp`: waving or greeting, 12-24 frames
5. `happy.webp`: positive reaction, 12-24 frames
6. `thinking.webp`: thinking or waiting, 12-24 looping frames
7. `sleep.webp`: sleeping, 24-48 looping frames

## Optional Action Set

- `surprised.webp`
- `sad.webp`
- `angry.webp`
- `sit.webp`
- `stretch.webp`

The app recognizes the standard filenames automatically, so `manifest.json` is optional. To use
custom filenames, provide this manifest:

```json
{
  "version": 1,
  "actions": {
    "idle": "idle.webp",
    "greet": "greet.webp"
  }
}
```

All animation files for one character must use the same approved visual identity. Avoid generating
each action independently without a shared reference image, because clothing, face and proportions
will drift between actions.
