import { PDFTokenizer } from './tokenizer.js'
import { PDFEngineError, defaultPDFLimits, type PDFDictionary, type PDFReference, type PDFValue, type PageInfo } from './types.js'
const dictionary = (value: PDFValue): value is PDFDictionary => !!value && !Array.isArray(value) && typeof value === 'object' && 'kind' in value && value.kind === 'dictionary'
const reference = (value: PDFValue | undefined): value is PDFReference => !!value && !Array.isArray(value) && typeof value === 'object' && 'kind' in value && value.kind === 'reference'
const name = (value: PDFValue | undefined): string | null => value && !Array.isArray(value) && typeof value === 'object' && 'kind' in value && value.kind === 'name' ? value.value : null
interface XRef {offset:number;generation:number;free:boolean}
interface Page {reference:PDFReference;box:readonly number[];rotation:number;unit:number}

/** Native cross-reference and page-tree reader; unsupported encodings are explicit, never guessed. */
export class PDFByteDocument {
    private readonly objects = new Map<string, PDFValue>()
    private readonly xref = new Map<number, XRef>()
    private readonly pages: Page[] = []
    private closed = false
    constructor(private bytes: Uint8Array, private readonly limits = {maxBytes:104857600,maxObjects:100000,maxPages:2000,maxRevisions:32}) {
        if(bytes.length>limits.maxBytes)throw new PDFEngineError('byte_limit','PDF exceeds its byte limit.')
        for(const value of Object.values(limits))if(!Number.isSafeInteger(value)||value<1)throw new PDFEngineError('invalid_budget','Invalid PDF document budget.')
        const header=String.fromCharCode(...bytes.subarray(0,8))
        if(!/^%PDF-(?:1\.[0-7]|2\.0)$/.test(header))throw new PDFEngineError('header_invalid','A supported PDF header is required.')
        const tail=String.fromCharCode(...bytes.subarray(Math.max(0,bytes.length-65536)))
        const marker=tail.lastIndexOf('startxref'),offset=marker<0?NaN:Number(/^startxref\s+(\d+)/.exec(tail.slice(marker))?.[1])
        if(!Number.isSafeInteger(offset)||offset<0||offset>=bytes.length)throw new PDFEngineError('xref_missing','A valid PDF cross-reference offset is required.')
        const root=this.readReferences(offset,new Set())
        const catalog=this.resolve(root)
        if(!dictionary(catalog)||name(catalog.entries.get('Type'))!=='Catalog')throw new PDFEngineError('catalog_invalid','PDF catalog is invalid.')
        const pages=catalog.entries.get('Pages')
        if(!reference(pages))throw new PDFEngineError('page_tree_invalid','PDF page tree is missing.')
        this.readPages(pages,{},new Set())
        if(!this.pages.length)throw new PDFEngineError('page_tree_empty','PDF has no pages.')
    }
    private fail(code:string,message:string):never {throw new PDFEngineError(code,message)}
    private readReferences(offset:number,seen:Set<number>):PDFReference {
        if(seen.has(offset)||seen.size>=this.limits.maxRevisions)return this.fail('xref_cycle','PDF cross-reference chain exceeds its budget.')
        seen.add(offset)
        const lexer=new PDFTokenizer(this.bytes,offset,{...defaultPDFLimits,maxBytes:this.limits.maxBytes})
        if(lexer.keyword()!=='xref')return this.fail('xref_stream_unsupported','Cross-reference streams are not implemented yet.')
        while(true){
            lexer.skip();if(this.bytes[lexer.position]===116){lexer.expect('trailer');break}
            const start=lexer.read(),count=lexer.read()
            if(typeof start!=='number'||typeof count!=='number'||!Number.isSafeInteger(start)||!Number.isSafeInteger(count)||start<0||count<0||start+count>this.limits.maxObjects)return this.fail('xref_limit','Invalid or oversized PDF reference subsection.')
            for(let i=0;i<count;i++){
                const position=lexer.read(),generation=lexer.read(),state=lexer.keyword()
                if(typeof position!=='number'||typeof generation!=='number'||!Number.isSafeInteger(position)||!Number.isInteger(generation)||generation<0||generation>65535||!['n','f'].includes(state)||position<0||(state==='n'&&position>=this.bytes.length))return this.fail('xref_invalid','Invalid PDF reference entry.')
                if(!this.xref.has(start+i))this.xref.set(start+i,{offset:position,generation,free:state==='f'})
            }
        }
        const trailer=lexer.read();if(!dictionary(trailer))return this.fail('trailer_invalid','PDF trailer is not a dictionary.')
        if(trailer.entries.has('Encrypt'))return this.fail('encryption_unsupported','Encrypted PDFs are not implemented yet.')
        if(trailer.entries.has('XRefStm'))return this.fail('xref_stream_unsupported','Hybrid PDF cross-references are not implemented yet.')
        const currentRoot=trailer.entries.get('Root'),previous=trailer.entries.get('Prev')
        let inheritedRoot:PDFReference|undefined
        if(previous!==undefined){if(typeof previous!=='number'||!Number.isSafeInteger(previous)||previous<0||previous>=this.bytes.length)return this.fail('xref_invalid','Invalid previous PDF reference offset.');inheritedRoot=this.readReferences(previous,seen)}
        if(reference(currentRoot))return currentRoot
        if(inheritedRoot)return inheritedRoot
        return this.fail('catalog_missing','PDF trailer does not identify a catalog.')
    }
    private resolve(ref:PDFReference):PDFValue {
        const key=ref.object+':'+ref.generation,cached=this.objects.get(key)
        if(cached!==undefined)return cached
        const location=this.xref.get(ref.object)
        if(!location||location.free||location.generation!==ref.generation)return this.fail('reference_invalid','PDF indirect reference is unavailable.')
        const lexer=new PDFTokenizer(this.bytes,location.offset,{maxBytes:this.limits.maxBytes})
        const object=lexer.read(),generation=lexer.read();lexer.expect('obj')
        if(object!==ref.object||generation!==ref.generation)return this.fail('reference_mismatch','PDF object header does not match its reference.')
        const value=lexer.read();this.objects.set(key,value);return value
    }
    private readPages(ref:PDFReference,inherited:{box?:readonly number[];rotation?:number;unit?:number},seen:Set<string>):void {
        const key=ref.object+':'+ref.generation
        if(seen.has(key)||seen.size>=this.limits.maxObjects)this.fail('page_tree_cycle','Invalid PDF page tree recursion.')
        seen.add(key)
        const node=this.resolve(ref);if(!dictionary(node))this.fail('page_tree_invalid','PDF page node must be a dictionary.')
        const boxValue=node.entries.get('CropBox')??node.entries.get('MediaBox')
        const box=boxValue===undefined?inherited.box:this.box(boxValue)
        const rotationValue=node.entries.get('Rotate')??inherited.rotation??0
        const unitValue=node.entries.get('UserUnit')??inherited.unit??1
        if(typeof rotationValue!=='number'||!Number.isSafeInteger(rotationValue)||rotationValue%90!==0||typeof unitValue!=='number'||!Number.isFinite(unitValue)||unitValue<=0||unitValue>75000)this.fail('page_geometry_invalid','Invalid PDF page geometry.')
        const rotation=((rotationValue%360)+360)%360
        if(name(node.entries.get('Type'))==='Page'){
            if(!box)this.fail('page_geometry_missing','PDF page has no inherited size.')
            if(this.pages.length>=this.limits.maxPages)this.fail('page_limit','PDF page count exceeds its budget.')
            this.pages.push({reference:ref,box,rotation,unit:unitValue});return
        }
        if(name(node.entries.get('Type'))!=='Pages')this.fail('page_tree_invalid','Unexpected PDF page-tree node.')
        const children=node.entries.get('Kids')
        if(!Array.isArray(children)||children.length>this.limits.maxPages)this.fail('page_limit','Invalid PDF page children.')
        for(const child of children){if(!reference(child))this.fail('page_tree_invalid','PDF page child must be an indirect reference.');this.readPages(child,{box,rotation,unit:unitValue},seen)}
    }
    private box(value:PDFValue):readonly number[]{if(!Array.isArray(value)||value.length!==4||value.some(item=>typeof item!=='number'||!Number.isFinite(item)))return this.fail('page_geometry_invalid','PDF page size must contain four coordinates.');const result=value as number[];if(result[2]<=result[0]||result[3]<=result[1])return this.fail('page_geometry_invalid','PDF page size must be positive.');return Object.freeze([...result])}
    get pageCount():number {this.check();return this.pages.length}
    getPageInfo(index:number):PageInfo {
        this.check();if(!Number.isInteger(index)||index<0||index>=this.pages.length)throw new RangeError('Invalid PDF page index.')
        const page=this.pages[index],w=(page.box[2]-page.box[0])*page.unit,h=(page.box[3]-page.box[1])*page.unit,rotated=page.rotation%180!==0
        return Object.freeze({pageIndex:index,width:rotated?h:w,height:rotated?w:h,rotation:page.rotation})
    }
    private check():void {if(this.closed)this.fail('document_closed','PDF document is closed.')}
    destroy():void {if(this.closed)return;this.closed=true;this.objects.clear();this.xref.clear();this.pages.length=0;this.bytes=new Uint8Array()}
}
