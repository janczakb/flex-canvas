import {createServer} from 'node:http'
import {readFile,stat} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root=path.resolve(import.meta.dirname,'..')
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.wasm':'application/wasm','.pdf':'application/pdf','.jpg':'image/jpeg'}
export async function serveViewerExample(port=0) {
    const server=createServer(async(request,response)=>{
        const url=new URL(request.url,'http://localhost')
        let pathname
        try{pathname=url.pathname==='/'?'/examples/index.html':decodeURIComponent(url.pathname)}
        catch{response.writeHead(400);response.end();return}
        const brochure=/^\/brochures\/(marly|leela)\.pdf$/.exec(pathname)
        if(brochure){
            const file=path.join(root,'.cache/examples',brochure[1]+'.pdf')
            try{
                const info=await stat(file)
                response.writeHead(200,{'Content-Type':'application/pdf','Content-Length':info.size,'Cache-Control':'no-store'})
                const stream=createReadStream(file)
                stream.on('error',()=>response.destroy());response.on('close',()=>stream.destroy());stream.pipe(response)
            }catch{response.writeHead(503);response.end('Run npm run examples:fetch to cache the brochure examples.')}
            return
        }
        const file=path.resolve(root,'.'+pathname)
        if(!file.startsWith(root+path.sep)||!['examples','dist'].includes(path.relative(root,file).split(path.sep)[0])){
            response.writeHead(404);response.end();return
        }
        try{
            const bytes=await readFile(file)
            response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
            response.end(bytes)
        }catch{response.writeHead(404);response.end()}
    })
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)})
    return {url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
    const example=await serveViewerExample(Number(process.env.PORT??4178))
    console.log('FLEX Media Viewer: '+example.url)
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void example.close().then(()=>process.exit(0))})
}
