import type {Annotation} from './types.js'
import type {ToolProperty} from './toolbar.js'
import type {createHeroControls} from './hero-controls.js'
import {paintViewerIcon} from './viewer-icons.js'

/** Redaction settings are separate from ordinary text markup. No PDF content is changed here. */
export function mountRedactionToolbar(row:HTMLElement, options:{
    hero:ReturnType<typeof createHeroControls>;text:(key:string)=>string;colors:readonly string[]
    properties?:readonly ToolProperty[]|null
    selected:()=>Annotation|undefined;busy:()=>boolean;canApply:()=>boolean
    update:(patch:Partial<Annotation>)=>void;comment:()=>void;remove:()=>void;apply:()=>void
}){
    const doc=row.ownerDocument,wrap=doc.createElement('div');wrap.className='fm-redaction-controls';wrap.hidden=true
    const enabled=(key:ToolProperty)=>options.properties?.includes(key)??true
    const slot=(key:string,icon?:string)=>{
        const cell=doc.createElement('div');cell.className='fm-property';cell.dataset.property=key
        if(icon){const glyph=doc.createElement('span');glyph.className='fm-property-icon';glyph.setAttribute('aria-hidden','true');paintViewerIcon(glyph,icon);cell.append(glyph)}
        const node=doc.createElement('div');node.className='fm-hero-choice';cell.append(node);wrap.append(cell);return node
    }
    const palette=(key:'fill'|'color'|'overlayColor',label:string,icon:string,fallback:string)=>{
        if(!enabled(key))return
        options.hero.choice(slot(key,icon),()=>({label:options.text(label),value:options.selected()?.[key]??fallback,
            choices:[...new Set([...options.colors,...(key==='color'?[]:key==='fill'?['#000000']:['#000000','#ffffff'])])].map(key=>({key,label:key})),
            onChange:value=>options.update({[key]:value})}),true)
    }
    palette('fill','redaction_fill','fill','#000000')
    palette('overlayColor','redaction_text_color','fontColor','#dc2626')
    if(enabled('overlayText'))options.hero.input(slot('overlayText'),()=>({
        'aria-label':options.text('redaction_overlay'),placeholder:options.text('redaction_overlay'),
        value:options.selected()?.overlayText??'',maxLength:512,isDisabled:options.busy(),
        onChange:event=>options.update({overlayText:event.currentTarget.value}),
    }))
    if(enabled('repeatOverlayText'))options.hero.checkbox(slot('repeatOverlayText'),()=>({
        label:options.text('redaction_repeat'),selected:options.selected()?.repeatOverlayText??false,
        disabled:options.busy(),onChange:value=>options.update({repeatOverlayText:value}),
    }))
    palette('color','redaction_outline','color','#dc2626')
    if(enabled('opacity'))options.hero.choice(slot('opacity','opacity'),()=>({
        label:options.text('opacity'),value:String(options.selected()?.opacity??1),
        choices:[.1,.25,.5,.75,.9,1].map(value=>({key:String(value),label:Math.round(value*100)+'%'})),
        onChange:value=>options.update({opacity:Number(value)}),
    }),false)
    const spacer=doc.createElement('span');spacer.className='fm-redaction-spacer';wrap.append(spacer)
    options.hero.toggle(slot('redactionComment'),()=>({label:options.text('markup_comment'),icon:'note',active:false,action:options.comment}))
    options.hero.toggle(slot('redactionDelete'),()=>({label:options.text('delete'),icon:'delete',active:false,action:options.remove}))
    options.hero.action(slot('redactionApply'),()=>({label:options.text('redaction_apply'),disabled:options.busy()||!options.canApply(),action:options.apply}))
    row.append(wrap)
    return {update:(visible:boolean)=>{wrap.hidden=!visible}}
}
