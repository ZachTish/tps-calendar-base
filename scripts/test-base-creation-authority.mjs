import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/calendar-view.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('calendar-view.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const owner = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'CalendarView');
const names = ['handleCreateRange', 'createCalendarNote', 'createFileForView', 'handleExternalDrop', 'getFilterCreationDefaults', 'extractFrontmatterDefaults', 'collectFirstMatchPositiveFilterConditions', 'getFilterBranchNodes', 'parseInlineFilterCondition', 'isPositiveEqualityOp'];
const methods = owner.members.filter(n => names.includes(n.name?.getText(ast))).map(n => n.getText(ast)).join('\n');
const code = ts.transpileModule(`class Harness extends Base { ${methods} }; ({Harness, TFile});`, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const {Harness, TFile} = vm.runInNewContext(code, {
  TFile: class { constructor(path){this.path=path;this.basename=path.split("/").pop().replace(/\.md$/, "");} },
  getGcmNativeRecordsApi:()=>({}),
  isGcmNativeCalendarRecord:r=>r?.kind === "calendar-event",
  Base: class { async createFileForView(name,process){this.coreCreates.push(name);process(this.coreFrontmatter);} },
  normalizePath:p=>p, formatDateTimeForFrontmatter:d=>d.toISOString(),
  getGcmApi:()=>({ui:{version:2,handlesNativeBaseCreation:()=>true}}),
  logger: { error(){}, flow(){}, log(){}, warn(){} }, Notice: class {},
  isCalendarFormulaProperty: p => String(p).startsWith('formula.'),
  normalizeFilterValue: value => value == null ? null : String(value).trim() || null,
  stripOuterQuotes: value => value.replace(/^(["'])(.*)\1$/, "$2"),
  buildNativeCalendarAssociatedNote: p => `[[${p.replace(/\.md$/, '')}]]`,
});
function fixture(native = true, defaults = {}) {
  const calls = {create:[], native:0, refresh:0, opens:[], sources:0};
  const view = new Harness();
  Object.assign(view, {
    startDateProp:'note.planned',
    isNativeCalendarRecordMode:()=>native,
    resolveDefaultCreateRange:(start,end)=>({start,end}),
    promptForCalendarCreateSelection:async()=>({action:'create-event'}),
    promptForCalendarEventTitle:async()=>({title:'Created from Base',templatePath:'Templates/Calendar.md'}),
    createNativeCalendarRecord:async()=>{calls.native++;return {file:{path:'wrong.md'}};},
    readBaseFileFilterSources:async()=>{calls.sources++;return ['active-view','base'];},
    buildCalendarNewEventOptions:(sources,overrides)=>{
      assert.deepEqual(sources,['active-view','base']);
      return {createMode:'note',useBaseDefaults:true,frontmatterDefaults:defaults,typeFolderOverride:'Inbox/Calendar QA',...overrides};
    },
    newEventService:{createEvent:async(...args)=>{calls.create.push(args);return {path:'Inbox/Calendar QA/Created.md'};}},
    updateCalendar:async()=>{calls.refresh++;},
    handlePostCreateBehavior:async file=>{calls.opens.push(file.path);},
  });
  return {view,calls,start:new Date('2026-11-01T12:00:00Z'),end:new Date('2026-11-01T13:00:00Z')};
}
for (const native of [true,false]) {
  for(const defaults of [{}, {kind:['task/custom'],status:'requested',custom:'preserved'}]) {
    test(`range creation follows Base defaults with native mode ${native}, ${Object.keys(defaults).length} defaults`,async()=>{
      const f=fixture(native,defaults);
      await f.view.handleCreateRange(f.start,f.end,false);
      assert.equal(f.calls.native,0,'Controller storage mode must not select a classification writer');
      assert.equal(f.calls.sources,1);
      assert.equal(f.calls.create.length,1);
      const [start,end,overrides,options]=f.calls.create[0];
      assert.equal(start,f.start);assert.equal(end,f.end);
      assert.equal(overrides,undefined);
      assert.deepEqual(options.frontmatterDefaults,defaults);
      assert.equal(options.templateOverride,'Templates/Calendar.md');
      assert.equal(options.templateTypeOverride,'file');
      assert.equal(options.titleOverride,'Created from Base');
      assert.equal(f.calls.refresh,1);assert.deepEqual(f.calls.opens,['Inbox/Calendar QA/Created.md']);
    });
  }
}
test('canceling title performs no filter read, creation, refresh or open',async()=>{
 const f=fixture(); f.view.promptForCalendarEventTitle=async()=>null;
 await f.view.handleCreateRange(f.start,f.end,false);
 assert.deepEqual(f.calls,{create:[],native:0,refresh:0,opens:[],sources:0});
});
test('computed start refuses creation before a filter read or writer',async()=>{
 const f=fixture(); f.view.startDateProp='formula.start';
 await f.view.handleCreateRange(f.start,f.end,false);
 assert.equal(f.calls.native,0);assert.equal(f.calls.create.length,0);assert.equal(f.calls.sources,0);
});
test('canceled note creation does not refresh or open',async()=>{
 const f=fixture();f.view.newEventService.createEvent=async()=>null;
 await f.view.handleCreateRange(f.start,f.end,true);
 assert.equal(f.calls.native,0);assert.equal(f.calls.refresh,0);assert.equal(f.calls.opens.length,0);
});

test('serialized active view wins over Base and runtime defaults; ordered OR and exclusions remain', () => {
 const view=new Harness();
 view.currentBaseFileFilterSources=[];
 view.getCalendarFilterSources=()=>[{and:['kind == "runtime"','status == "runtime"','location == "runtime-location"']}];
 view.extractFolderFromTopLevelFilters=()=>null;
 const active={or:[{and:['kind == "chosen"','status == "active"']},{and:['kind == "other"']}]};
 const base={and:['kind == "base"','priority == "low"','kind != "excluded"']};
 const result=view.getFilterCreationDefaults([active,base]);
 assert.deepEqual(JSON.parse(JSON.stringify(result.frontmatter)),{kind:'chosen',status:'active',priority:'low',location:'runtime-location'});
});
test('non-assignment filters never invent a classification',()=>{
 const view=new Harness();view.currentBaseFileFilterSources=[];view.getCalendarFilterSources=()=>[];view.extractFolderFromTopLevelFilters=()=>null;
 const result=view.getFilterCreationDefaults([{and:['scheduled > today()','kind != "excluded"','!kind.contains("hidden")']}]);
 assert.deepEqual(Object.keys(result.frontmatter),[]);
});
test('100 canceled selections perform no Base reads, writer calls, refreshes or opens',async()=>{
 const f=fixture();f.view.promptForCalendarCreateSelection=async()=>null;
 for(let i=0;i<100;i++)await f.view.handleCreateRange(f.start,f.end,false);
 assert.deepEqual(f.calls,{create:[],native:0,refresh:0,opens:[],sources:0});
});

test('toolbar passes a filename to Core Bases without duplicating its inferred folder',async()=>{
 const f=fixture(true,{qaBucket:'view'});
 Object.assign(f.view,{coreCreates:[],coreFrontmatter:{},app:{},
  resolveCurrentTimeCreateRange:()=>({start:f.start,end:f.end}),
  getNoteField:p=>p?.replace(/^note\./,''),endDateProp:'note.minutes',useEndDuration:true,
  plugin:{settings:{}},ensureCalendarCreationFolder:async()=>{},findOwningCalendarLeaf:()=>null,
 });
 await f.view.createFileForView(undefined,fm=>{fm.explicit='kept';});
 assert.deepEqual(f.view.coreCreates,[undefined]);
 assert.equal(f.view.coreFrontmatter.qaBucket,'view');
 assert.equal(f.view.coreFrontmatter.minutes,60);
 assert.equal(f.view.coreFrontmatter.explicit,'kept');
 assert.equal(Object.hasOwn(f.view.coreFrontmatter,'kind'),false);
});

for (const template of [false,true]) {
 test(`file drop creation follows Base defaults (${template ? 'template' : 'ordinary note'})`,async()=>{
  const f=fixture();const file=new TFile('Inbox/Source.md');
  Object.assign(f.view,{
   app:{vault:{getAbstractFileByPath:()=>file}},isTemplateFile:()=>template,
   resolveNativeCalendarWriteEnd:()=>f.end,resolveNativeCalendarRecord:async()=>null,
   inspectNativeCalendarRecord:()=>null,nativeCalendarFileHasIdentityEvidence:()=>false,
   resolveDroppedFileEventTitle:()=>file.basename,
   buildCalendarDropCreateRequest:(_kind,_file,start,allDay,sources)=>({start,end:f.end,options:f.view.buildCalendarNewEventOptions(sources,{allDay,templateOverride:file.path,templateTypeOverride:'file'})}),
  });
  await f.view.handleExternalDrop({type:'file',filePath:file.path},f.start,false);
  assert.equal(f.calls.native,0);assert.equal(f.calls.create.length,1);assert.equal(f.calls.sources,1);
  const [,,overrides,options]=f.calls.create[0];
  assert.deepEqual(Object.keys(options.frontmatterDefaults),[]);
  if(template)assert.equal(options.templateOverride,file.path);
  else assert.equal(overrides.associatedNote,'[[Inbox/Source]]');
  assert.equal(f.calls.opens.length,1);
 });
}
test('dropping an existing imported event reschedules it without creating a replacement',async()=>{
 const f=fixture();const file=new TFile('Inbox/Imported.md');let updates=0;
 Object.assign(f.view,{app:{vault:{getAbstractFileByPath:()=>file}},isTemplateFile:()=>false,
  resolveNativeCalendarWriteEnd:()=>f.end,resolveNativeCalendarRecord:async()=>({kind:'calendar-event'}),
  updateNativeCalendarRecordSchedule:async args=>{updates++;assert.equal(args.file,file);},
 });
 await f.view.handleExternalDrop({type:'file',filePath:file.path},f.start,false);
 assert.equal(updates,1);assert.equal(f.calls.create.length,0);assert.equal(f.calls.sources,0);
});
