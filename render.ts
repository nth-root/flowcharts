import { readFile, writeFile, mkdir, readdir } from "node:fs/promises"
import path from "node:path"
import { PDFDocument } from "pdf-lib";
import puppeteer from "puppeteer";
import type { Browser } from 'puppeteer';

declare global {
    interface Window {
        mermaid: {
            initialize(config: Record<string, unknown>): void;
            render(id: string, code: string): Promise<{ svg: string }>;
        }
    }
}

interface Margin {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

interface Job {
    out: string;
    title: string;
    files: string[];
}

interface Box {
    width: number;
    height: number;
}

const PAGE_SIZE = [210, 297]; // A4
const MARGIN: number = 10;

const SOURCE_DIR = 'diagrams';
const DIST_DIR = 'dist';
const PUPPETEER_EXECUTABLE_PATH = '/snap/bin/chromium';

async function main() {
    const jobs = await scan();

    await mkdir(DIST_DIR, { recursive: true });

    await render(jobs);
}

async function render(jobs: Job[]) {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: PUPPETEER_EXECUTABLE_PATH,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
    });

    try {
        for (const job of jobs) {
            const pages = [];

            for (const [i, file] of job.files.entries()) {
                try {
                    const rendered = await renderPage(browser, file);

                    pages.push(rendered.pdf);
                } catch (error) {
                    console.error(error);
                }
            }

            const dest = path.join(DIST_DIR, job.out);

            await writeFile(dest, await merge(pages, job.title));
        }
    } finally {
        await browser.close();
    }
}

interface RenderResult {
    pdf: Uint8Array;
    landscape: boolean;
    box: Box;
}

const THEME = 'default';

async function renderPage(browser: Browser, file: string): Promise<RenderResult> {
    let src = await readFile(file, 'utf8');
    const html = await readFile(path.join(import.meta.dirname, 'page.html'), 'utf8');
    const page = await browser.newPage();

    const nonBreakingHyphen = '#8209;'
    src = src.replaceAll(/(?<=\([^()]*)-/g, nonBreakingHyphen);

    try {
        await page.setContent(html, { waitUntil: "domcontentloaded" });
        await page.waitForFunction('window.__ready == true || window.__error');

        const box: Box = await page.evaluate(
            async (code: string, theme: string): Promise<Box> => {
                const config: Record<string, unknown> = {
                    startOnLoad: false,
                    theme,
                    securityLevel: 'strict',
                    layout: 'elk',
                    elk: {
                        mergeEdges: true,
                        nodePlacementStrategy: 'BRANDES_KOEPF',
                        nodePlacementAlignment: 'RIGHTDOWN',
                        forceNodeModelOrder: true
                    }
                };

                window.mermaid.initialize(config);

                const { svg } = await window.mermaid.render('d' + Math.random().toString(36).slice(2), code);
                const host = document.getElementById('page')!;
                host.innerHTML = svg;
                const el = host.querySelector('svg')!;

                let viewbox = (el.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
                if (viewbox.length !== 4 || viewbox.some(Number.isNaN)) {
                    const b = el.getBBox();
                    viewbox = [b.x, b.y, b.width, b.height];
                    el.setAttribute('viewBox', viewbox.join(' '));
                }

                el.removeAttribute('width');
                el.removeAttribute('height');
                el.style.maxWidth = 'none';
                el.setAttribute('preserveAspectRatio', 'xMinYMin meet');

                return { width: viewbox[2]!, height: viewbox[3]! };
            },
            src,
            THEME
        );

        const landscape = box.width / box.height > 1;

        const [pw, ph] = PAGE_SIZE;
        const [pageWidth, pageHeight] = landscape ? [ph, pw] : [pw, ph];

        await page.evaluate(
            (width: number, height: number) => {
                const el = document.getElementById('page')!;
                el.style.width = width + 'mm';
                el.style.height = height + 'mm';
            },
            pageWidth - (MARGIN * 2),
            pageHeight - (MARGIN * 2.8),
        );

        const pdf = await page.pdf({
            printBackground: true,
            landscape,
            format: 'A4',
            displayHeaderFooter: true,
            headerTemplate: renderHeaderFooter(''),
            footerTemplate: renderHeaderFooter('© <a href="https://nth-root.nl/en/" style="color: #000; font-weight:normal;">Nth Root Software Consultancy</a>'),
            margin: {
                top: `${MARGIN}mm`,
                right: `${MARGIN}mm`,
                bottom: `${MARGIN}mm`,
                left: `${MARGIN}mm`,
            }
        });

        return { pdf, landscape, box };
    } finally {
        await page.close();
    }
}

function renderHeaderFooter(text: string): string {
    const style = `width: 100%; font-size: 8px; margin: 0; padding: ${MARGIN / 2}mm ${MARGIN}mm;`;

    return `<div style="${style}">${text}</div>`;
}

async function merge(buffers: Uint8Array[], title: string): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.setTitle(title);

    for (const buf of buffers) {
        const src = await PDFDocument.load(buf);
        const pages = await doc.copyPages(src, src.getPageIndices());
        pages.forEach((p) => doc.addPage(p));
    }

    return doc.save();
}

async function scan(): Promise<Job[]> {
    const entries = await readdir(SOURCE_DIR, { withFileTypes: true });
    const jobs = [];

    // Root-level files become standalone documents
    for (const entry of entries.filter((entry) => entry.isFile() && isMermaid(entry.name)).sort((a, b) => byPrefix(a.name, b.name))) {
        const base = path.basename(entry.name, path.extname(entry.name));
        jobs.push({ out: `${base}.pdf`, title: humanize(base), files: [path.join(SOURCE_DIR, entry.name)] });
    }

    // Each subdirectory becomes one merged, multi-page document
    for (const directory of entries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
        const dir = path.join(SOURCE_DIR, directory.name);
        const files = (await readdir(dir))
            .filter(isMermaid)
            .sort(byPrefix)
            .map((n) => path.join(dir, n));

        if (files.length) {
            jobs.push({ out: `${directory.name}.pdf`, title: humanize(directory.name), files });
        }
    }

    return jobs;
}

function isMermaid(path: string): boolean {
    return /\.(mmd|mermaid)$/i.test(path);
}

function humanize(name: string): string {
    return name
        .replace(/^\d+[-_. ]+/, '')
        .replace(/[-_]+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function byPrefix(a: string, b: string): number {
    const num = (string: string) => {
        const match = string.match(/^(\d+)/);
        return match ? Number(match[1]) : Infinity;
    }

    return num(a) - num(b) || a.localeCompare(b);
}

main();
