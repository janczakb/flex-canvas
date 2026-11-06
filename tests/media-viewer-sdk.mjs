import assert from 'node:assert/strict'
import {prepareTextMarkup,annotationBlendModes,eraseInk,annotationControlPoints,moveAnnotationVertex} from '../dist/index.js'
import {createAnnotationDocument,createAnnotationProfile,normalizeAnnotations,createMediaSession,thumbnailWindow,thumbnailGridWindow,createAnnotationToolbar,annotationStyle,noteIcons,notePopupPlacement,lineEndings,lineGeometry,cloudOutline,hitAnnotationGeometry} from '../dist/index.js'
import {defaultNoteIcons} from '../dist/index.js'
import {noteMarkerSVG} from '../dist/notes.js'
let checks=0
const check=(condition,message)=>{assert(condition,message);checks++}
const failure=(operation,code)=>{assert.throws(operation,error=>error.code===code);checks++}
const shape={id:'a',tool:'rectangle',color:'#dc2626',stroke:2,points:[[.1,.2],[.7,.8]]}
const window=thumbnailWindow(10000,1200000,800)
check(window.start>4000&&window.end-window.start<=24,'Large document thumbnail DOM is windowed')
check(window.before+(window.end-window.start)*240+window.after===10000*240,'Virtual thumbnail spacers preserve scroll geometry')
assert.throws(()=>thumbnailWindow(10001,0,800),RangeError);checks++
for(const width of [180,232,300,464,700,1200,2400]){
 for(const position of [0,1000,10000000]){
  const grid=thumbnailGridWindow(10000,position,900,width)
  check(grid.end-grid.start<=96&&grid.start%grid.columns===0,'Thumbnail grid keeps bounded complete rows')
  check(grid.before+Math.ceil((grid.end-grid.start)/grid.columns)*grid.rowHeight+grid.after===Math.ceil(10000/grid.columns)*grid.rowHeight,'Responsive grid preserves scroll geometry')
 }
}
check(thumbnailGridWindow(9,0,800,300).columns===1&&thumbnailGridWindow(9,0,800,500).columns===2,'Sidebar width determines thumbnail columns')
const toolbar=createAnnotationToolbar(['pen','highlight','rectangle','ellipse','text'])
check(toolbar.resize(1200).layout==='wide','Full toolbar above its container breakpoint')
check(toolbar.resize(1000).layout==='compact','Compact group navigation')
check(toolbar.expand().expanded,'Open mobile annotation group')
toolbar.activate('ellipse')
toolbar.activate('text')
check(toolbar.selectGroup('shapes')==='ellipse','Each group remembers its last selected tool')
check(toolbar.supports('ellipse','fill')&&toolbar.supports('text','fill')&&!toolbar.supports('text','stroke'),'Properties belong only to compatible tools')
check(toolbar.resize(390).layout==='narrow'&&toolbar.getState().expanded,'Mobile expansion survives narrow resize')
check(!toolbar.resize(1200).expanded,'Desktop restores main navigation')
check(toolbar.activate('ellipse',{toggle:true}).active==='ellipse','Activate remembered group tool')
check(toolbar.activate('ellipse',{toggle:true}).active===null,'Repeated tool activation toggles selection mode')
assert.throws(()=>toolbar.activate('pin'),TypeError);checks++
toolbar.dispose();assert.throws(()=>toolbar.getState(),/disposed/);checks++
assert.throws(()=>createAnnotationToolbar(['pen'],{compactBreakpoint:768,narrowBreakpoint:1070}),RangeError);checks++
check(defaultNoteIcons.length===10,'Ten default Hugeicons note markers')
for(const icon of defaultNoteIcons)check(noteMarkerSVG(icon).includes('stroke-width="2"'),'Hugeicons marker stroke is consistent: '+icon)
const note={id:'note-1',tool:'note',color:'#dc2626',stroke:2,points:[[.5,.5]],text:''}
for(const noteIcon of noteIcons)check(normalizeAnnotations([{...note,noteIcon}])[0].noteIcon===noteIcon,'Round-trip note icon '+noteIcon)
failure(()=>normalizeAnnotations([{...note,noteIcon:'script'}]),'annotation_geometry_invalid')
failure(()=>normalizeAnnotations([{...note,noteIcon:'star'}],{noteIcons:['comment']}),'annotation_geometry_invalid')
failure(()=>normalizeAnnotations([{...shape,noteIcon:'star'}]),'annotation_geometry_invalid')
failure(()=>normalizeAnnotations([{...note,tool:'text'}]),'annotation_geometry_invalid')
failure(()=>createAnnotationProfile({noteIcons:[]}), 'annotation_profile_invalid')
check(annotationStyle(note).noteIcon==='comment','Legacy notes retain the comment marker')
const noteToolbar=createAnnotationToolbar(['note','text'])
check(noteToolbar.supports('note','noteIcon')&&!noteToolbar.supports('text','noteIcon')&&!noteToolbar.supports('note','stroke'),'Note tools expose only their own properties')
noteToolbar.dispose()
for(const viewport of [{left:0,top:0,right:320,bottom:480},{left:-100,top:-80,right:290,bottom:600}]){
 for(const [x,y] of [[0,0],[150,200],[viewport.right,viewport.bottom]]){
  const box=notePopupPlacement(x,y,viewport)
  check(box.left>=viewport.left&&box.top>=viewport.top&&box.left+box.width<=viewport.right&&box.top+box.height<=viewport.bottom,'Note popup remains inside the visible scroller')
 }
}
check(notePopupPlacement(160,420,{left:0,top:0,right:320,bottom:480}).above,'Note popup flips above near bottom edge')
const line={id:'line-1',tool:'line',color:'#dc2626',stroke:2,points:[[.1,.2],[.8,.7]],fill:'none',dash:'dashed'}
for(const startCap of lineEndings)for(const endCap of lineEndings){
 const [saved]=normalizeAnnotations([{...line,startCap,endCap}])
 check(saved.startCap===startCap&&saved.endCap===endCap,'Every pair of line endings round trips')
}
failure(()=>normalizeAnnotations([{...line,startCap:'unknown'}]),'annotation_geometry_invalid')
failure(()=>normalizeAnnotations([{...line,startCap:'circle'}],{lineEndings:['none']}),'annotation_geometry_invalid')
failure(()=>normalizeAnnotations([{...shape,startCap:'square'}]),'annotation_geometry_invalid')
failure(()=>createAnnotationProfile({lineEndings:[]}), 'annotation_profile_invalid')
check(annotationStyle({...line,tool:'arrow'}).endCap==='open-arrow','Legacy arrow retains its open head')
check(annotationStyle(line).startCap==='none'&&annotationStyle(line).endCap==='none','Legacy line keeps plain ends')
const shortLine=lineGeometry([[.5,.5],[.501,.5]],100,100,'circle','square',12)
check(shortLine.every(point=>point.every(Number.isFinite))&&shortLine[0][0]<=shortLine[1][0],'Large endings never invert a short segment')
const zeroLine=lineGeometry([[.5,.5],[.5,.5]],100,100,'circle','square',12)
check(zeroLine.every(point=>point.every(Number.isFinite)),'Zero length line geometry stays finite')
const pinMessage={id:'pin-message',tool:'pin',color:'#dc2626',stroke:2,points:[[.2,.3]],text:'Review this point.'}
check(normalizeAnnotations([pinMessage])[0].text===pinMessage.text,'Pin messages round trip independently of note icons')
failure(()=>normalizeAnnotations([{...pinMessage,text:'x'.repeat(513)}]),'annotation_geometry_invalid')
const cloud={id:'cloud',tool:'cloudy-polygon',color:'#dc2626',stroke:2,points:[[.1,.1],[.7,.1],[.6,.7]],cloudIntensity:2,fill:'none'}
check(normalizeAnnotations([cloud])[0].cloudIntensity===2,'Cloud outline intensity round trips')
failure(()=>normalizeAnnotations([{...cloud,cloudIntensity:4}]),'annotation_geometry_invalid')
failure(()=>normalizeAnnotations([{...cloud,points:[[.1,.1],[.2,.2]]}]),'annotation_geometry_invalid')
const perimeter=cloudOutline(cloud.points,100000,100000,1,1)
check(perimeter.curves.length<=1024&&perimeter.curves.every(curve=>curve.every(Number.isFinite)),'Cloud geometry has a bounded scallop budget even for extreme render dimensions')
check(hitAnnotationGeometry({...shape,tool:'ellipse',points:[[.1,.1],[.9,.9]]},[.5,.5],1000,1000),'Ellipse body can be selected')
check(!hitAnnotationGeometry({...shape,tool:'ellipse',points:[[.1,.1],[.9,.9]]},[.1,.1],1000,1000),'Empty corners outside an ellipse do not intercept the pointer')
check(hitAnnotationGeometry(cloud,[.45,.3],1000,1000),'Polygon interior selects the real polygon')
check(!hitAnnotationGeometry(cloud,[.9,.9],1000,1000),'Outside polygon remains available for drawing')
check(hitAnnotationGeometry({...line,startCap:'circle'},[.1,.2],1000,1000),'Line ending hit area remains interactive')
check(hitAnnotationGeometry({...shape,tool:'text',points:[[.1,.1],[.9,.3]],text:'Editable'},[.2,.25],1000,1000),'Text boxes are selectable throughout their body, not only their diagonal')
check(!hitAnnotationGeometry({...shape,tool:'text',points:[[.1,.1]],text:'Legacy'},[.2,.25],1000,1000),'One-point imported text remains safe during hit testing')
const ink={id:'ink',tool:'pen',color:'#dc2626',stroke:2,points:[[.1,.5],[.9,.5]]}
const textHighlight={id:'text-highlight',tool:'text-highlight',color:'#ca8a04',stroke:2,points:[[0,0],[1,1]],rectangles:[[.1,.1,.4,.05],[.1,.2,.2,.05]]}
const [canonicalHighlight]=normalizeAnnotations([textHighlight])
check(JSON.stringify(canonicalHighlight.points)===JSON.stringify([[.1,.1],[.5,.25]]),'PDF text highlight bounds are derived from actual line rectangles')
failure(()=>normalizeAnnotations([{...textHighlight,rectangles:[[.9,.1,.4,.05]]}]),'annotation_geometry_invalid')
failure(()=>normalizeAnnotations([{...ink,tool:'eraser'}]),'annotation_geometry_invalid')
let fragmentId=0
const cut=eraseInk([ink,canonicalHighlight,shape],[[.5,.4],[.5,.6]],1000,1000,{radius:20,createId:()=>`fragment-${++fragmentId}`})
check(cut.changed&&cut.shapes.filter(s=>s.tool==='pen').length===2,'Point eraser splits an intersected ink segment into two strokes')
check(cut.shapes.includes(canonicalHighlight)&&cut.shapes.includes(shape),'Eraser preserves text highlights and geometric shapes')
check(cut.shapes[0].points.at(-1)[0]<.5&&cut.shapes[1].points[0][0]>.5,'Point eraser removes only the intersected interval')
check(normalizeAnnotations(cut.shapes).length===4,'Erased fragments pass the same bounded persistence validation')
check(eraseInk([ink],[[.5,.5]],1000,1000,{mode:'stroke'}).shapes.length===0,'Stroke eraser removes the entire touched stroke')
check(eraseInk([{...ink,pageIndex:1}],[[.5,.5]],1000,1000).changed===false,'Eraser never touches ink on a different page')
check(eraseInk([ink],[[.5,.5]],1000,1000,{maxShapes:1}).limited,'Fragment budget is enforced without losing the original stroke')
check(eraseInk([ink],[[.1,.1]],1000,1000).shapes[0]===ink,'Non-intersecting ink preserves immutable ownership')
for(const polygon of [line,cloud,{...cloud,tool:'polygon'},{...cloud,tool:'polyline'}]){
 check(annotationControlPoints(polygon).length===polygon.points.length,'Each actual vertex has its own control point')
 const moved=moveAnnotationVertex(polygon,1,[.4,.4])
 check(moved.points[0]===polygon.points[0]&&moved.points[1][0]===.4&&polygon.points[1][0]!==.4,'Moving one vertex preserves every other point and original document')
}
const callout={id:'callout',tool:'callout',color:'#dc2626',stroke:2,text:'Review this',points:[[.2,.2],[.6,.4],[.15,.3],[.1,.6]],fontSize:18,fill:'none'}
check(normalizeAnnotations([callout])[0].tool==='callout','Callout text box and leader geometry round trip together')
failure(()=>normalizeAnnotations([{...callout,points:callout.points.slice(0,3)}]),'annotation_geometry_invalid')
for(const blendMode of annotationBlendModes){
 check(normalizeAnnotations([{...ink,blendMode}])[0].blendMode===blendMode,'Each configured blend mode round trips with ink')
 failure(()=>normalizeAnnotations([{...ink,blendMode}],{blendModes:annotationBlendModes.filter(mode=>mode!==blendMode)}),'annotation_geometry_invalid')
}
for(const markup of ['highlight','strikeout','underline','squiggle','redaction'])check(normalizeAnnotations([{...textHighlight,markup,blendMode:'multiply'}])[0].markup===markup,'Text markup type stays associated with its actual text rectangles')
check(normalizeAnnotations([{...textHighlight,text:'Review this phrase',markup:'highlight'}])[0].text==='Review this phrase','Text comment stays attached to highlighted text')
failure(()=>normalizeAnnotations([{...ink,markup:'underline'}]),'annotation_geometry_invalid')
check(annotationStyle({...ink,tool:'highlight'}).blendMode==='multiply','Highlighter default blend is Multiply')
const existingMarkup={...canonicalHighlight,markup:'highlight',blendMode:'multiply',color:'#fff176'}
const repeated=prepareTextMarkup([existingMarkup],{...existingMarkup,id:'repeat'})
check(!repeated.changed&&repeated.shapes.length===1&&repeated.selectedId===existingMarkup.id,'The same text cannot accumulate duplicate highlight layers')
const partial=prepareTextMarkup([existingMarkup],{...existingMarkup,id:'partial',rectangles:[[.3,.1,.4,.05]]})
check(partial.shapes.length===1&&partial.shapes[0].rectangles[0][0]===.1&&Math.abs(partial.shapes[0].rectangles[0][2]-.6)<1e-6,'Partially overlapping compatible text highlights merge without double opacity')
const comment=prepareTextMarkup([existingMarkup],{...existingMarkup,id:'comment',text:''})
check(comment.shapes.length===1&&comment.selectedId===existingMarkup.id&&comment.shapes[0].text==='','Adding a comment reuses the existing text highlight')
const alternate=prepareTextMarkup([existingMarkup],{...existingMarkup,id:'other-color',color:'#dc2626',rectangles:[[.3,.1,.4,.05]]})
check(alternate.shapes.length===2&&Math.abs(alternate.shapes[1].rectangles[0][0]-.5)<1e-6,'A different color does not paint over already highlighted text')
const differentMarkup=prepareTextMarkup([existingMarkup],{...existingMarkup,id:'underline',markup:'underline'})
check(differentMarkup.shapes.length===2,'Underline remains independent of a highlight on the same words')
check(prepareTextMarkup([existingMarkup],{...existingMarkup,id:'other-page',pageIndex:1}).shapes.length===2,'Duplicate detection stays scoped to the document page')
const model=createAnnotationDocument({historyLimit:2})
model.dispatch({type:'add',shape});shape.points[0][0]=.9
check(model.getState().shapes[0].points[0][0]===.1,'Caller mutation must not alter an annotation')
check(Object.isFrozen(model.getState().shapes[0].points),'Geometry snapshots are immutable')
model.dispatch({type:'update',id:'a',patch:{opacity:.5,fill:'#2563eb',dash:'dashed'}})
model.dispatch({type:'update',id:'a',patch:{stroke:4}})
model.dispatch({type:'undo'});check(model.getState().shapes[0].stroke===2,'Undo')
model.dispatch({type:'redo'});check(model.getState().shapes[0].stroke===4,'Redo')
check(annotationStyle(model.getState().shapes[0]).opacity===.5,'Toolbar reads canonical selected style')
model.dispatch({type:'update',id:'a',patch:{opacity:.45}});model.dispatch({type:'undo'})
check(annotationStyle(model.getState().shapes[0]).opacity===.5,'Undo refreshes toolbar values from the selected snapshot')
model.markSaved();check(!model.getState().dirty,'Saved state')
const exported=model.export();const imported=createAnnotationDocument();imported.import(exported)
check(imported.getState().shapes.length===1,'Versioned JSON round trip')
failure(()=>imported.import('{"version":99,"shapes":[]}'),'annotation_document_version')
failure(()=>normalizeAnnotations([{...shape,points:[[NaN,0],[1,1]]}]),'annotation_geometry_invalid')
failure(()=>normalizeAnnotations([{...shape,opacity:2}]),'annotation_geometry_invalid')
failure(()=>normalizeAnnotations([{...shape,pageIndex:1}]),'annotation_geometry_invalid')
check(normalizeAnnotations([{...shape,pageIndex:3}],{maxPages:4})[0].pageIndex===3,'PDF page identity')
failure(()=>createAnnotationProfile({maxShapes:Infinity}),'annotation_profile_invalid')
failure(()=>createAnnotationDocument({profile:{readOnly:true}}).dispatch({type:'add',shape}),'annotation_read_only')
let disposed=0
const adapter=()=>({pageCount:4,getPageInfo:async index=>({pageIndex:index,width:612,height:792,rotation:0}),getText:async index=>'Page '+(index+1),renderPage:async()=>({pageIndex:0,width:612,height:792,pixelWidth:612,pixelHeight:792}),releasePage(){},destroy(){disposed++}})
const options={source:{kind:'image',url:'/unused'},adapter:adapter()}
const reader=await createMediaSession({...options,mode:'read'})
check(reader.getState().mode==='read','Reader view')
failure(()=>reader.dispatch({type:'add',shape}),'annotation_read_only')
reader.setPage(3);check(await reader.getText()==='Page 4','Reader navigation and text')
reader.setReaderView(false);reader.dispatch({type:'add',shape:{...shape,pageIndex:3}})
check(reader.getAnnotations(3).length===1&&reader.getAnnotations(0).length===0,'Independent page layers')
await reader.destroy();await reader.destroy();check(disposed===1,'Dispose once')
const readonly=await createMediaSession({...options,adapter:adapter(),profile:{readOnly:true},storage:{load:async()=>({data:exported,revision:4}),save:async()=>{throw Error('Must not write')}}})
check(readonly.getAnnotations().length===1,'Read-only persisted layers can be loaded')
readonly.setReaderView(false);failure(()=>readonly.dispatch({type:'clear'}),'annotation_read_only')
await readonly.destroy()
let release,failFirst=true;const writes=[]
const session=await createMediaSession({...options,adapter:adapter(),storage:{load:async()=>({data:'{"version":1,"shapes":[]}',revision:0}),save:async request=>{
 writes.push(request)
 if(failFirst){failFirst=false;throw Error('lost response')}
 if(writes.length===2)return {revision:1}
 return new Promise(resolve=>{release=resolve})
}}})
session.dispatch({type:'add',shape});await assert.rejects(session.save(),/lost response/);checks++
await session.save();check(writes[0].operation===writes[1].operation,'Retry preserves operation identity')
session.dispatch({type:'update',id:'a',patch:{stroke:3}})
const saving=session.save();await Promise.resolve()
session.dispatch({type:'update',id:'a',patch:{stroke:5}})
release({revision:2});await saving
check(session.getState().dirty&&session.getAnnotations()[0].stroke===5,'Late save response preserves newer edits')
await session.destroy()
const controller=new AbortController(),before=disposed
const cancellable=await createMediaSession({...options,adapter:adapter(),signal:controller.signal});controller.abort();await Promise.resolve()
check(disposed===before+1,'External abort cleans adapter once');assert.throws(()=>cancellable.getState(),{name:'AbortError'});checks++
const extra=createAnnotationDocument({profile:{maxPages:4}})
for(const tool of ['stamp','polygon','polyline','text']) {
 const item={...shape,id:tool,tool,points:tool==='polygon'?[[.1,.2],[.6,.2],[.4,.7]]:tool==='polyline'?[[.1,.2],[.4,.6]]:[[.1,.2]]}
 if(tool==='text'||tool==='stamp')Object.assign(item,{text:'Review',fontSize:24,bold:true,italic:false,align:'center'})
 extra.dispatch({type:'add',shape:item})
}
check(extra.getState().shapes.length===4,'Stamp, polygon, polyline and text')
failure(()=>normalizeAnnotations([{...shape,tool:'polygon'}]),'annotation_geometry_invalid')
failure(()=>normalizeAnnotations([{...shape,tool:'text',points:[[.1,.2]],text:'x',bold:1}]),'annotation_geometry_invalid')
failure(()=>normalizeAnnotations([{...shape,tool:'text',points:[[.1,.2]],text:'\uD800'}]),'annotation_geometry_invalid')
check(extra.getState().shapes[3].fontSize===24,'Text style retained')
const previousShape=extra.getState().shapes[0];extra.dispatch({type:'update',id:'text',patch:{text:'Updated'}})
check(extra.getState().shapes[0]===previousShape,'Unchanged annotations share immutable references')
extra.dispose()
const many=Array.from({length:500},(_,i)=>({...shape,id:'shape-'+i,pageIndex:i%4}))
const start=performance.now();const large=createAnnotationDocument({shapes:many,profile:{maxPages:4}});const initializeMs=performance.now()-start
const updateStart=performance.now();large.dispatch({type:'update',id:'shape-250',patch:{stroke:3}});const updateMs=performance.now()-updateStart
check(large.getState().shapes.length===500,'500 annotations retained')
large.dispose();model.dispose();imported.dispose()

