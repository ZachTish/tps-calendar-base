import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/CalendarReactView.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('CalendarReactView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['_canvasEmbedContainers', '_origBCR', '_bcrPatched', '_scaleCache', '_SCALE_TTL',
  '_getContainerScale', '_isFCMeasurementEl', '_SCALED_SYM', '_DRAG_EVENT_TYPES', '_pointerPatchInstalled',
  '_interceptAndScaleEvent', '_installCanvasBCRPatch', '_uninstallCanvasBCRPatch']);
const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node)
  ? names.has(node.name?.text)
  : ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.has(d.name.getText(ast))));
let effect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
    && node.arguments[0].getText(ast).includes('_canvasEmbedContainers.add')) effect = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(effect, 'Exercise the actual registration effect and geometry patch');
const compiled = ts.transpileModule(`${declarations.map(n => n.getText(ast)).join('\n')}
globalThis.runEffect = ${effect.arguments[0].getText(ast)};
globalThis.dependencies = () => ${effect.arguments[1].getText(ast)};`,
{ compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture() {
  let nativeReads = 0, inspections = 0;
  class Element {
    constructor(tag = 'DIV', classes = []) { this.tagName = tag; this.classList = { contains: c => classes.includes(c) }; }
    getBoundingClientRect() { nativeReads++; return { x: 20, y: 40, width: 200, height: 100 }; }
  }
  const original = Element.prototype.getBoundingClientRect;
  const listeners = new Map();
  const context = vm.createContext({ Element, DOMRect: class { constructor(x,y,width,height) { Object.assign(this,{x,y,width,height}); } },
    performance: { now: () => 1000 }, window: {
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    }, isEmbedMode: true, isCanvasEmbed: false, containerRef: { current: null },
  });
  vm.runInContext(compiled, context);
  function container() {
    const members = new Set(), fc = new Element(); fc.offsetWidth = 100;
    return { members, contains(el) { inspections++; return members.has(el); }, querySelector() { return fc; } };
  }
  function mount(root, canvas = false, embed = true) {
    context.containerRef.current = root; context.isCanvasEmbed = canvas; context.isEmbedMode = embed;
    return context.runEffect();
  }
  return { Element, original, listeners, context, container, mount,
    get reads() { return nativeReads; }, get inspections() { return inspections; } };
}

test('ordinary embedded Calendars leave global geometry and input untouched across repeated mounts', () => {
  const f = fixture(), root = f.container(), cell = new f.Element('TR'); root.members.add(cell);
  for (let i = 0; i < 50; i++) {
    const cleanup = f.mount(root);
    assert.equal(f.Element.prototype.getBoundingClientRect, f.original);
    for (let j = 0; j < 20; j++) cell.getBoundingClientRect();
    assert.equal(f.listeners.size, 0);
    cleanup?.();
  }
  assert.equal(f.reads, 1000); assert.equal(f.inspections, 0);
});

test('Canvas detection activates the existing patch and leaving Canvas releases it', () => {
  const f = fixture(), root = f.container(), cell = new f.Element('TR'); root.members.add(cell);
  const first = f.mount(root, false); const before = [...f.context.dependencies()];
  f.context.isCanvasEmbed = true; const after = [...f.context.dependencies()];
  assert.notDeepEqual(after, before, 'React must rerun registration when Canvas ancestry is detected');
  first?.(); const cleanup = f.mount(root, true);
  assert.notEqual(f.Element.prototype.getBoundingClientRect, f.original);
  assert.equal(f.listeners.size, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(cell.getBoundingClientRect())), { x: 10, y: 20, width: 100, height: 50 });
  cleanup(); f.mount(root, false)?.();
  assert.equal(f.Element.prototype.getBoundingClientRect, f.original); assert.equal(f.listeners.size, 0);
});

test('multiple Canvas owners retain scaling while ordinary embeds remain outside their scope', () => {
  const f = fixture(), a = f.container(), b = f.container(), ordinary = f.container();
  const aCell = new f.Element('TR'), bCell = new f.Element('TR'), ordinaryCell = new f.Element('TR');
  a.members.add(aCell); b.members.add(bCell); ordinary.members.add(ordinaryCell);
  const closeA = f.mount(a, true), closeB = f.mount(b, true), closeOrdinary = f.mount(ordinary);
  assert.equal(aCell.getBoundingClientRect().width, 100); assert.equal(bCell.getBoundingClientRect().width, 100);
  assert.equal(ordinaryCell.getBoundingClientRect().width, 200);
  closeOrdinary?.(); closeA();
  assert.notEqual(f.Element.prototype.getBoundingClientRect, f.original); assert.equal(f.listeners.size, 3);
  assert.equal(bCell.getBoundingClientRect().width, 100);
  closeB(); assert.equal(f.Element.prototype.getBoundingClientRect, f.original); assert.equal(f.listeners.size, 0);
});

test('missing or nonembedded hosts cannot install a Canvas override', () => {
  const f = fixture(); f.mount(null, true)?.(); f.mount(f.container(), true, false)?.();
  assert.equal(f.Element.prototype.getBoundingClientRect, f.original); assert.equal(f.listeners.size, 0);
});
