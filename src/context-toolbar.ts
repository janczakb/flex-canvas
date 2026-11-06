/** A tool-properties overlay never participates in document layout. */
export function createContextToolbar(slot:HTMLElement, content:HTMLElement, signal:AbortSignal) {
    const view=slot.ownerDocument.defaultView!
    let animation:Animation|undefined,shown=false,disposed=false,generation=0
    slot.hidden=true;slot.dataset.open='false';content.inert=true
    function settle(visible:boolean,version:number) {
        if(disposed||version!==generation)return
        slot.hidden=!visible;slot.dataset.open=String(visible)
        animation?.cancel();animation=undefined
    }
    function setVisible(visible:boolean,update:()=>void) {
        if(disposed)return
        if(visible)update()
        content.inert=!visible
        if(shown===visible)return
        shown=visible
        const version=++generation,style=view.getComputedStyle(content)
        const from={opacity:slot.hidden?'0':style.opacity,transform:slot.hidden?'translateY(-50%)':style.transform}
        animation?.cancel();slot.hidden=false;slot.dataset.open=String(visible)
        const to={opacity:visible?'1':'0',transform:visible?'translateY(0)':'translateY(-50%)'}
        animation=content.animate([from,to],{duration:view.matchMedia('(prefers-reduced-motion: reduce)').matches?0:visible?100:120,easing:visible?'ease-out':'ease-in',fill:'both'})
        animation.onfinish=()=>settle(visible,version)
    }
    signal.addEventListener('abort',()=>{disposed=true;generation++;animation?.cancel()},{once:true})
    return {setVisible}
}
