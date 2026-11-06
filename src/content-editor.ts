import type {PDFTextAppearance,PDFTextEdit,PDFTextCharacter} from './pdf/text-edit.js'
import type {PDFTextPreview} from './pdf/protocol.js'
import type {PDFParagraph} from './pdf/text-paragraphs.js'
import {createContentTextSelection} from './content-text-selection.js'

interface Draft {
    readonly pageIndex:number
    readonly block?:PDFParagraph
    readonly position?:readonly [number,number]
    readonly pageHeight?:number
    value:string
    appearance:PDFTextAppearance
    removed?:boolean
    box?:{x:number;y:number;width:number;height:number}
    resized?:boolean
    characters?:readonly PDFTextCharacter[]
    geometryValue?:string
}
interface PageLayer {
    readonly stage:HTMLElement
    readonly index:number
    readonly height:number
    readonly layer:HTMLElement
    readonly raster:HTMLCanvasElement
    readonly status:HTMLElement
    preview?:AbortController
    timer?:number
    readonly blocks:readonly PDFParagraph[]
}

export function createContentEditor({root,text,onChange,preview}:{
    root:HTMLElement
    text:(key:string)=>string
    onChange:()=>void
    preview:(page:number,edits:readonly PDFTextEdit[],width:number,height:number,signal:AbortSignal)=>Promise<PDFTextPreview>
}) {
    const doc=root.ownerDocument,view=doc.defaultView!
    const drafts=new Map<string,Draft>(),layers=new Map<HTMLElement,PageLayer>()
    let active:Draft|undefined,input:HTMLTextAreaElement|undefined,selection:HTMLElement|undefined,interaction:AbortController|undefined,activePage:PageLayer|undefined,insertMode=false,sequence=0
    let textSelection:ReturnType<typeof createContentTextSelection>|undefined
    const originalValue=(block:PDFParagraph)=>block.lines.map(line=>line.text).join(' ')
    const dirty=(draft:Draft)=>draft.block
        ?!!draft.removed||!!draft.resized||draft.value!==originalValue(draft.block)||Object.keys(draft.appearance).length>0
        :!!draft.value.trim()

    function typography(node:HTMLElement,draft:Draft,page:PageLayer){
        const appearance={...draft.block?.appearance,...draft.appearance}
        node.style.color=appearance.color??'#111827'
        const fontSize=appearance.size??12
        node.style.fontSize='clamp(8px,'+fontSize*100/page.height+'cqh,120px)'
        const lines=draft.block?.lines
        const lineHeight=lines&&lines.length>1?(lines[1].y-lines[0].y)*page.height/fontSize:1.2
        node.style.lineHeight=String(Math.min(2,Math.max(1,lineHeight)))
        node.style.fontWeight=appearance.bold?'700':'400'
        node.style.fontStyle=appearance.italic?'italic':'normal'
        const family=appearance.family??(/times|serif/i.test(draft.block?.font??'')?'serif':/courier|mono/i.test(draft.block?.font??'')?'mono':'sans')
        node.style.fontFamily=family==='serif'?'serif':family==='mono'?'monospace':'sans-serif'
    }
    function bounds(draft:Draft){
        if(draft.box)return draft.box
        const [x,y]=draft.position??[draft.block!.x,draft.block!.y]
        const width=draft.block?.width??.24,height=draft.block?.height??.035
        return {x,y,width,height}
    }
    function geometry(draft:Draft){
        const {x,y,width,height}=bounds(draft)
        return 'left:'+x*100+'%;top:'+y*100+'%;width:'+width*100+'%;height:'+height*100+'%'
    }
    function updateBounds(draft:Draft,page:PageLayer){
        if(active===draft&&selection)selection.style.cssText=geometry(draft)
        const target=page.layer.querySelector<HTMLElement>('[data-source="'+(draft.block?.index??'new')+'"]')
        if(target)target.style.cssText=geometry(draft)
    }
    function deactivate(){
        const previous=activePage
        textSelection?.destroy();textSelection=undefined
        interaction?.abort();interaction=undefined
        selection?.remove();selection=undefined;input=undefined;active=undefined;activePage=undefined
        if(previous?.stage.isConnected)draw(previous)
    }
    function resizeHandle(draft:Draft,page:PageLayer,side:'left'|'right'){
        const handle=doc.createElement('button')
        handle.type='button';handle.className='fm-content-resize';handle.dataset.side=side
        handle.setAttribute('aria-label',text(side==='left'?'pdf_text_resize_left':'pdf_text_resize_right'))
        const resize=(initial:ReturnType<typeof bounds>,delta:number)=>{
            const minimum=Math.min(initial.width,24/page.stage.getBoundingClientRect().width)
            if(side==='right')draft.box={...initial,width:Math.max(minimum,Math.min(1-initial.x,initial.width+delta))}
            else{
                const x=Math.max(0,Math.min(initial.x+initial.width-minimum,initial.x+delta))
                draft.box={...initial,x,width:initial.x+initial.width-x}
            }
            draft.resized=true;updateBounds(draft,page);refreshPreview(page);onChange()
        }
        handle.addEventListener('pointerdown',event=>{
            if(event.button!==0)return
            event.preventDefault();event.stopPropagation()
            const initial={...bounds(draft)},start=event.clientX,width=page.stage.getBoundingClientRect().width
            const drag=new AbortController()
            interaction?.signal.addEventListener('abort',()=>drag.abort(),{once:true,signal:drag.signal})
            handle.setPointerCapture(event.pointerId)
            handle.addEventListener('pointermove',move=>{
                if(move.pointerId===event.pointerId)resize(initial,(move.clientX-start)/width)
            },{signal:drag.signal})
            const finish=(end:PointerEvent)=>{
                if(end.pointerId!==event.pointerId)return
                if(end.type==='pointerup')resize(initial,(end.clientX-start)/width)
                if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId)
                drag.abort();input?.focus({preventScroll:true})
            }
            for(const type of ['pointerup','pointercancel','lostpointercapture'] as const)handle.addEventListener(type,finish,{signal:drag.signal})
        },{signal:interaction!.signal})
        handle.addEventListener('keydown',event=>{
            if(!['ArrowLeft','ArrowRight'].includes(event.key))return
            event.preventDefault();event.stopPropagation()
            resize({...bounds(draft)},(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?10:1)/page.stage.getBoundingClientRect().width)
        },{signal:interaction!.signal})
        return handle
    }
    function activate(draft:Draft,page:PageLayer,position?:{x:number;y:number}){
        if(draft.removed)return
        deactivate()
        active=draft;activePage=page;interaction=new AbortController();input=doc.createElement('textarea')
        selection=doc.createElement('div');selection.className='fm-content-selection';selection.style.cssText=geometry(draft)
        input.className='fm-content-input'
        input.value=draft.value;input.maxLength=8192;input.wrap='soft';input.spellcheck=false
        input.setAttribute('aria-label',text('edit_pdf_text'))
        input.oninput=()=>{draft.value=input!.value;refreshPreview(page);onChange()}
        selection.append(input,resizeHandle(draft,page,'left'),resizeHandle(draft,page,'right'))
        page.layer.append(selection);typography(input,draft,page);onChange()
        textSelection=createContentTextSelection(input,page.stage,page.layer)
        const box=bounds(draft)
        const empty:PDFTextCharacter={start:0,end:0,x:box.x,endX:box.x,y:box.y,width:0,height:box.height,baseline:box.y+box.height}
        textSelection.update(draft.geometryValue??(draft.block?originalValue(draft.block):draft.value),draft.characters??draft.block?.characters??[empty])
        textSelection.focusAt(position)
    }
    function buttonFor(draft:Draft,page:PageLayer,id:string){
        const target=doc.createElement('button')
        target.type='button';target.className='fm-content-block'
        target.dataset.source=String(draft.block?.index??'new')
        target.setAttribute('aria-label',text('edit_pdf_text')+' '+(draft.value||text('pdf_text_add')))
        target.style.cssText=geometry(draft)
        if(draft.removed){target.disabled=true;target.dataset.removed='true'}

        target.onclick=event=>{
            drafts.set(id,draft)
            const box=page.stage.getBoundingClientRect()
            activate(draft,page,event.detail?{x:(event.clientX-box.left)/box.width,y:(event.clientY-box.top)/box.height}:undefined)
        }
        return target
    }
    function draw(page:PageLayer){
        const {index,layer,blocks}=page
        const children=blocks.map(block=>{
            const id=index+':'+block.index
            return buttonFor(drafts.get(id)??{pageIndex:index,pageHeight:page.height,block,value:originalValue(block),appearance:{}},page,id)
        })
        for(const [id,draft]of drafts)if(!draft.block&&draft.pageIndex===index)children.push(buttonFor(draft,page,id))
        layer.replaceChildren(...children,page.status)
    }
    function setInsertMode(enabled:boolean){
        insertMode=enabled
        for(const {layer}of layers.values())layer.toggleAttribute('data-insert',enabled)
        onChange()
    }
    function prune(){
        for(const [stage,page]of layers)if(!stage.isConnected){
            release(page);layers.delete(stage)
            if(activePage===page)deactivate()
        }
    }
    function detach(){
        textSelection?.destroy();textSelection=undefined
        interaction?.abort();interaction=undefined;selection=undefined
        for(const page of layers.values())release(page)
        layers.clear();input=undefined;active=undefined;activePage=undefined;onChange()
    }
    function release(page:PageLayer){
        view.clearTimeout(page.timer);page.preview?.abort();page.layer.remove();page.raster.parentElement?.remove()
    }
    function refreshPreview(page:PageLayer){
        view.clearTimeout(page.timer);page.preview?.abort()
        const edits=[...drafts.values()].filter(draft=>draft.pageIndex===page.index&&dirty(draft)).flatMap(commands)
        if(activePage===page&&active){
            if(dirty(active))textSelection?.invalidate()
            else if(active.block)textSelection?.update(originalValue(active.block),active.block.characters??[])
        }
        if(!edits.length){page.raster.hidden=true;page.status.hidden=true;return}
        const controller=new AbortController();page.preview=controller
        page.timer=view.setTimeout(async()=>{
            const viewport=page.stage.getBoundingClientRect(),scale=Math.min(view.devicePixelRatio||1,2048/viewport.width,2048/viewport.height,Math.sqrt(3145728/(viewport.width*viewport.height)))
            try{
                const pixels=await preview(page.index,edits,Math.max(1,Math.floor(viewport.width*scale)),Math.max(1,Math.floor(viewport.height*scale)),controller.signal)
                if(controller.signal.aborted||!page.stage.isConnected)return
                const {raster}=page
                raster.width=pixels.width;raster.height=pixels.height
                raster.style.cssText='left:'+pixels.x*100+'%;top:'+pixels.y*100+'%;width:'+pixels.fractionWidth*100+'%;height:'+pixels.fractionHeight*100+'%'
                raster.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(pixels.rgba),pixels.width,pixels.height),0,0)
                for(const layout of pixels.layouts){
                    const draft=[...drafts.values()].find(draft=>draft.pageIndex===page.index&&draft.block?.index===layout.fontSource
                        &&Math.abs(bounds(draft).x-layout.position[0])<.00001&&Math.abs(bounds(draft).y-layout.position[1])<.00001)
                    if(!draft)continue
                    draft.characters=layout.characters;draft.geometryValue=draft.value
                    draft.box={...bounds(draft),height:Math.min(1-layout.position[1],Math.max(draft.block?.height??.035,layout.height))}
                    updateBounds(draft,page)
                    if(draft===active)textSelection?.update(draft.value,layout.characters)
                }
                raster.hidden=false;page.status.hidden=true
            }catch(error){
                if(!controller.signal.aborted){page.status.hidden=false;page.status.textContent=text(error instanceof Error&&'code' in error&&error.code==='pdf_text_edit_font'?'pdf_text_preview_font':'pdf_text_preview_failed')}
            }
        },45)
    }
    function commands(draft:Draft):PDFTextEdit[]{
        const {pageIndex,block,value,appearance}=draft
        const commands:PDFTextEdit[]=block?block.lines.flatMap(line=>line.parts.map(part=>({pageIndex,index:part.index,original:part.text,remove:true as const}))):[]
        if(draft.removed||!value.trim())return commands
        const box=bounds(draft),pageHeight=draft.pageHeight??activePage?.height??792
        const originalSize=block?.appearance.size??12,size=appearance.size??originalSize
        const originalLineHeight=block&&block.lines.length>1?block.lines[1].y-block.lines[0].y:Math.max((block?.height??0)*1.35,originalSize*1.2/pageHeight)
        const lineHeight=originalLineHeight*size/originalSize
        commands.push({pageIndex,position:[box.x,box.y],fontSource:block?.index,text:value,appearance,flow:{width:box.width,lineHeight}})
        return commands
    }
    return {
        show(stage:HTMLElement,index:number,height:number,blocks:readonly PDFParagraph[]){
            prune()
            const old=layers.get(stage)
            if(old?.index===index)return
            if(old===activePage)deactivate()
            if(old)release(old)
            const layer=doc.createElement('div'),rasterLayer=doc.createElement('div'),raster=doc.createElement('canvas'),status=doc.createElement('p')
            rasterLayer.className='fm-content-raster';raster.hidden=true;rasterLayer.setAttribute('aria-hidden','true');rasterLayer.append(raster)
            status.className='fm-content-preview-status';status.role='status';status.hidden=true
            layer.className='fm-content-blocks';layer.toggleAttribute('data-insert',insertMode)
            const page={stage,index,height,blocks,layer,raster,status};layers.set(stage,page)
            layer.addEventListener('click',event=>{
                if(!insertMode)return
                const rect=stage.getBoundingClientRect()
                const x=(event.clientX-rect.left)/rect.width,y=(event.clientY-rect.top)/rect.height
                if(x<0||y<0||x>=1||y>=1)return
                const draft:Draft={pageIndex:index,position:[x,y],pageHeight:height,value:'',appearance:{family:'sans',size:12,color:'#000000'}}
                drafts.set('new:'+sequence++,draft);setInsertMode(false);activate(draft,page)
            },{capture:true})
            draw(page);stage.insertBefore(rasterLayer,stage.querySelector(':scope > .fm-page-overlay'));stage.append(layer);refreshPreview(page);onChange()
        },
        has:(stage:HTMLElement,index:number)=>layers.get(stage)?.index===index,
        detach,
        reset(){detach();drafts.clear();insertMode=false;sequence=0;onChange()},
        active:()=>active,
        insertMode:()=>insertMode,
        setInsertMode,
        update(appearance:PDFTextAppearance){
            if(!active)return
            active.appearance=Object.fromEntries(Object.entries({...active.appearance,...appearance}).filter(([,value])=>value!==undefined))
            if(input&&activePage){typography(input,active,activePage);refreshPreview(activePage)}
            onChange()
        },
        remove(){
            if(!active)return
            if(active.block)active.removed=true
            else for(const [id,draft]of drafts)if(draft===active){drafts.delete(id);break}
            const page=activePage
            deactivate();if(page)refreshPreview(page);onChange()
        },
        isDirty:()=>[...drafts.values()].some(dirty),
        canSave:()=>[...drafts.values()].filter(dirty).every(draft=>draft.removed||!!draft.value.trim()),
        edits:()=>[...drafts.values()].filter(dirty).flatMap(commands),
    }
}
