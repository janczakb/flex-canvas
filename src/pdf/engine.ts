import {pdfStandardFont,validatePDFTextEdits,type PDFTextAppearance,type PDFTextBlock,type PDFTextEdit,type PDFTextCharacter} from './text-edit.js'
import {validatePDFCrops,type PDFCrop} from './crop.js'
import {validatePDFRedactions,type PDFRedaction} from './redactions.js'
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium'
import { PDFEngineError, type PageInfo } from './types.js'
import type { OutlineItem, PageText, PDFLink, PDFMetadata, PDFPageOverlay, PDFTile, Raster, PDFTextPreview, PDFTextFlowLayout, SearchHit } from './protocol.js'
import { readBoundedBytes } from './source.js'
import { validatePagePlan, type PDFPageEdit } from './page-plan.js'

/** One document per worker: handles never cross the boundary and terminate frees WASM memory. */
export class PDFiumDocument {
    private document = 0
    private bytes = 0
    private byteLength = 0
    private constructor(private readonly api: WrappedPdfiumModule) {}

    static async prepare(wasmUrl: string): Promise<WrappedPdfiumModule> {
        const wasmBinary = await readBoundedBytes(wasmUrl, 8 * 1024 * 1024)
        const api = await init({ wasmBinary, print: () => {}, printErr: () => {} })
        api.PDFiumExt_Init()
        return api
    }

