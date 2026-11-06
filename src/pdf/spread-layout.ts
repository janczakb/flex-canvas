export type PDFPageLayout='single'|'double'
export interface PDFPageSize {width:number;height:number}

/** A spread owns page identities, independently of rendering and annotation state. */
export function createPDFSpreads(sizes:readonly PDFPageSize[],layout:PDFPageLayout,firstPageSingle=true,pageGap=0){
    if(!['single','double'].includes(layout)||typeof firstPageSingle!=='boolean'||!Number.isFinite(pageGap)||pageGap<0)throw new RangeError('Invalid PDF spread settings')
    if(sizes.some(size=>![size.width,size.height].every(value=>Number.isFinite(value)&&value>0)))throw new RangeError('Invalid PDF page sizes')
    const spreads:Array<{pages:number[];width:number;height:number}>=[],pageRows:number[]=[]
    for(let index=0;index<sizes.length;){
        const count=layout==='double'&&!(firstPageSingle&&index===0)?2:1
        const pages=Array.from({length:Math.min(count,sizes.length-index)},(_,offset)=>index+offset)
        const width=pages.reduce((sum,page)=>sum+sizes[page].width,0)+pageGap*(pages.length-1),height=Math.max(...pages.map(page=>sizes[page].height))
        for(const page of pages)pageRows[page]=spreads.length
        spreads.push({pages,width,height});index+=pages.length
    }
    return {spreads,pageRows}
}
