import type {createHeroControls} from './hero-controls.js'

/** An annotation-owned, non-modal comment editor. It does not steal the document layout. */
export function openCommentPopover(options:{
    root:HTMLElement;hero:ReturnType<typeof createHeroControls>;signal:AbortSignal;text:(key:string)=>string
    bounds:()=>DOMRect|null;value:string;maxBytes:number;readOnly:boolean
    save:(value:string)=>void;close:()=>void
}){
    const {root,hero,signal,text}=options,doc=root.ownerDocument,view=doc.defaultView!
    const popup=doc.createElement('section'),header=doc.createElement('div'),title=doc.createElement('strong'),dismiss=doc.createElement('button')
    const field=doc.createElement('div'),footer=doc.createElement('div'),submit=doc.createElement('div'),status=doc.createElement('span')
    popup.className='fm-comment-popover';popup.role='dialog';popup.setAttribute('aria-label',text('comments'))
    header.className='fm-comment-header';title.textContent=text('comments');dismiss.type='button';dismiss.textContent='×';dismiss.setAttribute('aria-label',text('close'))
    header.append(title,dismiss);field.className='fm-comment-field';footer.className='fm-comment-footer';status.role='status';footer.append(status,submit)
    popup.append(header,field,footer);root.append(popup)
    let value=options.value,disposed=false
    const position=()=>{
        const anchor=options.bounds(),viewport=root.getBoundingClientRect();if(!anchor){close();return}
        const width=Math.min(360,viewport.width-24);popup.style.width=width+'px'
        const x=Math.max(viewport.left+12,Math.min(viewport.right-width-12,anchor.left+anchor.width/2-width/2))
        const top=anchor.bottom+8,above=anchor.top-popup.offsetHeight-8
        popup.style.left=x+'px';popup.style.top=Math.max(viewport.top+55,Math.min(viewport.bottom-popup.offsetHeight-12,top+popup.offsetHeight<viewport.bottom?top:above))+'px'
        popup.style.setProperty('--comment-arrow',Math.max(16,Math.min(width-16,anchor.left+anchor.width/2-x))+'px')
    }
    const close=()=>{
        if(disposed)return;disposed=true;signal.removeEventListener('abort',close);root.removeEventListener('scroll',position,true);view.removeEventListener('resize',position)
        doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('keydown',key,true);hero.release(field);hero.release(submit);popup.remove();options.close()
    }
    const outside=(event:PointerEvent)=>{if(!event.composedPath().includes(popup))close()}
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close()}}
    dismiss.onclick=close
    hero.textarea(field,()=>({value,'aria-label':text('add_comment'),placeholder:text('add_comment'),isReadOnly:options.readOnly,
        maxLength:options.maxBytes,onChange:event=>{value=event.currentTarget.value;status.textContent='';hero.update()},rows:4,
    }))
    hero.action(submit,()=>({label:text('save_comment'),disabled:options.readOnly||!value.trim()||new TextEncoder().encode(value).length>options.maxBytes,action:()=>{
        try{options.save(value);status.textContent=text('comment_saved')}catch{status.textContent=text('limit')}
    }}))
    hero.commit();position()
    if(!options.readOnly)field.querySelector('textarea')?.focus({preventScroll:true})
    root.addEventListener('scroll',position,true);view.addEventListener('resize',position);doc.addEventListener('pointerdown',outside,true);doc.addEventListener('keydown',key,true);signal.addEventListener('abort',close,{once:true})
    return {close,reposition:position}
}
