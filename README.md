# Flowcharts

Troubleshooting flowcharts written in [Mermaid](https://mermaid.js.org/), rendered to PDF.

## Requirements

- Node.js 22.18 or later (`render.ts` is run directly, without a build step)
- Chromium. The path is hardcoded as `PUPPETEER_EXECUTABLE_PATH` in `render.ts`;
  change it if yours lives elsewhere.

## Building

```console
$ npm install
$ npm run build
```

The PDFs are written to `dist/`.
Rendering needs an internet connection: Mermaid and the ELK layout engine are
loaded from a CDN by `page.html`.

## Adding a diagram

Diagrams live in `diagrams/`, as `.mmd` files:

- A file directly in `diagrams/` becomes its own PDF.
- A subdirectory becomes one PDF with a page per file.

Files within a subdirectory are ordered by their numeric prefix, and the document
title is derived from the file or directory name.
Page orientation is chosen per diagram, based on its aspect ratio.

> [!NOTE]
> While GitHub renders a preview of Mermaid diagrams, it does not support the
> ELK renderer and lacks the custom style rules, so those previews are not
> representative of the rendered result.

## License

The diagrams in `diagrams/` and the PDFs rendered from them are licensed under
[CC BY 4.0](LICENSE.txt).
The build script (`render.ts` and `page.html`) is licensed under the
[MIT license](LICENSE-CODE.txt).
