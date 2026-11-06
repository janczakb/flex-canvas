import type {Annotation,Point} from './types.js'
import {annotationTextFont,wrapAnnotationText} from './text-layout.js'

interface Surface {stage:HTMLElement;width:number;height:number;scale:number}
interface Options {
    root:HTMLElement;signal:AbortSignal;maxBytes:number;text:(key:string)=>string
    surface:(shape:Annotation)=>Surface|undefined
    commit:(shape:Annotation,original:Annotation|undefined)=>void
    change:()=>void;error:()=>void
}

/** A local editing transaction: native caret and IME, one history entry on commit. */
export function createAnnotationTextEditor(options:Options) {
    const document=options.root.ownerDocument,measure=document.createElement('canvas').getContext('2d')!
    let draft:Annotation|undefined,original:Annotation|undefined,input:HTMLTextAreaElement|undefined
    let autoWidth=false,minHeight=0,disposed=false
    const active=()=>draft
    function refresh(grow=false):void {
        if(!draft||!input)return
        const surface=options.surface(draft);if(!surface)return
        const {stage,width,height,scale}=surface
        if(input.parentElement!==stage)stage.append(input)
        const fontSize=(draft.fontSize??18)*scale,padding=6*scale,lineHeight=fontSize*1.3
        const [a,b]=draft.points
        let boxWidth=(b[0]-a[0])*width,boxHeight=(b[1]-a[1])*height
        input.setAttribute('aria-label',options.text(draft.tool))
        measure.font=annotationTextFont(draft,scale)
        if(grow){
            if(autoWidth)boxWidth=Math.min(width-a[0]*width,Math.max(28*scale,...(draft.text??'').split('\n').map(line=>measure.measureText(line).width+padding*2+2)))
            const lines=wrapAnnotationText(measure,draft.text??'',Math.max(1,boxWidth-padding*2))
            boxHeight=Math.min(height-a[1]*height,Math.max(minHeight*scale,lines.length*lineHeight+padding*2))
            const end:Point=[a[0]+boxWidth/width,a[1]+boxHeight/height]
            draft={...draft,points:[a,end,...draft.points.slice(2)]}
        }
        const lines=wrapAnnotationText(measure,draft.text??'',Math.max(1,boxWidth-padding*2))
        const spare=Math.max(0,boxHeight-padding*2-lines.length*lineHeight)
        const offset=draft.verticalAlign==='bottom'?spare:draft.verticalAlign==='center'?spare/2:0
        Object.assign(input.style,{
            left:a[0]*100+'%',top:a[1]*100+'%',width:boxWidth+'px',height:boxHeight+'px',
            font:annotationTextFont(draft,scale),lineHeight:lineHeight+'px',padding:`${padding+offset}px ${padding}px ${padding}px`,
            color:draft.color,textAlign:draft.align??'left',textDecoration:draft.underline?'underline':'none',
            opacity:String(draft.opacity??1),
        })
    }
    function finish(commit=true):boolean {
        if(!draft)return true
        const next=draft,before=original
        if(commit&&next.text?.trim()){
            // Paint the committed shape during subscribers, not both the draft and its stored copy.
            draft=undefined
            try{if(!before||JSON.stringify(next)!==JSON.stringify(before))options.commit(next,before)}catch{draft=next;options.error();return false}
        }
        draft=undefined;original=undefined;input?.remove();input=undefined
        options.change();return true
    }
    function open(shape:Annotation,isNew:boolean,expand=false):void {
        if(disposed||!['text','callout'].includes(shape.tool))return
        if(!finish())return
        const surface=options.surface(shape);if(!surface)return
        original=isNew?undefined:shape;draft=shape;autoWidth=expand
        minHeight=(shape.points[1][1]-shape.points[0][1])*surface.height/surface.scale
        input=document.createElement('textarea');input.className='fm-annotation-text-editor'
        input.setAttribute('aria-label',options.text(shape.tool));input.spellcheck=false;input.wrap='soft'
        input.value=shape.text??'';surface.stage.append(input);refresh(true)
        input.addEventListener('input',()=>{
            if(!draft||!input)return
            if(new TextEncoder().encode(input.value).byteLength>options.maxBytes||/\p{Cs}/u.test(input.value)||input.value.includes('\0')){input.value=draft.text??'';options.error();return}
            draft={...draft,text:input.value};refresh(true);options.change()
        })
        input.addEventListener('keydown',event=>{
            if(event.isComposing)return
            if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish(false)}
            else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();finish()}
        })
        input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length);options.change()
    }
    // Formatting and dropdown portals keep the transaction alive; the page click commits it.
    options.root.addEventListener('pointerdown',event=>{
        if(!input||!(event.target instanceof Element)||input===event.target)return
        if(event.target.closest('dialog,.fm-top,.fm-context,.fm-hero-overlays,.fm-footer,[role=dialog],[role=menu],[role=listbox],[data-slot=popover]'))return
        if(!finish()){event.preventDefault();event.stopPropagation()}
    },{capture:true,signal:options.signal})
    const destroy=():void=>{if(disposed)return;disposed=true;finish(false)}
    options.signal.addEventListener('abort',destroy,{once:true})
    return {active,open,finish,refresh,destroy,isDirty:()=>!!draft&&JSON.stringify(draft)!==JSON.stringify(original),
        patch(patch:Partial<Annotation>):void {if(!draft)return;draft={...draft,...patch};refresh(true);options.change()},
    }
}

/** Page-relative geometry; the clicked point remains the callout's arrow tip. */
export function createTextAnnotationBox(shape:Annotation,width:number,height:number,scale:number):{shape:Annotation;autoWidth:boolean} {
    const [start,end]=shape.points,clicked=Math.hypot((end[0]-start[0])*width,(end[1]-start[1])*height)<5
    const clamp=(value:number)=>Math.min(1,Math.max(0,value)),font=(shape.fontSize??18)*scale
    if(shape.tool==='text'){
        const w=clicked?Math.min(40*scale,width):Math.max(28*scale,Math.abs(end[0]-start[0])*width)
        const h=clicked?font*1.3+12*scale:Math.max(font*1.3+12*scale,Math.abs(end[1]-start[1])*height)
        const left=Math.max(0,Math.min(clicked?start[0]:Math.min(start[0],end[0]),1-w/width))
        const top=Math.max(0,Math.min(clicked?start[1]-font/2/height:Math.min(start[1],end[1]),1-h/height))
        return {shape:{...shape,points:[[left,top],[clamp(left+w/width),clamp(top+h/height)]]},autoWidth:clicked}
    }
    const w=Math.min(150*scale,width*.4),h=Math.min(font*1.3+12*scale,height*.3)
    const right=start[0]*width+180*scale<width,above=start[1]*height>125*scale
    const left=Math.max(0,Math.min(start[0]+(right?55*scale:-55*scale-w)/width,1-w/width))
    const top=Math.max(0,Math.min(start[1]+(above?-90*scale:70*scale)/height,1-h/height))
    const knee:Point=[clamp(start[0]+(right?55:-55)*scale/width),clamp(start[1]+(above?-50:50)*scale/height)]
    return {shape:{...shape,points:[[left,top],[clamp(left+w/width),clamp(top+h/height)],knee,start]},autoWidth:false}
}
