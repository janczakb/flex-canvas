import type {PDFPageLayout} from './pdf/spread-layout.js'
import type {ViewerPrintOptions} from './printing.js'
import {createAnnotationTextEditor,createTextAnnotationBox} from './annotation-text-editor.js'
import {createContentEditor} from './content-editor.js'
import {pdfTextFamilies,type PDFTextFamily} from './pdf/text-edit.js'
import {groupPDFParagraphs,type PDFParagraph} from './pdf/text-paragraphs.js'
import {createCropSelection} from './crop-selection.js'
import {remapCropAnnotations,type PDFCrop} from './pdf/crop.js'
import {openCommentPopover} from './comment-popover.js'
import {normalizeBookmarks,type ViewerBookmark} from './bookmarks.js'
import {mountRedactionToolbar} from './redaction-toolbar.js'
import {createAnnotationDocument,createAnnotationProfile} from './document.js'
import {annotationHandles, annotationBounds, paintAnnotation} from './canvas.js'
import {hitAnnotationGeometry} from './hit-test.js'
import {eraseInk} from './ink-eraser.js'
import {openAnnotationInsertDialog,type InsertKind} from './insertion.js'
import {downloadMediaBlob,exportAnnotatedPDF} from './pdf-export.js'
import {remapPageAnnotations} from './pdf/page-plan.js'
import {annotationToolDescriptors,createAnnotationToolbar,type ToolbarOptions,type ToolbarItem,type ToolGroup, type ToolProperty, observeToolbarContainer, annotationStyle} from './toolbar.js'
import {openPDFPageEditor} from './viewer-pages.js'
import { paintViewerIcon } from './viewer-icons.js'
import { viewerLocale, type ViewerTranslations } from './viewer-locale.js'
import { moveAnnotationVertex } from './selection.js'
import { notePopupPlacement } from './notes.js'
import { annotationStrokeWidth } from './stroke-width.js'
import { prepareTextMarkup } from './text-markup.js'
import { mountViewerNavigation,type ViewerNavigationMode } from './viewer-navigation.js'
import {createViewerZoom,type ViewerZoomOptions} from './pdf/zoom.js'
import {createPDFPageFlow,type PDFPageScene,type PDFScrollMode} from './pdf/page-flow.js'
import { createPDFTileSurface } from './pdf/tile-surface.js'
import {createPDFSelectionHighlights} from './pdf/selection-highlights.js'
import { readTextSelection } from './viewer-text-selection.js'
import {toolPropertyPresentation} from './tool-property-presentation.js'
import { attachViewerStyles, type ViewerStylesOptions } from './stylesheets.js'
import {defaultNoteIcons} from './note-markers.js'
import { createResponsiveProperties } from './responsive-properties.js'
import { createContextToolbar } from './context-toolbar.js'
import { mountSidebarResizer } from './sidebar-resizer.js'
import type {IndependentPDFDocument, PDFPageEdit, SearchHit} from './pdf.js'
import type {MediaSource} from './session.js'
import type {Annotation,AnnotationTool,Point,ProfileOptions} from './types.js'

export interface ViewerPDFReplacement {
    readonly operation?: 'pages' | 'redactions' | 'crop' | 'content'
    readonly bytes: ArrayBuffer
    readonly annotations: readonly Annotation[]
    readonly plan: readonly PDFPageEdit[]
    readonly sourcePages: number
    readonly signal: AbortSignal
}
export type ViewerTheme = 'auto' | 'light' | 'dark'
export interface MediaViewerOptions extends ViewerStylesOptions {
    /** Applies to the complete workspace, including panels and nested dialogs. */
    theme?: ViewerTheme
    bookmarks?:readonly ViewerBookmark[]
    saveBookmarks?:(bookmarks:readonly ViewerBookmark[],signal:AbortSignal)=>Promise<void>
    source: MediaSource
    name?: string
    mode?: 'edit' | 'read'
    /** PDF only: one page at a time or a virtualized vertical document. */
    scrollMode?: PDFScrollMode
    pageLayout?:PDFPageLayout
    firstPageSingle?:boolean
    zoom?:ViewerZoomOptions
    profile?: ProfileOptions
    toolbar?: ToolbarOptions
    annotations?: readonly Annotation[]
    saveAnnotations?: (annotations: readonly Annotation[], signal: AbortSignal) => Promise<void>
    /** Choose which operations the replacement adapter can persist atomically. */
    pdfOperations?:readonly ('pages'|'redactions'|'crop'|'content')[]
    replacePdf?: (replacement: ViewerPDFReplacement) => Promise<void>
    preserveAnnotations?: boolean
    locale?: string
    translations?: ViewerTranslations
    labels?: Record<string,string>
    printOptions?:ViewerPrintOptions
    maxPdfOutputBytes?: number
    onClose?: () => void | Promise<void>
    closeAfterPdfReplacement?: boolean
    signal?: AbortSignal
    annotationDetails?: (annotation:Annotation) => {title?:string;createdAt?:string;subtitle?:string}
}

const defaultLabels: Record<string,string> = {
    viewer:'Document viewer', properties:'Annotation properties', annotationLayer:'Annotation canvas',
    loading:'Loading document…', error:'The document operation failed.', save:'Save annotations', saved:'Annotations saved',
    prev:'Previous', next:'Next', page:'Page', position:'Insert before page', pageRange:'Pages {start}–{end} of {count}',
    zoomIn:'Zoom in', zoomOut:'Zoom out', select:'Select', pan:'Pan', annotations:'Annotations', empty:'No annotations',
    search:'Search document', noResults:'No matches', print:'Print', download:'Download', original:'Original PDF', annotated:'PDF with annotations',
    'edit-pages':'Document editor', delete:'Delete', deleteConfirm:'Delete this annotation?', clear:'Delete all',
    clearConfirm:'Delete all annotations?', eraseConfirm:'Apply the eraser?', cancel:'Cancel', confirm:'Confirm deletion',
    resize:'Resize annotations panel', undo:'Undo', redo:'Redo', note:'Note', pin:'Numbered pin', pen:'Drawing',
    highlight:'Freeform highlight', 'text-highlight':'Text highlighter', eraser:'Eraser', rectangle:'Rectangle', ellipse:'Ellipse',
    line:'Line', arrow:'Arrow', polygon:'Polygon', 'cloudy-polygon':'Cloudy polygon', polyline:'Polyline',
    text:'Text', callout:'Callout', image:'Image', link:'Link', signature:'Add signature', color:'Color', opacity:'Opacity', stroke:'Width',
    newPage:'New page', deletePages:'Delete pages', deletePagesConfirm:'Delete selected pages and their annotations?',
    duplicate:'Duplicate', rotateLeft:'Rotate left', rotateRight:'Rotate right', movePages:'Move here', replacePdf:'Replace PDF',
}
const editingTools = annotationToolDescriptors.map(({id})=>id)
const limit = (value: number, min = 0, max = 1): number => Math.min(max,Math.max(min,value))
const abortError = (): DOMException => new DOMException('Media viewer closed','AbortError')

