import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
import {serveViewerExample} from '../scripts/serve.mjs'
import {installBrochureFixture} from './fixtures/brochure.mjs'
const example=await serveViewerExample(),browser=await chromium.launch()
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000)
 await page.route('**/brochures/*.pdf',route=>route.fulfill({path:'examples/assets/sample.pdf',contentType:'application/pdf'}));await page.goto(example.url);await page.getByRole('button',{name:'Open Marly brochure',exact:true}).click();await page.waitForFunction(()=>window.exampleViewer?.())
 const root=page.locator('.fm'),trigger=root.getByRole('button',{name:'Search document',exact:true})
 await trigger.click();const panel=root.locator('.fm-search'),field=panel.getByRole('searchbox',{name:'Find text',exact:true})
 await field.fill('FLEX');await panel.getByText('1 of 8',{exact:true}).waitFor()
 const endSpacing=await panel.evaluate(node=>{const suffix=node.querySelector('[data-slot=input-group-suffix]').getBoundingClientRect(),clear=node.querySelector('[data-slot=search-field-clear-button]').getBoundingClientRect();return suffix.right-clear.right})
 assert.equal(endSpacing,8,'Clear button must not add a second end margin on top of the suffix gutter')
 await panel.getByRole('button',{name:'Next match',exact:true}).click();await panel.getByText('2 of 8',{exact:true}).waitFor()
 await field.press('Shift+Enter');await panel.getByText('1 of 8',{exact:true}).waitFor()
 const geometry=await panel.evaluate(node=>{const box=node.getBoundingClientRect(),body=node.parentElement.getBoundingClientRect(),buttons=[...node.querySelectorAll('.fm-document-find-navigation')];return {width:box.width,height:box.height,top:box.top-body.top,right:body.right-box.right,buttons:buttons.map(button=>{const b=button.getBoundingClientRect(),svg=button.querySelector('svg');return {w:b.width,h:b.height,radius:getComputedStyle(button).borderRadius,icon:svg.getBoundingClientRect().width,stroke:svg.getAttribute('stroke-width')}})}})
 assert.equal(geometry.width,420);assert.equal(geometry.height,50);assert.equal(geometry.top,0);assert.equal(geometry.right,0)
 assert(geometry.buttons.every(b=>b.w===34&&b.h===34&&b.radius==='8px'&&b.icon===24&&b.stroke==='2'))
 await panel.getByRole('button',{name:'Clear search',exact:true}).click();await panel.getByText('0 of 0',{exact:true}).waitFor()
 assert(await panel.isVisible());assert.equal(await panel.locator('button').count(),2)
 await page.setViewportSize({width:390,height:800});await field.fill('FLEX');await panel.getByText('1 of 8',{exact:true}).waitFor()
 const mobile=await panel.evaluate(node=>{const r=node.getBoundingClientRect(),f=node.querySelector('input').getBoundingClientRect();return {left:r.left,right:r.right,overflow:node.scrollWidth>node.clientWidth,fieldWidth:f.width}})
 assert(mobile.left>=0&&mobile.right<=390&&!mobile.overflow&&mobile.fieldWidth>20)
 await field.press('Escape');await panel.waitFor({state:'hidden'});await trigger.click();await panel.waitFor({state:'visible'});await trigger.click();await panel.waitFor({state:'hidden'})
 assert.deepEqual(errors,[]);console.log(JSON.stringify({geometry,mobile,nativeHeroUI:true,liveSearch:true,clearDoesNotClose:true,keyboardNavigation:true,toggle:true}))
}finally{await browser.close();await example.close()}
