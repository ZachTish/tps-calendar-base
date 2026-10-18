import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../src/calendar-view.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('calendar-view.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const klass=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='CalendarView');
const method=name=>klass.members.find(n=>n.name?.getText(ast)===name).getText(ast);
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exports={};vm.runInNewContext(compile(readFileSync(new URL('../src/utils/calendar-display-interval.ts',import.meta.url),'utf8')),{exports,Date});
const allDayExports={};vm.runInNewContext(compile(readFileSync(new URL('../src/utils/calendar-entry-all-day.ts',import.meta.url),'utf8')),{exports:allDayExports,Date});
function fixture(){
 const View=vm.runInNewContext(compile(`class View {${method('selectVisibleNativeEntries')}};View;`),{Date,Set,normalizePath:p=>p,normalizeCalendarDisplayInterval:exports.normalizeCalendarDisplayInterval,doesCalendarDisplayIntervalOverlapRange:exports.doesCalendarDisplayIntervalOverlapRange,isCalendarEntryDisplayedAllDay:allDayExports.isCalendarEntryDisplayedAllDay});
 const view=new View(),calls={metadata:0,start:0,interval:0,bounds:0};let range={start:new Date(2026,9,1),end:new Date(2026,10,1)},bounds;
 Object.assign(view,{currentDate:new Date(2026,9,18),defaultEventDuration:30,plugin:{settings:{archiveFolder:''}},app:{metadataCache:{getFileCache(file){calls.metadata++;return file.cache;}}},shouldRenderNoteEvent(file){return !file.hidden;},getAuxiliaryDateMarkers:fm=>fm?.markers||[],getMinimumEventDurationMinutes:()=>15,resolveEntryStartDate(entry){calls.start++;return entry.start?{date:entry.start}:null;},hasNoteLevelStartDate:()=>true,resolveEntryDisplayInterval(entry){calls.interval++;return {startDate:entry.start,endDate:entry.end,forceAllDay:entry.allDay};},computeFilterDateRange(entries){calls.bounds++;bounds=entries;},resolveExternalCalendarVisibleRange:()=>({start:new Date(range.start),end:new Date(range.end)})});
 return {view,calls,get bounds(){return bounds;},range(start,end){range={start,end};}};
}
function entry(name,start,end,extra={}){return {file:{path:name+'.md',cache:{frontmatter:{}}},start,end,...extra};}
test('only current-range candidates reach presentation while all 3,676 date intervals retain navigation bounds',()=>{
 const f=fixture();const entries=Array.from({length:3676},(_,i)=>entry('Event '+i,new Date(i<100?2026:2022,9,15,10),new Date(i<100?2026:2022,9,15,11)));
 const selected=f.view.selectVisibleNativeEntries(entries);assert.equal(selected.length,100);assert.equal(f.bounds.length,3676);assert.deepEqual(f.calls,{metadata:3676,start:3676,interval:3676,bounds:1});
 assert.equal(entries.length,3676,'the Core Bases query result is not narrowed or mutated');
 for(const e of selected)assert.ok(entries.includes(e));
});
test('navigation and fresh metadata edits select newly visible records without a retained cache',()=>{
 const f=fixture(),a=entry('October',new Date(2026,9,18),new Date(2026,9,19)),b=entry('November',new Date(2026,10,18),new Date(2026,10,19));
 assert.deepEqual([...f.view.selectVisibleNativeEntries([a,b])],[a]);
 f.range(new Date(2026,10,1),new Date(2026,11,1));assert.deepEqual([...f.view.selectVisibleNativeEntries([a,b])],[b]);
 a.start=new Date(2026,10,17);a.end=new Date(2026,10,18);assert.deepEqual([...f.view.selectVisibleNativeEntries([a,b])],[a,b]);
 assert.equal(f.calls.metadata,6);
});
test('spanning intervals, adjacent-day buffer and auxiliary dates survive early selection',()=>{
 const f=fixture(),span=entry('Old filename 2020-01-01',new Date(2026,8,20),new Date(2026,9,5)),adjacent=entry('Edge',new Date(2026,10,1),new Date(2026,10,2)),outside=entry('Outside',new Date(2026,10,2),new Date(2026,10,3)),aux=entry('Aux',new Date(2022,1,1),new Date(2022,1,2));
 aux.file.cache.frontmatter.markers=[{date:new Date(2026,9,19),isDateOnly:true}];
 assert.deepEqual([...f.view.selectVisibleNativeEntries([span,adjacent,outside,aux])],[span,adjacent,aux]);
 assert.equal(f.bounds.length,5);assert.equal(f.bounds[3].endDate.getDate(),20);
});
test('undated, hidden and invalid intervals do not acquire fabricated display dates',()=>{
 const f=fixture(),missing=entry('No start',null),invalid=entry('Invalid',new Date('bad')),hidden=entry('Hidden',new Date(2026,9,18),new Date(2026,9,19));hidden.file.hidden=true;
 assert.equal(f.view.selectVisibleNativeEntries([missing,invalid,hidden]).length,0);assert.equal(f.calls.interval,1);assert.equal(f.calls.metadata,3);
});
test('native early selection precedes every display-title resolution and leaves legacy filtering with its owner',()=>{
 const core=method('updateCalendarCore');assert.ok(core.indexOf('this.selectVisibleNativeEntries(queryData.data)')<core.indexOf('this.resolveEntryDisplayTitle('));assert.match(core,/if \(!rangeLimitedPresentation\) this\.computeFilterDateRange/);
 assert.match(core,/rangeLimitedPresentation\s*\? this\.selectVisibleNativeEntries\(queryData\.data\)\s*: queryData\.data/);
});

test('auxiliary timed dates do not inherit the main note all-day formula and archive rules remain',()=>{
 const f=fixture(),a=entry('Aux formula',new Date(2022,1,1),new Date(2022,1,2));
 a.getValue=()=>true;f.view.allDayProperty='formula.allDay';a.file.cache.frontmatter.markers=[{date:new Date(2026,9,19,12),isDateOnly:false}];
 f.view.selectVisibleNativeEntries([a]);const marker=f.bounds.find(e=>e.isAuxiliaryDate);assert.equal(allDayExports.isCalendarEntryDisplayedAllDay(marker,f.view.allDayProperty),false);
 f.view.plugin.settings.archiveFolder='_archive';a.file.path='_archive/Aux.md';f.view.selectVisibleNativeEntries([a]);assert.equal(f.bounds.length,1,'archived auxiliary markers remain excluded, as before');
});

test('Core controller scan snapshots are never treated as published Bases data',()=>{
 const View=vm.runInNewContext(compile(`class View {${method('getQueryData')}};View;`),{Array});
 const view=new View(),unpublished={file:{path:'Outside limit.md'}};
 view.controller={results:new Map([['early',unpublished]]),data:{data:[unpublished]},queryResult:{data:[unpublished]},rows:[unpublished]};
 for(let i=0;i<50;i++)assert.equal(view.getQueryData(),null,'no early formatting pass while Core scans');
 const final={data:[{file:{path:'Visible.md'}}]};view.data=final;
 assert.equal(view.getQueryData(),final,'Core sorting and limit output remains authoritative');
 view.data={data:[]};assert.equal(view.getQueryData(),view.data,'a published empty result remains valid');
 view.data={data:[{file:{path:'Edited.md'}}]};assert.equal(view.getQueryData(),view.data,'fresh query updates are read without a retained result cache');
});
test('explicit direct embeds already supply the same published data boundary',()=>{
 const embed=readFileSync(new URL('../src/embed-renderer.ts',import.meta.url),'utf8');
 assert.match(embed,/\(this\.view as any\)\.data = queryResult;/);
 assert.doesNotMatch(source,/private normalizeQueryData\(/);
});


test('external-feed identity matching keeps the full local inventory, including moved-out notes',()=>{
 const core=method('updateCalendarCore');assert.match(core,/const rangeLimitedPresentation = nativeRecordMode && allExternalEvents\.length === 0/);
 assert.match(core,/rangeLimitedPresentation\s*\? this\.selectVisibleNativeEntries\(queryData\.data\)\s*: queryData\.data/);
 assert.match(core,/if \(!rangeLimitedPresentation\) this\.computeFilterDateRange/);
});
