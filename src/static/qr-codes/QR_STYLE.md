# ComiCine QR Code Style

## Priority

1. Place the matching service icon in the center. Hide the QR modules behind the icon and leave a clean white margin around it.
2. Apply the rounded black-and-white QR style used by the existing ComiCine QR images.

## Defaults

- Square canvas: 1500 × 1500 px, white background, 100 px outer margin.
- QR version: automatic, so each payload fits without forcing a fixed version.
- Encoding mode: Byte; choose the mask pattern automatically.
- Error correction: H, to support the center icon and rounded modules.
- Center icon: use the matching PNG from `small-icons/`; target `imageOptions.imageSize` 0.15 and hide covered background dots.
- QR dots: black `extra-rounded`; corner squares: black `extra-rounded`; corner dots: black `dot`.
- Keep the final image as a PNG and scan-check it after generation.

Keep QR payloads specific to the requested image. Do not reuse URLs, contact details, or fixed version values from old generation notes.