const filledText={id:'filled-text',tool:'text',color:'#171717',stroke:2,points:[[.1,.1],[.6,.3]],text:'Review',fill:'#ffffff'}
check(normalizeAnnotations([filledText])[0].fill==='#ffffff','Text fill round trips through bounded document validation')
failure(()=>normalizeAnnotations([{...filledText,fill:'#123456'}]),'annotation_geometry_invalid')

console.log(JSON.stringify({checks,annotations:500,initializeMs,updateMs,reader:true,perPage:true,immutable:true,retry:true,lateSave:true,cleanup:true}))

// Public zoom modes use a real scale and reject invalid configuration.
{
 const {createViewerZoom}=await import('../dist/pdf/zoom.js')
 const zoom=createViewerZoom()
 assert.equal(zoom.resolve(.4,.8),.4)
 zoom.set('fit-width');assert.equal(zoom.resolve(.4,.8),.8)
 zoom.set(1.5);assert.equal(zoom.resolve(.4,.8),1.5)
 zoom.set(100);assert.equal(zoom.level,16)
 for(const value of [NaN,Infinity,0,-1,'unknown'])assert.throws(()=>zoom.set(value),RangeError)
 for(const options of [{min:0},{max:99},{min:2,max:1},{level:NaN},{mode:'custom'}])assert.throws(()=>createViewerZoom(options),RangeError)
 console.log(JSON.stringify({zoomModes:3,invalidZoomInputs:10,bounded:true}))
}

