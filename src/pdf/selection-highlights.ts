type Rect=readonly [number,number,number,number]
/** One visual rectangle per selected text line; never overlapping per-glyph backgrounds. */
export function createPDFSelectionHighlights(){
    const layers=new Map<HTMLElement,{node:HTMLElement;key:string}>()
    return {
        show(selections:readonly {layer:HTMLElement;rectangles:readonly Rect[]}[]){
            const visible=new Set(selections.map(item=>item.layer))
            for(const [layer,item] of layers)if(!visible.has(layer)){item.node.remove();layers.delete(layer)}
            for(const {layer,rectangles} of selections){
                const key=JSON.stringify(rectangles),previous=layers.get(layer)
                if(previous?.key===key)continue
                const node=previous?.node??layer.ownerDocument.createElement('div')
                node.className='fm-text-selection';node.setAttribute('aria-hidden','true')
                const fragment=layer.ownerDocument.createDocumentFragment()
                for(const [x,y,width,height] of rectangles){
                    const rect=layer.ownerDocument.createElement('span')
                    rect.style.cssText=`left:${x*100}%;top:${y*100}%;width:${width*100}%;height:${height*100}%;`
                    fragment.append(rect)
                }
                node.replaceChildren(fragment);if(!node.isConnected)layer.append(node)
                layers.set(layer,{node,key})
            }
        },
        clear(){for(const item of layers.values())item.node.remove();layers.clear()},
    }
}
