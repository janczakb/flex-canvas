import type {Annotation} from './types.js'

type Rect = readonly [number,number,number,number]
const epsilon=1e-5
const sameLine=(a:Rect,b:Rect)=>Math.abs(a[1]-b[1])<=epsilon&&Math.abs(a[3]-b[3])<=epsilon
function union(rectangles:readonly Rect[]):Rect[]{
    const sorted=rectangles.map(rect=>[...rect] as [number,number,number,number]).sort((a,b)=>a[1]-b[1]||a[0]-b[0]),result:Rect[]=[]
    for(const rect of sorted){
        const last=result.at(-1)
        if(last&&sameLine(last,rect)&&rect[0]<=last[0]+last[2]+epsilon)result[result.length-1]=[last[0],last[1],Math.max(last[0]+last[2],rect[0]+rect[2])-last[0],last[3]]
        else result.push(rect)
    }
    return result
}
function subtract(rect:Rect,coverage:readonly Rect[]):Rect[]{
    const intervals=union(coverage.filter(box=>box[1]<=rect[1]+epsilon&&box[1]+box[3]>=rect[1]+rect[3]-epsilon).map(box=>[box[0],rect[1],box[2],rect[3]]))
    const result:Rect[]=[];let left=rect[0],right=rect[0]+rect[2]
    for(const interval of intervals){
        if(interval[0]>left+epsilon)result.push([left,rect[1],Math.min(right,interval[0])-left,rect[3]])
        left=Math.max(left,interval[0]+interval[2]);if(left>=right-epsilon)break
    }
    if(left<right-epsilon)result.push([left,rect[1],right-left,rect[3]])
    return result.filter(rect=>rect[2]>epsilon)
}
const touches=(a:Rect,b:Rect)=>sameLine(a,b)&&a[0]<=b[0]+b[2]+epsilon&&b[0]<=a[0]+a[2]+epsilon
/** Idempotent markup: already covered text is selected, never painted twice. */
export function prepareTextMarkup(shapes:readonly Annotation[],candidate:Annotation,maxRects=512){
    if(candidate.tool!=='text-highlight'||!candidate.rectangles?.length)throw new TypeError('Expected text markup rectangles')
    const rectangles=union(candidate.rectangles),kind=candidate.markup??'highlight'
    const matching=shapes.filter(shape=>shape.tool==='text-highlight'&&(shape.pageIndex??0)===(candidate.pageIndex??0)&&(shape.markup??'highlight')===kind)
    const coverage=matching.flatMap(shape=>shape.rectangles??[]),remaining=rectangles.flatMap(rect=>subtract(rect,coverage))
    const overlapping=matching.filter(shape=>(shape.rectangles??[]).some(box=>rectangles.some(rect=>touches(box,rect))))
    if(!remaining.length){
        const existing=overlapping[0]
        if(!existing)return {shapes,selectedId:null,changed:false,limited:false}
        if('text' in candidate&&!('text' in existing))return {shapes:shapes.map(shape=>shape===existing?{...shape,text:candidate.text}:shape),selectedId:existing.id,changed:true,limited:false}
        return {shapes,selectedId:existing.id,changed:false,limited:false}
    }
    const compatible=overlapping.filter(shape=>(kind!=='redaction'||(['fill','overlayColor','overlayText','repeatOverlayText'] as const).every(key=>shape[key]===candidate[key]))&&shape.color===candidate.color&&(shape.blendMode??'multiply')===(candidate.blendMode??'multiply')&&(shape.opacity??1)===(candidate.opacity??1)&&shape.stroke===candidate.stroke&&!('text' in shape))
    const combined=union([...remaining,...compatible.flatMap(shape=>shape.rectangles??[])])
    if(combined.length>maxRects)return {shapes,selectedId:null,changed:false,limited:true}
    if(compatible.length){
        const first=compatible[0],merged={...first,rectangles:combined,...('text' in candidate?{text:candidate.text}:{})}
        return {shapes:shapes.flatMap(shape=>shape===first?[merged]:compatible.includes(shape)?[]:[shape]),selectedId:first.id,changed:true,limited:false}
    }
    return {shapes:[...shapes,{...candidate,rectangles:combined}],selectedId:candidate.id,changed:true,limited:false}
}
