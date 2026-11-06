import {createPDFThumbnails,thumbnailGridMetrics,thumbnailGridRange} from './pdf/thumbnails.js'
import type {Annotation} from './types.js'
import type {ViewerBookmark} from './bookmarks.js'
import {paintViewerIcon} from './viewer-icons.js'
import type {IndependentPDFDocument,OutlineItem} from './pdf.js'

export type ViewerNavigationMode='thumbnails'|'outline'|'bookmarks'|'signatures'

export function mountViewerNavigation(
    panel:HTMLElement,pdf:IndependentPDFDocument,text:(key:string)=>string,
    go:(index:number)=>void,current:()=>number,_close:()=>void,initialMode:ViewerNavigationMode='thumbnails',
    extra?:{bookmarks:()=>readonly ViewerBookmark[];signatures:()=>readonly Annotation[];addBookmark:()=>void;removeBookmark:(id:string)=>void;selectAnnotation:(id:string,page:number)=>void;readOnly:boolean},
) {
    const doc=panel.ownerDocument,view=doc.defaultView!,list=doc.createElement('div')
    const grid=doc.createElement('div'),before=doc.createElement('div'),after=doc.createElement('div')
    list.className='fm-list fm-navigation-list';grid.className='fm-thumbnail-grid'
    before.setAttribute('aria-hidden','true');after.setAttribute('aria-hidden','true')
    panel.append(list)
    const thumbs=createPDFThumbnails({document:pdf,root:list,width:188,maxSize:250})
    const entries=new Map<number,HTMLButtonElement>()
    let disposed=false,mode:ViewerNavigationMode=initialMode,frame=0,epoch=0,columns=1,rowHeight=328,followed=-1,windowKey=''
    let pageSizes:readonly {width:number;height:number}[]|undefined,dimensionsReady=!pdf.getPageSizes
    let metrics:ReturnType<typeof thumbnailGridMetrics>|undefined,metricsKey=''
    const geometry=()=>{
        const compact=(panel.closest('.fm')?.clientWidth??1000)<=480,sidebarWidth=Math.round(panel.getBoundingClientRect().width),key=list.clientWidth+':'+sidebarWidth+':'+compact
        if(!metrics||key!==metricsKey){metrics=thumbnailGridMetrics(pdf.pageCount,list.clientWidth,pageSizes,compact,sidebarWidth);metricsKey=key}
        return thumbnailGridRange(metrics,list.scrollTop,list.clientHeight)
    }
    function mark() {
        for(const [index,row]of entries){
            const active=index===current()
            row.setAttribute('aria-current',active?'page':'false');row.setAttribute('aria-selected',String(active));row.tabIndex=active?0:-1
        }
    }
    function draw() {
        if(disposed||mode!=='thumbnails'||!dimensionsReady)return
        const range=geometry(),key=metricsKey+':'+[range.start,range.end,range.columns,range.rowHeight].join(':')
        columns=range.columns;rowHeight=range.rowHeight
        if(windowKey===key){mark();return}
        windowKey=key
        list.style.setProperty('--thumbnail-columns',String(columns))
        list.style.setProperty('--thumbnail-cell-width',range.itemWidth+'px')
        list.style.setProperty('--thumbnail-cell-height',(rowHeight-16)+'px')
        list.style.setProperty('--thumbnail-preview-width',range.previewWidth+'px')
        list.style.setProperty('--thumbnail-preview-height',range.previewHeight+'px')
        before.style.height=range.before+'px';after.style.height=range.after+'px'
        const tracked:Array<{index:number;canvas:HTMLCanvasElement;width:number}>=[],nodes:HTMLButtonElement[]=[]
        for(const index of entries.keys())if(index<range.start||index>=range.end)entries.delete(index)
        for(let index=range.start;index<range.end;index++){
            let row=entries.get(index)
            if(!row){
                row=doc.createElement('button');row.type='button';row.className='fm-thumbnail';row.dataset.page=String(index)
                row.role='option';row.setAttribute('aria-label',text('page')+' '+(index+1));row.setAttribute('aria-posinset',String(index+1));row.setAttribute('aria-setsize',String(pdf.pageCount))
                const preview=doc.createElement('span'),label=doc.createElement('span'),canvas=doc.createElement('canvas')
                preview.className='fm-thumbnail-preview';label.className='fm-thumbnail-number';label.textContent=String(index+1)
                preview.append(canvas);row.append(preview,label);row.onclick=()=>go(index);entries.set(index,row)
            }
            const dimension=range.dimensions[index],preview=row.querySelector<HTMLElement>('.fm-thumbnail-preview')!
            preview.style.width=dimension.width+'px';preview.style.height=dimension.height+'px'
            const canvas=row.querySelector('canvas')!;canvas.style.width=dimension.width+'px';canvas.style.height=dimension.height+'px'
            nodes.push(row);tracked.push({index,canvas,width:dimension.width})
        }
        // Retain mounted rows instead of detaching the entire visible window on every scroll.
        const retained=new Set(nodes)
        for(const child of [...grid.children])if(!retained.has(child as HTMLButtonElement))child.remove()
        let cursor=grid.firstElementChild
        for(const row of nodes){if(row===cursor)cursor=cursor.nextElementSibling;else grid.insertBefore(row,cursor)}
        thumbs.sync(tracked);mark()
    }
    function followCurrent() {
        if(mode!=='thumbnails'||!dimensionsReady||followed===current())return
        followed=current()
        const range=geometry(),top=32+Math.floor(current()/range.columns)*range.rowHeight,bottom=top+range.rowHeight-16
        if(top<list.scrollTop||bottom>list.scrollTop+list.clientHeight){list.scrollTop=Math.max(0,(top+bottom-list.clientHeight)/2);draw()}
    }
    async function outline(version:number) {
        list.textContent=text('loading')
        try{
            const items=await pdf.getOutline()
            if(disposed||version!==epoch||mode!=='outline')return
            list.replaceChildren()
            const add=(nodes:OutlineItem[],depth=0)=>{
                for(const node of nodes){
                    const button=doc.createElement('button');button.type='button';button.textContent=node.title
                    button.className='fm-outline-entry';button.style.setProperty('--outline-depth',String(depth))
                    button.disabled=node.pageIndex===null;button.onclick=()=>{if(node.pageIndex!==null)go(node.pageIndex)}
                    list.append(button);add(node.children,depth+1)
                }
            }
            if(items.length)add(items);else list.textContent=text('outline_empty')
        }catch{if(!disposed&&version===epoch)list.textContent=text('error')}
    }
    let customMode='',customData:readonly unknown[]=[]
    function custom(){
        if(mode!=='bookmarks'&&mode!=='signatures')return
        const data=mode==='bookmarks'?extra?.bookmarks()??[]:extra?.signatures()??[]
        if(mode===customMode&&data.length===customData.length&&data.every((item,index)=>item===customData[index]))return
        customMode=mode;customData=data
        list.replaceChildren()
        if(mode==='bookmarks'&&!extra?.readOnly){const add=doc.createElement('button');add.type='button';add.className='fm-bookmark-add';add.textContent=text('add_bookmark');add.onclick=()=>extra?.addBookmark();list.append(add)}
        if(!data.length){const empty=doc.createElement('p');empty.className='fm-annotations-empty';empty.textContent=text(mode+'_empty');list.append(empty);return}
        for(const item of data){
            const row=doc.createElement('div'),button=doc.createElement('button');row.className='fm-navigation-entry';button.type='button'
            if(mode==='bookmarks'){
                const bookmark=item as ViewerBookmark;button.textContent=bookmark.title;button.onclick=()=>go(bookmark.pageIndex)
                row.append(button)
                if(!extra?.readOnly){const del=doc.createElement('button');del.type='button';del.setAttribute('aria-label',text('delete_bookmark')+' '+bookmark.title);paintViewerIcon(del,'delete');del.onclick=()=>extra?.removeBookmark(bookmark.id);row.append(del)}
            }else{
                const signature=item as Annotation,preview=doc.createElement('img'),caption=doc.createElement('span')
                preview.src=signature.asset!;preview.alt='';preview.loading='lazy';caption.textContent=text('signature_sample')+' · '+text('page')+' '+((signature.pageIndex??0)+1)
                button.className='fm-signature-entry';button.append(preview,caption);button.onclick=()=>extra?.selectAnnotation(signature.id,signature.pageIndex??0);row.append(button)
            }
            list.append(row)
        }
    }
    function setMode(next:ViewerNavigationMode) {
        mode=next;epoch++;windowKey='';customMode='';customData=[];followed=-1;thumbs.sync([]);entries.clear();list.replaceChildren();list.scrollTop=0
        panel.setAttribute('aria-label',text(next));list.dataset.mode=next
        if(next==='outline'){list.removeAttribute('role');void outline(epoch)}
        else if(next!=='thumbnails'){list.removeAttribute('role');custom()}
        else{list.role='listbox';list.setAttribute('aria-label',text('thumbnails'));list.append(before,grid,after);draw();followCurrent()}
    }
    list.addEventListener('scroll',()=>{if(!frame)frame=view.requestAnimationFrame(()=>{frame=0;draw()})},{passive:true})
    list.addEventListener('keydown',event=>{
        if(mode!=='thumbnails')return
        const row=(event.target as HTMLElement).closest<HTMLElement>('[data-page]')
        const index=Number(row?.dataset.page??current()),delta=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:event.key==='ArrowDown'?columns:event.key==='ArrowUp'?-columns:0
        if(!delta&&!['Home','End'].includes(event.key))return
        event.preventDefault();event.stopPropagation()
        const next=Math.max(0,Math.min(pdf.pageCount-1,event.key==='Home'?0:event.key==='End'?pdf.pageCount-1:index+delta))
        go(next);followCurrent();draw();entries.get(next)?.focus({preventScroll:true})
    })
    const observer=new ResizeObserver(()=>{
        if(disposed||mode!=='thumbnails')return
        const next=geometry()
        if(next.columns!==columns||next.rowHeight!==rowHeight){
            const first=Math.floor(Math.max(0,list.scrollTop-32)/rowHeight)*columns
            draw();list.scrollTop=first===0?0:32+Math.floor(first/next.columns)*next.rowHeight;draw()
        }else draw()
    })
    observer.observe(list);setMode(initialMode)
    if(pdf.getPageSizes)void pdf.getPageSizes().then(sizes=>{
        if(disposed)return
        const anchor=Math.floor(Math.max(0,list.scrollTop-32)/rowHeight)*columns
        pageSizes=sizes;dimensionsReady=true;metrics=undefined;windowKey='';const range=geometry()
        if(mode==='thumbnails'){draw();list.scrollTop=anchor===0?0:32+Math.floor(anchor/range.columns)*range.rowHeight;draw();followed=-1;followCurrent()}
    }).catch(()=>{if(!disposed){dimensionsReady=true;draw();followCurrent()}})
    return {
        update(){followCurrent();draw();custom()},setMode,get mode(){return mode},
        destroy(){disposed=true;epoch++;observer.disconnect();view.cancelAnimationFrame(frame);thumbs.destroy();list.remove()},
    }
}