// Text annotations retain type, font and separate callout border settings across persistence.
{
 const profile=createAnnotationProfile({textFonts:['Helvetica','Times New Roman','Courier New']})
 const text={id:'live-text',tool:'text',color:'#171717',stroke:2,points:[[.1,.2],[.4,.3]],text:'Łódź — Review',fontFamily:'Times New Roman',verticalAlign:'bottom',underline:true}
 const doc=createAnnotationDocument({profile})
 doc.dispatch({type:'add',shape:text})
 assert.equal(doc.getState().shapes[0].fontFamily,'Times New Roman')
 assert.equal(doc.getState().shapes[0].verticalAlign,'bottom')
 assert.equal(doc.getState().shapes[0].underline,true)
 const callout={...text,id:'live-callout',tool:'callout',points:[[.3,.4],[.6,.5],[.28,.36],[.2,.3]],strokeColor:'#2563eb'}
 doc.dispatch({type:'add',shape:callout})
 assert.equal(doc.getState().shapes[1].strokeColor,'#2563eb')
 for(const patch of [{fontFamily:'unconfigured'},{verticalAlign:'diagonal'},{underline:'yes'},{strokeColor:'#abcdef'}])assert.throws(()=>doc.dispatch({type:'update',id:'live-callout',patch}))
 assert.throws(()=>createAnnotationProfile({textFonts:[]}))
 assert.throws(()=>createAnnotationProfile({textFonts:['evil";color:red']}))
 doc.dispose()
 console.log(JSON.stringify({liveTextStyleRoundTrip:true,invalidStyleRejected:6}))
}

