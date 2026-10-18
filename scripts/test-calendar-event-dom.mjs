import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const stub={name:'host-stubs',setup(b){b.onResolve({filter:/^(react|obsidian)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path==='react'?'export const useCallback=f=>f; export const useMemo=f=>f();':`export function parsePropertyId(p){return {name:String(p).replace(/^note\\./,'')}};export function setIcon(node,name){node.icon=name;node.appendChild(node.ownerDocument.createElement('svg'));}` }));}};
const bundled=await build({entryPoints:[fileURLToPath(new URL('../src/components/EventRenderer.tsx',import.meta.url))],bundle:true,format:'esm',platform:'node',write:false,plugins:[stub]});
const {useEventRenderer}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
class Node {constructor(tag,doc){this.tag=tag;this.ownerDocument=doc;this.childNodes=[];this.dataset={};this.style={};this.attrs={};this.textContent='';}appendChild(n){this.childNodes.push(n);return n;}setAttribute(k,v){this.attrs[k]=v;}querySelector(tag){return this.childNodes.flatMap(n=>[n,...n.descendants()]).find(n=>n.tag===tag)||null;}descendants(){return this.childNodes.flatMap(n=>[n,...n.descendants()]);}}
const document={createElement:tag=>new Node(tag,document),createElementNS:(_,tag)=>new Node(tag,document)};globalThis.document=document;
const make=(allDay=false,props={})=>({event:{title:'<script>food</script>',allDay,extendedProps:{entryPath:'Inbox/Event.md',...props}}});
const find=(root,cls)=>[root,...root.descendants()].find(n=>n.className?.split(' ').includes(cls));
test('event content is owned DOM, preserves literal title/path/icons and never interpolates authored HTML',()=>{
 const {renderEventContent}=useEventRenderer({app:{},sanitizedProperties:[],basesEntryMap:new Map()});const out=renderEventContent(make(false,{iconName:'lucide:square',iconColor:'red'}));
 assert.deepEqual(Object.keys(out),['domNodes']);const root=out.domNodes[0];assert.equal(root.dataset.path,'Inbox/Event.md');assert.equal(find(root,'bases-calendar-event-title').textContent,'<script>food</script>');assert.equal(find(root,'bases-calendar-event-frontmatter-icon').icon,'square');assert.equal(find(root,'bases-calendar-event-frontmatter-icon').style.color,'red');assert.equal(root.descendants().some(n=>n.tag==='script'),false);
});
test('all-day cards do not evaluate or render discarded property values over 100 event renders',()=>{
 let reads=0;const entry={getValue(){reads++;throw Error('hidden property');}};const {renderEventContent}=useEventRenderer({app:{},sanitizedProperties:['note.protein'],basesEntryMap:new Map([['Inbox/Event.md',entry]])});for(let i=0;i<100;i++){const root=renderEventContent(make(true)).domNodes[0];assert.equal(find(root,'bases-calendar-event-properties'),undefined);}assert.equal(reads,0);
});
test('visible timed properties retain native value widgets, skip empty values and isolate one bad property',()=>{
 let widgets=0;const context={};const values={'note.title':'ignored','note.tags':{isTruthy:()=>true,renderTo(node,ctx){assert.equal(ctx,context);node.textContent='tags';widgets++;}},'note.empty':'','note.number':0};const entry={getValue:p=>{if(p==='note.bad')throw Error('bad value');return values[p];}};
 const {renderEventContent}=useEventRenderer({app:{renderContext:context},sanitizedProperties:Object.keys(values).concat('note.bad'),basesEntryMap:new Map([['Inbox/Event.md',entry]])});const root=renderEventContent(make()).domNodes[0],chips=find(root,'bases-calendar-event-properties');assert.equal(widgets,1);assert.deepEqual(chips.childNodes.map(n=>n.textContent),['tags','0']);
});
test('external properties, drag preview and archived counts retain their rendered payloads',()=>{
 const {renderEventContent}=useEventRenderer({app:{},sanitizedProperties:['note.location'],basesEntryMap:new Map()});let root=renderEventContent(make(false,{isExternal:true,externalEvent:{location:'Office'},isExternalDropPreview:true,dropPreviewTimeLabel:'9:00 – 9:30'})).domNodes[0];assert.equal(find(root,'bases-calendar-event-frontmatter-icon').icon,'calendar-days');assert.equal(find(root,'bases-calendar-external-drop-preview-time').textContent,'9:00 – 9:30');assert.equal(find(root,'bases-calendar-event-property-value').textContent,'Office');root=renderEventContent(make(false,{isArchivedExternalPlaceholder:true,archivedExternalCount:3,archivedExternalTooltip:'Three archived events'})).domNodes[0];assert.equal(root.attrs['aria-label'],'Three archived events');assert.equal(find(root,'bases-calendar-archived-external-count').textContent,'3');
});
test('FullCalendar 6 owns domNodes without sending them into its React custom rendering bridge',()=>{
 const core=readFileSync(new URL('../node_modules/@fullcalendar/core/internal-common.js',import.meta.url),'utf8');const start=core.indexOf('class ContentInjector');assert.ok(start>=0);const end=core.indexOf('ContentInjector.addPropsEquality',start);const body=core.slice(start,end);assert.match(body,/'domNodes' in customGeneratorRes[\s\S]{0,150}queuedDomNodes = Array\.prototype\.slice\.call\(customGeneratorRes\.domNodes\)/);assert.match(body,/this\.applyQueueudDomNodes\(\)/);
});
