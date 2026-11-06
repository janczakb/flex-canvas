import type {PDFTextBlock,PDFTextCharacter} from './text-edit.js'

interface TextLine {
    parts:PDFTextBlock[]
    text:string
    x:number
    y:number
    width:number
    height:number
    baseline:number
    characters:PDFTextCharacter[]
}

export interface PDFParagraph extends PDFTextBlock {
    readonly lines:readonly TextLine[]
}

const sameFace=(a:PDFTextBlock,b:PDFTextBlock)=>a.font===b.font&&a.appearance.size===b.appearance.size&&a.appearance.color===b.appearance.color&&a.appearance.bold===b.appearance.bold&&a.appearance.italic===b.appearance.italic
function extend(target:TextLine,part:Pick<TextLine,'x'|'y'|'width'|'height'>){
    const right=Math.max(target.x+target.width,part.x+part.width),bottom=Math.max(target.y+target.height,part.y+part.height)
    target.x=Math.min(target.x,part.x);target.y=Math.min(target.y,part.y)
    target.width=right-target.x;target.height=bottom-target.y
}

/** Conservative grouping of horizontal runs by baseline, then consecutive left-aligned lines. */
export function groupPDFParagraphs(blocks:readonly PDFTextBlock[],pageHeight:number):PDFParagraph[]{
    const horizontal=(part:PDFTextBlock)=>part.rotation!==undefined?Math.abs(Math.sin(part.rotation))<.15:part.width>=part.height*.55
    const em=(part:PDFTextBlock)=>Math.max(part.height,(part.appearance.size??0)/pageHeight)
    const rows:TextLine[]=[]
    const baseline=(part:PDFTextBlock)=>part.baseline??part.y+part.height
    for(const part of [...blocks].sort((a,b)=>baseline(a)-baseline(b)||a.x-b.x)){
        const row=horizontal(part)?rows.findLast(line=>{
            const start=line.parts[0]
            return horizontal(start)&&sameFace(start,part)&&Math.abs(line.baseline-baseline(part))<em(part)*.23
                &&part.x<line.x+line.width+em(part)*1.25&&part.x+part.width>line.x-em(part)*1.25
        }):undefined
        if(row){row.parts.push(part);extend(row,part)}
        else rows.push({parts:[part],text:part.text,x:part.x,y:part.y,width:part.width,height:part.height,baseline:baseline(part),characters:[]})
    }
    for(const row of rows){
        row.parts.sort((a,b)=>a.x-b.x)
        row.text=row.parts.reduce((value,part,index)=>{
            const previous=row.parts[index-1]
            const gap=previous?part.x-previous.x-previous.width:0
            const prefix=value+(previous&&gap>em(part)*.11&&!/\s$/.test(value)&&!/^\s/.test(part.text)?' ':'')
            row.characters.push(...(part.characters??[]).map(character=>({...character,start:character.start+prefix.length,end:character.end+prefix.length})))
            return prefix+part.text
        },'')
    }
    const groups:Array<{lines:TextLine[];bounds:TextLine}>=[]
    for(const row of rows.sort((a,b)=>a.y-b.y||a.x-b.x)){
        const part=row.parts[0],size=em(part)
        const group=horizontal(part)?groups.findLast(({lines,bounds})=>{
            const last=lines.at(-1)!,step=row.y-last.y
            return sameFace(last.parts[0],part)&&Math.abs(row.x-last.x)<size*.45
                &&step>size*.65&&step<size*1.42&&row.y>=last.y+last.height*.8
                &&(last.width>=Math.max(bounds.width,row.width)*.7||!/[.!?…]["'’”)]?\s*$/.test(last.text))
        }):undefined
        if(group){group.lines.push(row);extend(group.bounds,row)}
        else groups.push({lines:[row],bounds:{...row}})
    }
    return groups.map(({lines,bounds})=>{
        let offset=0
        const characters=lines.flatMap(line=>{
            const result=line.characters.map(character=>({...character,start:character.start+offset,end:character.end+offset}))
            offset+=line.text.length+1
            return result
        })
        return {...lines[0].parts[0],x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height,
            text:lines.map(line=>line.text).join('\n'),characters,lines}
    })
}
