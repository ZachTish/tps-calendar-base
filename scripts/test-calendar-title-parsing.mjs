import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import moment from 'moment';

const viewSource = readFileSync(new URL('../src/calendar-view.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('calendar-view.tsx', viewSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const viewClass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'CalendarView');
const method = viewClass.members.find(n => n.name?.getText(ast) === 'parseFilenameComponents').getText(ast);
const compile = text => ts.transpileModule(text, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function fixture(format) {
  const counts = { broadFilenameParses:0, momentCalls:0, formats:0 };
  const parseMoment = (...args) => { counts.momentCalls++; counts.formats += Array.isArray(args[1]) ? args[1].filter(Boolean).length : 0; return moment(...args); };
  Object.assign(parseMoment, {ISO_8601:moment.ISO_8601,invalid:moment.invalid});
  const exports = {};
  vm.runInNewContext(compile(readFileSync(new URL('../src/utils/daily-file-date.ts', import.meta.url),'utf8')), {exports,require:()=>({moment:parseMoment})});
  const View = vm.runInNewContext(compile(`class View {getDailyNoteDateFormat(){return format;} ${method}};View;`), {
    format,window:{moment:parseMoment},parseDateFromFilename(...args){counts.broadFilenameParses++;return exports.parseDateFromFilename(...args);}
  });
  return {view:new View(),counts};
}

test('reopening 3,676 ordinary event titles does not run the broad daily filename parser',()=>{
  const f=fixture('YYYY-MM-DD');
  for(let i=0;i<3676;i++){
    const title=`Synthetic Calendar ${i}`;
    assert.deepEqual(JSON.parse(JSON.stringify(f.view.parseFilenameComponents(title))),{cleanTitle:title,dateSuffix:null});
  }
  assert.equal(f.counts.broadFilenameParses,0);
  assert.equal(f.counts.momentCalls,3676,'one strict whole-date check, without a redundant broad parse');
  assert.equal(f.counts.formats,3676*5);
});

test('whole dates, trailing dates and ordinary titles preserve their display values',()=>{
  const f=fixture('YYYY-MM-DD');
  const cases=[
    ['Meeting with team',{cleanTitle:'Meeting with team',dateSuffix:null}],
    ['2026-10-18',{cleanTitle:'',dateSuffix:'2026-10-18'}],
    ['2026_10_18',{cleanTitle:'',dateSuffix:'2026-10-18'}],
    ['20261018',{cleanTitle:'',dateSuffix:'2026-10-18'}],
    ['Planning 2026-10-18',{cleanTitle:'Planning',dateSuffix:'2026-10-18'}],
    ['Planning 2026_10_18',{cleanTitle:'Planning',dateSuffix:'2026-10-18'}],
    ['Planning 20261018 2',{cleanTitle:'Planning',dateSuffix:'2026-10-18'}],
    ['Quarter 2026 planning',{cleanTitle:'Quarter 2026 planning',dateSuffix:null}],
    ['Review Sunday October 18 2026',{cleanTitle:'Review',dateSuffix:'2026-10-18'}],
  ];
  for(const [title,expected] of cases)assert.deepEqual(JSON.parse(JSON.stringify(f.view.parseFilenameComponents(title))),expected,title);
});

test('custom whole-note date formats retain authority, including formats without a year',()=>{
  for(const [format,title,expected] of [
    ['DD_MM_YYYY','18_10_2026','2026-10-18'],
    ['[Day] YYYY-MM-DD','Day 2026-10-18','2026-10-18'],
    ['dddd, MMMM D, YYYY','Sunday, October 18, 2026','2026-10-18'],
    ['MM-DD','10-18',`${moment().year()}-10-18`],
  ]){
    const f=fixture(format);
    assert.deepEqual(JSON.parse(JSON.stringify(f.view.parseFilenameComponents(title))),{cleanTitle:'',dateSuffix:expected},format);
  }
});
