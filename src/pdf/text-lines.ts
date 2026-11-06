import type {PageText, TextGlyph} from './protocol.js'

export interface SelectionGlyph {readonly glyph: TextGlyph; readonly x: number; readonly width: number}
export interface SelectionLine {readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly glyphs: readonly SelectionGlyph[]}
/** Preserve reading order and columns while using font boxes rather than ink outlines. */
export function pdfSelectionLines(content: PageText): readonly SelectionLine[] {
    const lines: Array<{x:number;y:number;right:number;bottom:number;items:TextGlyph[]}> = []
    for(const glyph of content.glyphs){
        const box=glyph.selection??glyph
        if(!glyph.text||box.width<=0||box.height<=0)continue
        const last=lines.at(-1),previous=last?.items.at(-1)
        const overlap=last?Math.min(last.bottom,box.y+box.height)-Math.max(last.y,box.y):0
        if(last&&previous&&glyph.index-previous.index<=2&&overlap>=Math.min(last.bottom-last.y,box.height)*.55&&box.x>=last.x-.002&&box.x-last.right<=Math.max(box.height,last.bottom-last.y)*1.5){
            last.x=Math.min(last.x,box.x);last.y=Math.min(last.y,box.y);last.right=Math.max(last.right,box.x+box.width);last.bottom=Math.max(last.bottom,box.y+box.height);last.items.push(glyph)
        }else lines.push({x:box.x,y:box.y,right:box.x+box.width,bottom:box.y+box.height,items:[glyph]})
    }
    return lines.map(line=>({x:line.x,y:line.y,width:line.right-line.x,height:line.bottom-line.y,glyphs:line.items.map((glyph,index)=>{
        const box=glyph.selection??glyph,next=line.items[index+1],nextBox=next?(next.selection??next):null
        return {glyph,x:box.x,width:nextBox&&nextBox.x>box.x?nextBox.x-box.x:box.width}
    })}))
}
