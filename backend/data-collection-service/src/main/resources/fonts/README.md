# Korean Font Files for PDF Report Generation

This directory contains Korean font files required for PDF report generation with proper Korean text support.

## Required Fonts

- `NotoSansKR-Regular.ttf` - Regular weight
- `NotoSansKR-Bold.ttf` - Bold weight

## Source

Google Fonts - Noto Sans Korean
https://fonts.google.com/noto/specimen/Noto+Sans+KR

## License

These fonts are licensed under the SIL Open Font License (OFL).
https://scripts.sil.org/OFL

## Download Commands

If fonts are missing, download them using:

```bash
curl -L -o NotoSansKR-Regular.ttf "https://github.com/google/fonts/raw/main/ofl/notosanskr/NotoSansKR-Regular.ttf"
curl -L -o NotoSansKR-Bold.ttf "https://github.com/google/fonts/raw/main/ofl/notosanskr/NotoSansKR-Bold.ttf"
```

## Usage

These fonts are used by `PdfExportService.java` for generating PDF reports with Korean content.
