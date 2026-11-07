import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import ts from "typescript";
import { discoverRuntimeSources } from "./runtime-source-guards.mjs";

/**
 * Dev-only import-graph check. Dependency-free apart from the existing
 * `typescript` package. Takes [relativePath, content][] (paths relative to src/),
 * erases type-only imports/re-exports, resolves static local imports and
 * re-exports, and reports runtime cycles. A local runtime edge that cannot be
 * resolved (or a dynamic import/require) is a failure, never silently dropped.
 */

function isTypeOnlyImport(statement) {
  const clause = statement.importClause;
  if (!clause) return false; // side-effect import: a runtime edge
  if (clause.isTypeOnly) return true;
  if (!clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    const elements = clause.namedBindings.elements;
    return elements.length > 0 && elements.every((element) => element.isTypeOnly);
  }
  return false;
}

function isTypeOnlyExport(statement) {
  if (statement.isTypeOnly) return true;
  const clause = statement.exportClause;
  if (clause && ts.isNamedExports(clause)) {
    return clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly);
  }
  return false;
}

/** Runtime module specifiers of one file, plus constructs the check cannot follow. */
export function runtimeSpecifiers(file, content) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const specifiers = [];
  const unsupported = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (!isTypeOnlyImport(statement)) specifiers.push(statement.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (!isTypeOnlyExport(statement)) specifiers.push(statement.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference)) {
      if (!statement.isTypeOnly) unsupported.push(`import-equals in ${file}`);
    }
  }
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) unsupported.push(`dynamic import() in ${file}`);
      else if (ts.isIdentifier(node.expression) && node.expression.text === "require") unsupported.push(`require() in ${file}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { specifiers, unsupported };
}

function resolveLocal(fromFile, specifier, known) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  const stripped = base.replace(/\.(?:js|ts)$/, "");
  for (const candidate of [base, `${stripped}.ts`, `${base}.ts`, `${base}/index.ts`]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/** Build the runtime graph: { nodes, edges: Map<file, Set<file>>, unresolved, unsupported }. */
export function buildRuntimeGraph(files) {
  const known = new Set(files.map(([file]) => file));
  const edges = new Map();
  const unresolved = [];
  const unsupported = [];
  for (const [file, content] of files) {
    const targets = new Set();
    edges.set(file, targets);
    const found = runtimeSpecifiers(file, content);
    unsupported.push(...found.unsupported);
    for (const specifier of found.specifiers) {
      if (!specifier.startsWith(".")) continue; // external package or host module
      const resolved = resolveLocal(file, specifier, known);
      if (resolved === null) unresolved.push(`${file} -> ${specifier}`);
      else targets.add(resolved);
    }
  }
  return { nodes: [...known].sort(), edges, unresolved, unsupported };
}

/** Strongly connected components with a cycle (size > 1 or a self-edge), Tarjan, sorted. */
export function findCycles(graph) {
  let counter = 0;
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  const connect = (node) => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.edges.get(node) ?? []) {
      if (!index.has(next)) {
        connect(next);
        low.set(node, Math.min(low.get(node), low.get(next)));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node), index.get(next)));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      if (component.length > 1 || graph.edges.get(node)?.has(node)) components.push(component.sort());
    }
  };
  for (const node of graph.nodes) if (!index.has(node)) connect(node);
  return components.sort((left, right) => left[0].localeCompare(right[0]));
}

/** Lines describing failures; empty when the graph is acceptable. `allowed` lists known cyclic components. */
export function evaluateGraph(files, allowed = []) {
  const graph = buildRuntimeGraph(files);
  const cycles = findCycles(graph);
  const allowedKeys = new Set(allowed.map((component) => [...component].sort().join(",")));
  const problems = [
    ...graph.unresolved.map((entry) => `unresolved local runtime import: ${entry}`),
    ...graph.unsupported.map((entry) => `unsupported construct: ${entry}`),
    ...cycles.filter((component) => !allowedKeys.has(component.join(","))).map((component) => `runtime import cycle: ${component.join(" <-> ")}`),
  ];
  return { graph, cycles, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
  const files = await discoverRuntimeSources(srcRoot);
  // Known, documented cyclic components. Keep empty unless a cycle is deliberately accepted.
  const allowed = [];
  const { graph, cycles, problems } = evaluateGraph(files, allowed);
  const edgeCount = [...graph.edges.values()].reduce((total, targets) => total + targets.size, 0);
  process.stdout.write(`import-graph: ${graph.nodes.length} files, ${edgeCount} runtime edges, ${cycles.length} cyclic component(s)\n`);
  for (const component of cycles) process.stdout.write(`  cycle: ${component.join(" <-> ")}\n`);
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`import-graph: ${problem}\n`);
    process.exit(1);
  }
}