/** Mounts a complete, owned browser surface in a shadow root. Storage and authorization are application adapters. */
export async function mountMediaViewer(container: HTMLElement, options: MediaViewerOptions) {
    const assertTheme=(theme:ViewerTheme):void=>{if(!['auto','light','dark'].includes(theme))throw new RangeError('Invalid viewer theme')}
    assertTheme(options.theme??'auto')
    if(options.toolbar&&'theme' in options.toolbar)throw new TypeError('Set theme on the viewer options, not toolbar.theme')
    if(options.scrollMode!==undefined&&!['paginated','continuous'].includes(options.scrollMode))throw new RangeError('Invalid PDF scroll mode')
    if(options.pageLayout!==undefined&&!['single','double'].includes(options.pageLayout))throw new RangeError('Invalid PDF page layout')
    if(options.firstPageSingle!==undefined&&typeof options.firstPageSingle!=='boolean')throw new RangeError('Invalid cover page option')
    if (options.signal?.aborted) throw abortError()
    const owner = container.ownerDocument, view = owner.defaultView
    if (!view) throw new Error('Viewer requires a browser window')
    let locale = options.locale ?? view.navigator.language
    const translations = viewerLocale(locale, defaultLabels, options.labels, options.translations)
    let labels = {...defaultLabels,...options.labels}
    const lifecycle = new AbortController(), signal = lifecycle.signal
    const abort = (): void => lifecycle.abort()
    options.signal?.addEventListener('abort',abort,{once:true})
    const zoomState=createViewerZoom(options.zoom)
    const profile = createAnnotationProfile({...options.profile,maxPages:options.profile?.maxPages ?? (options.source.kind==='pdf' ? options.source.pdf.maxPages ?? 2000 : 1)})
    const defaultNoteColors=['#fff176','#ea580c','#dc2626','#7c3aed','#2563eb','#16a34a']
    const noteColors=options.toolbar?.noteColors??(defaultNoteColors.every(color=>profile.colors.includes(color))?defaultNoteColors:profile.colors)
    if(!noteColors.length||new Set(noteColors).size!==noteColors.length||noteColors.some(color=>!profile.colors.includes(color)))throw new RangeError('Invalid note palette')
    const noteChoices=options.profile?.noteIcons??defaultNoteIcons.filter(icon=>profile.noteIcons.includes(icon))
    const read = profile.readOnly || options.mode === 'read'
    const allowed = editingTools.filter(tool=>(tool !== 'text-highlight' || options.source.kind === 'pdf') && profile.tools.includes(tool) && (options.toolbar?.tools?.includes(tool) ?? true))
    const toolbar = createAnnotationToolbar(read?[]:allowed,options.toolbar)
    const text = (key: string): string => labels[key] ?? key
    let bookmarks:readonly ViewerBookmark[]=[],bookmarkBusy=false
    const preserveAnnotations=options.preserveAnnotations!==false
    const canOperate=(operation:'pages'|'redactions'|'crop'|'content')=>options.pdfOperations?.includes(operation)??true
    let documentChanged=false
    let cropping=false,crop:PDFCrop|undefined
    let editingContent=false,contentEpoch=0
    let contentPreparation:AbortController|undefined
    const preparedText=new Map<number,readonly PDFParagraph[]>()
    const pendingContentPages=new WeakMap<HTMLElement,{epoch:number;index:number}>()
    let model = createAnnotationDocument({profile,shapes:options.annotations})
    const host = owner.createElement('div'), shadow=host.attachShadow({mode:'open'})
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] => {
        const node=owner.createElement(tag); if(className)node.className=className; return node
    }
    let theme=options.theme??'auto'
    const appearance=view.matchMedia('(prefers-color-scheme:dark)')
    const root=make('section','fm');root.hidden=true;root.setAttribute('aria-busy','true');root.dataset.loading='true';root.tabIndex=-1;root.dataset.read=String(read);root.dataset.pdf=String(options.source.kind==='pdf')
    const applyTheme=():void=>{root.dataset.theme=theme==='auto'?(appearance.matches?'dark':'light'):theme}
    const setTheme=(next:ViewerTheme):void=>{assertTheme(next);theme=next;applyTheme()}
    applyTheme()
    appearance.addEventListener('change',()=>{if(theme==='auto')applyTheme()},{signal})
    root.setAttribute('aria-label',options.name??text('viewer'))
    const top=make('div','fm-bar fm-top'),slot=make('div','fm-context'),properties=make('div','fm-bar')
    top.setAttribute('role','toolbar');top.setAttribute('aria-label',text('viewer'))
    properties.setAttribute('role','toolbar');properties.setAttribute('aria-label',text('properties'))
    properties.inert=true;slot.append(properties)
    const contextMotion=createContextToolbar(slot,properties,signal)
    const body=make('div','fm-body'),sidebar=make('aside','fm-sidebar'),list=make('div','fm-list fm-annotation-list')
    sidebar.setAttribute('aria-label',text('annotations'));sidebar.hidden=true;if(options.source.kind==='pdf')sidebar.classList.add('fm-annotations-left')
    const navigation=make('aside','fm-sidebar fm-navigation');navigation.hidden=true
    const scroller=make('div','fm-scroll')
    let stage=make('div','fm-stage'),source=make('canvas','fm-page-source'),overlay=make('canvas','fm-page-overlay')
    let textLayer=make('div','fm-text'),links=make('div','fm-links'),tileLayer=make('div','fm-pdf-tiles')
    const singlePage={stage,source,overlay,text:textLayer,links,tiles:tileLayer}
    let scrollMode:PDFScrollMode=options.scrollMode??'paginated'
    let pageLayout:PDFPageLayout=options.pageLayout??'single',firstPageSingle=options.firstPageSingle??true
    let flow:Awaited<ReturnType<typeof createPDFPageFlow>>|undefined
    let flowPending:Promise<Awaited<ReturnType<typeof createPDFPageFlow>>>|undefined,flowController:AbortController|undefined,flowEpoch=0
    const clearFlow=():void=>{flowEpoch++;flowController?.abort();flow?.destroy();flow=undefined;flowPending=undefined}
    overlay.setAttribute('aria-label',text('annotationLayer'))
    const start=make('div','fm-strip'),end=make('div','fm-strip'),toolStrip=make('div','fm-strip fm-edit-tools')
    const skeletonBar=make('div','fm-top-skeleton')
    skeletonBar.setAttribute('aria-hidden','true')
    for(let i=0;i<8;i++)skeletonBar.append(make('span'))
    top.inert=true;top.append(start,end,skeletonBar)
    const loading=make('div','fm-loading'),skeleton=make('div','fm-skeleton')
    loading.setAttribute('aria-hidden','true')
    skeleton.append(make('span'),make('span'),make('span'))
    loading.append(skeleton)
    const footer=make('div','fm-bar fm-footer'),status=make('span','fm-status')
    status.setAttribute('role','status');status.textContent=text('loading');footer.append(status)
    stage.append(source,tileLayer,textLayer,overlay,links);scroller.append(stage);body.append(...(options.source.kind==='pdf'?[navigation,sidebar,scroller,loading]:[navigation,scroller,sidebar,loading]));root.append(top,slot,body,footer);shadow.append(root);container.append(host)
    const heroModule = import('./hero-controls.js')
    let hero: ReturnType<(typeof import('./hero-controls.js'))['createHeroControls']>
    try {
        const sheets = attachViewerStyles(shadow, options, signal)
        const showSkeleton = sheets.viewer.then(() => { if (!signal.aborted) root.hidden = false })
        const [module, catalog] = await Promise.all([heroModule, translations, sheets.ready, showSkeleton])
        signal.throwIfAborted()
        labels = catalog
        hero = module.createHeroControls(root)
    } catch (error) {
        lifecycle.abort();options.signal?.removeEventListener('abort',abort);host.remove();model.dispose();toolbar.dispose()
        throw error
    }
    const tileSurface=options.source.kind==='pdf'?createPDFTileSurface(tileLayer,scroller,signal,()=>{}):undefined
    let requestedPage:number|null=null
    let requestedAnnotation:string|null=null
    let pdf: IndependentPDFDocument | undefined, image: HTMLImageElement | undefined, pageIndex=0, pageCount=1
    let navigationView:ReturnType<typeof mountViewerNavigation>|undefined
    let sidebarTool:ViewerNavigationMode|'annotations'='thumbnails'
    let showNavigation:(mode:ViewerNavigationMode|'annotations',force?:boolean)=>void=()=>{}
    let searchHits:SearchHit[]=[],searchIndex=-1, searchAbort:AbortController|undefined
    let previewRender:AbortController|undefined
    let size={width:1,height:1},scale=1,renderedKey='',renderGeneration=0,frame=0,busy=false,refreshingPDF=false,closed=false,selected: string|null=null
    let tool: AnnotationTool|'select'|'pan'='select'
    let draft: Point[] = []
    const styles=new Map<AnnotationTool,Partial<Annotation>>()
    let eraserSize=profile.eraserSize
    const styleOf=(id:AnnotationTool):Partial<Annotation>=>styles.get(id)??{
        color:id==='note'||id==='pin'?noteColors[0]:['text','callout'].includes(id)?profile.colors.find(color=>color==='#171717'||color==='#000000')??profile.colors[0]:profile.colors[0],stroke:limit(id==='highlight'?30:id==='callout'?2:5,profile.minStroke,profile.maxStroke),
        ...(['text','callout'].includes(id)?{fontFamily:profile.textFonts[0],fontSize:18,align:'left' as const,verticalAlign:'top' as const,...(id==='callout'?{strokeColor:profile.colors.find(color=>color==='#171717'||color==='#000000')??profile.colors[0]}:{})}:{}),
        opacity:1,
        ...(['pen','highlight','text-highlight'].includes(id) ? {
            blendMode:id!=='pen'&&profile.blendModes.includes('multiply')?'multiply':profile.blendModes[0],
        } : {}),
        ...(id==='note'?{noteIcon:noteChoices[0]}:{}),
    }
    const polygonTools:readonly AnnotationTool[]=['polygon','cloudy-polygon','polyline']
    let gesture: {id:number;shape:Annotation;start:Point;moving?:Annotation;handle?:string} | undefined
    let interceptTextClick=false
    let pan: {id:number; x:number; y:number; left:number;top:number} | undefined
    let confirmPending: HTMLDialogElement | undefined
    let clipboard:Annotation|undefined
    const translationsByElement=new Map<HTMLElement,Map<string,string>>()
    const localize=(node:HTMLElement,key:string,attribute?:string):void=>{
        const bindings=translationsByElement.get(node)??new Map<string,string>()
        bindings.set(attribute??'',key);translationsByElement.set(node,bindings)
        if(attribute)node.setAttribute(attribute,text(key));else node.textContent=text(key)
    }
    localize(status,'loading')
    localize(top,'viewer','aria-label')
    localize(properties,'properties','aria-label')
    localize(sidebar,'annotations','aria-label')
    localize(overlay,'annotationLayer','aria-label')
    const cache=new Map<string,HTMLImageElement>()
    const controls=new Map<string,HTMLButtonElement>()
    const groups=new Map<ToolGroup, HTMLButtonElement>()
    const button=(key:string,action:()=>void,area:HTMLElement=end):HTMLButtonElement=>{
        const node=make('button','fm-tool');node.type='button';node.dataset.control=key;node.onclick=action;node.classList.add('button','button--ghost')
        if ((area.closest('.fm-top')||area.classList.contains('fm-search')||area.classList.contains('fm-markup')) && paintViewerIcon(node,key)) localize(node,key,'aria-label')
        else if(area===top||top.contains(area)||area===footer)localize(node,key)
        else node.textContent=text(key)
        area.append(node);return node
    }
    const addItem=(item:ToolbarItem,key:string,fn:()=>void,area=end):void=>{if(toolbar.hasItem(item))controls.set(key,button(key,fn,area))}
    const menuButton=(key:string, entries:()=> readonly {key:string;checked?:boolean;action:()=>void}[], area:HTMLElement=end, icon=key):HTMLElement=>{
        const slot=make('div','fm-hero-menu')
        slot.dataset.menu=key
        area.append(slot)
        hero.dropdown(slot,()=>({label:text(key),icon,entries:()=>entries().map(entry=>({...entry,label:text(entry.key)}))}))
        return slot
    }
    const confirm=(message:string, action='delete'):Promise<boolean>=>{
        if(signal.aborted||confirmPending)return Promise.resolve(false)
        const dialog=make('dialog','fm-confirm'),caption=make('strong'),detail=make('p'),actions=make('div')
        confirmPending=dialog;dialog.setAttribute('aria-label',text('confirm'));caption.textContent=text('confirm');detail.textContent=message
        dialog.append(caption,detail,actions);root.append(dialog)
        return new Promise(resolve=>{
            const finish=(answer:boolean):void=>{signal.removeEventListener('abort',cancel);confirmPending=undefined;dialog.close();dialog.remove();resolve(answer)}
            const cancel=():void=>finish(false)
            const cancelButton=button('cancel',cancel,actions);button(action,()=>finish(true),actions)
            signal.addEventListener('abort',cancel,{once:true})
            dialog.oncancel=event=>{event.preventDefault();cancel()};dialog.showModal();cancelButton.focus()
        })
    }
    let textEditor:ReturnType<typeof createAnnotationTextEditor>|undefined
    const visibleShapes=():readonly Annotation[]=>{
        const shapes=model.getState().shapes,draft=textEditor?.active()
        return draft?[...shapes.filter(shape=>shape.id!==draft.id),draft]:shapes
    }
    const current=():readonly Annotation[]=>visibleShapes().filter(shape=>(shape.pageIndex??0)===pageIndex)
    const paintedShape=(shape:Annotation):Annotation=>textEditor?.active()?.id===shape.id?{...shape,text:''}:shape
    const asset=(shape:Annotation):HTMLImageElement|undefined=>{
        if (!shape.asset)return
        if (!cache.has(shape.asset)){const img=make('img');cache.set(shape.asset,img);img.src=shape.asset;void img.decode().then(paint).catch(()=>{})}
        const img=cache.get(shape.asset)!;return img.complete&&img.naturalWidth?img:undefined
    }
    function paint():void{
        if(closed)return
        const ctx=overlay.getContext('2d');if(!ctx)return
        const w=overlay.clientWidth,h=overlay.clientHeight;if(w<=0||h<=0)return
        ctx.setTransform(overlay.width/w,0,0,overlay.height/h,0,0);ctx.clearRect(0,0,w,h)
        const hit=searchHits[searchIndex]
        if(hit?.pageIndex===pageIndex){
            ctx.fillStyle='#ffc34d9e'
            for(const rect of hit.rectangles)ctx.fillRect(rect.x*w,rect.y*h,rect.width*w,rect.height*h)
        }
        let pin=0
        for(const shape of current()){
            if(shape.id===gesture?.moving?.id)continue
            if(shape.tool==='pin')pin++
            paintAnnotation(ctx,paintedShape(shape),w,h,pin,shape.id===selected,scale,asset(shape))
        }
        if(gesture&&tool!=='eraser')paintAnnotation(ctx,gesture.shape,w,h,0,true,scale,asset(gesture.shape))
        if(draft.length>1)paintAnnotation(ctx,shapeFrom('polyline',draft,{id:'draft'}),w,h,0,true,scale)
        if(brushPoint&&['pen','highlight','eraser'].includes(tool)){
            const preview=shapeFrom(tool==='highlight'?'highlight':'pen',[brushPoint])
            const radius=(tool==='eraser'?eraserSize*scale:annotationStrokeWidth(preview,scale))/2
            ctx.beginPath();ctx.arc(brushPoint[0]*w,brushPoint[1]*h,Math.max(1,radius),0,Math.PI*2)
            ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle='#26262c';ctx.lineWidth=1;ctx.stroke()
        }
    }
    let brushPoint:Point|undefined
    const notePreview=make('div','fm-note-preview')
    notePreview.hidden=true;notePreview.setAttribute('role','tooltip');root.append(notePreview)
    function showNotePreview(shape?:Annotation):void{
        if(!shape?.text||!['note','pin'].includes(shape.tool)){notePreview.hidden=true;return}
        const bounds=root.getBoundingClientRect(),box=stage.getBoundingClientRect()
        const place=notePopupPlacement(box.left+shape.points[0][0]*size.width,box.top+shape.points[0][1]*size.height,bounds)
        notePreview.style.left=place.left+'px';notePreview.style.top=place.top+'px'
        notePreview.style.width=place.width+'px';notePreview.style.setProperty('--note-color',shape.color)
        notePreview.textContent=shape.text;notePreview.hidden=false
    }
    const drawLinks=():void=>{
        links.replaceChildren()
        for(const shape of current()){
            if(shape.tool!=='text-highlight'||!('text' in shape))continue
            const mark=make('button','fm-comment-marker'),box=annotationBounds(shape)
            mark.type='button';mark.setAttribute('aria-label',text('comments'));paintViewerIcon(mark,'markup_comment')
            mark.style.left=Math.min(97,box.right*100)+'%';mark.style.top=(box.top+box.bottom)*50+'%'
            mark.onclick=()=>editComment(shape);links.append(mark)
        }
        for(const shape of current()){
            if(shape.tool!=='link')continue
            const [a,b]=shape.points,node=make('a')
            node.href=shape.href??'#';node.setAttribute('aria-label',shape.href??text('page')+' '+((shape.targetPage??0)+1));node.target=shape.href?'_blank':'';node.rel='noopener noreferrer'
            node.style.cssText='left:'+Math.min(a[0],b[0])*100+'%;top:'+Math.min(a[1],b[1])*100+'%;width:'+Math.abs(a[0]-b[0])*100+'%;height:'+Math.abs(a[1]-b[1])*100+'%'
            node.style.pointerEvents=read?'auto':'none'
            node.onclick=event=>{if(shape.targetPage!==undefined){event.preventDefault();setPage(shape.targetPage)}}
            links.append(node)
        }
    }
    async function layout():Promise<void>{
        const generation=++renderGeneration,index=pageIndex
        if(pdf&&(scrollMode==='continuous'||pageLayout==='double')){
            previewRender?.abort();tileSurface?.hide();singlePage.stage.remove();root.dataset.scrollMode=scrollMode;root.dataset.pageLayout=pageLayout
            if(!flow&&!flowPending){
                const document=pdf,epoch=flowEpoch,controller=new AbortController();flowController=controller
                const parentAbort=()=>controller.abort();signal.addEventListener('abort',parentAbort,{once:true})
                controller.signal.addEventListener('abort',()=>signal.removeEventListener('abort',parentAbort),{once:true})
                flowPending=createPDFPageFlow({document,viewport:scroller,signal:controller.signal,paint:paintScene,activate:activateScene,current:()=>pageIndex,zoom:zoomState,pageLayout,firstPageSingle,scrollMode,pinned:()=>!!gesture||!!pan||selectingText,error:error=>{if((error as Error)?.name!=='AbortError')status.textContent=text('error')}})
                    .then(next=>{if(closed||epoch!==flowEpoch||pdf!==document||(scrollMode!=='continuous'&&pageLayout!=='double')){next.destroy();throw abortError()}flow=next;return next})
                    .catch(error=>{if(epoch===flowEpoch){flowPending=undefined;controller.abort()}throw error})
            }
            const current=flow??await flowPending!
            if(closed||generation!==renderGeneration)return
            await current.update(resizingSidebar)
            return
        }
        root.dataset.scrollMode='paginated';root.dataset.pageLayout=pageLayout
        const info=pdf?await pdf.getPageInfo(index):{width:image?.naturalWidth??1,height:image?.naturalHeight??1}
        if(closed||generation!==renderGeneration)return
        const fitWidth=Math.max(.01,(scroller.clientWidth-24)/info.width),fitHeight=Math.max(.01,(scroller.clientHeight-24)/info.height)
        scale=zoomState.resolve(Math.min(fitWidth,fitHeight),fitWidth)
        const key=index+':'+scale+':'+(view!.devicePixelRatio||1)
        if(key===renderedKey)return
        size={width:info.width*scale,height:info.height*scale};stage.style.width=size.width+'px';stage.style.height=size.height+'px'
        if(resizingSidebar)return
        const ratio=Math.min(view!.devicePixelRatio||1,4096/size.width,4096/size.height,Math.sqrt(4194304/(size.width*size.height)))
        overlay.width=Math.max(1,Math.round(size.width*ratio));overlay.height=Math.max(1,Math.round(size.height*ratio))
        paint()
        if(pdf){
            previewRender?.abort()
            const controller=new AbortController();previewRender=controller
            const previewRatio=Math.min(ratio,640/Math.max(size.width,size.height))
            await pdf.renderPage(index,source,{scale,pixelRatio:previewRatio,signal:controller.signal})
            if(generation!==renderGeneration||closed)return
            source.hidden=false
            tileSurface?.show({document:pdf,index,width:size.width,height:size.height,dpr:Math.min(4,view!.devicePixelRatio||1)})
            await pdf.renderTextLayer(index,textLayer,scale)
        }
        if(generation===renderGeneration){renderedKey=key;if(editingContent)void loadContentBlocks()}
    }
    const schedule=():void=>{
        if(refreshingPDF)return
        view.cancelAnimationFrame(frame)
        frame=view.requestAnimationFrame(()=>{void layout().catch(error=>{if(!closed&&error?.name!=='AbortError')status.textContent=text('error')})})
    }
    let resizingSidebar=false
    const observer=new ResizeObserver(()=>{if(!resizingSidebar)schedule()})
    function adjacentPage(direction:-1|1):number{
        const index=requestedPage??pageIndex
        if(pageLayout==='single')return index+direction
        if(firstPageSingle&&index===0)return direction>0?1:-1
        const offset=firstPageSingle?1:0,start=offset+Math.floor((index-offset)/2)*2
        return direction<0&&start===1?0:direction>0?start+2:start-2
    }
    function setPage(index:number):void{navigateTo(index)}
    function navigateTo(index:number,annotation:string|null=null):void{
        if(!Number.isInteger(index)||index<0||index>=pageCount)return
        if(textEditor?.finish()===false)return
        if(flow){
            requestedPage=index;requestedAnnotation=annotation;selected=null;sync()
            draft=[];selectedText()?.removeAllRanges();markupMenu.hidden=true
            void flow.goTo(index).catch(()=>{if(!closed)status.textContent=text('error')});return
        }
        if(index===pageIndex){if(annotation){selected=annotation;sync();paint()}return}
        zoomState.set('fit-page')
        if(pdf){pdf.clearTextLayer(textLayer);source.hidden=true}
        pageIndex=index;selected=annotation;draft=[];tileSurface?.hide();showNotePreview();owner.getSelection()?.removeAllRanges();drawLinks();sync();schedule()
    }
    scroller.addEventListener('wheel',()=>{
        requestedPage=null;requestedAnnotation=null
        if(pageNumber&&shadow.activeElement===pageNumber){pageDraft=undefined;root.focus({preventScroll:true});sync()}
    },{passive:true,signal})
    const switchTool=(value:typeof tool):void=>{
        if(textEditor?.finish()===false)return
        if(editingContent){void cancelContentEditor();return}
        if(cropping)leaveCrop()

        if(tool!==value){selectedText()?.removeAllRanges();selectionHighlights.clear();markupMenu.hidden=true}
        tool=value;requestedAnnotation=null
        toolbar.activate(value==='select'||value==='pan'?null:value)
        draft=[];brushPoint=undefined;showNotePreview()
        root.dataset.tool=value
        for(const [id,node] of controls)if(id==='select'||id==='pan'||allowed.includes(id as AnnotationTool))node.setAttribute('aria-pressed',String(value===id))
        selected=null;sync();paint()
    }
    const shapeFrom=(kind:Annotation['tool'],points:readonly Point[],extra:Partial<Annotation>={}):Annotation=>({
        id:extra.id??crypto.randomUUID(),tool:kind,color:profile.colors[0],stroke:Math.round(limit(5,profile.minStroke,profile.maxStroke)),
        ...styleOf(kind),points,...(pdf?{pageIndex}:{}),...extra,
    })
    textEditor=createAnnotationTextEditor({root,signal,text,maxBytes:profile.maxTextBytes,
        surface:shape=>{
            const scene=flow?.scenes().find(item=>item.index===(shape.pageIndex??0))
            return scene?{stage:scene.stage,width:scene.width,height:scene.height,scale:scene.scale}:(shape.pageIndex??0)===pageIndex?{stage,width:size.width,height:size.height,scale}:undefined
        },
        commit:(shape,original)=>{
            if(original)model.dispatch({type:'update',id:shape.id,patch:shape})
            else model.dispatch({type:'add',shape})
        },
        change:()=>{sync();paint();flow?.refresh()},error:()=>{status.textContent=text('limit')},
    })
    function editText(shape:Annotation,isNew:boolean):void {
        if(read||busy)return
        const next=isNew||shape.points.length<2?createTextAnnotationBox({...shape,points:[shape.points[0],shape.points[1]??shape.points[0]]},size.width,size.height,scale):{shape,autoWidth:false}
        tool='select';root.dataset.tool='select';toolbar.activate(null);selected=shape.id
        textEditor!.open(next.shape,isNew,next.autoWidth)
    }
    const insert=async(kind:InsertKind,points:readonly Point[]):Promise<void>=>{
        const page=pageIndex
        const result=await openAnnotationInsertDialog({owner:root,kind,pageCount:pdf?.pageCount,dark:root.dataset.theme==='dark'||root.dataset.theme==='auto'&&view.matchMedia('(prefers-color-scheme:dark)').matches,labels,signal,assetBaseUrl:options.assetBaseUrl})
        if(result&&!closed&&page===pageIndex){
            const {aspectRatio,...data}=result
            if(kind==='signature'&&aspectRatio&&Number.isFinite(aspectRatio)&&aspectRatio>0){
                const cx=(points[0][0]+points[1][0])/2,cy=(points[0][1]+points[1][1])/2
                let width=Math.abs(points[1][0]-points[0][0]),height=width*size.width/size.height/aspectRatio
                if(height>.45){width*=.45/height;height=.45}
                points=[[cx-width/2,cy-height/2],[cx+width/2,cy+height/2]]
            }
            const shape=shapeFrom(kind,points,data);model.dispatch({type:'add',shape});switchTool('select');selected=shape.id;paint()}
    }
    let commentPopover:ReturnType<typeof openCommentPopover>|undefined
    function editComment(shape:Annotation):void{
        if(busy)return
        commentPopover?.close();selected=shape.id;sync();paint();flow?.refresh()
        commentPopover=openCommentPopover({root,hero,signal,text,value:shape.text??'',maxBytes:profile.maxTextBytes,readOnly:read,
            bounds:()=>{
                const current=model.getState().shapes.find(item=>item.id===shape.id);if(!current)return null
                const scene=flow?.scenes().find(item=>item.index===(current.pageIndex??0))
                const surface=scene?.stage??((current.pageIndex??0)===pageIndex?stage:undefined);if(!surface)return null
                const page=surface.getBoundingClientRect(),box=annotationBounds(current)
                return new DOMRect(page.left+box.left*page.width,page.top+box.top*page.height,(box.right-box.left)*page.width,(box.bottom-box.top)*page.height)
            },
            save:value=>{if(!read&&!busy&&model.getState().shapes.some(item=>item.id===shape.id))model.dispatch({type:'update',id:shape.id,patch:{text:value}})},
            close:()=>{commentPopover=undefined},
        })
    }
    function editNote(shape:Annotation, isNew:boolean):void {
        if(read||busy)return
        const dialog=make('dialog','fm-confirm fm-note'), caption=make('strong'), input=make('textarea'), actions=make('div')
        caption.textContent=text(shape.tool);input.setAttribute('aria-label',text(shape.tool));input.value=shape.text??''
        input.maxLength=profile.maxTextBytes
        const close=():void=>{dialog.close();dialog.remove()}
        button('cancel',close,actions)
        button('done',()=>{
            try {
                if(new TextEncoder().encode(input.value).byteLength>profile.maxTextBytes)throw new Error()
                if(isNew){model.dispatch({type:'add',shape:{...shape,text:input.value}});switchTool('select');selected=shape.id}
                else model.dispatch({type:'update',id:shape.id,patch:{text:input.value}})
                close();sync();paint()
            }catch{input.setCustomValidity(text('limit'));input.reportValidity()}
        },actions)
        input.oninput=()=>input.setCustomValidity('')
        dialog.oncancel=event=>{event.preventDefault();close()}
        dialog.append(caption,input,actions);root.append(dialog);dialog.showModal();input.focus()
    }
    const remove=async(id:string|null):Promise<void>=>{
        if(read||busy||!id||!toolbar.hasItem('delete')||!await confirm(text('deleteConfirm'))||closed)return
        if(textEditor?.active()?.id===id)textEditor.finish(false)
        if(model.getState().shapes.some(shape=>shape.id===id))model.dispatch({type:'remove',id})
        if(selected===id)selected=null;sync();paint()
    }
    const clear=async():Promise<void>=>{
        if(read||busy||!model.getState().shapes.length||!await confirm(text('clearConfirm'))||closed)return
        selected=null;model.dispatch({type:'clear'})
    }
    let sidebarSnapshot:readonly Annotation[]|undefined,sidebarLocale=''
    const renderSidebar=():void=>{
        const snapshot=model.getState().shapes
        const count=snapshot.length
        sideCount.textContent=count?text(count===1?'annotation_count_one':'annotation_count_other').replace('{count}',String(count)):text('empty')
        if(controls.has('sidebar-delete'))controls.get('sidebar-delete')!.disabled=!selected||busy
        if(sidebarSnapshot===snapshot&&sidebarLocale===locale){
            for(const row of list.querySelectorAll<HTMLElement>('[data-annotation-id]'))row.setAttribute('aria-selected',String(row.dataset.annotationId===selected))
            return
        }
        sidebarSnapshot=snapshot;sidebarLocale=locale
        list.replaceChildren()
        const groups=new Map<number,Annotation[]>()
        for(const shape of snapshot){const index=shape.pageIndex??0;if(!groups.has(index))groups.set(index,[]);groups.get(index)!.push(shape)}
        if(!groups.size){const empty=make('p','fm-annotations-empty');empty.textContent=text('empty');list.append(empty)}
        for(const [index,shapes] of [...groups].sort(([a],[b])=>a-b)){
            if(pdf){const heading=make('div','fm-annotation-page');heading.textContent=text('page')+' '+(index+1);list.append(heading)}
            for(const shape of shapes){
                const row=make('button','fm-annotation-row'),icon=make('span','fm-annotation-icon'),body=make('span','fm-annotation-caption'),title=make('span','fm-annotation-title')
                row.type='button';row.role='option';row.dataset.annotationId=shape.id;row.setAttribute('aria-selected',String(shape.id===selected))
                const details=options.annotationDetails?.(shape)
                title.textContent=details?.title||shape.text||shape.href||text(shape.tool)
                paintViewerIcon(icon,shape.tool);icon.setAttribute('aria-hidden','true');body.append(title)
                const date=details?.createdAt?new Date(details.createdAt):undefined
                const subtitle=details?.subtitle||(date&&Number.isFinite(date.getTime())?new Intl.DateTimeFormat(locale).format(date):'')
                if(subtitle){const detail=make('span','fm-annotation-detail');detail.textContent=subtitle;body.append(detail)}
                row.append(icon,body);row.onclick=()=>{switchTool('select');setPage(index);selected=shape.id;sync();paint()}
                list.append(row)
            }
        }
    }
    const pageSlot=make('div','fm-hero-input'), pageTotal=make('span'), pageCompact=make('span','fm-page-compact')
    let pageNumber:HTMLInputElement|null=null,pageDraft:string|undefined
    let syncSearch=():void=>{}
    const pageInputRef=(node:HTMLInputElement|null):void=>{pageNumber=node}
    const readPage=():void=>{
        const raw=pageDraft;pageDraft=undefined
        if(raw!==undefined&&/^\d+$/.test(raw.trim())){
            const index=Math.max(0,Math.min(pageCount-1,Number(raw)-1))
            if(Number.isSafeInteger(index))setPage(index)
        }
        sync()
    }
    function sync():void{
        if(closed)return
        const state=model.getState()
        for(const key of ['select','pan'])controls.get(key)?.setAttribute('aria-pressed',String(tool===key))
        const fitButton=controls.get('fit')
        if(fitButton){
            const next=zoomState.mode==='fit-page'?'fitWidth':'fitPage'
            paintViewerIcon(fitButton,next);localize(fitButton,next,'aria-label')
        }
        pageTotal.textContent='/ '+pageCount;pageCompact.textContent=String((requestedPage??pageIndex)+1);syncSearch()
        const redactionButton=markupMenu.querySelector<HTMLButtonElement>('[data-control=markup_redaction]')
        if(redactionButton)redactionButton.disabled=busy||!pdf?.canEditPages||!canOperate('redactions')
        if(controls.has('prev'))controls.get('prev')!.disabled=adjacentPage(-1)<0
        if(controls.has('next'))controls.get('next')!.disabled=adjacentPage(1)>=pageCount
        for(const [group,node] of groups){
            const id=toolbar.selectGroup(group)
            if(!id)continue
            paintViewerIcon(node,id);localize(node,id,'aria-label');node.setAttribute('aria-pressed',String(tool===id))
        }
        if(controls.has('delete'))controls.get('delete')!.disabled=!selected||busy
        if(controls.has('clear'))controls.get('clear')!.disabled=!state.shapes.length||busy
        if(controls.has('undo'))controls.get('undo')!.disabled=!state.canUndo
        if(controls.has('redo'))controls.get('redo')!.disabled=!state.canRedo
        if(controls.has('save'))controls.get('save')!.disabled=busy||!(state.dirty||textEditor?.isDirty())
        if(controls.has('edit-pages'))controls.get('edit-pages')!.disabled=busy||!pdf?.canEditPages||!!options.replacePdf&&state.dirty||(!preserveAnnotations&&!!state.shapes.length)
        const selectedShape=current().find(shape=>shape.id===selected&&allowed.includes(shape.tool))
        const active=tool==='select'||tool==='pan' ? selectedShape?.tool??null : tool
        const props=active?(selectedShape?annotationStyle(selectedShape):styleOf(active)):{}
        const isRedaction=selectedShape?.tool==='text-highlight'&&selectedShape.markup==='redaction'
        const hasProperties=!read&&(cropping||editingContent||isRedaction||[...propertyControls.keys()].some(key=>toolbar.supports(active,key)))
        contextMotion.setVisible(hasProperties,()=>{
            cropBar.hidden=!cropping
            contentBar.hidden=!editingContent
            redactionToolbar.update(!!isRedaction&&!cropping)
            properties.dataset.redaction=String(!!isRedaction)
            properties.dataset.note=String(active==='note'||active==='pin')
            for(const [key,control] of propertyControls){
                control.wrapper.dataset.available=String(!cropping&&!editingContent&&!isRedaction&&toolbar.supports(active,key))
                const presentation=toolPropertyPresentation(key,active)
                control.labelKey=presentation.label;control.wrapper.dataset.label=presentation.label
                if(control.icon!==presentation.icon){
                    control.icon=presentation.icon
                    for(const node of control.wrapper.querySelectorAll<HTMLElement>(':scope > .fm-property-icon,:scope > .fm-property-summary'))paintViewerIcon(node,presentation.icon)
                }
                control.value=String(key==='eraserSize'?eraserSize:props[key as keyof typeof props]??control.initial)
            }
        })
        responsiveProperties.update(new Set([...propertyControls.keys()].filter(key=>!cropping&&!editingContent&&!isRedaction&&toolbar.supports(active,key))),cropping?'crop':editingContent?'content':isRedaction?'redaction':active)
        if(!sidebar.hidden)renderSidebar()
        navigationView?.update();hero.update();textEditor?.refresh()
    }
    const paintScene=(scene:PDFPageScene):void=>{
        const ctx=scene.overlay.getContext('2d');if(!ctx)return
        ctx.setTransform(scene.overlay.width/scene.width,0,0,scene.overlay.height/scene.height,0,0);ctx.clearRect(0,0,scene.width,scene.height)
        let pin=0
        for(const shape of visibleShapes().filter(shape=>(shape.pageIndex??0)===scene.index)){
            if(shape.tool==='pin')pin++
            paintAnnotation(ctx,paintedShape(shape),scene.width,scene.height,pin,shape.id===selected,scene.scale,asset(shape))
        }
        scene.stage.setAttribute('aria-label',text('page')+' '+(scene.index+1))
        scene.overlay.setAttribute('aria-label',text('annotationLayer'))
        if(editingContent)void loadContentPage(scene.stage,scene.index,scene.height/scene.scale)
    }
    const activateScene=(scene:PDFPageScene):void=>{
        if(requestedPage!==null&&requestedPage!==scene.index)return
        if(gesture||pan)return
        if(pageIndex!==scene.index){selected=null;draft=[];showNotePreview()}
        const selectingAnnotation=requestedPage===scene.index&&requestedAnnotation!==null
        if(requestedPage===scene.index){
            if(selectingAnnotation)selected=requestedAnnotation
            requestedPage=null;requestedAnnotation=null
        }
        pageIndex=scene.index;stage=scene.stage;source=scene.source;overlay=scene.overlay;textLayer=scene.text;links=scene.links;tileLayer=scene.tiles
        size={width:scene.width,height:scene.height};scale=scene.scale
        sync();drawLinks();if(selectingAnnotation)paint();if(editingContent)void loadContentBlocks()
    }
    const onModelChange=():void=>{
        const assets=new Set(model.getState().shapes.map(shape=>shape.asset))
        for(const key of cache.keys())if(!assets.has(key))cache.delete(key)
        sync();drawLinks();flow?.refresh();paint()
    }
    const propertyControls=new Map<ToolProperty,{value:string;initial:string;wrapper:HTMLElement;labelKey:string;icon:string}>()
    const responsiveProperties=createResponsiveProperties(properties,signal,text)
    let unsub=model.subscribe(onModelChange)
    const point=(event:PointerEvent):Point=>{const r=overlay.getBoundingClientRect();return [limit((event.clientX-r.left)/r.width),limit((event.clientY-r.top)/r.height)]}
    scroller.addEventListener('pointerdown',event=>{
        if(!(event.target instanceof Element))return
        const fromCanvas=event.target instanceof HTMLCanvasElement&&event.target.classList.contains('fm-page-overlay')
        const fromText=tool==='select'&&event.target instanceof Element?event.target.closest('.fm-text'):null
        if(!fromCanvas&&!fromText)return
        const scene=flow?.sceneFor(event.target);if(scene)activateScene(scene)
        if(event.button!==0||gesture||pan||busy)return
        showNotePreview()
        if(tool==='pan'){pan={id:event.pointerId,x:event.clientX,y:event.clientY,left:scroller.scrollLeft,top:scroller.scrollTop};overlay.setPointerCapture(event.pointerId);return}
        if(read)return
        const p=point(event),hit=current().findLast(shape=>hitAnnotationGeometry(shape,p,size.width,size.height,8,scale))
        if(fromText){
            interceptTextClick=false
            if(!hit||hit.tool==='text-highlight')return
            // An annotation above PDF glyphs owns the gesture; uncovered text
            // remains available for native selection and the text markup menu.
            interceptTextClick=true;event.preventDefault();event.stopImmediatePropagation()
            selectedText()?.removeAllRanges();selectionHighlights.clear();markupMenu.hidden=true
        }
        if(tool==='select'||(hit&&['note','pin'].includes(tool))){
            const previous=current().find(shape=>shape.id===selected)
            const handle=previous&&annotationHandles(previous).find(([,x,y])=>Math.hypot((p[0]-x)*size.width,(p[1]-y)*size.height)<=9)?.[0]
            const target=handle?previous:hit
            selected=target?.id??null
            if(target&&allowed.includes(target.tool))gesture={id:event.pointerId,shape:target,start:p,moving:target,handle}
            sync();paint()
        } else if(polygonTools.includes(tool)){
            if(event.detail<2&&draft.length<profile.maxPoints)draft.push(p)
            if(event.detail>1)finishPolygon()
            paint()
            return
        }
        else if(tool==='signature')void insert('signature',[[.25,.42],[.75,.58]])
        else {
            const shape=shapeFrom(tool==='eraser'?'pen':tool,[p,p])
            gesture={id:event.pointerId,start:p,shape}
        }
        if(gesture)overlay.setPointerCapture(event.pointerId)
    })
    scroller.addEventListener('pointermove',event=>{
        if(!(event.target instanceof HTMLCanvasElement)||!event.target.classList.contains('fm-page-overlay'))return
        const scene=flow?.sceneFor(event.target);if(scene&&scene.overlay!==overlay&&!gesture&&!pan)activateScene(scene)
        if(pan?.id===event.pointerId){scroller.scrollLeft=pan.left+pan.x-event.clientX;scroller.scrollTop=pan.top+pan.y-event.clientY;return}
        const p=point(event)
        if(['pen','highlight','eraser'].includes(tool)){brushPoint=p;requestPaint()}
        if(!gesture||gesture.id!==event.pointerId){
            const hit=current().findLast(shape=>hitAnnotationGeometry(shape,p,size.width,size.height,8,scale))
            overlay.style.cursor=hit&&['note','pin','link'].includes(hit.tool)?'pointer':''
            showNotePreview(hit)
            return
        }
        if(gesture.moving){
            const original=gesture.moving.points
            const dx=p[0]-gesture.start[0],dy=p[1]-gesture.start[1]
            if(gesture.handle?.startsWith('vertex:'))gesture.shape=moveAnnotationVertex(gesture.moving,Number(gesture.handle.slice(7)),p)
            else if(gesture.handle){
                const b=annotationBounds({...gesture.moving,points:original.slice(0,2)}), key=gesture.handle
                const left=key.includes('w')?Math.min(p[0],b.right-.001):b.left,right=key.includes('e')?Math.max(p[0],b.left+.001):b.right
                const top=key.includes('n')?Math.min(p[1],b.bottom-.001):b.top,bottom=key.includes('s')?Math.max(p[1],b.top+.001):b.bottom
                gesture.shape={...gesture.moving,points:[[limit(left),limit(top)],[limit(right),limit(bottom)],...original.slice(2)]}
            }else if(gesture.moving.tool!=='text-highlight'&&Math.hypot(dx*size.width,dy*size.height)>2)
                gesture.shape={...gesture.moving,points:translate(gesture.moving,dx,dy)}
        }else if(['pen','highlight','eraser'].includes(tool)&&gesture.shape.points.length<profile.maxPoints)
            gesture.shape={...gesture.shape,points:[...gesture.shape.points,p]}
        else gesture.shape={...gesture.shape,points:[gesture.start,p]}
        requestPaint()
    })
    let paintFrame=0
    function requestPaint():void{if(!paintFrame)paintFrame=view!.requestAnimationFrame(()=>{paintFrame=0;paint()})}
    scroller.addEventListener('pointerout',event=>{if(event.target===overlay){brushPoint=undefined;showNotePreview();requestPaint()}})
    function finishPolygon():void{
        if(tool==='select'||tool==='pan'||!polygonTools.includes(tool))return
        if(draft.length<(tool==='polyline'?2:3))return
        const shape=shapeFrom(tool as Annotation['tool'],draft);draft=[]
        try{model.dispatch({type:'add',shape});switchTool('select');selected=shape.id;sync();paint()}
        catch{status.textContent=text('limit')}
    }
    function translate(shape:Annotation, dx:number,dy:number):Point[]{
        const bounds=annotationBounds(shape)
        const x=limit(dx,-bounds.left,1-bounds.right),y=limit(dy,-bounds.top,1-bounds.bottom)
        return shape.points.map(([u,v])=>[u+x,v+y])
    }
    const onEnd=async(event:PointerEvent,commit:boolean):Promise<void>=>{
        if(pan?.id===event.pointerId){pan=undefined;return}
        if(gesture?.id!==event.pointerId)return
        const {shape,moving}=gesture;gesture=undefined;paint()
        if(!commit||closed)return
        try {
            if(moving){if(shape!==moving)model.dispatch({type:'update',id:shape.id,patch:{points:shape.points}});else if(['text','callout'].includes(shape.tool))editText(shape,false);else if(['note','pin'].includes(shape.tool))editNote(shape,false);return}
            if(tool==='eraser'){
                const shapes=model.getState().shapes
                const points=shape.points
                let next=shapes
                for(let i=1;i<points.length;i++)next=eraseInk(next,[points[i-1],points[i]],size.width,size.height,{radius:eraserSize*scale/2,strokeScale:scale,mode:profile.eraserMode,pageIndex,maxShapes:profile.maxShapes,maxPoints:profile.maxPoints}).shapes
                if(next!==shapes&&await confirm(text('eraseConfirm'))&&!closed&&model.getState().shapes===shapes)model.dispatch({type:'replace',shapes:next})
                return
            }
            if(shape.tool==='image'||shape.tool==='link'){if(Math.hypot(shape.points[1][0]-shape.points[0][0],shape.points[1][1]-shape.points[0][1])>.01)await insert(shape.tool,shape.points);return}
            if(['text','callout'].includes(shape.tool)){editText(shape,true);return}
            if(['note','pin'].includes(shape.tool)){editNote({...shape,points:shape.points.slice(0,1)},true);return}
            if(shape.points.some((p,i)=>i>0&&Math.hypot(p[0]-shape.points[0][0],p[1]-shape.points[0][1])>.001))model.dispatch({type:'add',shape})
        }catch{status.textContent=text('error')}
    }
    scroller.addEventListener('pointerup',event=>{if(event.target===overlay)void onEnd(event,true)})
    scroller.addEventListener('lostpointercapture',event=>{if(event.target===overlay)void onEnd(event,false)})
    const exportPDF=async():Promise<ArrayBuffer>=>{
        if(textEditor?.finish()===false)throw new Error(text('limit'))
        if(!pdf)throw new Error('Not a PDF')
        return pdf.canEditPages?exportAnnotatedPDF(pdf,model.getState().shapes,owner):pdf.getBytes()
    }
    function imageExport():HTMLCanvasElement{
        if(textEditor?.finish()===false)throw new Error(text('limit'))
        if(!image)throw new Error(text('image_failed'))
        const canvas=make('canvas')
        const ratio=Math.min(1,4096/image.naturalWidth,4096/image.naturalHeight,Math.sqrt(8388608/(image.naturalWidth*image.naturalHeight)))
        canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio))
        const ctx=canvas.getContext('2d')!
        ctx.drawImage(image,0,0,canvas.width,canvas.height)
        let pin=0
        for(const shape of current()){
            if(shape.tool==='pin')pin++
            paintAnnotation(ctx,shape,canvas.width,canvas.height,pin,false,ratio,asset(shape))
        }
        return canvas
    }
    const exportFile=async(original=false):Promise<void>=>{
        try {
            if(pdf){const bytes=original?await pdf.getBytes():await exportPDF();if(!closed)downloadMediaBlob(owner,new Blob([bytes],{type:'application/pdf'}),options.name??'document.pdf');return}
            const canvas=imageExport()
            canvas.toBlob(blob=>{if(blob&&!closed)downloadMediaBlob(owner,blob,'image.png')},'image/png')
        }catch{status.textContent=text('error')}
    }
    if(!read)addItem('select','select',()=>switchTool('select'),start)
    if(options.source.kind==='pdf'){
        if(toolbar.hasItem('pager')){
            const pager=make('div','fm-pager')
            start.append(pager);pager.append(pageCompact)
            addItem('pager','prev',()=>setPage(adjacentPage(-1)),pager)
            pager.append(pageSlot)
            hero.input(pageSlot,()=>({
                type:'text',inputMode:'numeric',autoComplete:'off','aria-label':text('page'),value:pageDraft??String((requestedPage??pageIndex)+1),
                ref:pageInputRef,onChange:event=>{pageDraft=event.currentTarget.value;hero.update()},onBlur:readPage,
                onKeyDown:event=>{
                    if(event.key==='Enter')event.preventDefault()
                    if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();pageDraft=String((requestedPage??pageIndex)+1+(event.key==='ArrowUp'?1:-1));readPage()}
                },
                onKeyUp:event=>{if(event.key==='Enter'){readPage();root.focus({preventScroll:true})}},
            }))
            addItem('pager','next',()=>setPage(adjacentPage(1)),pager)
            pager.append(pageTotal)
        }
        const sidebarSelect=make('div','fm-split fm-sidebar-select')
        start.prepend(sidebarSelect)
        const toggle=button('thumbnails',()=>showNavigation(sidebarTool),sidebarSelect)
        controls.set('pages',toggle)
        const selector=toolbar.hasItem('pages')?menuButton('sidebar_tools',()=>[
            ...(['thumbnails','outline','annotations','bookmarks','signatures'] as const)
                .filter(key=>key!=='annotations'||toolbar.hasItem('annotations'))
                .map(key=>({key,checked:sidebarTool===key,action:()=>showNavigation(key,true)})),
        ],sidebarSelect,'chevron'):undefined
        selector?.classList.add('fm-chevron-slot')
        sidebarSelect.hidden=!toolbar.hasItem('pages')
        showNavigation=(mode,force=false):void=>{
            if(!pdf)return
            const wasOpen=mode==='annotations'?!sidebar.hidden:!navigation.hidden&&navigationView?.mode===mode
            sidebarTool=mode
            paintViewerIcon(toggle,mode);localize(toggle,mode,'aria-label')
            if(mode==='annotations'){
                navigationView?.destroy();navigationView=undefined;navigation.hidden=true
                sidebar.hidden=wasOpen&&!force
            }else{
                sidebar.hidden=true
                if(wasOpen&&!force){navigationView?.destroy();navigationView=undefined;navigation.hidden=true}
                else{
                    navigation.hidden=false
                    if(navigationView)navigationView.setMode(mode)
                    else navigationView=mountViewerNavigation(navigation,pdf,text,setPage,()=>pageIndex,()=>showNavigation(mode),mode,{
                        bookmarks:()=>bookmarks,signatures:()=>model.getState().shapes.filter(shape=>shape.tool==='signature'),readOnly:read,
                        addBookmark:()=>{void updateBookmarks([...bookmarks,{id:crypto.randomUUID(),pageIndex,title:text('page')+' '+(pageIndex+1)}])},
                        removeBookmark:id=>{void(async()=>{if(await confirm(text('delete_bookmark_confirm')))await updateBookmarks(bookmarks.filter(item=>item.id!==id))})()},
                        selectAnnotation:(id,index)=>{switchTool('select');navigateTo(index,id)},
                    })
                }
            }
            toggle.setAttribute('aria-pressed',String(!navigation.hidden||!sidebar.hidden))
            sync()
            schedule()
        }
        const searchSlot=make('div','fm-hero-input'), searchBar=make('form','fm-search'), results=make('span','fm-search-results')
        let search:HTMLInputElement|null=null,searchPending=false
        let previousMatch:HTMLButtonElement|undefined,nextMatch:HTMLButtonElement|undefined
        searchBar.hidden=true
        results.setAttribute('role','status');results.setAttribute('aria-atomic','true')
        syncSearch=()=>{
            results.textContent=text('search_result_count').replace('{current}',String(searchHits.length?searchIndex+1:0)).replace('{total}',String(searchHits.length))
            results.setAttribute('aria-busy',String(searchPending))
            if(previousMatch)previousMatch.disabled=searchPending||searchHits.length===0
            if(nextMatch)nextMatch.disabled=searchPending||searchHits.length===0
        }
        const showHit=(offset:number):void=>{
            if(!searchHits.length)return
            searchIndex=(searchIndex+offset+searchHits.length)%searchHits.length
            syncSearch();setPage(searchHits[searchIndex].pageIndex);paint()
        }
        const toggleSearch=():void=>{
            searchBar.hidden=!searchBar.hidden
            controls.get('search')?.setAttribute('aria-pressed',String(!searchBar.hidden))
            if(!searchBar.hidden){syncSearch();search?.focus();return}
            searchAbort?.abort();searchPending=false;searchHits=[];searchIndex=-1;syncSearch();paint()
        }
        async function find(query:string):Promise<void>{
            if(!pdf)return
            searchAbort?.abort();const controller=new AbortController();searchAbort=controller
            const document=pdf;searchHits=[];searchIndex=-1;searchPending=!!query;syncSearch();paint()
            if(!query)return
            const hits:SearchHit[]=[]
            try{
                const firstPage=pageIndex
                for(let i=0;i<document.pageCount&&hits.length<1000;i++){
                    const index=(firstPage+i)%document.pageCount
                    hits.push(...await document.searchPage(index,query,{limit:Math.min(100,1000-hits.length),signal:controller.signal}))
                    if(closed||controller.signal.aborted||pdf!==document)return
                }
                searchHits=hits;searchPending=false
                if(hits.length)showHit(1);else syncSearch()
            }catch{if(!closed&&!controller.signal.aborted){searchPending=false;syncSearch();status.textContent=text('error')}}
        }
        addItem('search','search',toggleSearch)
        if(toolbar.hasItem('search')){
            searchBar.append(searchSlot,results)
            hero.input(searchSlot,()=>({type:'search','aria-label':text('search_query'),placeholder:text('search_query'),ref:node=>{search=node}}))
            previousMatch=button('prev',()=>showHit(-1),searchBar);localize(previousMatch,'search_previous','aria-label')
            nextMatch=button('next',()=>showHit(1),searchBar);localize(nextMatch,'search_next','aria-label')
            button('close',toggleSearch,searchBar)
            syncSearch()
            searchBar.onsubmit=event=>{event.preventDefault();void find(search?.value.trim()??'')}
            searchBar.onkeydown=event=>{if(event.key==='Escape'){event.stopPropagation();toggleSearch();controls.get('search')?.focus()}}
            root.append(searchBar)
        }
        const openPageEditor=()=>{
            if(!pdf||editingContent||!canOperate('pages')||controls.get('edit-pages')?.disabled)return
            if(cropping)leaveCrop()
            const document=pdf
            openPDFPageEditor({owner:root,pdf:document,maxPages:profile.maxPages,signal,hero,text,confirm,saveAs:toolbar.hasItem('download')?async plan=>{
                if(options.source.kind!=='pdf'||pdf!==document)throw abortError()
                const bytes=await document.editPages(plan,options.maxPdfOutputBytes)
                signal.throwIfAborted()
                const {openPDF}=await import('./pdf.js')
                const copy=await openPDF({...options.source.pdf,source:new Uint8Array(bytes),signal})
                try{
                    const annotations=preserveAnnotations?remapPageAnnotations(model.getState().shapes,plan):[]
                    const output=await exportAnnotatedPDF(copy,annotations,owner)
                    signal.throwIfAborted()
                    downloadMediaBlob(owner,new Blob([output],{type:'application/pdf'}),options.name??'document.pdf')
                }finally{await copy.destroy()}
            }:undefined,save:async plan=>{
                const sourcePDF=pdf!
                if(sourcePDF!==document)throw abortError()
                if(busy||bookmarkBusy)throw new Error('Document is busy')
                const annotations=preserveAnnotations?remapPageAnnotations(model.getState().shapes,plan):[]
                await runPDFChange(async()=>{
                    const bytes=await sourcePDF.editPages(plan,options.maxPdfOutputBytes)
                    await replaceDocument(sourcePDF,bytes,annotations,plan,'pages',0)
                })
            }})
        }
        if(!read&&toolbar.hasItem('edit-pages')&&(canOperate('pages')||canOperate('crop')||canOperate('content'))){
            const editorGroup=make('div','fm-split')
            end.append(editorGroup)
            const editorButton=button('edit-pages',canOperate('pages')?openPageEditor:canOperate('crop')?startCrop:startContentEditor,editorGroup)
            controls.set('edit-pages',editorButton)
            if(canOperate('crop')||canOperate('content')){
                const menu=menuButton('document_editors',()=>[
                    ...(canOperate('pages')?[{key:'edit-pages',checked:!cropping&&!editingContent,action:openPageEditor}]:[]),
                    ...(canOperate('crop')?[{key:'document_crop',checked:cropping,action:startCrop}]:[]),
                    ...(canOperate('content')?[{key:'content_editor',checked:editingContent,action:startContentEditor}]:[]),
                ],editorGroup,'chevron')
                menu.classList.add('fm-chevron-slot')
            }
        }
    }
    const setScrollMode=async(next:PDFScrollMode):Promise<void>=>{
        if(textEditor?.finish()===false)return
        if(!['paginated','continuous'].includes(next))throw new RangeError('Invalid PDF scroll mode')
        if(!pdf||next===scrollMode)return
        selectedText()?.removeAllRanges();markupMenu.hidden=true;selectingText=false
        gesture=undefined;pan=undefined;draft=[];selected=null
        if(editingContent)contentEditor.detach()
        const targetPage=requestedPage??pageIndex;requestedPage=null;requestedAnnotation=null;clearFlow();previewRender?.abort();tileSurface?.hide()
        ;({stage,source,overlay,text:textLayer,links,tiles:tileLayer}=singlePage)
        if(next==='paginated'&&pageLayout==='single')scroller.append(stage)
        scrollMode=next;if(next==='paginated')zoomState.set('fit-page');renderedKey='';scroller.scrollTop=scroller.scrollLeft=0
        const modeEpoch=flowEpoch
        await layout();if((next==='continuous'||pageLayout==='double')&&modeEpoch===flowEpoch)await (flow as Awaited<ReturnType<typeof createPDFPageFlow>>|undefined)?.goTo(requestedPage??targetPage)
        sync()
    }
    const setPageLayout=async(next:PDFPageLayout,cover=firstPageSingle):Promise<void>=>{
        if(!['single','double'].includes(next)||typeof cover!=='boolean')throw new RangeError('Invalid PDF page layout')
        if(!pdf||closed||(next===pageLayout&&cover===firstPageSingle))return
        if(textEditor?.finish()===false)return
        selectedText()?.removeAllRanges();markupMenu.hidden=true;selectingText=false;gesture=undefined;pan=undefined;draft=[];selected=null
        if(editingContent)contentEditor.detach()
        const targetPage=requestedPage??pageIndex;requestedPage=null;requestedAnnotation=null
        clearFlow();previewRender?.abort();tileSurface?.hide()
        ;({stage,source,overlay,text:textLayer,links,tiles:tileLayer}=singlePage)
        pageLayout=next;firstPageSingle=cover
        if(scrollMode==='paginated'&&next==='single')scroller.append(stage)
        zoomState.set('fit-page');renderedKey='';scroller.scrollTop=scroller.scrollLeft=0
        const epoch=flowEpoch
        await layout();if(epoch===flowEpoch)await (flow as Awaited<ReturnType<typeof createPDFPageFlow>>|undefined)?.goTo(targetPage)
        sync()
    }
    const changeDisplay=(operation:Promise<void>):void=>{void operation.catch(error=>{if(!closed&&error?.name!=='AbortError')status.textContent=text('error')})}
    if(options.source.kind==='pdf'&&toolbar.hasItem('viewMode'))menuButton('viewMode',()=>[
        {key:'paginated',checked:scrollMode==='paginated',action:()=>changeDisplay(setScrollMode('paginated'))},
        {key:'continuous',checked:scrollMode==='continuous',action:()=>changeDisplay(setScrollMode('continuous'))},
        {key:'single_page_layout',checked:pageLayout==='single',action:()=>changeDisplay(setPageLayout('single'))},
        {key:'double_page_layout',checked:pageLayout==='double',action:()=>changeDisplay(setPageLayout('double'))},
        {key:'single_cover',checked:firstPageSingle,action:()=>changeDisplay(setPageLayout(pageLayout,!firstPageSingle))},
    ],start,'viewMode')
    addItem('pan','pan',()=>switchTool('pan'),start)
    const setZoom=async(value:'fit-page'|'fit-width'|number):Promise<void>=>{
        if(closed)return
        const box=stage.getBoundingClientRect(),viewport=scroller.getBoundingClientRect()
        const center={x:viewport.left+viewport.width/2,y:viewport.top+viewport.height*.1}
        const anchor={x:(center.x-box.left)/size.width,y:(center.y-box.top)/size.height}
        const old=scale
        zoomState.set(value);sync();renderedKey='';await layout()
        if(closed)return
        if(!flow&&old!==scale){
            const after=stage.getBoundingClientRect()
            scroller.scrollLeft+=after.left+anchor.x*size.width-center.x
            scroller.scrollTop+=after.top+anchor.y*size.height-center.y
        }
        sync()
    }
    const zoomBy=(factor:number):void=>{void setZoom(scale*factor).catch(()=>{if(!closed)status.textContent=text('error')})}
    addItem('zoom','zoomOut',()=>zoomBy(1/1.25),start);addItem('zoom','zoomIn',()=>zoomBy(1.25),start)
    addItem('zoomMode','fit',()=>{void setZoom(zoomState.mode==='fit-page'?'fit-width':'fit-page')},start)
    const activateTool=(id:AnnotationTool):void=>{
        if(id==='signature')void insert(id,[[.25,.42],[.75,.58]])
        else switchTool(tool===id?'select':id)
    }
    if(!read){
        end.append(toolStrip)
        const order=['drawing','text','notes','insert','shapes'] as const
        for(const group of order){
            const entries=toolbar.getTools(group).filter(({id})=>id!=='signature')
            if(!entries.length)continue
            const split=make('div','fm-split');toolStrip.append(split)
            const main=button(entries[0].id,()=>{const id=toolbar.selectGroup(group);if(id&&id!=='signature')activateTool(id)},split)
            groups.set(group,main)
            if(entries.length>1){
                const trigger=menuButton(group==='text'?'textTools':group,()=>entries.map(({id})=>({key:id,checked:toolbar.selectGroup(group)===id,action:()=>activateTool(id)})),split,'chevron')
                trigger.classList.add('fm-chevron-slot')
            }
        }
        if(allowed.includes('signature'))button('signature',()=>activateTool('signature'),toolStrip)
        addItem('undo','undo',()=>{if(textEditor?.finish()!==false)model.dispatch({type:'undo'})});addItem('redo','redo',()=>{if(textEditor?.finish()!==false)model.dispatch({type:'redo'})})
        addItem('delete','delete',()=>{void remove(selected)})
        if(options.saveAnnotations)controls.set('save',button('save',()=>{
            if(busy)return
            if(textEditor?.finish()===false)return
            const snapshot=model.getState().shapes;busy=true;sync()
            void options.saveAnnotations!(snapshot,signal).then(()=>{if(!closed){model.markSaved(snapshot);status.textContent=text('saved')}}).catch(error=>{if(!closed)status.textContent=error instanceof Error?error.message:text('error')}).finally(()=>{busy=false;sync()})
        },footer))
    }
    const choices:Partial<Record<ToolProperty,readonly string[]>>={
        color:profile.colors,strokeColor:profile.colors,fontFamily:profile.textFonts,verticalAlign:['top','center','bottom'],fill:['none',...profile.colors],dash:['solid','dashed','dotted'],
        align:['left','center','right'],noteIcon:profile.noteIcons,
        startCap:profile.lineEndings,endCap:profile.lineEndings,blendMode:profile.blendModes,
        cloudIntensity:['1','2','3'],
    }
    const numeric:Partial<Record<ToolProperty,{initial:number;min:number;max:number;presets:readonly number[]}>>={
        opacity:{initial:1,min:0,max:1,presets:[0,.1,.25,.5,.75,.9,1]},
        stroke:{initial:5,min:profile.minStroke,max:profile.maxStroke,presets:[1,2,3,4,5,8,10,12,15,20,24,30,40,60]},
        fontSize:{initial:18,min:8,max:96,presets:[8,10,12,14,16,18,20,24,28,32,40,48,64,72,96]},
        eraserSize:{initial:profile.eraserSize,min:1,max:160,presets:[4,8,12,16,20,30,40,60,80,120,160]},
    }
    const labelPrefix:Partial<Record<ToolProperty,string>>={noteIcon:'note_',startCap:'cap_',endCap:'cap_',blendMode:'blend_',cloudIntensity:'cloud_'}
    for(const key of ['color','fill','opacity','stroke','dash','startCap','endCap','cloudIntensity','blendMode','noteIcon','fontFamily','fontSize','bold','italic','underline','align','verticalAlign','eraserSize','strokeColor'] as const){
        if(!allowed.some(id=>toolbar.supports(id,key)))continue
        const wrapper=make('div','fm-property'),slot=make('div','fm-hero-choice'),setting=numeric[key]
        const toggle=key==='bold'||key==='italic'||key==='underline'
        const initial=String(toggle ? false : setting?.initial ?? choices[key]?.[0] ?? '')
        const presentation=toolPropertyPresentation(key,null),labelKey=presentation.label
        const control={value:initial,initial,wrapper,labelKey,icon:presentation.icon}
        wrapper.dataset.property=key
        const caption=make('span','fm-property-icon')
        if(!toggle&&key!=='align'&&key!=='verticalAlign'){
            caption.setAttribute('aria-hidden','true')
            if(!paintViewerIcon(caption,control.icon))localize(caption,control.labelKey)
            wrapper.append(caption)
        }
        const change=(input:string):void=>{
            const activeShape=current().find(shape=>shape.id===selected&&allowed.includes(shape.tool))
            const active=tool==='select'||tool==='pan'?activeShape?.tool:tool
            if(!active||!toolbar.supports(active,key))return
            const value=toggle ? input==='true' : setting ? limit(Number(input),setting.min,setting.max)
                : key==='cloudIntensity'?Number(input):input
            if(key==='eraserSize')eraserSize=Number(value)
            else {
                const patch={ [key]: value }
                if(activeShape&&textEditor?.active()?.id===activeShape.id)textEditor.patch(patch)
                else if(activeShape)model.dispatch({type:'update',id:activeShape.id,patch})
                else styles.set(active,{...styleOf(active),...patch})
            }
            sync();requestPaint()
        }
        if(toggle)hero.toggle(slot,()=>({label:text(control.labelKey),icon:key,active:control.value==='true',action:()=>change(String(control.value!=='true'))}))
        else if(key==='align'||key==='verticalAlign'){
            slot.classList.add('fm-text-alignment');slot.setAttribute('role','group');localize(slot,control.labelKey,'aria-label')
            const icons=key==='align'?['alignLeft','alignCenter','alignRight']:['alignTop','alignMiddle','alignBottom']
            for(const [index,value] of (choices[key]??[]).entries()){
                const choice=make('span');slot.append(choice)
                hero.toggle(choice,()=>({label:text(key==='align'?'align_'+value:'vertical_'+value),icon:icons[index],active:control.value===value,action:()=>change(value)}))
            }
        }
        else if(key==='noteIcon')hero.noteChoices(slot,()=>({label:text(control.labelKey),value:control.value,choices:[...new Set([...noteChoices,control.value])].filter(value=>profile.noteIcons.includes(value as typeof profile.noteIcons[number])).map(value=>({key:value,label:text('note_'+value)})),onChange:change}),true)
        else hero.choice(slot,()=>{
            const values=setting
                ? [...new Set([setting.min,...setting.presets,setting.max,Number(control.value)])].filter(value=>value>=setting.min&&value<=setting.max).sort((a,b)=>a-b).map(String)
                : choices[key]??[]
            return {
                label:text(control.labelKey),value:control.value,onChange:change,
                choices:values.map(value=>({key:value,label:setting
                    ? (key==='opacity' ? new Intl.NumberFormat(locale,{style:'percent'}).format(Number(value)) : value+' pt')
                    : text((labelPrefix[key]??'')+value)})),
            }
        },key==='color'||key==='fill'||key==='strokeColor')
        if(key==='color'){
            const inline=make('div','fm-note-inline')
            hero.noteChoices(inline,()=>({label:text(control.labelKey),value:control.value,
                choices:[...new Set([...noteColors,control.value])].map(value=>({key:value,label:labels['color_'+value.slice(1)]??value})),onChange:change}),false)
            wrapper.append(inline)
        }
        wrapper.append(slot);properties.append(wrapper);propertyControls.set(key,control)
        responsiveProperties.register(key,wrapper,labelKey)
    }
    const redactionToolbar=options.source.kind==='pdf'&&!read&&profile.textMarkupActions.includes('redaction')&&canOperate('redactions')?mountRedactionToolbar(properties,{
        hero,text,colors:profile.colors,properties:options.toolbar?.properties,
        selected:()=>current().find(shape=>shape.id===selected),busy:()=>busy,
        canApply:()=>!!pdf?.canEditPages&&!read,
        update:patch=>{const shape=current().find(shape=>shape.id===selected);if(!busy&&!read&&shape?.markup==='redaction'){try{model.dispatch({type:'update',id:shape.id,patch})}catch{status.textContent=text('limit')}}},
        comment:()=>{const shape=current().find(shape=>shape.id===selected);if(shape)editComment(shape)},
        remove:()=>{void remove(selected)},apply:()=>{void applyRedactions().catch(()=>{if(!closed)status.textContent=text('error')})},
    }):{update:(_visible:boolean)=>{}}
    const cropBar=make('div','fm-crop-controls');cropBar.hidden=true;properties.append(cropBar)
    if(options.source.kind==='pdf'&&!read&&canOperate('crop')){
        for(const [label,action] of [
            ['crop_current',()=>{void applyCrop(false)}],['crop_all',()=>{void applyCrop(true)}],['cancel',()=>leaveCrop()],
        ] as const){
            const item=make('div','fm-crop-action');cropBar.append(item)
            hero.action(item,()=>({label:text(label),disabled:busy||label!=='cancel'&&!crop,action}))
        }
    }
    const cropSelection=createCropSelection(scroller,signal,{
        active:()=>cropping&&!busy,
        pickPage:element=>{
            const surface=element.closest<HTMLElement>('.fm-stage')
            if(!surface)return
            const scene=flow?.sceneFor(surface)
            return {stage:surface,index:scene?.index??pageIndex}
        },
        change:value=>{crop=value?{pageIndex:value.index,box:value.box}:undefined;sync()},
    })
    function startCrop(){
        if(read||busy||editingContent||!pdf?.canEditPages||!canOperate('crop'))return
        switchTool('select');cropping=true;root.dataset.cropping='true';sync()
    }
    function leaveCrop(){
        cropping=false;crop=undefined;cropSelection.clear();delete root.dataset.cropping;sync()
    }
    async function applyCrop(all:boolean){
        if(!cropping||!crop||!pdf||busy||bookmarkBusy)return
        const original=pdf, target=crop, snapshot=model.getState().shapes
        try{
            const crops=all?Array.from({length:original.pageCount},(_,pageIndex)=>({pageIndex,box:target.box})):[target]
            let annotations:readonly Annotation[]
            try{annotations=remapCropAnnotations(snapshot,crops)}catch{status.textContent=text('crop_annotations');return}
            await runPDFChange(async()=>{
                const bytes=await original.cropPages(crops,options.maxPdfOutputBytes)
                const plan=Array.from({length:original.pageCount},(_,index)=>({index,rotation:0}))
                await replaceDocument(original,bytes,annotations,plan,'crop',target.pageIndex)
                if(!closed)leaveCrop()
            })
        }catch{if(!closed)status.textContent=text('crop_failed')}
    }
    const preparation=make('div','fm-content-preparation')
    const preparationCard=make('div'),preparationTitle=make('strong'),preparationCount=make('span'),preparationProgress=make('progress'),preparationCancel=make('div')
    preparation.hidden=true;preparationCard.append(preparationTitle,preparationProgress,preparationCount,preparationCancel);preparation.append(preparationCard)
    if(options.source.kind==='pdf'&&!read&&canOperate('content')){
        localize(preparationTitle,'pdf_text_preparing')
        localize(preparationProgress,'pdf_text_preparing','aria-label')
        hero.action(preparationCancel,()=>({label:text('cancel'),variant:'secondary',action:leaveContentEditor}))
        root.append(preparation)
    }
    const contentBar=make('div','fm-crop-controls fm-content-controls');contentBar.hidden=true;properties.append(contentBar)
    const contentEditor=createContentEditor({root,text,onChange:()=>hero.update(),preview:async(index,edits,width,height,previewSignal)=>{
        if(!pdf||!editingContent)throw abortError()
        return pdf.previewText(index,edits,width,height,previewSignal)
    }})
    if(options.source.kind==='pdf'&&!read&&canOperate('content')){
        const slot=()=>{const element=make('div');contentBar.append(element);return element}
        const active=()=>contentEditor.active()
        const appearance=()=>({...active()?.block?.appearance,...active()?.appearance})
        const disabled=()=>busy||!active()
        const familyChoices=()=>[
            ...(active()?.block?[{key:'original',label:active()?.block?.font||text('pdf_font_original')}]:[]),
            ...pdfTextFamilies.map(key=>({key,label:text('pdf_font_'+key)})),
        ]
        hero.toggle(slot(),()=>({label:text('pdf_text_add'),icon:'newPage',active:contentEditor.insertMode(),disabled:busy,action:()=>contentEditor.setInsertMode(!contentEditor.insertMode())}))
        hero.choice(slot(),()=>{
            const value=appearance().color??'#000000'
            return {label:text('fontColor'),value,disabled:disabled(),choices:[...new Set([value,'#000000',...profile.colors])].map(key=>({key,label:labels['color_'+key.slice(1)]??key})),onChange:color=>contentEditor.update({color})}
        },true)
        hero.choice(slot(),()=>({label:text('pdf_text_font'),value:appearance().family??'original',choices:familyChoices(),disabled:disabled(),onChange:value=>{
            if(value!=='original')contentEditor.update({family:value as PDFTextFamily})
            else contentEditor.update({family:undefined,bold:undefined,italic:undefined})
        }}),false)
        hero.input(slot(),()=>({type:'number',min:1,max:144,step:1,'aria-label':text('pdf_text_size'),isDisabled:disabled(),value:active()?String(Math.round((appearance().size??12)*10)/10):'',onBlur:event=>{
            const size=Number(event.currentTarget.value)
            if(size>=1&&size<=144&&size!==appearance().size)contentEditor.update({size})
        }}))
        for(const key of ['bold','italic'] as const)hero.toggle(slot(),()=>({label:text(key),icon:key,active:!!appearance()[key],disabled:disabled(),action:()=>contentEditor.update({[key]:!appearance()[key]})}))
        hero.action(slot(),()=>({label:text('pdf_text_delete'),variant:'ghost',disabled:disabled(),action:()=>contentEditor.remove()}))
        const spacer=slot();spacer.className='fm-content-spacer'
        hero.action(slot(),()=>({label:text('cancel'),variant:'secondary',disabled:busy,action:()=>{void cancelContentEditor()}}))
        hero.action(slot(),()=>({label:text('save_pdf_text'),disabled:busy||!contentEditor.isDirty()||!contentEditor.canSave(),action:()=>{void applyContentEdit()}}))
    }
    function startContentEditor(){
        if(read||busy||editingContent||!pdf?.canEditPages||!canOperate('content'))return
        switchTool('select');editingContent=true;root.dataset.editingContent='true';sync();void prepareContent(pdf)
    }
    function closePreparation(){
        if(!contentPreparation)return
        contentPreparation.abort();contentPreparation=undefined;preparation.hidden=true
        if(!busy&&!closed){body.inert=false;top.inert=false;footer.inert=false;properties.inert=false;root.setAttribute('aria-busy','false')}
    }
    async function prepareContent(document:IndependentPDFDocument){
        const controller=new AbortController(),initialPage=pageIndex
        contentPreparation=controller
        const abort=()=>controller.abort()
        signal.addEventListener('abort',abort,{once:true})
        preparationProgress.max=document.pageCount;preparationProgress.value=0
        const updateProgress=(completed:number)=>{
            preparationProgress.value=completed
            preparationCount.textContent=text('pdf_text_progress').replace('{done}',String(completed)).replace('{total}',String(document.pageCount))
        }
        updateProgress(0);preparation.hidden=false;body.inert=true;top.inert=true;footer.inert=true;properties.inert=true;root.setAttribute('aria-busy','true')
        preparationCancel.querySelector('button')?.focus({preventScroll:true})
        try{
            const sizes=await document.getPageSizes()
            controller.signal.throwIfAborted()
            for(let offset=0;offset<document.pageCount;offset++){
                const index=(initialPage+offset)%document.pageCount
                const blocks=await document.getTextBlocks(index,controller.signal)
                controller.signal.throwIfAborted()
                const paragraphs=groupPDFParagraphs(blocks,sizes[index].height)
                // Keep the starting page and its nearest neighbors. Distant pages can be loaded again on demand.
                if(Math.abs(index-initialPage)<=6)preparedText.set(index,paragraphs)
                updateProgress(offset+1)
            }
            closePreparation();await loadContentBlocks()
        }catch{
            if(!controller.signal.aborted){leaveContentEditor();status.textContent=text('pdf_text_prepare_failed')}
        }finally{signal.removeEventListener('abort',abort)}
    }
    function leaveContentEditor(){
        closePreparation();preparedText.clear()
        editingContent=false;contentEpoch++;contentEditor.reset()
        delete root.dataset.editingContent;sync()
    }
    async function cancelContentEditor(){
        if(!busy&&(!contentEditor.isDirty()||await confirm(text('pdf_text_discard'),'discard')))leaveContentEditor()
    }
    async function loadContentBlocks(){
        if(flow){
            await Promise.all(flow.scenes().map(scene=>loadContentPage(scene.stage,scene.index,scene.height/scene.scale)))
        }else await loadContentPage(stage,pageIndex,size.height/scale)
    }
    async function loadContentPage(target:HTMLElement,index:number,height:number){
        if(!editingContent||contentPreparation||busy||!pdf||contentEditor.has(target,index))return
        const document=pdf,epoch=contentEpoch,previous=pendingContentPages.get(target)
        if(previous?.epoch===epoch&&previous.index===index)return
        const request={epoch,index}
        pendingContentPages.set(target,request)
        try{
            const blocks=preparedText.get(index)??groupPDFParagraphs(await document.getTextBlocks(index,signal),height)
            if(editingContent&&epoch===contentEpoch&&document===pdf&&target.isConnected&&pendingContentPages.get(target)===request){
                contentEditor.show(target,index,height,blocks)
                if(index===pageIndex)status.textContent=blocks.length?text('choose_pdf_text'):text('no_pdf_text')
            }
        }catch{if(!closed&&epoch===contentEpoch&&index===pageIndex)status.textContent=text('error')}
        finally{if(pendingContentPages.get(target)===request)pendingContentPages.delete(target)}
    }
    async function applyContentEdit(){
        if(!editingContent||contentPreparation||!pdf||busy||bookmarkBusy||!contentEditor.isDirty()||!contentEditor.canSave())return
        const original=pdf,index=pageIndex,edits=contentEditor.edits()
        try{
            await runPDFChange(async()=>{
                const bytes=await original.editText(edits,options.maxPdfOutputBytes)
                const plan=Array.from({length:original.pageCount},(_,index)=>({index,rotation:0}))
                await replaceDocument(original,bytes,model.getState().shapes,plan,'content',index)
                if(!closed){leaveContentEditor();status.textContent=text('pdf_text_saved')}
            })
        }catch{if(!closed)status.textContent=text('pdf_text_failed')}
    }
    if(options.source.kind==='image')addItem('annotations','annotations',()=>{sidebar.hidden=!sidebar.hidden;sync();schedule()})
    const sideHeader=make('div','fm-panel-header'),sideCount=make('span','fm-panel-count');sideHeader.append(sideCount)
    if(!read&&toolbar.hasItem('delete'))menuButton('more',()=>[{key:'clear',action:()=>{void clear()}}],sideHeader,'more')
    const sideFooter=make('div','fm-bar fm-footer fm-side-footer')
    if(!read&&toolbar.hasItem('delete')){
        const removeSelected=button('delete',()=>{void remove(selected)},sideFooter)
        removeSelected.replaceChildren();paintViewerIcon(removeSelected,'delete');localize(removeSelected,'delete','aria-label');controls.set('sidebar-delete',removeSelected)
    }
    sidebar.append(sideHeader,list,sideFooter)
    const resizeOptions={signal,onResize:(active:boolean)=>{resizingSidebar=active;root.dataset.resizing=String(active);schedule()}}
    mountSidebarResizer(sidebar,root,{...resizeOptions,edge:options.source.kind==='pdf'?'start':'end',label:text('resize_annotations')})
    mountSidebarResizer(navigation,root,{...resizeOptions,edge:'start',label:text('resize_thumbnails')})
    addItem('download','download',()=>{void exportFile()})
    if(options.source.kind==='pdf'&&toolbar.hasItem('download')){
        controls.get('download')?.remove()
        menuButton('download',()=>[{key:'annotated',action:()=>{void exportFile()}},{key:'original',action:()=>{void exportFile(true)}}])
    }
    const selectionHighlights=createPDFSelectionHighlights()
    const markupMenu=make('div','fm-markup')
    markupMenu.hidden=true;markupMenu.setAttribute('role','toolbar');localize(markupMenu,'text_selection','aria-label');root.append(markupMenu)
    type PageSelection={index:number;layer:HTMLElement;rectangles:ReturnType<typeof readTextSelection>;stage:HTMLElement;width:number;height:number}
    let markupSelection:PageSelection[]=[],selectingText=false,selectionFrame=0
    let textPointer:{id:number;x:number;y:number;dragged:boolean}|undefined
    const selectedText=():Selection|null=>(shadow as ShadowRoot & {getSelection?():Selection}).getSelection?.()??owner.getSelection()
    const applyMarkup=(action:typeof profile.textMarkupActions[number]):void=>{
        if(busy||read||!markupSelection.length||!allowed.includes('text-highlight')||action==='redaction'&&!pdf?.canEditPages)return
        const selections=markupSelection;markupMenu.hidden=true;markupSelection=[];selectionHighlights.clear();selectedText()?.removeAllRanges()
        try{
            let shapes=model.getState().shapes,last:string|null=null
            for(const {index,rectangles} of selections){
                const [x,y]=rectangles[0]
                const candidate=shapeFrom('text-highlight',[[x,y],[x,y]],{pageIndex:index,rectangles,stroke:profile.minStroke,...((action==='highlight'||action==='comment')&&!styles.has('text-highlight')&&profile.colors.includes('#fff176')?{color:'#fff176'}:{}),...(action==='comment'?{text:''}:{}),markup:action==='comment'?'highlight':action,...(action==='redaction'?{fill:'#000000',overlayColor:profile.colors[0],repeatOverlayText:false}: {})})
                const result=prepareTextMarkup(shapes,candidate)
                if(result.limited)throw new Error('Text markup limit')
                shapes=result.shapes;last=result.selectedId
            }
            if(shapes!==model.getState().shapes)model.dispatch({type:'replace',shapes})
            if(action==='redaction')switchTool('select')
            selected=last;sync();flow?.refresh();paint()
            if(action==='comment'&&selected){const shape=model.getState().shapes.find(item=>item.id===selected);if(shape)editComment(shape)}
        }catch{status.textContent=text('limit')}
    }
    for(const action of profile.textMarkupActions.filter(action=>action!=='redaction'||canOperate('redactions')))button('markup_'+action,()=>applyMarkup(action),markupMenu)
    const showSelection=(finalize=false):void=>{
        if(cropping||editingContent||busy||!pdf||!['select','text-highlight'].includes(tool)){selectionHighlights.clear();markupMenu.hidden=true;return}
        const selection=selectedText()
        const scenes=flow?.scenes()??[{index:pageIndex,text:textLayer,stage,width:size.width,height:size.height}]
        markupSelection=scenes.map(scene=>({index:scene.index,layer:scene.text,rectangles:readTextSelection(scene.text,selection),stage:scene.stage,width:scene.width,height:scene.height}))
            .filter(item=>item.rectangles.length).sort((a,b)=>a.index-b.index)
        selectionHighlights.show(markupSelection)
        markupMenu.hidden=!markupSelection.length||read||!allowed.includes('text-highlight')||selectingText&&!finalize
        if(markupMenu.hidden)return
        if(finalize&&tool==='text-highlight'&&profile.textMarkupActions.includes('highlight')){applyMarkup('highlight');return}
        const bounds=scroller.getBoundingClientRect()
        const visible=markupSelection.flatMap(item=>item.rectangles.map(rect=>({item,rect,box:item.stage.getBoundingClientRect()})))
            .find(({item,rect,box})=>box.top+(rect[1]+rect[3])*item.height>bounds.top&&box.top+rect[1]*item.height<bounds.bottom)
        if(!visible){markupMenu.hidden=true;return}
        const {item,rect:[x,y,w,h],box}=visible
        const above=box.top+y*item.height-markupMenu.offsetHeight-10,below=box.top+(y+h)*item.height+10
        markupMenu.dataset.placement=above>=bounds.top?'above':'below'
        markupMenu.style.left=Math.max(bounds.left+4,Math.min(bounds.right-markupMenu.offsetWidth-4,box.left+(x+w/2)*item.width-markupMenu.offsetWidth/2))+'px'
        markupMenu.style.top=Math.max(bounds.top+4,Math.min(bounds.bottom-markupMenu.offsetHeight-4,above>=bounds.top?above:below))+'px'
    }
    const selectionChanged=():void=>{
        if(!selectionFrame)selectionFrame=view.requestAnimationFrame(()=>{selectionFrame=0;showSelection()})
    }
    owner.addEventListener('keydown',event=>{
        if(markupMenu.hidden||!root.contains(shadow.activeElement))return
        if(event.key==='Tab'){
            const buttons=[...markupMenu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
            if(!buttons.length)return
            const index=buttons.indexOf(shadow.activeElement as HTMLButtonElement)
            event.preventDefault();event.stopPropagation();buttons[(index+(event.shiftKey?-1:1)+buttons.length)%buttons.length].focus({preventScroll:true})
        }else if(event.key==='Escape'){markupMenu.hidden=true;selectedText()?.removeAllRanges();selectionHighlights.clear()}
    },{signal})
    markupMenu.onpointerdown=event=>event.preventDefault()
    scroller.addEventListener('pointerdown',event=>{
        if(!(event.target instanceof Element))return
        const layer=event.target.closest('.fm-text')
        if(layer){
            const scene=flow?.sceneFor(layer);if(scene)activateScene(scene)
            textPointer={id:event.pointerId,x:event.clientX,y:event.clientY,dragged:false}
            selectingText=true;markupMenu.hidden=true
        }else if(!event.target.closest('.fm-markup')){textPointer=undefined;selectedText()?.removeAllRanges();markupMenu.hidden=true}
    },{signal})
    scroller.addEventListener('click',event=>{
        if(interceptTextClick){interceptTextClick=false;return}
        if(busy||read||tool!=='select'||!(event.target instanceof Element)||!event.target.closest('.fm-text'))return
        const dragged=textPointer?.dragged;textPointer=undefined
        if(dragged||readTextSelection(event.target.closest<HTMLElement>('.fm-text')!,selectedText()).length)return
        const layer=event.target.closest('.fm-text')!;const scene=flow?.sceneFor(layer);if(scene)activateScene(scene)
        const box=overlay.getBoundingClientRect(),p:Point=[(event.clientX-box.left)/box.width,(event.clientY-box.top)/box.height]
        const hit=current().findLast(shape=>shape.tool==='text-highlight'&&hitAnnotationGeometry(shape,p,size.width,size.height,2,scale))
        selected=hit?.id??null;selectedText()?.removeAllRanges();selectionHighlights.clear();markupMenu.hidden=true;sync();flow?.refresh();paint()
    },{signal})
    const trackTextPointer=(event:PointerEvent):void=>{
        if(textPointer?.id===event.pointerId&&Math.hypot(event.clientX-textPointer.x,event.clientY-textPointer.y)>3)textPointer.dragged=true
    }
    owner.addEventListener('pointermove',trackTextPointer,{signal,passive:true})
    owner.addEventListener('pointerup',event=>{if(selectingText){trackTextPointer(event);selectingText=false;showSelection(true)}},{signal})
    owner.addEventListener('pointercancel',()=>{selectingText=false;textPointer=undefined},{signal})
    owner.addEventListener('selectionchange',selectionChanged,{signal})
    scroller.addEventListener('scroll',selectionChanged,{signal,passive:true})
    scroller.addEventListener('keyup',()=>showSelection(true),{signal})
    let printing=false
    const print=():void=>{void preparePrint().catch(error=>{if(!closed)status.textContent=error instanceof Error?error.message:text('error')})}
    async function preparePrint():Promise<boolean>{
        if(busy||printing||closed||!toolbar.hasItem('print')||textEditor?.finish()===false)return false
        printing=true;controls.get('print')?.setAttribute('disabled','')
        const document=pdf,shapes=model.getState().shapes
        const byPage=new Map<number,Annotation[]>()
        for(const shape of shapes){const index=shape.pageIndex??0;if(!byPage.has(index))byPage.set(index,[]);byPage.get(index)!.push(shape)}
        try{
            const {printMedia}=await import('./printing.js')
            if(signal.aborted)return false
            return await printMedia({owner:root,signal,label:text,title:options.name??text('viewer'),assetBaseUrl:options.assetBaseUrl,settings:options.printOptions,
                pages:async()=>{
                    if(document)return document.getPageSizes()
                    if(!image)throw new Error(text('image_failed'))
                    const factor=Math.min(1,842/Math.max(image.naturalWidth,image.naturalHeight))
                    return [{width:image.naturalWidth*factor,height:image.naturalHeight*factor}]
                },
                render:async(index,canvas,ratio,printSignal)=>{
                    if(document){
                            await document.renderPage(index,canvas,{scale:ratio,pixelRatio:1,signal:printSignal,priority:'foreground'})
                            const context=canvas.getContext('2d')!;let pin=0
                            for(const shape of byPage.get(index)??[]){
                                printSignal.throwIfAborted();if(shape.tool==='pin')pin++
                                let img:HTMLImageElement|undefined
                                if(shape.asset){img=make('img');img.src=shape.asset;await img.decode()}
                                paintAnnotation(context,shape,canvas.width,canvas.height,pin,false,ratio,img)
                            }
                    }else{
                        const raster=imageExport(),factor=Math.min(1,842/Math.max(image!.naturalWidth,image!.naturalHeight))
                        canvas.width=Math.max(1,Math.round(image!.naturalWidth*factor*ratio));canvas.height=Math.max(1,Math.round(image!.naturalHeight*factor*ratio))
                        const context=canvas.getContext('2d')!;context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(raster,0,0,canvas.width,canvas.height);raster.width=raster.height=1
                    }
                },
            })
        }finally{printing=false;controls.get('print')?.removeAttribute('disabled')}
    }
    addItem('print','print',print)
    async function updateBookmarks(next:readonly ViewerBookmark[]):Promise<void>{
        if(read||busy||bookmarkBusy||closed)return
        const validated=normalizeBookmarks(next,pageCount);bookmarkBusy=true
        try{await options.saveBookmarks?.(validated,signal);signal.throwIfAborted();bookmarks=validated;navigationView?.update()}
        catch{if(!closed)status.textContent=text('error')}
        finally{bookmarkBusy=false}
    }
    async function replaceDocument(original:IndependentPDFDocument,bytes:ArrayBuffer,annotations:readonly Annotation[],plan:readonly PDFPageEdit[],operation:'pages'|'redactions'|'crop'|'content',targetPage:number):Promise<void>{
        if(options.source.kind!=='pdf')throw new Error('Not a PDF')
        signal.throwIfAborted();const {openPDF}=await import('./pdf.js')
        const nextModel=createAnnotationDocument({profile,shapes:annotations})
        let candidate:IndependentPDFDocument|undefined
        try{
            candidate=await openPDF({...options.source.pdf,source:new Uint8Array(bytes),signal})
            await options.replacePdf?.({operation,bytes,annotations:nextModel.getState().shapes,plan,sourcePages:original.pageCount,signal})
            signal.throwIfAborted()
        }catch(error){nextModel.dispose();await candidate?.destroy();throw error}
        const remapped=bookmarks.flatMap(bookmark=>{
            const index=plan.findIndex(item=>'index' in item&&item.index===bookmark.pageIndex)
            return index<0?[]:[{...bookmark,pageIndex:index}]
        })
        // Pending resize work must not cancel the replacement's first render.
        refreshingPDF=true;view!.cancelAnimationFrame(frame)
        try{
            commentPopover?.close();searchAbort?.abort();searchHits=[];searchIndex=-1;navigationView?.destroy();navigationView=undefined;clearFlow();previewRender?.abort()
            ;({stage,source,overlay,text:textLayer,links,tiles:tileLayer}=singlePage)
            original.clearTextLayer(textLayer);tileSurface?.reset();renderedKey='';renderGeneration++
            pdf=candidate;pageCount=pdf.pageCount;pageIndex=Math.min(targetPage,pageCount-1);selected=null;requestedPage=null;requestedAnnotation=null;bookmarks=remapped
            if(scrollMode==='paginated')scroller.append(stage)
            unsub();model.dispose();model=nextModel;unsub=model.subscribe(onModelChange)
            documentChanged=!options.replacePdf
            if(!navigation.hidden)showNavigation(sidebarTool,true)
            onModelChange();await original.destroy()
            if(options.closeAfterPdfReplacement&&options.replacePdf&&options.onClose){await options.onClose();return}
            try{await layout();if(flow)await flow.goTo(pageIndex)}
            catch(error){
                if(signal.aborted)throw error
                // The new revision is already committed. A cancelled or failed repaint must not report a failed write.
                renderedKey='';refreshingPDF=false;schedule()
            }
        }finally{refreshingPDF=false}
    }
    /** Apply to a working copy; only swap after the application adapter has accepted the bytes. */
    const applyRedactions=async(settings:{confirm?:boolean}={}):Promise<boolean>=>{
        if(busy||editingContent||bookmarkBusy||read||!pdf?.canEditPages||options.source.kind!=='pdf'||!canOperate('redactions')||!profile.textMarkupActions.includes('redaction'))return false
        const snapshot=model.getState().shapes,marks=snapshot.filter(shape=>shape.markup==='redaction')
        if(!marks.length)return false
        if(settings.confirm!==false&&!await confirm(text('redaction_confirm'),'redaction_apply'))return false
        if(closed||busy||snapshot!==model.getState().shapes)return false
        const original=pdf,targetPage=pageIndex
        status.textContent=text('redaction_applying')
        await runPDFChange(async()=>{
            const bytes=await original.applyRedactions(marks.map(shape=>({pageIndex:shape.pageIndex??0,rectangles:shape.rectangles!,fill:shape.fill??'#000000',overlayText:shape.overlayText,overlayColor:shape.overlayColor,repeatOverlayText:shape.repeatOverlayText,opacity:shape.opacity})),options.maxPdfOutputBytes)
            const annotations=snapshot.filter(shape=>shape.markup!=='redaction')
            const plan=Array.from({length:original.pageCount},(_,index)=>({index,rotation:0}))
            await replaceDocument(original,bytes,annotations,plan,'redactions',targetPage)
            status.textContent=text('redaction_applied')
        })
        return true
    }
    async function runPDFChange(change:()=>Promise<void>):Promise<void>{
        if(busy||closed)throw abortError()
        busy=true;gesture=undefined;draft=[];selectingText=false;selectedText()?.removeAllRanges();selectionHighlights.clear();markupMenu.hidden=true
        root.setAttribute('aria-busy','true');body.inert=true;top.inert=true;footer.inert=true;sync();properties.inert=true
        try{await change()}
        finally{
            busy=false
            if(!closed){body.inert=false;top.inert=false;footer.inert=false;root.setAttribute('aria-busy','false');sync()}
        }
    }
    const requestClose=async():Promise<boolean>=>{
        if(busy)return false
        if(textEditor?.finish()===false)return false
        if((documentChanged||model.getState().dirty||contentEditor.isDirty())&&!await confirm(text('close_question'), 'discard'))return false
        await options.onClose?.()
        return true
    }
    if(options.onClose)button('close',()=>{void requestClose()},end)
    const stopToolbar=observeToolbarContainer(root,width=>{
        const state=toolbar.resize(width);root.dataset.layout=state.layout;root.dataset.pager=state.layout==='wide'?'full':'compact'
        responsiveProperties.resize(state.layout!=='wide')
    })
    root.addEventListener('keydown',event=>{
        const target=event.target as HTMLElement
        if(target.closest('input,select,textarea,[contenteditable],dialog,[role=dialog],[role=menu]')||confirmPending||event.isComposing||busy)return
        const key=event.key.toLowerCase(),modifier=event.ctrlKey||event.metaKey
        const shape=current().find(item=>item.id===selected)
        if(busy)return
        const delta=event.shiftKey?10:1
        const directions:Record<string,Point>={arrowleft:[-delta/size.width,0],arrowright:[delta/size.width,0],
            arrowup:[0,-delta/size.height],arrowdown:[0,delta/size.height]}
        if(modifier&&key==='p'&&toolbar.hasItem('print'))print()
        else if(modifier&&key==='0'&&toolbar.hasItem('zoom')){void setZoom('fit-page')}
        else if(!read&&modifier&&['z','y'].includes(key)){
            const type=key==='y'||event.shiftKey?'redo':'undo'
            if(!toolbar.hasItem(type))return
            model.dispatch({type})
        }else if(!read&&shape&&modifier&&['c','x'].includes(key)){
            if(key==='x'&&!toolbar.hasItem('delete'))return
            clipboard=shape
            if(key==='x')void remove(shape.id)
        }else if(!read&&modifier&&(key==='v'&&clipboard||key==='d'&&shape)){
            const original=(key==='v'?clipboard:shape)!
            if(!allowed.includes(original.tool))return
            const copy={...original,id:crypto.randomUUID(),
                points:original.tool==='text-highlight'?original.points:translate(original,.02,.02),...(pdf?{pageIndex}:{})}
            try{model.dispatch({type:'add',shape:copy});selected=copy.id;sync();paint()}catch{status.textContent=text('limit')}
        }else if(!read&&!modifier&&shape&&directions[key]&&allowed.includes(shape.tool)&&shape.tool!=='text-highlight'){
            model.dispatch({type:'update',id:shape.id,patch:{points:translate(shape,...directions[key])}})
        }else if(!read&&!modifier&&['delete','backspace'].includes(key)&&selected&&toolbar.hasItem('delete'))void remove(selected)
        else if(key==='pagedown')setPage(adjacentPage(1))
        else if(key==='pageup')setPage(adjacentPage(-1))
        else if(key==='enter'&&draft.length)finishPolygon()
        else if(key==='escape'&&cropping)leaveCrop()
        else if(key==='escape'&&editingContent)void cancelContentEditor()
        else if(key==='escape'){gesture=undefined;selected=null;markupMenu.hidden=true;switchTool('select')}
        else return
        event.preventDefault();event.stopPropagation()
    })
    const destroy=async():Promise<void>=>{
        if(closed)return
        commentPopover?.close()
        closed=true;contentEditor.reset();options.signal?.removeEventListener('abort',abort);signal.removeEventListener('abort',onAbort);lifecycle.abort()
        textEditor?.destroy();observer.disconnect();stopToolbar();clearFlow();previewRender?.abort();selectionHighlights.clear();hero.destroy();searchAbort?.abort();navigationView?.destroy();view.cancelAnimationFrame(frame);view.cancelAnimationFrame(paintFrame);view.cancelAnimationFrame(selectionFrame);unsub();model.dispose();toolbar.dispose();cache.clear();host.remove();await pdf?.destroy()
    }
    let localeChange=0
    async function setLocale(next:string):Promise<void>{
        const generation=++localeChange
        const translated=await viewerLocale(next,defaultLabels,options.labels,options.translations)
        if(closed||localeChange!==generation)return
        locale=next;labels=translated;root.lang=next
        for(const [node,bindings] of translationsByElement)if(node.isConnected)for(const [attribute,key] of bindings)localize(node,key,attribute)
        sync()
    }
    const onAbort=():void=>{void destroy()}
    signal.addEventListener('abort',onAbort,{once:true})
    try{
        hero.commit()
        signal.throwIfAborted()
        root.lang=locale
        for(const [node,bindings] of translationsByElement)if(node.isConnected)for(const [attribute,key] of bindings)localize(node,key,attribute)
        if(options.source.kind==='pdf'){
            const {openPDF}=await import('./pdf.js')
            pdf=await openPDF({...options.source.pdf,source:options.source.source,signal});pageCount=pdf.pageCount;bookmarks=normalizeBookmarks(options.bookmarks??[],pageCount)
        }else{
            image=make('img');image.alt=options.name??'';image.src=options.source.url
            await image.decode();signal.throwIfAborted();source.replaceWith(image)
        }
        if(signal.aborted)throw abortError()
        translationsByElement.delete(status);status.textContent='';await layout();signal.throwIfAborted();observer.observe(scroller);loading.remove();skeletonBar.remove();top.inert=false;root.removeAttribute('data-loading');root.setAttribute('aria-busy','false');switchTool('select');sync();drawLinks();root.focus({preventScroll:true})
        return Object.freeze({element:host,getState:()=>({pageIndex,pageCount,bookmarks,documentChanged,readOnly:read,scrollMode,pageLayout,firstPageSingle,zoomMode:zoomState.mode,zoomLevel:scale,annotations:visibleShapes()}),setPage,setScrollMode,setPageLayout,setZoom,applyRedactions,exportPDF,print:preparePrint,fitPage:()=>setZoom('fit-page'),fitWidth:()=>setZoom('fit-width'),setLocale,get locale(){return locale},setTheme,get theme(){return theme},requestClose,destroy})
    }catch(error){await destroy();throw error}
}
