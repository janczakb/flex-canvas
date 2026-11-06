import {createPDFThumbnails} from './pdf/thumbnails.js'
import type {createHeroControls} from './hero-controls.js'
import {paintViewerIcon} from './viewer-icons.js'
import type {IndependentPDFDocument, PDFPageEdit} from './pdf.js'

type DraftPage = PDFPageEdit & { id: number }
export interface PDFPageEditorOptions {
    owner: HTMLElement;pdf: IndependentPDFDocument;maxPages: number;signal: AbortSignal
    hero:ReturnType<typeof createHeroControls>;text:(key:string)=>string;confirm:(message:string)=>Promise<boolean>;save:(plan:readonly PDFPageEdit[])=>Promise<void>;saveAs?:(plan:readonly PDFPageEdit[])=>Promise<void>
}
/** A page-tree transaction: closing leaves the source document untouched. */
export function openPDFPageEditor({owner,pdf,maxPages,signal,hero,text,confirm,save,saveAs}:PDFPageEditorOptions):void{
    if(signal.aborted)return
    const doc=owner.ownerDocument,view=doc.defaultView!,dialog=doc.createElement('dialog')
    dialog.className='fm-pages';dialog.setAttribute('aria-label',text('edit-pages'))
    let sequence=pdf.pageCount,busy=false,dragging:number|null=null,lastSelected:number|null=null,frame=0,disposed=false
    let pages:DraftPage[]=Array.from({length:pdf.pageCount},(_,index)=>({id:index,index,rotation:0}))
    const previous:DraftPage[][]=[],next:DraftPage[][]=[],selected=new Set<number>(),entries=new Map<number,HTMLButtonElement>()
    const bar=doc.createElement('div'),tiles=doc.createElement('div'),grid=doc.createElement('div'),before=doc.createElement('div'),after=doc.createElement('div'),footer=doc.createElement('form'),status=doc.createElement('span')
    bar.className='fm-bar fm-page-editor-toolbar';tiles.className='fm-page-tiles';grid.className='fm-page-editor-grid';footer.className='fm-bar fm-footer';status.role='status'
    before.setAttribute('aria-hidden','true');after.setAttribute('aria-hidden','true');tiles.append(before,grid,after)
    const target=doc.createElement('input');target.type='text';target.inputMode='numeric';target.value='1';target.setAttribute('aria-label',text('position'))
    const thumbs=createPDFThumbnails({document:pdf,root:tiles,width:188,onError:()=>{status.textContent=text('error')}})
    const controls:Record<string,HTMLButtonElement>={}
    const footerSlots:HTMLElement[]=[]
    const footerActions=new Map<string,()=>void>()
    footer.onsubmit=event=>{
        event.preventDefault()
        const key=event.submitter?.closest<HTMLElement>('.fm-page-footer-action')?.dataset.control
        if(key&&!busy)footerActions.get(key)?.()
    }
    const action=(key:string,fn:()=>void,area=bar,icon=key)=>{
        const button=doc.createElement('button'),glyph=doc.createElement('span'),caption=doc.createElement('span')
        button.type='button';button.className='fm-page-action button button--ghost';button.setAttribute('aria-label',text(key));button.dataset.control=key
        if(paintViewerIcon(glyph,icon)){glyph.className='fm-page-action-icon';glyph.setAttribute('aria-hidden','true');button.append(glyph)}
        caption.textContent=text(key);button.append(caption);button.onclick=fn;area.append(button);controls[key]=button;return button
    }
    function set(value:DraftPage[]){if(busy)return;previous.push(pages);if(previous.length>40)previous.shift();next.length=0;pages=value;draw()}
    const position=()=>/^\d+$/.test(target.value)&&Number(target.value)>=1&&Number(target.value)<=pages.length+1?Number(target.value)-1:-1
    function move(at:number,ids=selected){if(at<0)return;const moving=pages.filter(page=>ids.has(page.id));if(moving.length)set([...pages.slice(0,at).filter(page=>!ids.has(page.id)),...moving,...pages.slice(at).filter(page=>!ids.has(page.id))])}
    function close(){if(disposed)return;disposed=true;observer.disconnect();view.cancelAnimationFrame(frame);thumbs.destroy();hero.removeSlots(footerSlots);signal.removeEventListener('abort',close);dialog.close();dialog.remove();entries.clear()}
    const undo=()=>{if(!busy&&previous.length){next.push(pages);pages=previous.pop()!;draw()}}
    const redo=()=>{if(!busy&&next.length){previous.push(pages);pages=next.pop()!;draw()}}
    async function remove(){const current=pages,ids=new Set(selected);if(!ids.size||ids.size>=pages.length||!await confirm(text('deletePagesConfirm'))||signal.aborted||pages!==current)return;selected.clear();set(pages.filter(page=>!ids.has(page.id)))}
    action('newPage',()=>{const at=position();if(at>=0&&pages.length<maxPages)set([...pages.slice(0,at),{id:sequence++,width:595.28,height:841.89,rotation:0},...pages.slice(at)])},bar,'newPage')
    action('deletePages',()=>{void remove()},bar,'delete')
    action('duplicate',()=>{if(pages.length+selected.size<=maxPages)set(pages.flatMap(page=>selected.has(page.id)?[page,{...page,id:sequence++}]:[page]))},bar,'duplicate')
    const rotate=(delta:number)=>set(pages.map(page=>selected.has(page.id)?{...page,rotation:(page.rotation+delta+4)%4}:page))
    action('rotateLeft',()=>rotate(-1),bar,'rotateLeft');action('rotateRight',()=>rotate(1),bar,'rotateRight')
    const moveGroup=doc.createElement('div');moveGroup.className='fm-page-move';moveGroup.append(target);bar.append(moveGroup)
    action('movePages',()=>move(position()),moveGroup,'movePages');action('undo',undo);action('redo',redo)
    const saveDraft=(operation:PDFPageEditorOptions['save'],closeOnSuccess:boolean)=>{
        if(busy)return
        busy=true;update();dialog.setAttribute('aria-busy','true');status.textContent=text('loading')
        void operation(pages.map(({id,...page})=>page)).then(()=>{
            if(closeOnSuccess)close()
            else if(!disposed){busy=false;dialog.setAttribute('aria-busy','false');update()}
        }).catch(()=>{if(!disposed){busy=false;dialog.setAttribute('aria-busy','false');update();status.textContent=text('error')}})
    }
    const footerAction=(key:string,variant:'primary'|'secondary',disabled:()=>boolean,press:()=>void)=>{
        const slot=doc.createElement('div')
        slot.className='fm-page-footer-action';slot.dataset.control=key
        footerSlots.push(slot);footer.append(slot)
        footerActions.set(key,press)
        hero.action(slot,()=>({label:text(key),type:'submit',size:'md',variant,disabled:disabled()}))
    }
    footerAction('cancel','secondary',()=>busy,()=>{if(!busy)close()})
    footer.append(status)
    if(saveAs)footerAction('save_copy','secondary',()=>busy,()=>saveDraft(saveAs,false))
    footerAction('replacePdf','primary',()=>busy||pages.length===pdf.pageCount&&pages.every((page,index)=>'index' in page&&page.index===index&&page.rotation===0),()=>saveDraft(save,true))
    function update(){
        const count=pages.reduce((n,page)=>n+Number(selected.has(page.id)),0)
        controls.newPage.disabled=busy||pages.length>=maxPages;controls.deletePages.disabled=busy||!count||count===pages.length
        controls.duplicate.disabled=busy||!count||pages.length+count>maxPages
        controls.rotateLeft.disabled=controls.rotateRight.disabled=controls.movePages.disabled=busy||!count
        controls.undo.disabled=busy||!previous.length;controls.redo.disabled=busy||!next.length;target.disabled=busy
        hero.update()
        if(!busy)status.textContent=text('selected_pages').replace('{selected}',String(count)).replace('{count}',String(pages.length))
    }
    function draw(){
        if(disposed)return
        const columns=Math.max(1,Math.min(pages.length,8,Math.floor((tiles.clientWidth-48)/220))),rowHeight=310,rows=Math.ceil(pages.length/columns)
        const visibleRows=Math.min(12,Math.ceil(tiles.clientHeight/rowHeight)+3)
        const startRow=Math.min(Math.max(0,rows-visibleRows),Math.max(0,Math.floor(tiles.scrollTop/rowHeight)-1)),endRow=Math.min(rows,startRow+visibleRows)
        const start=startRow*columns,end=Math.min(pages.length,endRow*columns)
        before.style.height=startRow*rowHeight+'px';after.style.height=(rows-endRow)*rowHeight+'px';grid.style.setProperty('--page-columns',String(columns))
        const retained=new Set(pages.slice(start,end).map(page=>page.id));for(const id of entries.keys())if(!retained.has(id))entries.delete(id)
        const alive=new Set(pages.map(page=>page.id));for(const id of selected)if(!alive.has(id))selected.delete(id)
        const nodes:HTMLButtonElement[]=[],tracked:Array<{index:number;canvas:HTMLCanvasElement}>=[]
        pages.slice(start,end).forEach((page,offset)=>{
            let button=entries.get(page.id)
            if(!button){button=doc.createElement('button');button.type='button';button.className='fm-page-editor-tile';button.draggable=true;button.dataset.pageId=String(page.id);const preview=doc.createElement('span'),number=doc.createElement('span');preview.className='fm-thumb';number.className='fm-thumbnail-number';preview.append(doc.createElement('canvas'));button.append(preview,number);entries.set(page.id,button)}
            const node=button,canvas=node.querySelector('canvas')!,index=start+offset
            node.setAttribute('aria-label',text('page')+' '+(index+1));node.setAttribute('aria-pressed',String(selected.has(page.id)));node.querySelector('.fm-thumbnail-number')!.textContent=String(index+1)
            canvas.hidden=!('index' in page);canvas.style.transform='rotate('+page.rotation*90+'deg)';if('index' in page)tracked.push({index:page.index,canvas})
            node.onclick=event=>{
                if(busy)return
                const anchor=event.shiftKey?pages.findIndex(p=>p.id===lastSelected):-1
                if(anchor>=0)for(let n=Math.min(anchor,index);n<=Math.max(anchor,index);n++)selected.add(pages[n].id)
                else if(selected.has(page.id))selected.delete(page.id)
                else selected.add(page.id)
                lastSelected=page.id;draw()
            }
            node.ondragstart=event=>{if(busy){event.preventDefault();return}dragging=page.id;event.dataTransfer?.setData('text/plain',String(page.id))}
            node.ondragover=event=>{if(dragging!==null){event.preventDefault();const box=tiles.getBoundingClientRect();if(event.clientY<box.top+48)tiles.scrollTop-=16;else if(event.clientY>box.bottom-48)tiles.scrollTop+=16}}
            node.ondragend=()=>{dragging=null}
            node.ondrop=event=>{event.preventDefault();if(dragging===null)return;const box=node.getBoundingClientRect();move(index+Number(event.clientX>box.left+box.width/2),selected.has(dragging)?selected:new Set([dragging]));dragging=null;tiles.focus({preventScroll:true})}
            nodes.push(node)
        })
        const activeRoot=grid.getRootNode() as Document|ShadowRoot
        const focused=activeRoot.activeElement
        grid.replaceChildren(...nodes)
        if(focused instanceof HTMLButtonElement&&nodes.includes(focused))focused.focus({preventScroll:true})
        thumbs.sync(tracked);update()
    }
    const request=()=>{if(!frame)frame=view.requestAnimationFrame(()=>{frame=0;draw()})}
    const observer=new ResizeObserver(request);observer.observe(tiles);tiles.addEventListener('scroll',request,{passive:true})
    dialog.addEventListener('cancel',event=>{event.preventDefault();if(!busy)close()})
    dialog.addEventListener('keydown',event=>{event.stopPropagation();if((event.target as HTMLElement).matches('input'))return
        if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();void remove()}
        if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();if(event.shiftKey)redo();else undo()}
        if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();pages.forEach(page=>selected.add(page.id));draw()}
    })
    tiles.tabIndex=-1;dialog.append(bar,tiles,footer);owner.append(dialog);signal.addEventListener('abort',close,{once:true});dialog.showModal();draw()
}
