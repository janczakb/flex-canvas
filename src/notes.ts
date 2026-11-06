import {noteMarkers} from './note-markers.js'
import type {NoteIcon} from './types.js'

/** Fixed screen-size note markers. Geometry stays normalized and independent of image bytes. */
const silhouettes: Partial<Record<NoteIcon,string>> = {
    comment:'M-12-10H12V7H-3L-10 13V7H-12Z',
    pointer:'M-10-12L13 0L-10 12L-5 0Z',
    arrow:'M-13-5H1V-12L14 0L1 12V5H-13Z',
    check:'M-12-1L-4 7L12-10L16-6L-4 15L-16 3Z',
    cross:'M-12-8L-8-12L0-4L8-12L12-8L4 0L12 8L8 12L0 4L-8 12L-12 8L-4 0Z',
    insert:'M0-12L14 10H7L0-2L-7 10H-14Z',
    note:'M-11-12H11V3L2 12H-11ZM2 3V10L9 3Z',
    star:'M0-14L4-5L14-4L7 3L9 13L0 8L-9 13L-7 3L-14-4L-4-5Z',
    key:'M-1-6A8 8 0 1 0-7 2L-14 9V14H-9V11H-6V8L0 2A8 8 0 0 0-1-6Z',
}
const cached = new Map<NoteIcon,Path2D>()
const markerPaths=new Map<NoteIcon,readonly Path2D[]>()
/** The toolbar previews the very same marker geometry as the canvas. */
export function noteMarkerSVG(icon:NoteIcon):string {
    if(noteMarkers[icon])return noteMarkers[icon]!.svg
    const body=icon==='circle'
        ? '<path d="M12 0A12 12 0 1 0-12 0A12 12 0 1 0 12 0ZM5 0A5 5 0 1 1-5 0A5 5 0 1 1 5 0Z" fill-rule="evenodd"/>'
        : icon==='paragraph'||icon==='new-paragraph'||icon==='help'
            ? `<text x="0" y="1" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-weight="700" font-size="${icon==='new-paragraph'?17:29}">${icon==='help'?'?':icon==='paragraph'?'¶':'N¶'}</text>`
            : `<path d="${silhouettes[icon]??silhouettes.comment}" fill-rule="evenodd"/>`
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -20 40 40" fill="currentColor" aria-hidden="true">${body}</svg>`
}
export function paintNote(context: CanvasRenderingContext2D,icon: NoteIcon,x:number,y:number): void {
    context.save();context.translate(x,y);context.setLineDash([])
    const marker=noteMarkers[icon]
    if(marker){
        let paths=markerPaths.get(icon)
        if(!paths){paths=marker.paths.map(path=>new Path2D(path));markerPaths.set(icon,paths)}
        context.translate(-12,-12);context.lineWidth=2;context.lineCap='round';context.lineJoin='round';context.strokeStyle=context.fillStyle
        for(const path of paths)context.stroke(path)
        context.restore();return
    }
    if(icon==='circle'){
        context.beginPath();context.arc(0,0,12,0,Math.PI*2);context.arc(0,0,5,0,Math.PI*2,true);context.fill('evenodd')
    }else if(icon==='paragraph'||icon==='new-paragraph'||icon==='help'){
        context.font=`700 ${icon==='new-paragraph'?17:29}px system-ui`;context.textAlign='center';context.textBaseline='middle'
        context.fillText(icon==='help'?'?':icon==='paragraph'?'¶':'N¶',0,1)
    }else{
        let path=cached.get(icon)
        if(!path){path=new Path2D(silhouettes[icon]??silhouettes.comment);cached.set(icon,path)}
        context.fill(path,'evenodd')
    }
    context.restore()
}

/** Anchors a 300×200 note to its marker, flipping above when there is no room below. */
export function notePopupPlacement(x:number,y:number,viewport:{left:number;top:number;right:number;bottom:number}) {
    const width=Math.max(1,Math.min(300,viewport.right-viewport.left-16))
    const height=Math.max(1,Math.min(200,viewport.bottom-viewport.top-16))
    const left=Math.max(viewport.left+8,Math.min(x-width/2,viewport.right-width-8))
    const above=y+28+height>viewport.bottom-8 && y-28-height>=viewport.top+8
    const top=Math.max(viewport.top+8,Math.min(above?y-28-height:y+28,viewport.bottom-height-8))
    return {left,top,width,height,above,anchor:Math.max(12,Math.min(width-12,x-left))}
}
