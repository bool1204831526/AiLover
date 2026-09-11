# Desktop Pet Animation Assets

Place optional approved desktop-pet animation assets in this directory. The application currently
works without them by animating the imported character portrait.

## Preferred Format

- Transparent WebP or PNG sprite sheets
- One action per file
- Every frame uses the same square canvas and character scale
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

Provide `manifest.json` with frame layout and playback data:

```json
{
  "frameWidth": 512,
  "frameHeight": 512,
  "actions": {
    "idle": { "file": "idle.webp", "frames": 32, "fps": 12, "loop": true }
  }
}
```

All animation files for one character must use the same approved visual identity. Avoid generating
each action independently without a shared reference image, because clothing, face and proportions
will drift between actions.
