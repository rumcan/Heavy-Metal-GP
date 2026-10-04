// The rules of hooks, checked over every component and custom hook in src/ (there is no ESLint in this project).
//
// Why: starting Act 1 showed a blank screen (2026-10-04). StoryMode called two `useMemo` hooks AFTER an early
// `return` (the scene playback). React counts hooks on every render; the first render that played a scene ran two
// fewer, threw "Rendered fewer hooks than expected", and unmounted the whole app. This test reads the source with the
// TypeScript parser and fails on exactly that: a hook after a `return` that only happens sometimes, or a hook inside a
// condition or a loop. Callbacks and effects are their own functions and are not counted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

const isHookName = (name: string) => /^use[A-Z0-9]/.test(name);

/** `useThing(...)` or `React.useThing(...)`: the hook's name, else null. (React 19's plain `use` may be conditional.) */
function hookCall(node: ts.Node): string | null {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  if (ts.isIdentifier(callee) && isHookName(callee.text)) return callee.text;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'React' && isHookName(callee.name.text)) return `React.${callee.name.text}`;
  return null;
}

const isFunctionLike = (node: ts.Node) => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
  || ts.isMethodDeclaration(node) || ts.isAccessor(node) || ts.isConstructorDeclaration(node) || ts.isClassLike(node);

/** The name a function goes by: its own, or the variable it is assigned to (also through memo() and forwardRef()). */
function functionName(fn: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction): string | null {
  if (!ts.isArrowFunction(fn) && fn.name) return fn.name.text;
  let parent: ts.Node = fn.parent;
  while (ts.isCallExpression(parent) && /^(React\.)?(memo|forwardRef)$/.test(parent.expression.getText())) parent = parent.parent;
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) ? parent.name.text : null;
}

/** Every hook call under `node` (not inside nested functions), and whether it only runs on some paths. */
function hooksIn(node: ts.Node, found: (call: ts.Node, name: string, conditional: boolean) => void, conditional = false): void {
  const name = hookCall(node);
  if (name) found(node, name, conditional);
  const walk = (child: ts.Node | undefined, sometimes: boolean) => { if (child && !isFunctionLike(child)) hooksIn(child, found, conditional || sometimes); };
  if (ts.isIfStatement(node)) { walk(node.expression, false); walk(node.thenStatement, true); walk(node.elseStatement, true); return; }
  if (ts.isConditionalExpression(node)) { walk(node.condition, false); walk(node.whenTrue, true); walk(node.whenFalse, true); return; }
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken].includes(node.operatorToken.kind)) {
    walk(node.left, false); walk(node.right, true); return;
  }
  if (ts.isSwitchStatement(node)) { walk(node.expression, false); walk(node.caseBlock, true); return; }
  if (ts.isIterationStatement(node, false)) { ts.forEachChild(node, (child) => walk(child, true)); return; }
  if (ts.isCatchClause(node)) { walk(node.block, true); return; }
  if (ts.isCallExpression(node) && node.questionDotToken) { walk(node.expression, false); node.arguments.forEach((arg) => walk(arg, true)); return; }
  ts.forEachChild(node, (child) => walk(child, false));
}

/** The first `return` under `node`, not counting nested functions. */
function returnIn(node: ts.Node): ts.Node | null {
  if (ts.isReturnStatement(node)) return node;
  let hit: ts.Node | null = null;
  ts.forEachChild(node, (child) => { if (!hit && !isFunctionLike(child)) hit = returnIn(child); });
  return hit;
}

/** Rules-of-hooks problems in one file's source. */
export function hookProblems(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const problems: string[] = [];
  const at = (node: ts.Node) => `${path.relative(ROOT, file).replace(/\\/g, '/')}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      const name = functionName(node);
      if (name && (/^[A-Z]/.test(name) || isHookName(name)) && node.body) {
        const statements = ts.isBlock(node.body) ? node.body.statements : [node.body];
        let returned: ts.Node | null = null;
        for (const statement of statements) {
          if (isFunctionLike(statement)) continue; // an inner `function run() {}` returns from itself, not the component
          hooksIn(statement, (call, hook, conditional) => {
            if (returned) problems.push(`${at(call)}: ${name} calls ${hook} after the return at ${at(returned)}; it only runs on some renders`);
            else if (conditional) problems.push(`${at(call)}: ${name} calls ${hook} inside a condition or a loop`);
          });
          returned ??= returnIn(statement);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return problems;
}

test('the checker catches a hook after an early return, and a hook in a condition', () => {
  const late = hookProblems(path.join(ROOT, 'src/Probe.tsx'), `
    export default function Probe({ playing }: { playing: boolean }) {
      const a = useState(0);
      if (playing) return <Scene />;
      const b = useMemo(() => 1, []);
      return <div>{b}</div>;
    }`);
  assert.equal(late.length, 1);
  assert.match(late[0], /Probe calls useMemo after the return/);
  const sometimes = hookProblems(path.join(ROOT, 'src/probe.ts'), `
    export const useThing = (on: boolean) => { const x = on ? useRef(1) : null; if (on) { useEffect(() => {}); } return x; };`);
  assert.equal(sometimes.length, 2);
  const fine = hookProblems(path.join(ROOT, 'src/Fine.tsx'), `
    export default function Fine({ on }: { on: boolean }) {
      const ref = useRef(0);
      function run() { if (on) return; }
      const go = useCallback(() => { if (!on) return; useItem(); }, [on]);
      useEffect(() => { if (on) return; }, [on]);
      if (!on) return null;
      return <button onClick={go} />;
    }`);
  assert.deepEqual(fine, []);
});

test('every component and custom hook in src/ calls its hooks on every render', () => {
  const problems: string[] = [];
  for (const file of sources(path.join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    // Only React code has hooks; game logic has methods like `useItem` that are not hooks.
    if (!file.endsWith('.tsx') && !/from ['"]react['"]/.test(text)) continue;
    problems.push(...hookProblems(file, text));
  }
  assert.deepEqual(problems, []);
});
