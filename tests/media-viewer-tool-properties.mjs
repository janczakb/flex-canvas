import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium,firefox,webkit} from '@playwright/test'
import {serveViewerExample} from '../scripts/serve.mjs'
const example=await serveViewerExample(),browser=await ({chromium,firefox,webkit}[process.env.BROWSER??'chromium']).launch()
let page
try{
    page=await browser.newPage({viewport:{width:1440,height:940}});const errors=[]
    page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message))
    await page.goto(example.url)
    await page.getByRole('button',{name:'Open image sample',exact:true}).click()
    await page.waitForFunction(()=>window.exampleViewer?.())
    const root=page.locator('.fm'),properties=root.locator('.fm-context'),button=name=>root.getByRole('button',{name,exact:true})
    const paletteButton=()=>properties.locator('[data-property=color] [data-slot=color-picker-trigger]')
    const menu=async(group,item)=>{await button(group).click();await root.getByRole('menuitemradio',{name:item,exact:true}).click()}
    for(const [group,item,label] of [
        ['Drawing tools','Drawing','Drawing color'],['Drawing tools','Freeform Highlight','Highlight color'],
        ['Shapes','Rectangle','Stroke color'],['Shapes','Line','Stroke color'],
        ['Notes and pins','Numbered pin','Pin color'],['Notes and pins','Note','Note color'],
        ['Text tools','Callout','Font color'],['Text tools','Text','Font color'],
    ]){
        await menu(group,item)
        if(item==='Note'||item==='Numbered pin')await properties.getByRole('radiogroup',{name:label,exact:true}).waitFor()
        else await properties.getByRole('button',{name:label,exact:true}).waitFor()
    }
    const icon=properties.locator('[data-property=color]>.fm-property-icon svg path').first()
    assert((await icon.getAttribute('d')).startsWith('M10.3185 16.9775H11.9666'))
    assert((await properties.locator('[data-property=fill]>.fm-property-icon svg path').first().getAttribute('d')).startsWith('M4.25276 20.302'))
    assert((await properties.locator('[data-property=opacity]>.fm-property-icon svg path').first().getAttribute('d')).startsWith('M22 12C22 17.5228'))
    await paletteButton().hover()
    await root.getByRole('tooltip',{name:'Font color',exact:true}).waitFor()
    assert.equal(await root.getByRole('tooltip',{name:'Drawing color',exact:true}).count(),0)
    const fill=properties.locator('[data-property=fill] [data-slot=color-picker-trigger]')
    assert.equal(await fill.getAttribute('aria-label'),'Fill color')
    await fill.click();await root.locator('[data-slot=color-picker-popover]').getByRole('option',{name:'#ffffff',exact:true}).click()
    const bounds=await root.locator('.fm-stage>canvas').last().boundingBox()
    await page.mouse.click(bounds.x+bounds.width*.25,bounds.y+bounds.height*.4)
    const editor=root.locator('.fm-annotation-text-editor')
    await editor.fill('Publication ready')
    await editor.press('Control+Enter')
    assert.equal(await root.getByRole('dialog').count(),0)
    assert.equal((await page.evaluate(()=>window.exampleViewer().getState().annotations))[0].fill,'#ffffff')
    await page.evaluate(()=>window.exampleViewer().setLocale('pl'))
    await properties.getByRole('button',{name:'Kolor tekstu',exact:true}).waitFor()
    assert.equal(await fill.getAttribute('aria-label'),'Kolor wypełnienia')
    await page.setViewportSize({width:390,height:844})
    const summary=properties.locator('[data-property-summary=color]')
    await summary.waitFor();assert.equal(await summary.getAttribute('aria-label'),'Kolor tekstu')
    assert((await summary.locator('svg path').first().getAttribute('d')).startsWith('M10.3185 16.9775H11.9666'))
    await summary.click();await properties.getByRole('button',{name:'Kolor tekstu',exact:true}).waitFor()
    await page.setViewportSize({width:1440,height:940})
    await page.evaluate(()=>window.exampleViewer().setLocale('en'))
    await paletteButton().hover();await root.getByRole('tooltip',{name:'Font color',exact:true}).waitFor()
    await page.waitForFunction(()=>{
        const root=window.exampleViewer().element.shadowRoot
        const tip=root.querySelector('.fm-tooltip')
        return tip&&Number(getComputedStyle(tip).opacity)>=.99
    })
    assert.equal((await root.locator('.fm-status').textContent()).trim(),'')
    await mkdir('.internal/previews',{recursive:true})
    await page.screenshot({path:'.internal/previews/text-properties.png'})
    const pixels=await page.evaluate(async()=>{
        const {paintAnnotation}=await import('/dist/canvas.js')
        const canvas=document.createElement('canvas');canvas.width=200;canvas.height=100
        const context=canvas.getContext('2d'),base={id:'paint',tool:'text',color:'#171717',stroke:2,text:'Review',fontSize:18}
        const pixel=()=>[...context.getImageData(80,35,1,1).data]
        paintAnnotation(context,{...base,points:[[.1,.1],[.6,.5]],fill:'#dc2626',opacity:.5},200,100,0)
        const filled=pixel();context.clearRect(0,0,200,100)
        paintAnnotation(context,{...base,points:[[.1,.1],[.6,.5]],fill:'none'},200,100,0)
        const empty=pixel();context.clearRect(0,0,200,100)
        paintAnnotation(context,{...base,text:'Long label',points:[[.1,.1]],fill:'#dc2626'},200,100,0)
        const legacy=[...context.getImageData(40,31,1,1).data]
        return {filled,empty,legacy}
    })
    assert(pixels.filled.every((value,index)=>Math.abs(value-[220,38,38,128][index])<=2));assert.equal(pixels.empty[3],0);assert.equal(pixels.legacy[3],255)
    await button('Save annotations').click();await page.getByText('Saved in this browser',{exact:true}).waitFor()
    assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('flex-viewer-example:image'))))[0].fill,'#ffffff')
    await page.evaluate(()=>window.exampleViewer().destroy())
    assert.deepEqual(errors,[])
    console.log(JSON.stringify({contextLabels:8,fontColor:true,hugeicons:true,textFill:true,raster:true,save:true,localeSwitch:true,mobile:true,errors:0}))
}catch(error){console.error(error);await mkdir('.internal/previews',{recursive:true});await page?.screenshot({path:'.internal/previews/text-properties-failure.png'});process.exitCode=1}
finally{await browser.close();await example.close()}
