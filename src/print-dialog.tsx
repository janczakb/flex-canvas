import {Modal} from '@heroui/react/modal'
import {Button} from '@heroui/react/button'
import {Spinner} from '@heroui/react/spinner'
import {UNSAFE_PortalProvider} from 'react-aria/PortalProvider'
import {createRoot} from 'react-dom/client'
import {flushSync} from 'react-dom'
import {useEffect} from 'react'

function Exit({complete}:{complete:()=>void}){useEffect(()=>()=>{queueMicrotask(complete)},[complete]);return null}
export function openPrintProgress(owner:HTMLElement,label:(key:string)=>string,cancel:()=>void) {
    const doc=owner.ownerDocument,mount=doc.createElement('div'),renderer=doc.createElement('div'),portal=doc.createElement('div')
    mount.className='fm-print-progress';mount.append(renderer,portal);owner.append(mount)
    const root=createRoot(renderer)
    let finished=0,total=0,disposed=false,closing=false,resolve:()=>void=()=>{}
    const closed=new Promise<void>(done=>{resolve=done})
    const complete=()=>{if(disposed)return;disposed=true;root.unmount();mount.remove();resolve()}
    const render=(open:boolean)=><UNSAFE_PortalProvider getContainer={()=>portal}><Modal isOpen={open} onOpenChange={next=>{if(!next)cancel()}}>
        <Modal.Backdrop><Modal.Container size="sm" placement="center"><Modal.Dialog aria-label={label('print_preparing')}>
            <Exit complete={complete}/><Modal.Header><Modal.Heading>{label('print_preparing')}</Modal.Heading></Modal.Header>
            <Modal.Body className="flex flex-col items-center gap-4"><Spinner size="lg"/><p role="status" aria-live="polite">{total?label('print_progress').replace('{done}',String(finished)).replace('{total}',String(total)):label('loading_document')}</p></Modal.Body>
            <Modal.Footer><Button variant="secondary" onPress={cancel}>{label('cancel')}</Button></Modal.Footer>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>
    </Modal></UNSAFE_PortalProvider>
    flushSync(()=>root.render(render(true)))
    return {update(done:number,count:number){if(!disposed&&!closing){finished=done;total=count;flushSync(()=>root.render(render(true)))}},close(){if(!closing&&!disposed){closing=true;root.render(render(false))}return closed},destroy:complete}
}
