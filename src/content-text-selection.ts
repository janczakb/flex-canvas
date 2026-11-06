import type {PDFTextCharacter} from './pdf/text-edit.js'

/** The native PDF geometry owns the visible caret and pointer hit testing. */
export function createContentTextSelection(input:HTMLTextAreaElement,stage:HTMLElement,layer:HTMLElement){
    const doc=input.ownerDocument,events=new AbortController(),overlay=doc.createElement('div'),caret=doc.createElement('span')
    overlay.className='fm-content-text-selection';caret.className='fm-content-caret'
    layer.append(overlay,caret)
    let characters:readonly PDFTextCharacter[]=[],geometryValue='',valid=false,drag: {id:number;anchor:number}|undefined,goalX:number|undefined
    let rowCache:Array<{baseline:number;top:number;bottom:number;characters:PDFTextCharacter[]}>|undefined

    function focusOffset(){return input.selectionDirection==='backward'?input.selectionStart:input.selectionEnd}
    function insertion(offset:number){
        const next=characters.find(character=>character.start>=offset)
        if(next?.start===offset)return {x:next.x,y:next.y,height:next.height,baseline:next.baseline}
        const previous=characters.findLast(character=>character.end<=offset)
        if(previous)return {x:previous.endX,y:previous.y,height:previous.height,baseline:previous.baseline}
        if(next)return {x:next.x,y:next.y,height:next.height,baseline:next.baseline}
    }
    function rows(){
        if(rowCache)return rowCache
        const result:Array<{baseline:number;top:number;bottom:number;characters:PDFTextCharacter[]}>=[]
        for(const character of characters){
            let row=result.find(row=>Math.abs(row.baseline-character.baseline)<Math.max(.0001,character.height*.15))
            if(!row){row={baseline:character.baseline,top:character.y,bottom:character.y+character.height,characters:[]};result.push(row)}
            row.characters.push(character);row.top=Math.min(row.top,character.y);row.bottom=Math.max(row.bottom,character.y+character.height)
        }
        rowCache=result.sort((a,b)=>a.baseline-b.baseline)
        return rowCache
    }
    function offsetOnRow(row:ReturnType<typeof rows>[number],x:number){
        let nearest=0,distance=Infinity
        for(const character of row.characters)for(const [offset,edge]of[[character.start,character.x],[character.end,character.endX]]){
            const delta=Math.abs(edge-x)
            if(delta<distance){nearest=offset;distance=delta}
        }
        return nearest
    }
    function hit(x:number,y:number){
        const lines=rows()
        let nearest=lines[0],distance=Infinity
        for(const row of lines){
            const delta=y<row.top?row.top-y:y>row.bottom?y-row.bottom:0
            if(delta<distance){nearest=row;distance=delta}
        }
        return nearest?offsetOnRow(nearest,x):0
    }
    function paint(){
        overlay.replaceChildren()
        caret.hidden=true
        if(!valid||geometryValue!==input.value)return
        const start=input.selectionStart,end=input.selectionEnd
        if(start===end){
            const point=insertion(focusOffset())
            if(!point||!input.matches(':focus'))return
            caret.dataset.offset=String(focusOffset())
            caret.style.cssText='left:'+point.x*100+'%;top:'+point.y*100+'%;height:'+point.height*100+'%'
            caret.hidden=false
            return
        }
        for(const row of rows()){
            const selected=row.characters.filter(character=>character.end>start&&character.start<end)
            if(!selected.length)continue
            const left=Math.min(...selected.map(character=>character.x)),right=Math.max(...selected.map(character=>character.endX))
            const rect=doc.createElement('span')
            rect.style.cssText='left:'+left*100+'%;top:'+row.top*100+'%;width:'+Math.max(0,right-left)*100+'%;height:'+(row.bottom-row.top)*100+'%'
            overlay.append(rect)
        }
    }
    function range(anchor:number,focus:number){
        input.setSelectionRange(Math.min(anchor,focus),Math.max(anchor,focus),focus<anchor?'backward':'forward')
        paint()
    }
    function point(event:PointerEvent|MouseEvent){
        const box=stage.getBoundingClientRect()
        return {x:(event.clientX-box.left)/box.width,y:(event.clientY-box.top)/box.height}
    }
    input.addEventListener('pointerdown',event=>{
        if(event.button!==0)return
        event.preventDefault();event.stopPropagation();input.focus({preventScroll:true});goalX=undefined
        if(!valid||geometryValue!==input.value)return
        const position=point(event),offset=hit(position.x,position.y)
        const anchor=event.shiftKey?(input.selectionDirection==='backward'?input.selectionEnd:input.selectionStart):offset
        drag={id:event.pointerId,anchor};input.setPointerCapture(event.pointerId);range(anchor,offset)
    },{signal:events.signal})
    input.addEventListener('pointermove',event=>{
        if(!drag||event.pointerId!==drag.id)return
        event.preventDefault();event.stopPropagation()
        const position=point(event);range(drag.anchor,hit(position.x,position.y))
    },{signal:events.signal})
    const finish=(event:PointerEvent)=>{
        if(!drag||event.pointerId!==drag.id)return
        drag=undefined
        if(input.hasPointerCapture(event.pointerId))input.releasePointerCapture(event.pointerId)
    }
    for(const type of ['pointerup','pointercancel','lostpointercapture'] as const)input.addEventListener(type,finish,{signal:events.signal})
    input.addEventListener('click',event=>{
        event.preventDefault();event.stopPropagation()
        if(event.detail>=3){range(0,input.value.length);return}
        if(event.detail!==2)return
        const position=point(event),offset=hit(position.x,position.y)
        const word=[...new Intl.Segmenter(undefined,{granularity:'word'}).segment(input.value)].find(word=>offset>=word.index&&offset<word.index+word.segment.length)
        if(word)range(word.index,word.index+word.segment.length)
    },{signal:events.signal})
    input.addEventListener('keydown',event=>{
        if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key)){goalX=undefined;return}
        event.preventDefault();event.stopPropagation()
        if((event.ctrlKey||event.metaKey)&&(event.key==='Home'||event.key==='End')){
            const next=event.key==='Home'?0:input.value.length
            const anchor=event.shiftKey?(input.selectionDirection==='backward'?input.selectionEnd:input.selectionStart):next
            range(anchor,next);goalX=undefined;return
        }
        if(!valid||geometryValue!==input.value)return
        const offset=focusOffset(),position=insertion(offset),lines=rows()
        if(!position||!lines.length)return
        const index=lines.findIndex(row=>Math.abs(row.baseline-position.baseline)<.0001)
        const row=lines[Math.max(0,index)]
        let next:number
        if(event.key==='Home'||event.key==='End'){
            next=event.key==='Home'?Math.min(...row.characters.map(character=>character.start)):Math.max(...row.characters.map(character=>character.end))
            goalX=undefined
        }else{
            goalX??=position.x
            const target=lines[Math.max(0,Math.min(lines.length-1,index+(event.key==='ArrowUp'?-1:1)))]
            next=offsetOnRow(target,goalX)
        }
        const anchor=event.shiftKey?(input.selectionDirection==='backward'?input.selectionEnd:input.selectionStart):next
        range(anchor,next)
    },{signal:events.signal})
    for(const type of ['select','keyup','focus','blur','input'])input.addEventListener(type,paint,{signal:events.signal})
    return {
        update(value:string,geometry:readonly PDFTextCharacter[]){geometryValue=value;characters=[...geometry].sort((a,b)=>a.start-b.start);rowCache=undefined;valid=true;paint()},
        focusAt(position?:{x:number;y:number}){input.focus({preventScroll:true});const offset=position?hit(position.x,position.y):input.value.length;range(offset,offset)},
        invalidate(){valid=false;paint()},
        destroy(){events.abort();if(drag&&input.hasPointerCapture(drag.id))input.releasePointerCapture(drag.id);drag=undefined;overlay.remove();caret.remove()},
    }
}
