import {paintViewerIcon} from './viewer-icons.js'

/** Compact property icons drill into an in-row editor without moving the document. */
export function createResponsiveProperties(row:HTMLElement, signal:AbortSignal, text:(key:string)=>string) {
    const doc=row.ownerDocument
    const entries=new Map<string,{wrapper:HTMLElement;summary:HTMLButtonElement}>()
    const back=doc.createElement('button'), spacer=doc.createElement('span')
    back.type='button';back.className='fm-tool fm-property-back button button--ghost'
    back.hidden=true;paintViewerIcon(back,'prev')
    spacer.className='fm-property-spacer';spacer.hidden=true
    row.append(back,spacer)
    let compact=false,active:string|null=null,identity:unknown,disposed=false
    const paint=()=>{
        back.setAttribute('aria-label',text('back'))
        back.hidden=!compact||active===null
        spacer.hidden=!compact
        row.dataset.propertyExpanded=active??''
        for(const [key,{wrapper,summary}] of entries){
            wrapper.hidden=wrapper.dataset.available!=='true'||compact&&active!==null&&active!==key
            wrapper.dataset.expanded=String(!compact||active===key)
            summary.setAttribute('aria-label',text(wrapper.dataset.label??key))
        }
    }
    back.onclick=()=>{
        const previous=active;active=null;paint()
        if(previous)entries.get(previous)?.summary.focus({preventScroll:true})
    }
    const escape=(event:KeyboardEvent)=>{
        if(event.key!=='Escape'||active===null||event.defaultPrevented||disposed)return
        // A nested palette/list handles Escape first; the next Escape returns to the icons.
        if(row.closest('.fm')?.querySelector('[data-slot="popover"],[role="listbox"],[role="menu"]'))return
        event.preventDefault();event.stopPropagation();back.click()
    }
    row.addEventListener('keydown',escape,{signal})
    signal.addEventListener('abort',()=>{disposed=true;entries.clear();back.onclick=null},{once:true})
    return {
        register(key:string,wrapper:HTMLElement,label:string) {
            const summary=doc.createElement('button')
            summary.type='button';summary.className='fm-tool fm-property-summary button button--ghost'
            summary.dataset.propertySummary=key;wrapper.dataset.label=label
            paintViewerIcon(summary,key)
            summary.onclick=()=>{if(disposed)return;active=key;paint();back.focus({preventScroll:true})}
            wrapper.prepend(summary);entries.set(key,{wrapper,summary})
        },
        update(available:ReadonlySet<string>,nextIdentity:unknown) {
            if(disposed)return
            if(identity!==nextIdentity||active&&!available.has(active))active=null
            identity=nextIdentity
            for(const [key,{wrapper}] of entries)wrapper.dataset.available=String(available.has(key))
            paint()
        },
        resize(nextCompact:boolean) {
            if(disposed||compact===nextCompact)return
            compact=nextCompact;if(!compact)active=null
            row.dataset.compact=String(compact);paint()
        },
    }
}
