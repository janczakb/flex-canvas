export interface PDFRedaction {
    readonly pageIndex:number
    readonly rectangles:readonly (readonly [number,number,number,number])[]
    readonly fill?:string
    readonly overlayText?:string
    readonly overlayColor?:string
    readonly repeatOverlayText?:boolean
    readonly opacity?:number
}
/** Validate the complete operation before opening a writable document copy. */
export function validatePDFRedactions(input:readonly PDFRedaction[],pageCount:number):void{
    if(!Array.isArray(input)||!input.length||input.length>2000)throw new RangeError('Invalid redaction count')
    let boxes=0
    for(const item of input){
        if(!item||!Number.isInteger(item.pageIndex)||item.pageIndex<0||item.pageIndex>=pageCount||!Array.isArray(item.rectangles)||!item.rectangles.length||(boxes+=item.rectangles.length)>4096)throw new RangeError('Invalid redaction page or geometry')
        for(const rect of item.rectangles)if(!Array.isArray(rect)||rect.length!==4||rect.some(n=>!Number.isFinite(n)||n<0||n>1)||rect[2]<=0||rect[3]<=0||rect[0]+rect[2]>1.000001||rect[1]+rect[3]>1.000001)throw new RangeError('Invalid redaction rectangle')
        for(const key of ['fill','overlayColor'] as const)if(item[key]!==undefined&&!/^#[0-9a-f]{6}$/.test(item[key]!))throw new RangeError('Invalid redaction color')
        if(item.overlayText!==undefined&&(typeof item.overlayText!=='string'||new TextEncoder().encode(item.overlayText).length>512||item.overlayText.includes('\0')||/\p{Cs}/u.test(item.overlayText)))throw new RangeError('Invalid redaction text')
        if(item.repeatOverlayText!==undefined&&typeof item.repeatOverlayText!=='boolean')throw new RangeError('Invalid overlay repetition')
        if(item.opacity!==undefined&&(!Number.isFinite(item.opacity)||item.opacity<0||item.opacity>1))throw new RangeError('Invalid redaction opacity')
    }
}
