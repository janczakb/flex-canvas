import fs from 'node:fs'
import {buildViewerStyles} from './build-styles.mjs'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const require=createRequire(import.meta.url)
const packageInfo=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'))
fs.rmSync(path.join(root,'dist'),{recursive:true,force:true})
const result=spawnSync(process.execPath,[require.resolve('typescript/bin/tsc'),'-p',path.join(root,'tsconfig.json')],{stdio:'inherit'})
if(result.status!==0)process.exit(result.status??1)
const {build}=await import(require.resolve('esbuild'))
const workerBuild=await build({entryPoints:[path.join(root,'src/pdf/worker.ts')],outfile:path.join(root,'dist/pdfium-worker.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'linked',metafile:true})
const viewerBuild=await build({
    entryPoints: [path.join(root,'src/index.ts')], outdir: path.join(root,'dist/browser'),
    bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022',
    minify: true, legalComments: 'linked', metafile: true,
})
await buildViewerStyles(path.join(root,'dist/browser'))
fs.writeFileSync(path.join(root,'dist/flex-canvas.js'),fs.readFileSync(path.join(root,'scripts/cdn-loader.js'),'utf8').replace('__CANVAS_VERSION__',packageInfo.version))
fs.cpSync(path.join(root,'assets/signature-fonts'),path.join(root,'dist/browser/fonts'),{recursive:true})
const wasm=require.resolve('@embedpdf/pdfium/pdfium.wasm')
fs.copyFileSync(wasm,path.join(root,'dist/pdfium.wasm'))
fs.copyFileSync(path.join(root,'assets/redaction-font/regular.ttf'),path.join(root,'dist/redaction-regular.ttf'))
fs.cpSync(path.join(root,'examples/assets'),path.join(root,'dist/samples'),{recursive:true})
fs.mkdirSync(path.join(root,'licenses'),{recursive:true})
for (const name of ['@heroui/styles', '@heroui/react', 'react', 'react-dom', 'react-aria', 'react-aria-components']) {
    const directory = path.dirname(require.resolve(name + '/package.json'))
    if (fs.existsSync(path.join(directory, 'LICENSE'))) fs.copyFileSync(path.join(directory, 'LICENSE'), path.join(root, 'licenses', name.replace(/[\/@]/g, '-') + '.txt'))
}
for(const name of ['LICENSE','LICENSE.pdfium'])fs.copyFileSync(path.resolve(path.dirname(wasm),'..',name),path.join(root,'licenses',name))
// Preserve notices for every bundled package, including transitive UI dependencies.
const bundled=new Map()
const includedInputs=new Set()
for(const metadata of [workerBuild.metafile,viewerBuild.metafile])for(const output of Object.values(metadata.outputs))for(const [input,contribution] of Object.entries(output.inputs))if(contribution.bytesInOutput>0)includedInputs.add(input)
for(const input of includedInputs) {
    if(!input.includes('node_modules/'))continue
    let directory=path.dirname(path.resolve(root,input))
    while(directory!==path.dirname(directory)) {
        if(fs.existsSync(path.join(directory,'package.json'))) {
            const info=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'))
            if(info.name&&info.version)bundled.set(info.name,{directory,info})
            break
        }
        directory=path.dirname(directory)
    }
}
let notices='# Third-party notices\n\nFLEX Canvas includes the following third-party packages. Their original licenses\napply to their respective code; the FLEX Canvas commercial license does not\nrestrict those independently granted rights.\n\n'
for(const [name,{directory,info}] of [...bundled].sort(([a],[b])=>a.localeCompare(b))) {
    const original=fs.readdirSync(directory).find(file=>/^(licen[cs]e|copying)(\.(txt|md))?$/i.test(file))
    if(!original)throw new Error('Missing license notice for bundled package: '+name)
    const target=name.replace(/[@/]/g,'-')+'.txt'
    fs.copyFileSync(path.join(directory,original),path.join(root,'licenses',target))
    notices+=`- **${name} ${info.version}** — ${typeof info.license==='string'?info.license:'see original license'}; [license](./licenses/${target}).\n`
}
notices+='\nPDFium additional notices: [LICENSE.pdfium](./licenses/LICENSE.pdfium).\n\nLocal signature fonts (Dancing Script, Allura, Sacramento and Kalam) and the\nredaction font (Noto Sans) retain their SIL Open Font License notices in licenses/.\nHugeicons and Lucide icon notices are also retained there. See each original\nnotice for its copyright holders and full terms.\n'
fs.writeFileSync(path.join(root,'THIRD_PARTY_NOTICES.md'),notices)
