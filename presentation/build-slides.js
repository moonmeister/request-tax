#!/usr/bin/env node

/**
 * Build a reveal.js slide deck from authored Markdown slides.
 *
 * Slide files:  presentation/slides/*.md  (sorted alphabetically)
 * Output:       presentation/dist/index.html
 *
 * Each .md file becomes one or more <section> elements.
 * Use "---" on its own line to split a file into multiple slides.
 * Raw HTML (e.g. <iframe>) is passed through as-is.
 *
 * Run: node presentation/build-slides.js [--open]
 */

import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import minimist from "minimist";

const SLIDES_DIR = path.resolve("presentation", "slides");
const DIST_DIR = path.resolve("presentation", "dist");
const REVEAL_DIR = path.resolve("node_modules", "reveal.js");

// ─── Assemble slides ────────────────────────────────────────────────────

async function buildSlides() {
  const files = (await fs.readdir(SLIDES_DIR))
    .filter((f) => f.endsWith(".md"))
    .sort();

  const sections = [];

  for (const file of files) {
    const raw = await fs.readFile(path.join(SLIDES_DIR, file), "utf8");
    const parts = raw.split(/\n---\n/);

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      sections.push(
        `<section data-markdown>\n<textarea data-template>\n${trimmed}\n</textarea>\n</section>`,
      );
    }
  }

  return sections.join("\n\n");
}

// ─── HTML shell ─────────────────────────────────────────────────────────

function wrapInDeck(slidesHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Request Tax – H1 vs H3</title>
<link rel="stylesheet" href="reveal.css">
<link rel="stylesheet" href="theme/white.css">
<style>
  .reveal h1, .reveal h2, .reveal h3, .reveal h4 { text-transform: none; }
  .reveal h1 { font-size: 2.2em; }
  .reveal h2 { font-size: 1.6em; }
  .reveal h3 { font-size: 1.2em; }
  .reveal h4 { font-size: 1.0em; color: #555; }
  .reveal ul, .reveal ol { font-size: 0.85em; text-align: left; display: block; margin-left: 1em; }
  .reveal p { font-size: 0.85em; }
  .reveal code { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
  .reveal iframe { border-radius: 8px; }
</style>
</head>
<body>
<div class="reveal">
  <div class="slides">
${slidesHtml}
  </div>
</div>
<script src="reveal.js"></script>
<script src="plugin/markdown.js"></script>
<script>
  Reveal.initialize({
    hash: true,
    width: 1280,
    height: 720,
    margin: 0.04,
    transition: 'slide',
    plugins: [RevealMarkdown],
  });
</script>
</body>
</html>`;
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const slidesHtml = await buildSlides();
  const html = wrapInDeck(slidesHtml);

  await fs.mkdir(DIST_DIR, { recursive: true });

  // Copy reveal.js assets
  const revealDist = path.join(REVEAL_DIR, "dist");
  await fs.copyFile(
    path.join(revealDist, "reveal.js"),
    path.join(DIST_DIR, "reveal.js"),
  );
  await fs.copyFile(
    path.join(revealDist, "reveal.css"),
    path.join(DIST_DIR, "reveal.css"),
  );
  await fs.cp(path.join(revealDist, "theme"), path.join(DIST_DIR, "theme"), {
    recursive: true,
  });
  await fs.mkdir(path.join(DIST_DIR, "plugin"), { recursive: true });
  await fs.copyFile(
    path.join(revealDist, "plugin", "markdown.js"),
    path.join(DIST_DIR, "plugin", "markdown.js"),
  );

  const outPath = path.join(DIST_DIR, "index.html");
  await fs.writeFile(outPath, html);
  console.log(`✓ Slides written to presentation/dist/index.html`);

  const argv = minimist(process.argv.slice(2));
  if (argv.open) {
    const cmd =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    exec(`${cmd} ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
