import {annotationStrokeWidth} from './stroke-width.js'
import {annotationTextFont,wrapAnnotationText} from './text-layout.js'
import {annotationControlPoints} from './selection.js'
import type { Annotation } from './types.js'
import {cloudOutline} from './cloud-outline.js'
import {paintLine} from './line-endings.js'
import {paintNote} from './notes.js'

export function annotationBounds(shape: Annotation) {
    const xs=shape.points.map(point=>point[0]),ys=shape.points.map(point=>point[1])
    return {left:Math.min(...xs),top:Math.min(...ys),right:Math.max(...xs),bottom:Math.max(...ys)}
}
export function annotationHandles(shape: Annotation): readonly (readonly [string, number, number])[] {
    const vertices=annotationControlPoints(shape)
    if(vertices.length&&shape.tool!=='callout')return vertices
    if(!['rectangle','ellipse','callout','text','image','link','signature'].includes(shape.tool)||shape.points.length<2)return vertices
    const {left,top,right,bottom}=annotationBounds({...shape,points:shape.points.slice(0,2)}),x=(left+right)/2,y=(top+bottom)/2
    return [...vertices,['nw',left,top],['n',x,top],['ne',right,top],['e',right,y],['se',right,bottom],['s',x,bottom],['sw',left,bottom],['w',left,y]]
}
function paintSelection(context: CanvasRenderingContext2D,shape: Annotation,width: number,height: number): void {
    const handles=annotationHandles(shape)
    if(!handles.length&&shape.tool!=='text-highlight')return
    const {left,top,right,bottom}=annotationBounds(shape.tool==='callout'?{...shape,points:shape.points.slice(0,2)}:shape)
    context.save();context.globalAlpha=1;context.shadowBlur=0;context.setLineDash([]);context.lineWidth=1;context.strokeStyle='#3299ff'
    if(!handles.length||!handles.every(([key])=>key.startsWith('vertex:')))context.strokeRect(left*width-2,top*height-2,(right-left)*width+4,(bottom-top)*height+4)
    for(const [,x,y] of handles){context.beginPath();context.arc(x*width,y*height,5,0,Math.PI*2);context.fillStyle='#3299ff';context.fill();context.strokeStyle='#fff';context.stroke()}
    context.restore()
}

