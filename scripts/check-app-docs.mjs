#!/usr/bin/env node
// Lints docs/app/ against the rules in docs/app/README.md.
//
// The Verify: line is these docs' only real anti-rot mechanism, so it has to be true: a doc
// citing a script that doesn't exist (or that exercises a different node) is worse than one
// citing nothing. This checks what a machine can — paths resolve, anchors exist, the header
// block is present, and no history crept into a current-state-only doc. It cannot check that a
// cited script actually covers the node; that still needs a human or an agent to read it.
//
//   node scripts/check-app-docs.mjs
//
// Exits non-zero on any ERROR. WARNs are advisory.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = process.cwd();
const DOCS = join(ROOT, "docs/app");

let errors = 0;
let warnings = 0;
const err = (file, msg) => {
  console.log(`  ERROR ${file}: ${msg}`);
  errors++;
};
const warn = (file, msg) => {
  console.log(`  warn  ${file}: ${msg}`);
  warnings++;
};

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** GitHub-style anchor: lowercase, strip punctuation, spaces -> hyphens. */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

function anchorsOf(absPath) {
  const out = new Set();
  for (const line of readFileSync(absPath, "utf8").split("\n")) {
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (m) out.add(slugify(m[1]));
  }
  return out;
}

// Phrases that mean history leaked into a current-state doc (README rule 1).
const HISTORY_PATTERNS = [
  /\bwe used to\b/i,
  /\bused to be\b/i,
  /\bpreviously,/i,
  /\bformerly\b/i,
  /\bas of [a-z]+ \d/i,
];

const files = walk(DOCS).sort();
console.log(`Checking ${files.length} docs under docs/app\n`);

for (const abs of files) {
  const rel = abs.slice(ROOT.length + 1);
  const text = readFileSync(abs, "utf8");
  const isIndex = rel.endsWith("docs/app/README.md");
  // Docs that aren't screen references. The header block asserts "this is true now, and here's
  // the script that proves it" — meaningless for a backlog of things that are deliberately NOT
  // true yet, so it isn't demanded of them. Every other rule still applies.
  const isBacklog = rel.endsWith("docs/app/onboarding/bugs_and_improvements.md");

  // --- header block ---------------------------------------------------------
  if (!isIndex) {
    const head = text.split("\n").slice(0, 12).join("\n");
    if (!/^#\s+\S/m.test(head)) err(rel, "no H1 title in the first 12 lines");
    if (!isBacklog) {
      if (!/Status:/.test(head)) err(rel, "header block missing `Status:`");
      if (!/Last verified:/.test(head)) err(rel, "header block missing `Last verified:`");
      if (!/Verify:/.test(head)) err(rel, "header block missing `Verify:`");
    }
  }

  // --- Verify: targets must exist -------------------------------------------
  // Matches the paths cited anywhere in the doc, then confirms they're real files.
  for (const m of text.matchAll(/`(scripts\/[A-Za-z0-9_\-/.]+\.(?:mjs|ts))`/g)) {
    if (!existsSync(join(ROOT, m[1]))) err(rel, `cites a script that does not exist: ${m[1]}`);
  }

  // --- source files referenced must exist -----------------------------------
  for (const m of text.matchAll(/`((?:lib|app|content|supabase)\/[A-Za-z0-9_\-/.]+\.(?:ts|tsx|yaml|sql))`/g)) {
    if (!existsSync(join(ROOT, m[1]))) err(rel, `references a missing source file: ${m[1]}`);
  }

  // --- relative links resolve, including anchors ----------------------------
  for (const m of text.matchAll(/\]\((\.[^)]+)\)/g)) {
    const [target, anchor] = m[1].split("#");
    const abs2 = resolve(dirname(abs), target);
    if (!existsSync(abs2)) {
      err(rel, `broken link: ${m[1]}`);
      continue;
    }
    if (anchor && !anchorsOf(abs2).has(anchor)) {
      err(rel, `link anchor not found in target: ${m[1]}`);
    }
  }

  // --- current-state-only rule ----------------------------------------------
  if (!isIndex) {
    for (const p of HISTORY_PATTERNS) {
      const hit = p.exec(text);
      if (hit) warn(rel, `reads like history, not current state: "${hit[0]}" (README rule 1)`);
    }
  }

  // --- length --------------------------------------------------------------
  const lines = text.split("\n").length;
  if (lines > 140) warn(rel, `${lines} lines — over the ~1 page guideline, consider moving shared behaviour to _shared/`);
}

// --- every onboarding node should be documented or knowingly absent ---------
const yaml = readFileSync(join(ROOT, "content/onboarding/flow-structure.yaml"), "utf8");
const nodes = [...yaml.matchAll(/^ {2}- id: (\w+)$/gm)].map((m) => m[1]);
const documented = new Set(files.map((f) => f.split("/").pop().replace(/\.md$/, "")));
const covered = (id) => documented.has(id) || files.some((f) => readFileSync(f, "utf8").includes(id));
const missing = nodes.filter((id) => !covered(id));
if (missing.length) {
  console.log(`\n  note  ${missing.length} node(s) not mentioned in any doc: ${missing.join(", ")}`);
}

console.log(`\n${errors} error(s), ${warnings} warning(s), ${nodes.length} nodes in the flow`);
process.exit(errors > 0 ? 1 : 0);
