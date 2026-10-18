# Benchmark Report

Generated: 2026-10-18T16:28:57.210Z
Build time: 145.2 ms

## Totals

| Version | Raw | Gzip | Brotli |
|---|---:|---:|---:|
| Source | 91.1 KB | 26.5 KB | 22.6 KB |
| Dist | 73.8 KB | 23.8 KB | 20.4 KB |
| Reduction | 18.9% | 10.1% | 9.7% |

## Files

| File | Source Raw | Dist Raw | Raw Reduction | Dist Gzip | Dist Brotli |
|---|---:|---:|---:|---:|---:|
| index.html | 12.1 KB | 9.3 KB | 23.3% | 3.0 KB | 2.4 KB |
| dashboard.html | 5.2 KB | 4.2 KB | 20.3% | 1.5 KB | 1.2 KB |
| styles.css | 25.4 KB | 20.3 KB | 20.1% | 4.8 KB | 4.2 KB |
| dashboard.css | 8.6 KB | 7.0 KB | 18.6% | 2.1 KB | 1.8 KB |
| app.js | 24.0 KB | 19.6 KB | 18.3% | 6.2 KB | 5.4 KB |
| dashboard.js | 7.8 KB | 6.4 KB | 17.5% | 2.3 KB | 2.0 KB |
| service-worker.js | 1.7 KB | 1.2 KB | 34.2% | 521 B | 434 B |
| manifest.webmanifest | 1.3 KB | 1014 B | 25.8% | 468 B | 365 B |
| icons/icon.svg | 580 B | 580 B | 0.0% | 329 B | 294 B |
| icons/icon-192.png | 904 B | 904 B | 0.0% | 707 B | 665 B |
| icons/icon-512.png | 3.5 KB | 3.5 KB | 0.0% | 1.8 KB | 1.8 KB |

## Notes

- `npm run build` writes compressed production files to `dist/`.
- Each `dist` asset also gets `.gz` and `.br` versions for gzip and Brotli serving.
- JavaScript and CSS assets are compacted and pre-compressed with gzip/Brotli for optimal performance.
