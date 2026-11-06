import {Button} from '@heroui/react/button'
import {Input} from '@heroui/react/input'
import {Select} from '@heroui/react/select'
import {ListBox} from '@heroui/react/list-box'
import {Modal} from '@heroui/react/modal'
import {Spinner} from '@heroui/react/spinner'
import {UNSAFE_PortalProvider} from 'react-aria/PortalProvider'
import {useEffect,useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {flushSync} from 'react-dom'
import {imageAnnotationAsset,type InsertData,type InsertOptions} from './insertion.js'

function InsertEditor({options,finish}:{options:InsertOptions;finish:(result:InsertData|null)=>void}) {
    const label=(key:string,fallback:string)=>options.labels?.[key]??fallback
    const [mode,setMode]=useState('website'),[value,setValue]=useState(''),[asset,setAsset]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
    const popovers=useRef<HTMLDivElement>(null)
    const input=useRef<HTMLInputElement>(null),mounted=useRef(true),generation=useRef(0)
    useEffect(()=>()=>{mounted.current=false;generation.current++},[])
    const image=options.kind==='image'
    const chooseImage=async(file?:File)=>{
        if(!file)return
        const request=++generation.current;setBusy(true);setError('')
        try{const next=await imageAnnotationAsset(file,options.owner.ownerDocument);if(mounted.current&&request===generation.current)setAsset(next)}
        catch{if(mounted.current&&request===generation.current)setError(label('insert_invalid','Select a supported image or enter a valid link.'))}
        finally{if(mounted.current&&request===generation.current)setBusy(false)}
    }
    const submit=()=>{
        if(busy||options.signal?.aborted)return
        try{
            if(image){if(asset)finish({asset});return}
            if(mode==='page'){
                const page=Number(value)-1
                if(!/^\d+$/.test(value)||!Number.isSafeInteger(page)||page<0||page>=(options.pageCount??0))throw new Error()
                finish({targetPage:page})
            }else{
                const url=new URL(value.trim())
                if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password)throw new Error()
                finish({href:url.href})
            }
        }catch{setError(label('insert_invalid','Select a supported image or enter a valid link.'))}
    }
    const modes=[{id:'website',label:label('link_website','Website')},{id:'page',label:label('page','Page')}]
    return <form className="fm-insert-form" noValidate onSubmit={event=>{event.preventDefault();submit()}}>
        <Modal.Header><Modal.Heading>{label(image?'image_insert_title':'link_settings',image?'Add image':'Link settings')}</Modal.Heading></Modal.Header>
        <Modal.Body className="fm-insert-body">
            {image?<>
                <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label={label('choose_image','Choose image')} onChange={event=>{void chooseImage(event.target.files?.[0]);event.target.value=''}}/>
                <div className="fm-insert-drop" onDragOver={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault()}} onDrop={event=>{if(!event.dataTransfer.types.includes('Files'))return;event.preventDefault();void chooseImage(event.dataTransfer.files[0])}}>
                    {asset&&<img src={asset} alt={label('image_preview','Image preview')}/>}
                    {busy?<Spinner aria-label={label('loading_document','Loading…')}/>:<Button variant="secondary" onPress={()=>input.current?.click()}>{label(asset?'replace_image':'choose_image',asset?'Replace image':'Choose image')}</Button>}
                </div>
                <p className="fm-insert-hint">{label('image_insert_formats','PNG, JPG or WebP · up to 5 MB')}</p>
            </>:<>
                {!!options.pageCount&&<UNSAFE_PortalProvider getContainer={()=>popovers.current??options.owner}><Select aria-label={label('insert_mode','Link destination')} value={mode} onChange={key=>{setMode(String(key));setValue('');setError('')}}>
                    <Select.Trigger aria-label={label('insert_mode','Link destination')}><Select.Value/><Select.Indicator/></Select.Trigger>
                    <Select.Popover className="fm-hero-popover"><ListBox aria-label={label('insert_mode','Link destination')}>
                        {modes.map(item=><ListBox.Item id={item.id} key={item.id} textValue={item.label}>{item.label}<ListBox.ItemIndicator/></ListBox.Item>)}
                    </ListBox></Select.Popover>
                </Select></UNSAFE_PortalProvider>}
                <Input aria-label={label(mode==='page'?'link_page_number':'link_website',mode==='page'?'Page number':'Website')} type="text" inputMode={mode==='page'?'numeric':'url'} value={value} maxLength={2048} placeholder={mode==='page'?`1–${options.pageCount}`:'https://example.com'} autoFocus onChange={event=>{setValue(event.target.value);setError('')}}/>
            </>}
            {error&&<p className="fm-insert-error" role="alert">{error}</p>}
            <div ref={popovers} className="fm-insert-popovers"/>
        </Modal.Body>
        <Modal.Footer><Button variant="secondary" onPress={()=>finish(null)}>{label('cancel','Cancel')}</Button><Button type="submit" variant="primary" isDisabled={busy||!(image?asset:value.trim())}>{label('insert_done','Done')}</Button></Modal.Footer>
    </form>
}
function Exit({complete}:{complete:()=>void}){useEffect(()=>()=>{queueMicrotask(complete)},[complete]);return null}

export function openInsertDialog(options:InsertOptions):Promise<InsertData|null> {
    if(options.signal?.aborted||options.owner.querySelector(':scope>.fm-insert-mount'))return Promise.resolve(null)
    const doc=options.owner.ownerDocument,mount=doc.createElement('div'),renderer=doc.createElement('div'),portal=doc.createElement('div')
    mount.className='fm-insert-mount';mount.append(renderer,portal);options.owner.append(mount)
    const root=createRoot(renderer)
    return new Promise((resolve,reject)=>{
        let disposed=false,closing=false,result:InsertData|null=null
        const complete=()=>{if(disposed)return;disposed=true;options.signal?.removeEventListener('abort',abort);root.unmount();mount.remove();resolve(result)}
        const abort=()=>{result=null;complete()}
        const finish=(next:InsertData|null)=>{if(disposed||closing)return;closing=true;result=next;root.render(content(false))}
        const content=(open:boolean)=><UNSAFE_PortalProvider getContainer={()=>portal}><Modal isOpen={open} onOpenChange={open=>{if(!open)finish(null)}}>
            <Modal.Backdrop><Modal.Container placement="center" size="md" scroll="inside"><Modal.Dialog className="fm-insert-dialog" aria-label={options.labels?.[options.kind==='image'?'image_insert_title':'link_settings']??(options.kind==='image'?'Add image':'Link settings')}>
                <Modal.CloseTrigger aria-label={options.labels?.close??'Close'}/><Exit complete={complete}/><InsertEditor options={options} finish={finish}/>
            </Modal.Dialog></Modal.Container></Modal.Backdrop>
        </Modal></UNSAFE_PortalProvider>
        options.signal?.addEventListener('abort',abort,{once:true})
        try{flushSync(()=>root.render(content(true)))}catch(error){options.signal?.removeEventListener('abort',abort);root.unmount();mount.remove();reject(error)}
    })
}