const {createPDFSpreads}=await import('../dist/index.js')
const portrait=Array.from({length:7},()=>({width:600,height:800})),landscape=portrait.map(()=>({width:800,height:500}))
assert.deepEqual(createPDFSpreads(portrait,'double',true).spreads.map(row=>row.pages),[[0],[1,2],[3,4],[5,6]])
assert.deepEqual(createPDFSpreads(portrait,'double',false).spreads.map(row=>row.pages),[[0,1],[2,3],[4,5],[6]])
assert.deepEqual(createPDFSpreads(portrait,'single',true).spreads.map(row=>row.pages),[[0],[1],[2],[3],[4],[5],[6]])
for(const sizes of [portrait,landscape])for(const width of [220,300,600,900,1200]){
 const metrics=thumbnailGridWindow(sizes.length,0,900,width,sizes)
 assert(metrics.itemWidth*metrics.columns+32*(metrics.columns-1)<=width-32+1)
 for(let index=0;index<sizes.length;index++)assert(Math.abs(metrics.dimensions[index].width/metrics.dimensions[index].height-sizes[index].width/sizes[index].height)<.02)
 assert.equal(metrics.rowHeight,Math.max(...metrics.dimensions.map(item=>item.height))+47)
}
assert(thumbnailGridWindow(7,0,900,300,landscape).rowHeight<thumbnailGridWindow(7,0,900,300,portrait).rowHeight)
assert.equal(thumbnailGridWindow(7,0,900,600,landscape).columns,2)
assert.equal(thumbnailGridWindow(7,0,900,900,landscape).columns,3)
console.log(JSON.stringify({thumbnailAspectGeometry:true,landscapeRowsCompact:true,responsiveColumns:true,singleCoverSpreads:true}))
