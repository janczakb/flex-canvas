import fs from 'node:fs/promises'
import path from 'node:path'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {transform} from 'esbuild'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))

export async function buildViewerStyles(directory) {
    await fs.mkdir(directory,{recursive:true})
    const viewer = await fs.readFile(path.join(root,'src/styles/viewer.css'), 'utf8')
    const signature = await fs.readFile(path.join(root,'src/styles/signature.css'), 'utf8')
    const insert=await fs.readFile(path.join(root,'src/styles/insert.css'),'utf8')
    const print=await fs.readFile(path.join(root,'src/styles/print.css'),'utf8')
    await fs.writeFile(path.join(directory,'print.css'),(await transform(print,{loader:'css',minify:true})).code)
    const {code} = await transform(viewer + '\n' + signature + '\n' + insert, {loader:'css',minify:true})
    await fs.writeFile(path.join(directory,'viewer.css'), code)
    const cli = require.resolve('@tailwindcss/cli/package.json')
    const {bin} = JSON.parse(await fs.readFile(cli, 'utf8'))
    const result = spawnSync(process.execPath, [
        path.resolve(path.dirname(cli), bin.tailwindcss),
        '-i', path.join(root,'src/styles/heroui.css'),
        '-o', path.join(directory,'heroui.css'), '--minify',
    ], {cwd:root,stdio:'inherit'})
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error('HeroUI CSS build failed.')
    // Browsers register @property only in the document, not inside a ShadowRoot.
    const heroCSS = await fs.readFile(path.join(directory,'heroui.css'), 'utf8')
    const registrations = heroCSS.match(/@property\s+--[\w-]+\s*\{[^{}]*\}/g) ?? []
    if (!registrations.length) throw new Error('HeroUI property registrations are missing.')
    await fs.writeFile(path.join(directory,'properties.css'), registrations.join('\n') + '\n')
}
