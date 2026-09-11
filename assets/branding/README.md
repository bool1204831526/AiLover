# Branding Asset Intake

Place final approved branding files in this directory. Do not put character portraits or private
user assets here.

## Required Before Public Release

1. `app-icon.png`
   - 1024 x 1024 pixels
   - transparent PNG
   - square composition with important detail inside the central 80 percent
   - no baked-in rounded corners; Windows applies its own masks where appropriate
2. `app-icon.ico`
   - multi-resolution Windows icon containing 16, 24, 32, 48, 64, 128 and 256 pixel variants
   - derived from the same approved source as `app-icon.png`

## Optional Installer Artwork

- `installer-sidebar.bmp`: 164 x 314 pixels for the assisted installer.
- `installer-header.bmp`: 150 x 57 pixels for installer header pages.

The approved product mark is a lavender heart with a white `A` on a transparent background. Future
refinements should remain legible at 16 pixels and avoid fine lines, small text, photographic detail
and gradients that disappear at taskbar size.

After these files are added, the packaging configuration must explicitly reference them and the
installer, executable, taskbar and Start menu rendering must be checked on Windows 10 and 11.
