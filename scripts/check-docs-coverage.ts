/**
 * check-docs-coverage.ts
 *
 * Parses packages/parcely/src/types.ts and errors.ts for exported
 * identifiers, then greps every website/docs/**\/*.mdx for each identifier.
 * Fails with non-zero exit code if any identifier is referenced in zero pages.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import * as ts from 'typescript';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 1. Extract exported identifiers from TypeScript source files
// ---------------------------------------------------------------------------

function getExportedIdentifiers(filePath: string): string[] {
  const source = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    path.basename(filePath),
    source,
    ts.ScriptTarget.Latest,
    true,
  );

  const identifiers: string[] = [];

  function visit(node: ts.Node) {
    // Top-level declarations with export keyword
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const isExported = modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );

    if (!isExported) {
      ts.forEachChild(node, visit);
      return;
    }

    if (ts.isInterfaceDeclaration(node)) {
      identifiers.push(node.name.text);
    } else if (ts.isTypeAliasDeclaration(node)) {
      identifiers.push(node.name.text);
    } else if (ts.isClassDeclaration(node) && node.name) {
      identifiers.push(node.name.text);
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      identifiers.push(node.name.text);
    } else if (ts.isEnumDeclaration(node)) {
      identifiers.push(node.name.text);
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          identifiers.push(decl.name.text);
        }
      }
    } else if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
      identifiers.push(node.name.text);
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
  return identifiers;
}

// ---------------------------------------------------------------------------
// 2. Collect all MDX files
// ---------------------------------------------------------------------------

function collectMdxFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMdxFiles(full));
    } else if (entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// 3. Check coverage
// ---------------------------------------------------------------------------

const typesFile = path.join(ROOT, 'packages/parcely/src/types.ts');
const errorsFile = path.join(ROOT, 'packages/parcely/src/errors.ts');

const identifiers = [
  ...getExportedIdentifiers(typesFile),
  ...getExportedIdentifiers(errorsFile),
];

// Deduplicate
const uniqueIdentifiers = [...new Set(identifiers)];

const docsDir = path.join(ROOT, 'website/docs');
const mdxFiles = collectMdxFiles(docsDir);

// Also include the landing page
const landingPage = path.join(ROOT, 'website/src/pages/index.tsx');
const allDocFiles = [...mdxFiles];
if (fs.existsSync(landingPage)) {
  allDocFiles.push(landingPage);
}

// Read all doc content once
const docContents = allDocFiles.map((f) => ({
  file: f,
  content: fs.readFileSync(f, 'utf-8'),
}));

const missing: string[] = [];

for (const id of uniqueIdentifiers) {
  const found = docContents.some((doc) => doc.content.includes(id));
  if (!found) {
    missing.push(id);
  }
}

if (missing.length > 0) {
  console.error('The following exported identifiers are not referenced in any docs page:');
  for (const id of missing) {
    console.error(`  - ${id}`);
  }
  process.exit(1);
} else {
  console.log(`All ${uniqueIdentifiers.length} exported identifiers are referenced in docs.`);
  process.exit(0);
}
