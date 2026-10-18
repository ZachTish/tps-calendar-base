import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../src/CalendarReactView.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('CalendarReactView.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let effect;
function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[0].getText(ast).includes('const lastSizeRef'))effect=n.arguments[0].getText(ast);ts.forEachChild(n,visit);}visit(ast);
const code=ts.transpileModule(`(${effect})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(embed=false){let size={width:800,height:600},updates=0,reads=0,next=0,height=0;const frames=new Map(),timers=new Map(),observers=new Set();
 const el={parentElement:null,closest(){return null;},getBoundingClientRect(){reads++;return size;}};
 class ResizeObserver{constructor(fn){this.fn=fn;observers.add(this);}observe(){}disconnect(){observers.delete(this);}}
 const requestAnimationFrame=fn=>{const id=++next;frames.set(id,fn);return id;},cancelAnimationFrame=id=>frames.delete(id);
 const setTimeout=fn=>{const id=++next;timers.set(id,fn);return id;},clearTimeout=id=>timers.delete(id);
 const dispose=vm.runInNewContext(code,{containerRef:{current:el},calendarRef:{current:{getApi:()=>({updateSize(){updates++;}})}},isEmbedMode:embed,ResizeObserver,requestAnimationFrame,cancelAnimationFrame,setTimeout,clearTimeout,setContainerHeight(fn){height=fn(height);}})();
 const notify=()=>observers.forEach(o=>o.fn());const flush=()=>{const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn());};
 return {notify,flush,dispose,frames,timers,get updates(){return updates;},get reads(){return reads;},resize(w,h){size={width:w,height:h};}};
}
test('opening and unchanged resize bursts do not schedule repeated delayed FullCalendar measurements',()=>{
 for(const embed of [false,true]){const f=fixture(embed);assert.equal(f.timers.size,0);f.notify();f.flush();const settled=f.updates;assert.equal(settled,0,'mount measurement belongs to FullCalendar');for(let i=0;i<100;i++)f.notify();f.flush();assert.equal(f.updates,settled);assert.equal(f.frames.size+f.timers.size,0);f.dispose();}
});
test('real container changes coalesce into one frame and cleanup cancels pending sizing',()=>{
 for(const embed of [false,true]){const f=fixture(embed);f.notify();f.flush();const before=f.updates;for(let i=0;i<50;i++){f.resize(810+i,600);f.notify();}assert.equal(f.frames.size,1);f.flush();assert.equal(f.updates,before+1);assert.equal(f.timers.size,0);f.resize(900,650);f.notify();f.dispose();f.flush();assert.equal(f.updates,before+1);}
});

test('month display skips time-grid slot sizing; timed views retain their sizing owner',()=>{
 let slotEffect;function find(n){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[0].getText(ast).includes("style.setProperty('--calendar-slot-height'"))slotEffect=n.arguments[0].getText(ast);ts.forEachChild(n,find);}find(ast);assert.ok(slotEffect);
 const compiled=ts.transpileModule(`(${slotEffect})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const mode of ['month','week']){let sizes=0,slots=0;const run=vm.runInNewContext(compiled,{resolvedFilterViewMode:mode,computedSlotHeight:30,containerRef:{current:{style:{setProperty(){}}}},calendarRef:{current:{getApi:()=>({updateSize(){sizes++;}})}},applyCalendarSlotHeight(){slots++;}});run();assert.equal(sizes,mode==='month'?0:1);assert.equal(slots,sizes);}
});
