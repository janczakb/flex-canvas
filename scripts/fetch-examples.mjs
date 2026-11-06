import {mkdir,writeFile,rename,rm} from 'node:fs/promises'
import path from 'node:path'
const directory=path.resolve(import.meta.dirname,'../.cache/examples')
const documents={
    marly:'https://www.marlyboutiquehotel.com/images/brochure-marly-boutique-hotel.pdf',
    leela:'https://www.theleela.com/prod/content/assets/2025-01/The-Leela-Palace-Trail-Brochure-15-Jan-2025.pdf',
}
await mkdir(directory,{recursive:true})
await Promise.all(Object.entries(documents).map(async([id,url])=>{
    const temporary=path.join(directory,id+'.part')
    try {
        const response=await fetch(url,{signal:AbortSignal.timeout(60000)})
        if(!response.ok||!response.body)throw Error('Could not fetch '+id)
        let size=0
        const chunks=[]
        for await(const chunk of response.body){size+=chunk.byteLength;if(size>32*1024*1024)throw Error('Example exceeds 32 MiB');chunks.push(chunk)}
        const pdf=Buffer.concat(chunks)
        if(pdf.subarray(0,5).toString()!=='%PDF-')throw Error('Example is not a PDF')
        await writeFile(temporary,pdf);await rename(temporary,path.join(directory,id+'.pdf'))
        console.log(id+': '+size+' bytes cached locally')
    }finally{await rm(temporary,{force:true})}
}))
