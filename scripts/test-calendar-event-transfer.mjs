import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
const result = await build({entryPoints:['src/utils/calendar-event-transfer.ts'],bundle:true,format:'esm',write:false});
const {rememberCalendarTransfer,receiveCalendarTransfer}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
test('moving between embeds restores both calendars before the normal confirmation/write',()=>{
 const calls=[]; const draggedEl={}; const entry={file:{path:'Inbox/QA.md'}};
 const before=new Date('2026-09-11T10:00:00Z'); const after=new Date('2026-09-12T10:00:00Z');
 rememberCalendarTransfer({draggedEl,event:{start:before,end:new Date(+before+3600000)},revert:()=>calls.push('source restored')});
 receiveCalendarTransfer({draggedEl,event:{start:after,end:new Date(+after+3600000),allDay:false,extendedProps:{calendarEntry:{entry}}},revert:()=>calls.push('destination restored')},info=>{
   assert.deepEqual(calls,['destination restored','source restored']);
   assert.equal(info.event.extendedProps.calendarEntry.entry,entry); assert.equal(+info.event.start,+after); assert.equal(+info.oldEvent.start,+before);
   info.revert(); calls.push('confirmation');
 });
 assert.equal(calls.length,3);
});
test('unowned transfers do not request a write',()=>{
 let restored=0; receiveCalendarTransfer({draggedEl:{},event:{start:new Date(),extendedProps:{}},revert:()=>restored++},()=>assert.fail('unexpected write'));assert.equal(restored,1);
});
test('both regular and continuous calendars wire receive and source rollback',()=>{
 for(const path of ['src/CalendarReactView.tsx','src/components/ContinuousScrollView.tsx']){
 const source=readFileSync(path,'utf8');assert.match(source,/droppable=\{allowEdit\}/);assert.match(source,/eventLeave=\{rememberCalendarTransfer\}/);assert.match(source,/receiveCalendarTransfer\(info, handleDrop\)/);
 }
});