    static async open(bytes: Uint8Array, wasmUrl: string, password = '', maxPages = 2000, runtime?: Promise<WrappedPdfiumModule>): Promise<PDFiumDocument> {
        const api = await (runtime ?? PDFiumDocument.prepare(wasmUrl))
        const instance = new PDFiumDocument(api)
        try {
            instance.byteLength = bytes.length
            instance.bytes = instance.allocate(bytes.length)
            instance.heap().set(bytes, instance.bytes)
            instance.document = api.FPDF_LoadMemDocument(instance.bytes, bytes.length, password)
            if (!instance.document) {
                const code = api.FPDF_GetLastError()
                throw new PDFEngineError(code === 4 ? 'pdf_password_required' : 'pdf_invalid', 'Unable to open this PDF.')
            }
            if (instance.pageCount < 1 || instance.pageCount > maxPages) throw new PDFEngineError('pdf_page_limit', 'PDF page count exceeds the limit.')
            return instance
        } catch (error) { instance.destroy(); throw error }
    }
    get pageCount(): number { return this.api.FPDF_GetPageCount(this.document) }
    private heap(): Uint8Array { return (this.api.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8 }
    private allocate(bytes: number): number {
        const pointer = this.api.pdfium.wasmExports.malloc(bytes)
        if (!pointer) throw new PDFEngineError('pdf_memory_limit', 'PDF memory allocation failed.')
        return pointer
    }
    private free(pointer: number): void { if (pointer) this.api.pdfium.wasmExports.free(pointer) }
    private withPage<T>(index: number, operation: (page: number) => T): T {
        if (!this.document || !Number.isSafeInteger(index) || index < 0 || index >= this.pageCount) throw new PDFEngineError('pdf_page_invalid', 'Invalid PDF page.')
        const page = this.api.FPDF_LoadPage(this.document, index)
        if (!page) throw new PDFEngineError('pdf_page_failed', 'Unable to open the PDF page.')
        try { return operation(page) } finally { this.api.FPDF_ClosePage(page) }
    }
    info(index: number): PageInfo {
        return this.withPage(index, page => ({pageIndex: index, width: this.api.FPDF_GetPageWidth(page), height: this.api.FPDF_GetPageHeight(page), rotation: this.api.FPDFPage_GetRotation(page) * 90}))
    }
    pageSizes():Array<{width:number;height:number}>{
        if(!this.document)throw new PDFEngineError('pdf_closed','PDF is closed.')
        const pointer=this.allocate(16),sizes:Array<{width:number;height:number}>=[]
        try{
            for(let index=0;index<this.pageCount;index++){
                if(!this.api.FPDF_GetPageSizeByIndex(this.document,index,pointer,pointer+8))throw new PDFEngineError('pdf_page_failed','Cannot read PDF page dimensions.')
                const data=new DataView(this.heap().buffer),width=data.getFloat64(pointer,true),height=data.getFloat64(pointer+8,true)
                if(!(width>0&&height>0)||!Number.isFinite(width+height))throw new PDFEngineError('pdf_page_failed','Invalid PDF page dimensions.')
                sizes.push({width,height})
            }
            return sizes
        }finally{this.free(pointer)}
    }
    render(index: number, width: number, height: number): Raster {
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16777216) throw new PDFEngineError('pdf_render_limit', 'PDF raster exceeds the limit.')
        return this.raster(index,{x:0,y:0,width,height,pageWidth:width,pageHeight:height})
    }
    renderTile(index: number, tile: PDFTile): Raster {
        const {x,y,width,height,pageWidth,pageHeight} = tile
        if (![x,y,width,height,pageWidth,pageHeight].every(Number.isSafeInteger)
            || x < 0 || y < 0 || width < 1 || height < 1 || width > 1024 || height > 1024
            || x + width > pageWidth || y + height > pageHeight || pageWidth > 65536 || pageHeight > 65536) {
            throw new PDFEngineError('pdf_render_limit', 'PDF tile exceeds the render limits.')
        }
        return this.withPage(index,page=>this.rasterPageWithOverlap(page,tile))
    }
    private rasterPageWithOverlap(page:number,{x,y,width,height,pageWidth,pageHeight}:PDFTile):Raster {
        // Render a small overlap so glyph antialiasing is not clipped at tile edges.
        const overlap = 16
        const left=Math.max(0,x-overlap),top=Math.max(0,y-overlap)
        const right=Math.min(pageWidth,x+width+overlap),bottom=Math.min(pageHeight,y+height+overlap)
        const raster=this.rasterPage(page,{x:left,y:top,width:right-left,height:bottom-top,pageWidth,pageHeight})
        const source=new Uint8Array(raster.rgba),output=new Uint8Array(width*height*4)
        for(let row=0;row<height;row++){
            const offset=((row+y-top)*raster.width+x-left)*4
            output.set(source.subarray(offset,offset+width*4),row*width*4)
        }
        return {width,height,rgba:output.buffer}
    }
    private raster(index: number, {x,y,width,height,pageWidth,pageHeight}: PDFTile): Raster {
        return this.withPage(index,page=>this.rasterPage(page,{x,y,width,height,pageWidth,pageHeight}))
    }
    private rasterPage(page:number,{x,y,width,height,pageWidth,pageHeight}:PDFTile):Raster {
        const bitmap = this.api.FPDFBitmap_Create(width, height, 1)
        if (!bitmap) throw new PDFEngineError('pdf_memory_limit', 'Unable to allocate PDF bitmap.')
        try {
            this.api.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff)
            this.api.FPDF_RenderPageBitmap(bitmap, page, -x, -y, pageWidth, pageHeight, 0, 1)
            const pointer = this.api.FPDFBitmap_GetBuffer(bitmap), stride = this.api.FPDFBitmap_GetStride(bitmap), heap = this.heap()
            const rgba = new Uint8Array(width * height * 4)
            for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
                const input = pointer + row * stride + col * 4, output = (row * width + col) * 4
                rgba[output] = heap[input + 2]; rgba[output + 1] = heap[input + 1]; rgba[output + 2] = heap[input]; rgba[output + 3] = heap[input + 3]
            }
            return {width, height, rgba: rgba.buffer}
        } finally { this.api.FPDFBitmap_Destroy(bitmap) }
    }
    private utf16(size: number, read: (pointer: number, size: number) => number, maxBytes = 2 * 1024 * 1024): string {
        if (size <= 2) return ''
        if (size > maxBytes) throw new PDFEngineError('pdf_text_limit', 'PDF text exceeds the limit.')
        const pointer = this.allocate(size)
        try { const used = read(pointer, size); return new TextDecoder('utf-16le').decode(this.heap().slice(pointer, pointer + Math.min(size, Math.max(0, used - 2)))) }
        finally { this.free(pointer) }
    }
    private rect(page: number, left: number, bottom: number, right: number, top: number, scratch?: number): {x: number; y: number; width: number; height: number} {
        const pointer = scratch ?? this.allocate(8)
        try {
            const point = (x: number, y: number): [number, number] => {
                this.api.FPDF_PageToDevice(page, 0, 0, 100000, 100000, 0, x, y, pointer, pointer + 4)
                return [this.api.pdfium.getValue(pointer, 'i32') / 100000, this.api.pdfium.getValue(pointer + 4, 'i32') / 100000]
            }
            const a = point(left, bottom), b = point(right, top)
            return {x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1])}
        } finally { if (!scratch) this.free(pointer) }
    }
    text(index: number, geometry: boolean): PageText {
        return this.withPage(index, page => {
            const textPage = this.api.FPDFText_LoadPage(page)
            if (!textPage) return {text: '', glyphs: [], truncated: false}
            let scratch = 0
            try {
                const count = this.api.FPDFText_CountChars(textPage)
                if (count > 500000) throw new PDFEngineError('pdf_text_limit', 'PDF text exceeds the limit.')
                const text = this.utf16((count + 1) * 2, pointer => this.api.FPDFText_GetText(textPage, 0, count, pointer) * 2)
                const glyphs: PageText['glyphs'] = []
                if (geometry) {
                    scratch = this.allocate(56)
                    for (let i = 0; i < Math.min(count, 20000); i++) {
                        const unicode = this.api.FPDFText_GetUnicode(textPage, i)
                        if (unicode < 32 || unicode > 0x10ffff || !this.api.FPDFText_GetCharBox(textPage, i, scratch, scratch + 8, scratch + 16, scratch + 24)) continue
                        const left = this.api.pdfium.getValue(scratch, 'double'), right = this.api.pdfium.getValue(scratch + 8, 'double'), bottom = this.api.pdfium.getValue(scratch + 16, 'double'), top = this.api.pdfium.getValue(scratch + 24, 'double')
                        const tight=this.rect(page,left,bottom,right,top,scratch+48)
                        let selection=tight
                        if(this.api.FPDFText_GetLooseCharBox(textPage,i,scratch+32)){
                            const read=(offset:number)=>this.api.pdfium.getValue(scratch+32+offset,'float')
                            selection=this.rect(page,read(0),read(12),read(8),read(4),scratch+48)
                        }
                        glyphs.push({index:i,text:String.fromCodePoint(unicode),...tight,selection,fontSize:this.api.FPDFText_GetFontSize(textPage,i)})
                    }
                }
                return {text, glyphs, truncated: geometry && count > 20000}
            } finally { this.free(scratch); this.api.FPDFText_ClosePage(textPage) }
        })
    }
    search(index: number, query: string, matchCase: boolean, wholeWord: boolean, limit: number): SearchHit[] {
        if (typeof query !== 'string' || query.length < 1 || query.length > 512 || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new PDFEngineError('pdf_search_invalid', 'Invalid PDF search.')
        return this.withPage(index, page => {
            const textPage = this.api.FPDFText_LoadPage(page)
            if (!textPage) return []
            let queryPointer = 0, scratch = 0, search = 0
            try {
                queryPointer = this.allocate((query.length + 1) * 2); this.api.pdfium.stringToUTF16(query, queryPointer, (query.length + 1) * 2)
                search = this.api.FPDFText_FindStart(textPage, queryPointer, (matchCase ? 1 : 0) | (wholeWord ? 2 : 0), 0)
                if (!search) return []
                scratch = this.allocate(56)
                const hits: SearchHit[] = []
                while (hits.length < limit && this.api.FPDFText_FindNext(search)) {
                    const start = this.api.FPDFText_GetSchResultIndex(search), length = this.api.FPDFText_GetSchCount(search), rectangles: SearchHit['rectangles'] = []
                    const count = Math.min(this.api.FPDFText_CountRects(textPage, start, length), 1024)
                    for (let i = 0; i < count; i++) {
                        if (this.api.FPDFText_GetRect(textPage, i, scratch, scratch + 8, scratch + 16, scratch + 24)) rectangles.push(this.rect(page, this.api.pdfium.getValue(scratch, 'double'), this.api.pdfium.getValue(scratch + 24, 'double'), this.api.pdfium.getValue(scratch + 16, 'double'), this.api.pdfium.getValue(scratch + 8, 'double'), scratch + 32))
                    }
                    hits.push({pageIndex: index, start, length, rectangles})
                }
                return hits
            } finally { if (search) this.api.FPDFText_FindClose(search); this.free(queryPointer); this.free(scratch); this.api.FPDFText_ClosePage(textPage) }
        })
    }
    metadata(): PDFMetadata {
        const read = (key: string): string => this.utf16(this.api.FPDF_GetMetaText(this.document, key, 0, 0), (p, n) => this.api.FPDF_GetMetaText(this.document, key, p, n))
        return {title: read('Title'), author: read('Author'), subject: read('Subject'), creator: read('Creator'), producer: read('Producer'), pageCount: this.pageCount, permissions: this.api.FPDF_GetDocPermissions(this.document) >>> 0}
    }
    outline(): OutlineItem[] {
        let remaining = 1000
        const visited = new Set<number>()
        const walk = (parent: number, depth: number): OutlineItem[] => {
            if (depth > 32) return []
            const items: OutlineItem[] = []
            let item = this.api.FPDFBookmark_GetFirstChild(this.document, parent)
            while (item && remaining-- > 0 && !visited.has(item)) {
                visited.add(item)
                const title = this.utf16(this.api.FPDFBookmark_GetTitle(item, 0, 0), (p, n) => this.api.FPDFBookmark_GetTitle(item, p, n), 8192)
                const destination = this.api.FPDFBookmark_GetDest(this.document, item)
                const pageIndex = destination ? this.api.FPDFDest_GetDestPageIndex(this.document, destination) : -1
                items.push({title, pageIndex: pageIndex >= 0 && pageIndex < this.pageCount ? pageIndex : null, children: walk(item, depth + 1)})
                item = this.api.FPDFBookmark_GetNextSibling(this.document, item)
            }
            return items
        }
        return walk(0, 0)
    }
    links(index: number): PDFLink[] {
        return this.withPage(index, page => {
            const scratch = this.allocate(32), links: PDFLink[] = []
            let scanned = 0
            try {
                this.api.pdfium.setValue(scratch, 0, 'i32')
                while (scanned++ < 2000 && this.api.FPDFLink_Enumerate(page, scratch, scratch + 4)) {
                    const link = this.api.pdfium.getValue(scratch + 4, 'i32')
                    if (!this.api.FPDFLink_GetAnnotRect(link, scratch + 8)) continue
                    const value = (offset: number): number => this.api.pdfium.getValue(scratch + offset, 'float')
                    const rect = this.rect(page, value(8), value(12), value(16), value(20), scratch + 24), destination = this.api.FPDFLink_GetDest(this.document, link)
                    if (destination) {
                        const pageIndex = this.api.FPDFDest_GetDestPageIndex(this.document, destination)
                        if (pageIndex >= 0 && pageIndex < this.pageCount) links.push({...rect, pageIndex})
                    } else {
                        const action = this.api.FPDFLink_GetAction(link)
                        if (!action || this.api.FPDFAction_GetType(action) !== 3) continue
                        const size = this.api.FPDFAction_GetURIPath(this.document, action, 0, 0)
                        if (size < 2 || size > 4096) continue
                        const pointer = this.allocate(size)
                        try {
                            this.api.FPDFAction_GetURIPath(this.document, action, pointer, size)
                            const url = new TextDecoder().decode(this.heap().slice(pointer, pointer + size - 1))
                            if (/^(https?:|mailto:)/i.test(url)) links.push({...rect, url})
                        } finally { this.free(pointer) }
                    }
                }
                return links
            } finally { this.free(scratch) }
        })
    }
    get canEditPages(): boolean {
        return this.api.FPDF_GetSecurityHandlerRevision(this.document) === -1
            && this.api.FPDF_GetSignatureCount(this.document) === 0
    }

    getBytes(): ArrayBuffer {
        return this.heap().slice(this.bytes, this.bytes + this.byteLength).buffer as ArrayBuffer
    }

    textBlocks(index: number): PDFTextBlock[] {
        return this.withPage(index, page => this.readTextBlocks(page))
    }

    private readTextBlocks(page: number,wanted?:ReadonlySet<number>): PDFTextBlock[] {
        const api = this.api, textPage = api.FPDFText_LoadPage(page)
        if (!textPage) return []
        let scratch = 0
        try {
            scratch = this.allocate(256)
            const count = Math.min(api.FPDFPage_CountObjects(page), 10000), blocks: PDFTextBlock[] = []
            const fontNames = new Map<number,string>()
            for (let index = 0; index < count && blocks.length < 1000; index++) {
                if(wanted&&!wanted.has(index))continue
                const object = api.FPDFPage_GetObject(page, index)
                if (!object || api.FPDFPageObj_GetType(object) !== 1 || api.FPDFTextObj_GetTextRenderMode(object) !== 0) continue
                const text = this.objectText(object,textPage)
                if (!text.trim() || /[\u0000-\u001f\u007f]/u.test(text)) continue
                const bounds = this.textBounds(page,object,scratch)
                if (!bounds) continue
                const fontHandle=api.FPDFTextObj_GetFont(object)
                if(!fontNames.has(fontHandle)){
                    const length=fontHandle?api.FPDFFont_GetBaseFontName(fontHandle,scratch,256):0
                    fontNames.set(fontHandle,length>1&&length<=256?new TextDecoder().decode(this.heap().subarray(scratch,scratch+length-1)).replace(/^[A-Z]{6}\+/,''):'')
                }
                const font=fontNames.get(fontHandle)!
                let size=api.FPDFTextObj_GetFontSize(object,scratch)?api.pdfium.getValue(scratch,'float'):undefined,baseline:number|undefined,rotation:number|undefined
                if(api.FPDFPageObj_GetMatrix(object,scratch)){
                    const [a,b,c,d,e,f]=[0,4,8,12,16,20].map(offset=>api.pdfium.getValue(scratch+offset,'float'))
                    if(size!==undefined)size*=Math.hypot(c,d)
                    rotation=Math.atan2(-b,a)+api.FPDFPage_GetRotation(page)*Math.PI/2
                    if(api.FPDF_PageToDevice(page,0,0,100000,100000,0,e,f,scratch+24,scratch+28))baseline=api.pdfium.getValue(scratch+28,'i32')/100000
                }
                const color=api.FPDFPageObj_GetFillColor(object,scratch,scratch+4,scratch+8,scratch+12)
                    ?'#'+[0,4,8].map(offset=>api.pdfium.getValue(scratch+offset,'i32').toString(16).padStart(2,'0')).join(''):undefined
                const appearance={
                    size,color,bold:/bold|demi|black/i.test(font)||!!fontHandle&&api.FPDFFont_GetWeight(fontHandle)>=650,
                    italic:/italic|oblique/i.test(font)||!!fontHandle&&api.FPDFFont_GetItalicAngle(fontHandle,scratch)&&api.pdfium.getValue(scratch,'i32')!==0,
                }
                blocks.push({index,text,...bounds,font,appearance,baseline,rotation})
            }
            const runs=new Map(blocks.map(block=>[api.FPDFPage_GetObject(page,block.index),{text:block.text,offset:0,characters:[] as PDFTextCharacter[]}]))
            this.readObjectCharacters(page,textPage,runs)
            return blocks.map(block=>({...block,characters:runs.get(api.FPDFPage_GetObject(page,block.index))!.characters}))
        } finally {this.free(scratch);api.FPDFText_ClosePage(textPage)}
    }

    private readObjectCharacters(page:number,textPage:number,runs:ReadonlyMap<number,{text:string;offset:number;characters:PDFTextCharacter[]}>):void {
        const api=this.api,scratch=this.allocate(72),offsets=new Map<number,number>()
        try{
            for(let index=0;index<Math.min(api.FPDFText_CountChars(textPage),20000);index++){
                const object=api.FPDFText_GetTextObject(textPage,index),run=runs.get(object)
                if(!run)continue
                const code=api.FPDFText_GetUnicode(textPage,index)
                if(code<32||code>0x10ffff)continue
                let value=String.fromCodePoint(code),start=run.text.indexOf(value,offsets.get(object)??0)
                if(start<0){value=value.normalize('NFKC');start=run.text.indexOf(value,offsets.get(object)??0)}
                if(start<0||!api.FPDFText_GetCharBox(textPage,index,scratch,scratch+8,scratch+16,scratch+24))continue
                const [left,right,bottom,top]=[0,8,16,24].map(offset=>api.pdfium.getValue(scratch+offset,'double'))
                let box=this.rect(page,left,bottom,right,top,scratch+48)
                if(api.FPDFText_GetLooseCharBox(textPage,index,scratch+32)){
                    const read=(offset:number)=>api.pdfium.getValue(scratch+32+offset,'float')
                    box=this.rect(page,read(0),read(12),read(8),read(4),scratch+48)
                }
                let x=box.x,baseline=box.y+box.height
                if(api.FPDFText_GetCharOrigin(textPage,index,scratch+56,scratch+64)
                    &&api.FPDF_PageToDevice(page,0,0,100000,100000,0,api.pdfium.getValue(scratch+56,'double'),api.pdfium.getValue(scratch+64,'double'),scratch+48,scratch+52)){
                    x=api.pdfium.getValue(scratch+48,'i32')/100000;baseline=api.pdfium.getValue(scratch+52,'i32')/100000
                }
                run.characters.push({start:run.offset+start,end:run.offset+start+value.length,...box,x,endX:box.x+box.width,baseline})
                offsets.set(object,start+value.length)
            }
            for(const characters of new Set([...runs.values()].map(run=>run.characters)))characters.sort((a,b)=>a.start-b.start)
        }finally{this.free(scratch)}
    }

    private objectText(object:number,textPage:number):string {
        const api=this.api,length=api.FPDFTextObj_GetText(object,textPage,0,0)
        return length>2&&length<=1026?this.utf16(length,(pointer,size)=>api.FPDFTextObj_GetText(object,textPage,pointer,size)):''
    }

    private textBounds(page:number,object:number,scratch:number):{x:number;y:number;width:number;height:number}|undefined {
        const api=this.api
        if(!api.FPDFPageObj_GetBounds(object,scratch,scratch+4,scratch+8,scratch+12))return
        const [left,bottom,right,top]=[0,4,8,12].map(offset=>api.pdfium.getValue(scratch+offset,'float'))
        const bounds=this.rect(page,left,bottom,right,top,scratch+16)
        if(bounds.width>0&&bounds.height>0&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=1.00001&&bounds.y+bounds.height<=1.00001)return bounds
    }

    private writeTextObject(object:number,text:string,style?:PDFTextAppearance):void {
        const api=this.api,pointer=this.allocate((text.length+1)*2)
        try{
            for(let i=0;i<=text.length;i++)api.pdfium.setValue(pointer+i*2,i===text.length?0:text.charCodeAt(i),'i16')
            if(!api.FPDFText_SetText(object,pointer))throw new PDFEngineError('pdf_text_edit_font','The font cannot encode the replacement.')
        }finally{this.free(pointer)}
        if(style?.color){
            const channels=[1,3,5].map(offset=>parseInt(style.color!.slice(offset,offset+2),16))
            if(!api.FPDFPageObj_SetFillColor(object,channels[0],channels[1],channels[2],255))throw new PDFEngineError('pdf_text_edit_failed','Cannot update the text color.')
        }
    }

    private insertTextObject(document:number,page:number,edit:Exclude<PDFTextEdit,{remove:true}>,original?:{object:number;block:PDFTextBlock},fontSource?:{object:number;block:PDFTextBlock}):number {
        const api=this.api,appearance=edit.appearance
        const source=original??fontSource
        const fallback=/times|serif/i.test(source?.block.font??'')?'serif':/courier|mono/i.test(source?.block.font??'')?'mono':'sans'
        const font=pdfStandardFont(appearance?.family??fallback,appearance?.bold??source?.block.appearance.bold??false,appearance?.italic??source?.block.appearance.italic??false)
        let size=appearance?.size??source?.block.appearance.size??12
        const borrowed=fontSource&&appearance?.family===undefined&&appearance?.bold===undefined&&appearance?.italic===undefined
            ?api.FPDFTextObj_GetFont(fontSource.object):0
        let object=0,scratch=0
        try{
            scratch=this.allocate(32)
            if(source&&(original||'flow' in edit&&edit.flow)&&source.block.appearance.size&&api.FPDFTextObj_GetFontSize(source.object,scratch))size*=api.pdfium.getValue(scratch,'float')/source.block.appearance.size
            object=borrowed?api.FPDFPageObj_CreateTextObj(document,borrowed,size):api.FPDFPageObj_NewTextObj(document,font,size)
            if(!object)throw new PDFEngineError('pdf_text_edit_font','Cannot open the selected font.')
            this.writeTextObject(object,edit.text,{...appearance,color:appearance?.color??source?.block.appearance.color})
            if(original){
                if(!api.FPDFPageObj_GetMatrix(original.object,scratch)||!api.FPDFPageObj_SetMatrix(object,scratch))throw new PDFEngineError('pdf_text_edit_failed','Cannot preserve the text position.')
                let index=0
                for(;index<api.FPDFPage_CountObjects(page)&&api.FPDFPage_GetObject(page,index)!==original.object;index++){}
                if(!api.FPDFPage_InsertObjectAtIndex(page,object,index))throw new PDFEngineError('pdf_text_edit_failed','Cannot insert replacement text.')
            }else if('position' in edit&&edit.flow&&fontSource){
                if(!api.FPDFPageObj_GetMatrix(fontSource.object,scratch))throw new PDFEngineError('pdf_text_edit_failed','Cannot preserve the paragraph transform.')
                const matrix=[0,4,8,12,16,20].map(offset=>api.pdfium.getValue(scratch+offset,'float'))
                const point=(x:number,y:number)=>{
                    if(!api.FPDF_DeviceToPage(page,0,0,100000,100000,0,Math.round(x*100000),Math.round(y*100000),scratch,scratch+8))throw new PDFEngineError('pdf_text_edit_bounds','Cannot map the paragraph position.')
                    return [api.pdfium.getValue(scratch,'double'),api.pdfium.getValue(scratch+8,'double')]
                }
                const origin=point(fontSource.block.x,fontSource.block.y),target=point(...edit.position)
                matrix[4]+=target[0]-origin[0];matrix[5]+=target[1]-origin[1]
                matrix.forEach((value,index)=>api.pdfium.setValue(scratch+index*4,value,'float'))
                if(!api.FPDFPageObj_SetMatrix(object,scratch))throw new PDFEngineError('pdf_text_edit_failed','Cannot position the paragraph.')
                api.FPDFPage_InsertObject(page,object)
            }else if('position' in edit){
                const [x,y]=edit.position,baseline=y+size/api.FPDF_GetPageHeight(page)
                const point=(u:number,v:number)=>{
                    if(!api.FPDF_DeviceToPage(page,0,0,100000,100000,0,Math.round(u*100000),Math.round(v*100000),scratch,scratch+8))throw new PDFEngineError('pdf_text_edit_bounds','Cannot map the insertion point.')
                    return [api.pdfium.getValue(scratch,'double'),api.pdfium.getValue(scratch+8,'double')]
                }
                const [left,bottom]=point(x,baseline),[right,top]=point(x+.01,baseline)
                const distance=Math.hypot(right-left,top-bottom),a=(right-left)/distance,b=(top-bottom)/distance
                api.FPDFPageObj_Transform(object,a,b,-b,a,left,bottom)
                api.FPDFPage_InsertObject(page,object)
            }
            const inserted=object
            object=0
            return inserted
        }finally{if(object)api.FPDFPageObj_Destroy(object);this.free(scratch)}
    }

    private insertFlowingText(document:number,page:number,edit:Extract<PDFTextEdit,{position:unknown}>,source?:{object:number;block:PDFTextBlock}) {
        const api=this.api,flow=edit.flow!,scratch=this.allocate(32)
        const objects:Array<{object:number;text:string;start:number}>=[]
        let probe=0
        try{
            probe=this.insertTextObject(document,page,{...edit,text:'M'},undefined,source)
            const measure=(value:string)=>{
                this.writeTextObject(probe,value)
                if(!api.FPDFPageObj_GetBounds(probe,scratch,scratch+4,scratch+8,scratch+12))throw new PDFEngineError('pdf_text_edit_bounds','Cannot measure the paragraph.')
                const [left,bottom,right,top]=[0,4,8,12].map(offset=>api.pdfium.getValue(scratch+offset,'float'))
                return this.rect(page,left,bottom,right,top,scratch+16).width
            }
            const lines:Array<{text:string;start:number}>=[]
            let paragraphOffset=0
            for(const paragraph of edit.text.split('\n')){
                if(!paragraph.trim()){lines.push({text:'',start:paragraphOffset});paragraphOffset+=paragraph.length+1;continue}
                const graphemes=Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(paragraph),part=>part.segment)
                const offsets=[0]
                for(const part of graphemes)offsets.push(offsets.at(-1)!+part.length)
                let offset=0
                while(offset<graphemes.length){
                    let low=1,high=Math.min(512,graphemes.length-offset),count=0
                    while(low<=high){
                        const middle=Math.floor((low+high)/2),value=graphemes.slice(offset,offset+middle).join('')
                        if(value.length<=512&&measure(value)<=flow.width+.00002){count=middle;low=middle+1}else high=middle-1
                    }
                    if(!count)throw new PDFEngineError('pdf_text_edit_bounds','The paragraph is narrower than one character.')
                    if(offset+count<graphemes.length){
                        let wordEnd=count
                        while(wordEnd>0&&!/\s/u.test(graphemes[offset+wordEnd-1]))wordEnd--
                        if(wordEnd>0)count=wordEnd
                    }
                    const line=graphemes.slice(offset,offset+count).join('').trimEnd()
                    if(line)lines.push({text:line,start:paragraphOffset+offsets[offset]})
                    offset+=count
                    while(offset<graphemes.length&&/\s/u.test(graphemes[offset]))offset++
                    if(lines.length>512)throw new PDFEngineError('pdf_text_limit','The paragraph has too many lines.')
                }
                paragraphOffset+=paragraph.length+1
            }
            if(!api.FPDFPage_RemoveObject(page,probe))throw new PDFEngineError('pdf_text_edit_failed','Cannot release the measurement object.')
            api.FPDFPageObj_Destroy(probe);probe=0
            lines.forEach((line,index)=>{
                if(!line.text)return
                const position:readonly [number,number]=[edit.position[0],edit.position[1]+index*flow.lineHeight]
                if(position[1]>=1)throw new PDFEngineError('pdf_text_edit_bounds','The paragraph extends beyond the page.')
                objects.push({object:this.insertTextObject(document,page,{...edit,position,text:line.text},undefined,source),text:line.text,start:line.start})
            })
            const bottom=Math.max(edit.position[1],...objects.map(({object})=>{
                const box=this.textBounds(page,object,scratch)
                return box?box.y+box.height:edit.position[1]
            }))
            const layout:PDFTextFlowLayout={fontSource:edit.fontSource,position:edit.position,width:flow.width,height:Math.max(flow.lineHeight,lines.length*flow.lineHeight,bottom-edit.position[1]),characters:[]}
            for(const [index,line]of lines.entries())if(!line.text)layout.characters.push({start:line.start,end:line.start,x:edit.position[0],endX:edit.position[0],y:edit.position[1]+index*flow.lineHeight,width:0,height:flow.lineHeight,baseline:edit.position[1]+(index+1)*flow.lineHeight})
            return {objects,layout}
        }finally{
            if(probe&&api.FPDFPage_RemoveObject(page,probe))api.FPDFPageObj_Destroy(probe)
            this.free(scratch)
        }
    }

    editText(edits: readonly PDFTextEdit[], maxBytes: number): ArrayBuffer {
        validatePDFTextEdits(edits, this.pageCount)
        if (!this.canEditPages) throw new PDFEngineError('pdf_edit_protected', 'This PDF cannot be edited.')
        const api = this.api, output = api.FPDF_LoadMemDocument(this.bytes,this.byteLength,'')
        if (!output) throw new PDFEngineError('pdf_text_edit_failed', 'Cannot open a PDF working copy.')
        try {
            const byPage = new Map<number,PDFTextEdit[]>()
            for (const edit of edits) {
                const pageEdits = byPage.get(edit.pageIndex) ?? []
                pageEdits.push(edit)
                byPage.set(edit.pageIndex,pageEdits)
            }
            for (const [index, changes] of byPage) {
                const page = api.FPDF_LoadPage(output,index)
                if (!page) throw new PDFEngineError('pdf_page_failed', 'Cannot open the edit page.')
                try{
                    this.modifyTextPage(output,page,changes,true)
                    if(!api.FPDFPage_GenerateContent(page))throw new PDFEngineError('pdf_text_edit_failed','Cannot save edited text.')
                }finally{api.FPDF_ClosePage(page)}
            }
            return this.writePDF(output,maxBytes)
        } finally {api.FPDF_CloseDocument(output)}
    }

    private modifyTextPage(output:number,page:number,changes:readonly PDFTextEdit[],strict:boolean){
        const api=this.api
        let scratch=0
        try{
            scratch=this.allocate(32)
            const wanted=new Set(changes.flatMap(edit=>'index' in edit?[edit.index]:edit.fontSource===undefined?[]:[edit.fontSource]))
            const blocks=new Map(this.readTextBlocks(page,strict?undefined:wanted).map(block=>[block.index,block]))
            const affected=[...blocks.values()].filter(block=>changes.some(edit=>'index' in edit&&edit.index===block.index)).map(({x,y,width,height})=>({x,y,width,height}))
            const targets=changes.map(edit=>{
                if('position' in edit){
                    if(edit.fontSource===undefined)return {edit}
                    const block=blocks.get(edit.fontSource)
                    if(!block)throw new PDFEngineError('pdf_text_edit_font','Cannot locate the original font.')
                    return {edit,fontSource:{block,object:api.FPDFPage_GetObject(page,edit.fontSource)}}
                }
                const block=blocks.get(edit.index)
                if(!block||block.text!==edit.original)throw new PDFEngineError('pdf_text_edit_stale','The text block has changed.')
                return {edit,original:{block,object:api.FPDFPage_GetObject(page,edit.index)}}
            })
            const verify=new Map<number,{text:string;original?:PDFTextBlock}>(),layouts:PDFTextFlowLayout[]=[]
            const textRuns=new Map<number,{text:string;offset:number;characters:PDFTextCharacter[]}>()
            const flowing=new Set<PDFTextEdit>()
            const remove=(object:number)=>{
                if(!api.FPDFPage_RemoveObject(page,object))throw new PDFEngineError('pdf_text_edit_failed','Cannot remove text.')
                api.FPDFPageObj_Destroy(object)
            }
            // Acquire the source font before the corresponding original object can be replaced or removed.
            for(const {edit,fontSource} of targets){
                if('position' in edit&&edit.flow){
                    const result=this.insertFlowingText(output,page,edit,fontSource)
                    for(const item of result.objects){
                        verify.set(item.object,{text:item.text})
                        textRuns.set(item.object,{text:item.text,offset:item.start,characters:result.layout.characters})
                    }
                    layouts.push(result.layout);flowing.add(edit);continue
                }
                if(fontSource&&'position' in edit)verify.set(this.insertTextObject(output,page,edit,undefined,fontSource),{text:edit.text})
            }
            for(const {edit,original,fontSource} of targets){
                if(fontSource||flowing.has(edit))continue
                if('remove' in edit){remove(original!.object);continue}
                const style=edit.appearance
                let object:number
                if(!original||style?.family!==undefined||style?.bold!==undefined||style?.italic!==undefined){
                    object=this.insertTextObject(output,page,edit,original)
                    if(original)remove(original.object)
                }else{
                    object=original.object
                    this.writeTextObject(object,edit.text,style)
                    if(style?.size!==undefined&&original.block.appearance.size){
                        if(!api.FPDFPageObj_GetMatrix(object,scratch))throw new PDFEngineError('pdf_text_edit_failed','Cannot read the original text transform.')
                        const scale=style.size/original.block.appearance.size
                        for(const offset of [0,4,8,12])api.pdfium.setValue(scratch+offset,api.pdfium.getValue(scratch+offset,'float')*scale,'float')
                        if(!api.FPDFPageObj_SetMatrix(object,scratch))throw new PDFEngineError('pdf_text_edit_failed','Cannot resize the text.')
                    }
                }
                verify.set(object,{text:edit.text,original:original?.block})
            }
            const textPage=api.FPDFText_LoadPage(page)
            if(!textPage)throw new PDFEngineError('pdf_text_edit_failed','Cannot check the edited text.')
            try{
                this.readObjectCharacters(page,textPage,textRuns)
                const overlap=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>
                    Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>.001&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>.001
                const changedIndices=new Set(targets.flatMap(target=>target.original?[target.original.block.index]:[]))
                const unchanged=[...blocks.values()].filter(block=>!changedIndices.has(block.index))
                for(const [object,{text,original}] of verify){
                    const bounds=this.textBounds(page,object,scratch)
                    if(this.objectText(object,textPage)!==text)throw new PDFEngineError('pdf_text_edit_font','The font cannot encode all characters.')
                    if(bounds)affected.push(bounds)
                    if(!bounds||strict&&unchanged.some(block=>overlap(bounds,block)&&(!original||!overlap(original,block))))throw new PDFEngineError('pdf_text_edit_bounds','The new text is outside the page or overlaps other text.')
                }
            }finally{api.FPDFText_ClosePage(textPage)}
            return {affected,layouts}
        }finally{this.free(scratch)}
    }

    previewText(index:number,edits:readonly PDFTextEdit[],width:number,height:number):PDFTextPreview {
        validatePDFTextEdits(edits,this.pageCount)
        if(!Number.isSafeInteger(index)||index<0||index>=this.pageCount||edits.some(edit=>edit.pageIndex!==index)
            ||![width,height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=2048)||width*height>3145728)throw new RangeError('Invalid text preview')
        if(!this.canEditPages)throw new PDFEngineError('pdf_edit_protected','This PDF cannot be edited.')
        const api=this.api,copy=api.FPDF_LoadMemDocument(this.bytes,this.byteLength,'')
        if(!copy)throw new PDFEngineError('pdf_text_edit_failed','Cannot open a PDF preview.')
        try{
            const page=api.FPDF_LoadPage(copy,index)
            if(!page)throw new PDFEngineError('pdf_page_failed','Cannot open the preview page.')
            try{
                const {affected,layouts}=this.modifyTextPage(copy,page,edits,false)
                const x=Math.max(0,Math.floor(Math.min(...affected.map(box=>box.x))*width)-4)
                const y=Math.max(0,Math.floor(Math.min(...affected.map(box=>box.y))*height)-4)
                const right=Math.min(width,Math.ceil(Math.max(...affected.map(box=>box.x+box.width))*width)+4)
                const bottom=Math.min(height,Math.ceil(Math.max(...affected.map(box=>box.y+box.height))*height)+4)
                if(!(right>x&&bottom>y))throw new PDFEngineError('pdf_text_edit_bounds','Invalid preview area.')
                const tile={x,y,width:right-x,height:bottom-y,pageWidth:width,pageHeight:height}
                return {...this.rasterPageWithOverlap(page,tile),x:x/width,y:y/height,fractionWidth:tile.width/width,fractionHeight:tile.height/height,layouts}
            }finally{api.FPDF_ClosePage(page)}
        }finally{api.FPDF_CloseDocument(copy)}
    }

    cropPages(crops: readonly PDFCrop[], maxBytes: number): ArrayBuffer {
        validatePDFCrops(crops, this.pageCount)
        if (!this.canEditPages) throw new PDFEngineError('pdf_edit_protected', 'Signed or encrypted PDFs cannot be cropped.')
        const api = this.api, output = api.FPDF_LoadMemDocument(this.bytes, this.byteLength, '')
        if (!output) throw new PDFEngineError('pdf_crop_failed', 'Cannot open a PDF working copy.')
        let scratch = 0
        try {
            scratch = this.allocate(16)
            for (const {pageIndex, box: [x,y,w,h]} of crops) {
                const page = api.FPDF_LoadPage(output, pageIndex)
                if (!page) throw new PDFEngineError('pdf_page_failed', 'Cannot open the crop page.')
                try {
                    const point = (u: number, v: number) => {
                        if (!api.FPDF_DeviceToPage(page, 0, 0, 100000, 100000, 0, Math.round(u*100000), Math.round(v*100000), scratch, scratch+8)) throw new PDFEngineError('pdf_crop_failed', 'Cannot map the crop box.')
                        return [api.pdfium.getValue(scratch, 'double'), api.pdfium.getValue(scratch+8, 'double')]
                    }
                    const [a,b] = point(x,y), [c,d] = point(x+w,y+h)
                    api.FPDFPage_SetCropBox(page, Math.min(a,c), Math.min(b,d), Math.max(a,c), Math.max(b,d))
                } finally {api.FPDF_ClosePage(page)}
            }
            return this.writePDF(output,maxBytes)
        } finally {this.free(scratch);api.FPDF_CloseDocument(output)}
    }

    applyRedactions(redactions:readonly PDFRedaction[],maxBytes:number,fontBytes?:Uint8Array):ArrayBuffer{
        validatePDFRedactions(redactions,this.pageCount)
        if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>104857600)throw new RangeError('Invalid output byte budget')
        if(fontBytes&&(!(fontBytes instanceof Uint8Array)||fontBytes.byteLength<1||fontBytes.byteLength>2097152))throw new RangeError('Invalid redaction font')
        if(!this.canEditPages)throw new PDFEngineError('pdf_edit_protected','Signed or encrypted PDFs cannot be redacted.')
        const api=this.api,output=api.FPDF_LoadMemDocument(this.bytes,this.byteLength,'')
        if(!output)throw new PDFEngineError('pdf_redaction_failed','Cannot open a PDF working copy.')
        const rgb=(color:string)=>[1,3,5].map(offset=>parseInt(color.slice(offset,offset+2),16))
        let font=0,fontMemory=0,painted=0
        const byPage=new Map<number,PDFRedaction[]>()
        for(const redact of redactions){if(!byPage.has(redact.pageIndex))byPage.set(redact.pageIndex,[]);byPage.get(redact.pageIndex)!.push(redact)}
        try{
            if(redactions.some(item=>!!item.overlayText)&&fontBytes){
                fontMemory=this.allocate(fontBytes.length);this.heap().set(fontBytes,fontMemory)
                font=api.FPDFText_LoadFont(output,fontMemory,fontBytes.length,2,true)
                if(!font)throw new PDFEngineError('pdf_redaction_font','Cannot load the redaction overlay font.')
                const scratch=this.allocate(4)
                try{for(const item of redactions)for(const char of item.overlayText??'')if(!api.FPDFFont_GetGlyphWidth(font,char.codePointAt(0)!,12,scratch))throw new PDFEngineError('pdf_redaction_font','The overlay font does not support all requested characters.')}
                finally{this.free(scratch)}
            }
            if(!font&&redactions.some(item=>item.overlayText&&/[^\x20-\x7e]/.test(item.overlayText)))throw new PDFEngineError('pdf_redaction_font','Unicode overlay text requires a compatible font.')
            for(const [index,items] of byPage){
                const page=api.FPDF_LoadPage(output,index)
                if(!page)throw new PDFEngineError('pdf_page_failed','Cannot open redaction page.')
                const scratch=this.allocate(32)
                try{
                    const width=Math.ceil(api.FPDF_GetPageWidth(page)*100),height=Math.ceil(api.FPDF_GetPageHeight(page)*100)
                    const appearances:Array<{item:PDFRedaction;corners:[number,number][]}>=[]
                    for(const item of items)for(const [x,y,w,h] of item.rectangles){
                        const annot=api.FPDFPage_CreateAnnot(page,28)
                        if(!annot)throw new PDFEngineError('pdf_redaction_failed','Cannot create a native redaction.')
                        try{
                            const point=(u:number,v:number):[number,number]=>{
                                if(!api.FPDF_DeviceToPage(page,0,0,width,height,0,Math.round(u*width),Math.round(v*height),scratch,scratch+8))throw new Error('Invalid redaction transform')
                                return [api.pdfium.getValue(scratch,'double'),api.pdfium.getValue(scratch+8,'double')]
                            }
                            const corners=[point(x,y),point(x+w,y),point(x,y+h),point(x+w,y+h)]
                            appearances.push({item,corners})
                            const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1])
                            ;[Math.min(...xs),Math.max(...ys),Math.max(...xs),Math.min(...ys)].forEach((v,i)=>api.pdfium.setValue(scratch+i*4,v,'float'))
                            if(!api.FPDFAnnot_SetRect(annot,scratch))throw new Error('Cannot set redaction area')
                            const [r,g,b]=rgb(item.fill??'#000000')
                            if(!api.EPDFAnnot_SetColor(annot,1,r,g,b))throw new Error('Cannot set redaction fill')
                            if(item.opacity!==undefined&&!api.EPDFAnnot_SetOpacity(annot,Math.round(item.opacity*255)))throw new Error('Cannot set redaction opacity')
                        }finally{api.FPDFPage_CloseAnnot(annot)}
                    }
                    if(!api.EPDFPage_ApplyRedactions(page))throw new PDFEngineError('pdf_redaction_failed','Native PDF redaction failed.')
                    for(const {item,corners} of appearances){painted+=this.drawAppliedRedaction(output,page,item,corners,font);if(painted>8192)throw new PDFEngineError('pdf_redaction_limit','Redaction appearance exceeds the object budget.')}
                    if(!api.FPDFPage_GenerateContent(page))throw new PDFEngineError('pdf_redaction_failed','Cannot commit redacted PDF content.')
                }finally{this.free(scratch);api.FPDF_ClosePage(page)}
            }
            return this.writePDF(output,maxBytes)
        }finally{if(font)api.FPDFFont_Close(font);this.free(fontMemory);api.FPDF_CloseDocument(output)}
    }

    private drawAppliedRedaction(document:number,page:number,item:PDFRedaction,corners:[number,number][],font:number):number{
        const api=this.api,xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]),left=Math.min(...xs),bottom=Math.min(...ys)
        const rgb=(color:string)=>[1,3,5].map(offset=>parseInt(color.slice(offset,offset+2),16))
        const [r,g,b]=rgb(item.fill??'#000000'),alpha=Math.round((item.opacity??1)*255)
        let object=api.FPDFPageObj_CreateNewRect(left,bottom,Math.max(...xs)-left,Math.max(...ys)-bottom)
        if(!object)throw new Error('Cannot create redaction appearance')
        try{
            if(!api.FPDFPageObj_SetFillColor(object,r,g,b,alpha)||!api.FPDFPath_SetDrawMode(object,2,false))throw new Error('Cannot paint redaction fill')
            api.FPDFPage_InsertObject(page,object);object=0
        }finally{if(object)api.FPDFPageObj_Destroy(object)}
        if(!item.overlayText)return 1
        const base=corners[2],width=Math.hypot(corners[3][0]-base[0],corners[3][1]-base[1]),height=Math.hypot(corners[0][0]-base[0],corners[0][1]-base[1])
        const size=Math.max(1,Math.min(12,height*.65,(width-2)/Math.max(1,item.overlayText.length*.65)))
        const advance=Math.max(size,item.overlayText.length*size*.65),lineHeight=size*1.3
        const ux=(corners[3][0]-base[0])/width,uy=(corners[3][1]-base[1])/width,vx=(corners[0][0]-base[0])/height,vy=(corners[0][1]-base[1])/height
        const [tr,tg,tb]=rgb(item.overlayColor??'#ffffff'),label=this.allocate((item.overlayText.length+1)*2)
        let count=0
        try{
            for(let i=0;i<=item.overlayText.length;i++)api.pdfium.setValue(label+i*2,i===item.overlayText.length?0:item.overlayText.charCodeAt(i),'i16')
            for(let y=item.repeatOverlayText?size*.3:(height-size)/2;y+size<=height&&count<512;y+=lineHeight){
                for(let x=item.repeatOverlayText?1:Math.max(1,(width-advance)/2);x+advance<=width&&count<512;x+=advance+size){
                    let text=font?api.FPDFPageObj_CreateTextObj(document,font,size):api.FPDFPageObj_NewTextObj(document,'Helvetica',size)
                    if(!text)throw new Error('Cannot create replacement text')
                    try{
                        if(!api.FPDFText_SetText(text,label)||!api.FPDFPageObj_SetFillColor(text,tr,tg,tb,alpha))throw new Error('Cannot paint replacement text')
                        api.FPDFPageObj_Transform(text,ux,uy,vx,vy,base[0]+x*ux+y*vx,base[1]+x*uy+y*vy)
                        api.FPDFPage_InsertObject(page,text);text=0;count++
                    }finally{if(text)api.FPDFPageObj_Destroy(text)}
                    if(!item.repeatOverlayText)break
                }
                if(!item.repeatOverlayText)break
            }
        }finally{this.free(label)}
        return count+1
    }

    exportPDF(overlays: readonly PDFPageOverlay[], maxBytes: number): ArrayBuffer {
        if (!overlays.length) return this.getBytes()
        if (!this.canEditPages || overlays.length > this.pageCount) throw new PDFEngineError('pdf_edit_protected', 'The PDF cannot accept overlays.')
        const api = this.api
        const output = api.FPDF_LoadMemDocument(this.bytes, this.byteLength, '')
        if (!output) throw new Error('Unable to open PDF export')
        try {
            const seen = new Set<number>()
            let pixels = 0
            for (const overlay of overlays) {
                const {index, width, height, rgba} = overlay
                if (!Number.isInteger(index) || index < 0 || index >= this.pageCount || seen.has(index)
                    || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 2048 || height > 2048
                    || !(rgba instanceof ArrayBuffer) || rgba.byteLength !== width * height * 4 || (pixels += width * height) > 8388608) {
                    throw new PDFEngineError('pdf_render_limit', 'PDF overlays exceed their render budget.')
                }
                seen.add(index)
                this.embedOverlay(output, overlay)
            }
            return this.writePDF(output, maxBytes)
        } finally { api.FPDF_CloseDocument(output) }
    }

    private embedOverlay(document: number, {index, width, height, rgba}: PDFPageOverlay): void {
        const api = this.api
        const page = api.FPDF_LoadPage(document, index)
        if (!page) throw new Error('Unable to open overlay page')
        let buffer = 0, bitmap = 0, image = 0, scratch = 0
        try {
            buffer = this.allocate(rgba.byteLength)
            const heap = this.heap(), input = new Uint8Array(rgba)
            for (let i = 0; i < input.length; i += 4) {
                heap[buffer + i] = input[i + 2]
                heap[buffer + i + 1] = input[i + 1]
                heap[buffer + i + 2] = input[i]
                heap[buffer + i + 3] = input[i + 3]
            }
            bitmap = api.FPDFBitmap_CreateEx(width, height, 4, buffer, width * 4)
            image = api.FPDFPageObj_NewImageObj(document)
            if (!bitmap || !image || !api.FPDFImageObj_SetBitmap(0, 0, image, bitmap)) throw new Error('Unable to attach PDF overlay bitmap')
            scratch = this.allocate(16)
            const point = (x: number, y: number): [number, number] => {
                if (!api.FPDF_DeviceToPage(page, 0, 0, width, height, 0, x, y, scratch, scratch + 8)) throw new Error('Invalid overlay coordinates')
                return [api.pdfium.getValue(scratch, 'double'), api.pdfium.getValue(scratch + 8, 'double')]
            }
            const [x, y] = point(0, height), [right, bottom] = point(width, height), [left, top] = point(0, 0)
            if (!api.FPDFImageObj_SetMatrix(image, right - x, bottom - y, left - x, top - y, x, y)) throw new Error('Unable to position PDF overlay')
            api.FPDFPage_InsertObject(page, image)
            image = 0
            if (!api.FPDFPage_GenerateContent(page)) throw new Error('Unable to generate PDF page')
        } finally {
            if (image) api.FPDFPageObj_Destroy(image)
            if (bitmap) api.FPDFBitmap_Destroy(bitmap)
            this.free(buffer)
            this.free(scratch)
            api.FPDF_ClosePage(page)
        }
    }

    private writePDF(document: number, maxBytes: number): ArrayBuffer {
        const api = this.api, writer = api.PDFiumExt_OpenFileWriter()
        if (!writer) throw new Error('Unable to initialize PDF writer')
        let bytes = 0
        try {
            if (!api.FPDF_SaveAsCopy(document, writer, 2)) throw new Error('Unable to write edited PDF')
            const size = api.PDFiumExt_GetFileWriterSize(writer)
            if (size < 5 || size > maxBytes) throw new PDFEngineError('pdf_size_limit', 'Edited PDF exceeds its byte limit.')
            bytes = this.allocate(size)
            if (api.PDFiumExt_GetFileWriterData(writer, bytes, size) !== size) throw new Error('Unable to read edited PDF')
            return this.heap().slice(bytes, bytes + size).buffer as ArrayBuffer
        } finally {
            this.free(bytes)
            api.PDFiumExt_CloseFileWriter(writer)
        }
    }

    editPages(pages: readonly PDFPageEdit[], maxPages: number, maxBytes: number): ArrayBuffer {
        if (!this.canEditPages) throw new PDFEngineError('pdf_edit_protected', 'Signed or encrypted PDFs cannot be edited.')
        validatePagePlan(pages, this.pageCount, maxPages)
        const sourcePages = pages.flatMap(page => 'index' in page ? [page.index] : [])
        const retained = [...new Set(sourcePages)]
        if ((sourcePages.length - retained.length) * this.byteLength > 104857600) {
            throw new PDFEngineError('pdf_size_limit', 'PDF duplication exceeds the working memory budget.')
        }
        const api = this.api
        const output = api.FPDF_LoadMemDocument(this.bytes, this.byteLength, '')
        if (!output) throw new PDFEngineError('pdf_edit_failed', 'Unable to open a writable PDF copy.')
        let indices = 0
        try {
            if (retained.length > 0) {
                indices = this.allocate(retained.length * 4)
                retained.forEach((index, position) => api.pdfium.setValue(indices + position * 4, index, 'i32'))
                if (!api.FPDF_MovePages(output, indices, retained.length, 0)) throw new Error('Unable to reorder PDF pages')
                for (let index = this.pageCount - 1; index >= retained.length; index--) api.FPDFPage_Delete(output, index)
            }
            if (!indices) indices = this.allocate(4)
            const used = new Set<number>()
            pages.forEach((page, index) => {
                if (!('index' in page)) {
                    const blank = api.FPDFPage_New(output, index, page.width, page.height)
                    if (!blank) throw new Error('Unable to insert a blank page')
                    api.FPDF_ClosePage(blank)
                } else if (used.has(page.index)) {
                    api.pdfium.setValue(indices, page.index, 'i32')
                    if (!api.FPDF_ImportPagesByIndex(output, this.document, indices, 1, index)) throw new Error('Unable to duplicate a PDF page')
                } else {
                    used.add(page.index)
                }
                if (!page.rotation) return
                const handle = api.FPDF_LoadPage(output, index)
                if (!handle) throw new Error('Unable to rotate a PDF page')
                try { api.FPDFPage_SetRotation(handle, (api.FPDFPage_GetRotation(handle) + page.rotation) % 4) }
                finally { api.FPDF_ClosePage(handle) }
            })
            if (!retained.length) {
                for (let index = api.FPDF_GetPageCount(output) - 1; index >= pages.length; index--) api.FPDFPage_Delete(output, index)
            }
            if (api.FPDF_GetPageCount(output) !== pages.length) throw new Error('Invalid edited PDF page count')
            return this.writePDF(output, maxBytes)
        } finally {
            this.free(indices)
            api.FPDF_CloseDocument(output)
        }
    }

    destroy(): void {
        if (this.document) this.api.FPDF_CloseDocument(this.document)
        this.document = 0; this.free(this.bytes); this.bytes = 0
        this.api.FPDF_DestroyLibrary()
    }
}
