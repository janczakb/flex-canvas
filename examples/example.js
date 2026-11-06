import {openMediaViewerModal} from '/dist/browser/index.js'

let viewer,opening=0,pending
const status=document.getElementById('example-status')
const documents={
    marly:{name:'Marly Boutique Hotel',kind:'pdf',source:'/brochures/marly.pdf'},
    leela:{name:'The Leela Palace Trail',kind:'pdf',source:'/brochures/leela.pdf'},
    image:{name:'Image annotations',kind:'image',url:'/dist/samples/sample.jpg'},
}
async function open(id) {
    const generation=++opening,document=documents[id],previous=viewer
    viewer=undefined;pending?.abort();pending=new AbortController()
    await previous?.destroy()
    if(generation!==opening)return
    status.textContent=''
    let annotations=[]
    try{annotations=JSON.parse(localStorage.getItem('flex-viewer-example:'+id)??'[]')}catch{}
    const source=document.kind==='image'?{kind:'image',url:document.url}
        : {kind:'pdf',source:document.source,pdf:{workerUrl:'/dist/pdfium-worker.js',wasmUrl:'/dist/pdfium.wasm'}}
    try {
        const mounted=await openMediaViewerModal({
            source,name:document.name,annotations,signal:pending.signal,
            theme:'light',
            saveAnnotations:async annotations=>{
                localStorage.setItem('flex-viewer-example:'+id,JSON.stringify(annotations))
                status.textContent='Saved in this browser'
            },
            onClose:()=>{if(generation===opening)viewer=undefined},
        })
        if(generation!==opening){await mounted.destroy();return}
        viewer=mounted
    }catch(error){if(generation===opening&&error?.name!=='AbortError')status.textContent='Could not open the document. Please try again.'}
}
for(const button of document.querySelectorAll('[data-document]'))button.onclick=()=>{void open(button.dataset.document)}
window.addEventListener('pagehide',()=>{opening++;pending?.abort();void viewer?.destroy()})
// Development example handle, also used by the package browser tests.
window.exampleViewer=()=>viewer