export function paintAnnotation(context: CanvasRenderingContext2D, shape: Annotation, width: number, height: number, pin: number, selected = false, strokeScale = 1, asset?: CanvasImageSource): void {
    const x = shape.points[0][0] * width, y = shape.points[0][1] * height
    const u = (shape.points[1] ?? shape.points[0])[0] * width, v = (shape.points[1] ?? shape.points[0])[1] * height
    const strokeWidth = annotationStrokeWidth(shape, strokeScale)
    context.save()
    context.strokeStyle = shape.color
    context.fillStyle = shape.color
    context.globalCompositeOperation=shape.blendMode==='normal'?'source-over':shape.blendMode??'source-over'
    context.globalAlpha = shape.opacity ?? 1
    context.setLineDash(shape.dash === 'dashed' ? [strokeWidth * 4, strokeWidth * 2] : shape.dash === 'dotted' ? [strokeScale, strokeWidth * 2] : [])
    context.lineWidth = strokeWidth
    context.lineCap = 'round'
    context.lineJoin = 'round'
    if (selected && !['pen','highlight','text-highlight'].includes(shape.tool)) {
        context.shadowColor = '#111827'
        context.shadowBlur = 1.25
    }
    context.beginPath()
    switch (shape.tool) {
        case 'image':
        case 'signature': {
            if (asset) {
                const size = asset as HTMLImageElement
                const ratio = Math.min(Math.abs(u-x) / (size.naturalWidth || size.width), Math.abs(v-y) / (size.naturalHeight || size.height))
                const w = (size.naturalWidth || size.width) * ratio, h = (size.naturalHeight || size.height) * ratio
                if (w > 0 && h > 0) context.drawImage(asset, (x+u-w)/2, (y+v-h)/2, w, h)
            }
            context.restore()
            if (selected) paintSelection(context,shape,width,height)
            return
        }
        case 'link':
            context.restore()
            if (selected) paintSelection(context,shape,width,height)
            return
        case 'rectangle':
            context.rect(x, y, u - x, v - y)
            break
        case 'ellipse':
            context.ellipse((x + u) / 2, (y + v) / 2, Math.abs(u - x) / 2, Math.abs(v - y) / 2, 0, 0, Math.PI * 2)
            break
        case 'arrow':
        case 'line':
        case 'polyline':
            paintLine(context,shape,width,height,strokeScale)
            context.restore()
            if(selected)paintSelection(context,shape,width,height)
            return
        case 'stamp': {
            const size = shape.fontSize ?? 20
            context.font = `700 ${size}px system-ui`
            const text = shape.text ?? '', padding = 10
            const boxWidth = Math.min(context.measureText(text).width + padding * 2, width * .8)
            context.strokeRect(x, y, boxWidth, size + padding * 2)
            context.textBaseline = 'top'
            context.fillText(text, x + padding, y + padding, Math.max(1, boxWidth - padding * 2))
            context.restore()
            return
        }
        case 'cloudy-polygon': {
            const outline=cloudOutline(shape.points,width,height,strokeWidth,shape.cloudIntensity??1)
            context.moveTo(...outline.start)
            for(const [cx,cy,ex,ey] of outline.curves)context.quadraticCurveTo(cx,cy,ex,ey)
            context.closePath()
            break
        }
        case 'polygon':
            context.moveTo(x, y)
            for (const [a, b] of shape.points.slice(1)) context.lineTo(a * width, b * height)
            if (shape.tool === 'polygon') context.closePath()
            break
        case 'note':
            paintNote(context,shape.noteIcon??'comment',x,y)
            context.restore()
            return
        case 'pin':
            context.arc(x, y, 13, 0, Math.PI * 2)
            context.fill()
            context.strokeStyle = '#fff'
            context.lineWidth = 2
            context.stroke()
            context.fillStyle = '#fff'
            context.font = '700 12px system-ui'
            context.textAlign = 'center'
            context.textBaseline = 'middle'
            context.fillText(String(pin), x, y)
            context.restore()
            return
        case 'text-highlight': {
            const markup=shape.markup??'highlight'
            context.shadowBlur=0
            if(markup==='redaction'){context.globalCompositeOperation='source-over';context.setLineDash([]);context.lineWidth=1.5}
            if(!shape.blendMode&&markup==='highlight')context.globalAlpha*=.36
            context.beginPath()
            for(const [left,top,w,h] of shape.rectangles??[]){
                const x=left*width,y=top*height,boxWidth=w*width,boxHeight=h*height
                if(markup==='highlight'||markup==='redaction'){context.rect(x,y,boxWidth,boxHeight);continue}
                const baseline=y+boxHeight*(markup==='strikeout'?.52:.94)
                context.moveTo(x,baseline)
                if(markup==='squiggle'){
                    const steps=Math.min(2048,Math.max(2,Math.ceil(boxWidth/2)))
                    for(let i=1;i<=steps;i++)context.lineTo(x+i*boxWidth/steps,baseline+(i%2?1.5:-1.5))
                }else context.lineTo(x+boxWidth,baseline)
            }
            if(markup==='highlight')context.fill()
            else context.stroke()
            context.restore()
            if(selected)paintSelection(context,shape,width,height)
            return
        }
        case 'callout': {
            context.strokeStyle=shape.strokeColor??shape.color
            const [[left,top],[right,bottom],knee,tip]=shape.points
            const boxX=left*width,boxY=top*height,boxW=(right-left)*width,boxH=(bottom-top)*height
            const center=[boxX+boxW/2,boxY+boxH/2],target=[knee[0]*width,knee[1]*height] as const
            const dx=target[0]-center[0],dy=target[1]-center[1],ratio=Math.min(Math.abs((boxW/2)/(dx||.001)),Math.abs((boxH/2)/(dy||.001)))
            context.beginPath();context.moveTo(center[0]+dx*ratio,center[1]+dy*ratio);context.lineTo(...target);context.lineTo(tip[0]*width,tip[1]*height);context.stroke()
            const angle=Math.atan2(tip[1]*height-target[1],tip[0]*width-target[0]),size=Math.max(8,shape.stroke*3)*strokeScale
            context.beginPath();context.moveTo(tip[0]*width-size*Math.cos(angle-.5),tip[1]*height-size*Math.sin(angle-.5));context.lineTo(tip[0]*width,tip[1]*height);context.lineTo(tip[0]*width-size*Math.cos(angle+.5),tip[1]*height-size*Math.sin(angle+.5));context.stroke()
            if(shape.fill&&shape.fill!=='none'){context.fillStyle=shape.fill;context.fillRect(boxX,boxY,boxW,boxH)}
            context.strokeRect(boxX,boxY,boxW,boxH);context.fillStyle=shape.color
            context.font=annotationTextFont(shape,strokeScale);context.textBaseline='alphabetic'
            paintTextBox(context,shape,boxX,boxY,boxW,boxH,strokeScale)
            context.restore();if(selected)paintSelection(context,shape,width,height)
            return
        }
        case 'text': {
            context.font = annotationTextFont(shape,strokeScale)
            context.textBaseline = 'top'
            context.textAlign = shape.align ?? 'left'
            if(shape.fill&&shape.fill!=='none'){
                context.fillStyle=shape.fill
                if(shape.points.length===2)context.fillRect(Math.min(x,u),Math.min(y,v),Math.abs(u-x),Math.abs(v-y))
                else {
                    const lines=(shape.text??'').split('\n'),boxWidth=Math.min(Math.max(...lines.map(line=>context.measureText(line).width)),Math.max(1,width-x))
                    const left=x-(shape.align==='center'?boxWidth/2:shape.align==='right'?boxWidth:0)
                    context.fillRect(left,y,boxWidth,lines.length*(shape.fontSize??18)*1.3)
                }
                context.fillStyle=shape.color
            }
            if(shape.points.length===2)paintTextBox(context,shape,x,y,u-x,v-y,strokeScale)
            else for (const [index, line] of (shape.text ?? '').split('\n').entries()) context.fillText(line, x, y + index * (shape.fontSize ?? 18) * 1.3, Math.max(1, width - x))
            context.restore()
            if(selected)paintSelection(context,shape,width,height)
            return
        }
        default:
            if (shape.tool === 'highlight') {
                if(!shape.blendMode)context.globalAlpha *= .36
            }
            context.moveTo(x, y)
            for (const [a, b] of shape.points.slice(1)) context.lineTo(a * width, b * height)
    }
    if (shape.fill && shape.fill !== 'none') {
        context.fillStyle = shape.fill
        context.fill()
    }
    context.stroke()
    context.restore()
    if(selected)paintSelection(context,shape,width,height)
}

