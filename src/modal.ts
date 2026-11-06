import {mountMediaViewer,type MediaViewerOptions} from './viewer.js'
import {attachViewerStyles} from './stylesheets.js'

/** Complete standalone modal; the same viewer is used by embedded consumers. */
export async function openMediaViewerModal(options:MediaViewerOptions, owner:Document=document) {
    const lifetime=new AbortController(),host=owner.createElement('div'),shadow=host.attachShadow({mode:'open'})
    const dialog=owner.createElement('dialog'),container=owner.createElement('div')
    let viewer:Awaited<ReturnType<typeof mountMediaViewer>>|undefined,closed=false
    const previous=owner.activeElement
    host.dataset.fmModal=''
    dialog.className='fm-fullscreen';dialog.setAttribute('aria-label',options.name??options.labels?.viewer??'Document viewer')
    container.className='fm-fullscreen-content'
    dialog.append(container);shadow.append(dialog);owner.body.append(host)
    const close=async(notify=false):Promise<void>=>{
        if(closed)return
        closed=true;options.signal?.removeEventListener('abort',abort)
        lifetime.abort();if(dialog.open)dialog.close();host.remove()
        await viewer?.destroy()
        if(previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true})
        if(notify)await options.onClose?.()
    }
    const abort=()=>{void close()}
    options.signal?.addEventListener('abort',abort,{once:true})
    dialog.addEventListener('cancel',event=>{
        event.preventDefault()
        if(viewer)void viewer.requestClose()
        else void close(true)
    })
    try{
        if(options.signal?.aborted)throw new DOMException('Media viewer closed','AbortError')
        await attachViewerStyles(shadow,options,lifetime.signal).ready
        lifetime.signal.throwIfAborted();dialog.showModal()
        viewer=await mountMediaViewer(container,{...options,signal:lifetime.signal,onClose:()=>close(true)})
        lifetime.signal.throwIfAborted()
        return Object.freeze({...viewer,destroy:()=>close()})
    }catch(error){await close();throw error}
}
