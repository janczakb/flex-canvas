import {Tooltip} from '@heroui/react/tooltip'
import {useTooltipTriggerState} from 'react-stately/useTooltipTriggerState'
import {useEffect,useRef,useState} from 'react'

/** One owned HeroUI tooltip for native and React toolbar controls alike. */
export function ViewerTooltips({viewer}:{viewer:HTMLElement}) {
    const state=useTooltipTriggerState({delay:420,closeDelay:0})
    const latest=useRef(state);latest.current=state
    const trigger=useRef<HTMLElement|null>(null),hovered=useRef<HTMLElement|null>(null)
    const [target,setTarget]=useState<HTMLElement|null>(null)
    const overlay=useRef<HTMLDivElement>(null)
    const [label,setLabel]=useState('')
    useEffect(()=>{
        const update=()=>{
            setLabel(target?.getAttribute('aria-label')??target?.querySelector('input[aria-label]')?.getAttribute('aria-label')??'')
            if(target?.matches('[aria-expanded=true],:disabled,[aria-disabled=true]'))latest.current.close(true)
        }
        update()
        if(!target)return
        const observer=new MutationObserver(update)
        observer.observe(target,{attributes:true,attributeFilter:['aria-label','aria-expanded','aria-disabled','disabled'],subtree:true})
        return ()=>observer.disconnect()
    },[target])
    useEffect(()=>{
        const selector='button.fm-tool[aria-label],.fm-property button[aria-label],.fm-note-choice-button,.fm-markup button[aria-label]'
        const find=(event:Event):HTMLElement|null=>{
            const element=(event.target as Element)?.closest?.<HTMLElement>(selector)
            if(!element||!viewer.contains(element)||element.matches(':disabled,[aria-disabled=true]')||element.closest('[inert],[hidden]'))return null
            return element
        }
        const show=(node:HTMLElement,immediate=false)=>{
            if(node.getAttribute('aria-expanded')==='true')return
            trigger.current=node;setTarget(node);latest.current.open(immediate)
        }
        const over=(event:PointerEvent)=>{
            if(event.pointerType==='touch')return
            const node=find(event)
            if(node&&!(event.relatedTarget instanceof Node&&node.contains(event.relatedTarget))){hovered.current=node;show(node)}
        }
        const move=(event:PointerEvent)=>{if(event.pointerType==='touch')return;const node=find(event);if(node&&hovered.current!==node){hovered.current=node;show(node)}}
        const out=(event:PointerEvent)=>{
            const node=find(event)
            if(node&&!(event.relatedTarget instanceof Node&&node.contains(event.relatedTarget))){
                if(hovered.current===node)hovered.current=null
                if(trigger.current===node)latest.current.close(true)
            }
        }
        const focus=(event:FocusEvent)=>{const node=find(event);if(node?.matches(':focus-visible'))show(node,true)}
        const close=()=>latest.current.close(true)
        const blur=(event:FocusEvent)=>{
            const node=find(event)
            if(node===trigger.current&&hovered.current!==node)close()
        }
        const scroll=()=>{hovered.current=null;close()}
        const key=(event:KeyboardEvent)=>{if(event.key==='Escape')close()}
        viewer.addEventListener('pointerover',over)
        viewer.addEventListener('pointerout',out)
        viewer.addEventListener('pointermove',move)
        viewer.addEventListener('focusin',focus)
        viewer.addEventListener('focusout',blur)
        viewer.addEventListener('pointerdown',close,true)
        viewer.addEventListener('keydown',key,true)
        viewer.addEventListener('scroll',scroll,true)
        return ()=>{
            viewer.removeEventListener('pointerover',over);viewer.removeEventListener('pointerout',out);viewer.removeEventListener('pointermove',move)
            viewer.removeEventListener('focusin',focus);viewer.removeEventListener('focusout',blur)
            viewer.removeEventListener('pointerdown',close,true);viewer.removeEventListener('keydown',key,true)
            viewer.removeEventListener('scroll',scroll,true)
        }
    },[viewer])
    useEffect(()=>{
        const id=overlay.current?.id
        if(!state.isOpen||!target||!label||!id)return
        const previous=target.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean)??[]
        target.setAttribute('aria-describedby',[...new Set([...previous,id])].join(' '))
        return ()=>{
            const retained=(target.getAttribute('aria-describedby')??'').split(/\s+/).filter(value=>value&&value!==id)
            if(retained.length)target.setAttribute('aria-describedby',retained.join(' '));else target.removeAttribute('aria-describedby')
        }
    },[state.isOpen,target,label])
    return <Tooltip isOpen={state.isOpen&&!!label} onOpenChange={open=>{if(!open)state.close(true)}}>
        <Tooltip.Content ref={overlay} triggerRef={trigger} placement="bottom" className="fm-tooltip">{label}</Tooltip.Content>
    </Tooltip>
}