/** Draws only annotations; the source image remains a separate untouched element. */
export function createAnnotationCanvas(canvas: HTMLCanvasElement, {maxPixels=4194304,maxDimension=4096}: {maxPixels?: number; maxDimension?: number}={}) {
    if(!canvas?.getContext || !Number.isFinite(maxPixels) || maxPixels<1 || maxPixels>16777216 || !Number.isFinite(maxDimension) || maxDimension<1 || maxDimension>8192)throw new TypeError('Invalid annotation canvas budget')
    let width=0,height=0,disposed=false
    const context=canvas.getContext('2d')
    if(!context)throw new Error('Canvas 2D is unavailable')
    return Object.freeze({
        resize(w: number,h: number,pixelRatio=globalThis.devicePixelRatio||1){
            if(disposed)throw new Error('Annotation canvas is disposed')
            if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0||!Number.isFinite(pixelRatio)||pixelRatio<=0)throw new TypeError('Invalid annotation canvas dimensions')
            width=w;height=h
            const ratio=Math.min(pixelRatio,maxDimension/w,maxDimension/h,Math.sqrt(maxPixels/(w*h)))
            canvas.width=Math.max(1,Math.floor(w*ratio));canvas.height=Math.max(1,Math.floor(h*ratio))
            context.setTransform(canvas.width/w,0,0,canvas.height/h,0,0)
        },
        render(shapes: readonly Annotation[],{selected=null,exclude=null,strokeScale=1}: {selected?: string | null; exclude?: string | null; strokeScale?: number}={}){
            if(disposed)throw new Error('Annotation canvas is disposed')
            if(!Number.isFinite(strokeScale)||strokeScale<=0)throw new RangeError('Invalid annotation stroke scale')
            context.clearRect(0,0,width,height);let pin=0
            for(const shape of shapes){if(shape.tool==='pin')pin++;if(shape.id!==exclude)paintAnnotation(context,shape,width,height,pin,selected===shape.id,strokeScale)}
        },
        clear(){if(!disposed)context.clearRect(0,0,width,height)},
        dispose(){if(disposed)return;disposed=true;canvas.width=canvas.height=1},
    })
}

function paintTextBox(context: CanvasRenderingContext2D,shape: Annotation,x: number,y: number,width: number,height: number,scale=1): void {
    const padding=6*scale,available=Math.max(1,width-padding*2),align=shape.align??'left',fontSize=(shape.fontSize??18)*scale,lineHeight=fontSize*1.3
    const lines=wrapAnnotationText(context,shape.text??'',available),spare=Math.max(0,height-padding*2-lines.length*lineHeight)
    const offset=shape.verticalAlign==='bottom'?spare:shape.verticalAlign==='center'?spare/2:0
    context.save();context.beginPath();context.rect(x,y,Math.max(1,width),Math.max(1,height));context.clip();context.textAlign=align;context.textBaseline='alphabetic';context.shadowBlur=0
    const metrics=context.measureText('Mg'),ascent=metrics.fontBoundingBoxAscent??fontSize*.8,descent=metrics.fontBoundingBoxDescent??fontSize*.2
    const left=x+padding+(align==='center'?available/2:align==='right'?available:0)
    for(const [index,line] of lines.entries()){
        const baseline=y+padding+offset+(lineHeight-ascent-descent)/2+ascent+index*lineHeight
        context.fillText(line,left,baseline)
        if(shape.underline){
            const w=context.measureText(line).width,start=left-(align==='center'?w/2:align==='right'?w:0)
            context.save();context.strokeStyle=shape.color;context.lineWidth=Math.max(.5,fontSize/16);context.setLineDash([]);context.beginPath();context.moveTo(start,baseline+fontSize*.12);context.lineTo(start+w,baseline+fontSize*.12);context.stroke();context.restore()
        }
    }
    context.restore()
}
