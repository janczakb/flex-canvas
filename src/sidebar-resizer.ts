import {paintViewerIcon} from './viewer-icons.js'

export function mountSidebarResizer(panel:HTMLElement, root:HTMLElement, options:{edge:'start'|'end';label:string;signal:AbortSignal;onResize?:(active:boolean)=>void}) {
    const view=root.ownerDocument.defaultView!,handle=root.ownerDocument.createElement('div')
    handle.className='fm-grip';handle.tabIndex=0;handle.role='separator'
    handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label',options.label)
    paintViewerIcon(handle,'drag');panel.append(handle)
    let width=300,start:{id:number;x:number;width:number}|undefined,frame=0,requested=width
    const direction=()=> (options.edge==='start'?1:-1)*(view.getComputedStyle(root).direction==='rtl'?-1:1)
    const bounds=()=>({min:Math.min(200,root.clientWidth),max:Math.max(200,root.clientWidth-96)})
    const apply=(next:number,notify=false)=>{
        const {min,max}=bounds();width=Math.round(Math.max(min,Math.min(max,next)))
        panel.style.setProperty('--side-width',width+'px')
        handle.setAttribute('aria-valuenow',String(width));handle.setAttribute('aria-valuemin',String(min));handle.setAttribute('aria-valuemax',String(max))
        if(notify)options.onResize?.(!!start)
    }
    const flush=()=>{view.cancelAnimationFrame(frame);frame=0;apply(requested,true)}
    handle.onpointerdown=event=>{
        if(event.button!==0)return
        event.preventDefault();start={id:event.pointerId,x:event.clientX,width:panel.getBoundingClientRect().width}
        requested=start.width;options.onResize?.(true);handle.setPointerCapture(event.pointerId)
    }
    handle.onpointermove=event=>{
        if(start?.id!==event.pointerId)return
        requested=start.width+(event.clientX-start.x)*direction()
        if(!frame)frame=view.requestAnimationFrame(flush)
    }
    const finish=()=>{if(!start)return;flush();start=undefined;options.onResize?.(false)}
    handle.onpointerup=finish;handle.onlostpointercapture=finish;handle.onpointercancel=finish
    handle.ondblclick=()=>{apply(300);options.onResize?.(false)}
    handle.onkeydown=event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return
        event.preventDefault();event.stopPropagation()
        const {min,max}=bounds()
        apply(event.key==='Home'?min:event.key==='End'?max:width+(event.key==='ArrowRight'?16:-16)*direction())
        options.onResize?.(false)
    }
    const observer=new ResizeObserver(()=>{if(!start)apply(width)})
    observer.observe(root);apply(width)
    options.signal.addEventListener('abort',()=>{view.cancelAnimationFrame(frame);observer.disconnect();handle.remove()},{once:true})
    return handle
}
