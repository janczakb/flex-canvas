import type {Annotation,LineEnding,Point} from './types.js'
export type LineVertex = readonly [number,number]
const sizeFor=(stroke:number)=>Math.max(10,stroke*3)
const offsetFor=(cap:LineEnding,stroke:number)=>['square','circle','diamond'].includes(cap)?sizeFor(stroke)/2:cap==='reverse-closed-arrow'?sizeFor(stroke):0

/** Shared geometry for screen canvas and toolbar previews; no DOM marker per object. */
export function lineEndingPath(cap:LineEnding,size:number):string {
    const h=size/2
    switch(cap){
        case 'square':return `M${-h} ${-h}H${h}V${h}H${-h}Z`
        case 'circle':return `M${h} 0A${h} ${h} 0 1 0 ${-h} 0A${h} ${h} 0 1 0 ${h} 0Z`
        case 'diamond':return `M${-h} 0L0 ${-h}L${h} 0L0 ${h}Z`
        case 'open-arrow':return `M${-size} ${-h}L0 0L${-size} ${h}`
        case 'closed-arrow':return `M${-size} ${-h}L0 0L${-size} ${h}Z`
        case 'reverse-open-arrow':return `M0 ${-h}L${-size} 0L0 ${h}`
        case 'reverse-closed-arrow':return `M0 ${-h}L${-size} 0L0 ${h}Z`
        case 'bar':return `M0 ${-h}V${h}`
        case 'slash':return `M${-h/2} ${h}L${h/2} ${-h}`
        default:return ''
    }
}
const paths=new Map<string,Path2D>()
function paintEnding(context:CanvasRenderingContext2D,cap:LineEnding,at:LineVertex,neighbor:LineVertex,stroke:number,fill:string,scale:number):void {
    if(cap==='none')return
    const size=sizeFor(stroke)*scale
    let path=paths.get(cap)
    if(!path){path=new Path2D(lineEndingPath(cap,1));paths.set(cap,path)}
    context.save();context.translate(...at);context.rotate(Math.atan2(at[1]-neighbor[1],at[0]-neighbor[0]));context.setLineDash([])
    context.scale(size,size);context.lineWidth/=size
    if(fill!=='none'&&['square','circle','diamond','closed-arrow','reverse-closed-arrow'].includes(cap)){context.fillStyle=fill;context.fill(path)}
    context.stroke(path);context.restore()
}
export function lineGeometry(points:readonly Point[],width:number,height:number,startCap:LineEnding,endCap:LineEnding,stroke:number,scale=1):readonly LineVertex[] {
    const vertices=points.map(([x,y]):LineVertex=>[x*width,y*height])
    if(vertices.length<2)return vertices
    const trim=(point:LineVertex,neighbor:LineVertex,offset:number):LineVertex=>{
        const length=Math.hypot(point[0]-neighbor[0],point[1]-neighbor[1])
        if(length===0)return point
        const ratio=Math.min(offset,length/2)/length
        return [point[0]+(neighbor[0]-point[0])*ratio,point[1]+(neighbor[1]-point[1])*ratio]
    }
    vertices[0]=trim(vertices[0],vertices[1],offsetFor(startCap,stroke)*scale)
    vertices[vertices.length-1]=trim(vertices.at(-1)!,vertices.at(-2)!,offsetFor(endCap,stroke)*scale)
    return vertices
}
export function paintLine(context:CanvasRenderingContext2D,shape:Annotation,width:number,height:number,scale=1):void {
    const start=shape.startCap??'none',end=shape.endCap??(shape.tool==='arrow'?'open-arrow':'none')
    const points=lineGeometry(shape.points,width,height,start,end,shape.stroke,scale)
    context.beginPath();context.moveTo(...points[0]);for(const point of points.slice(1))context.lineTo(...point);context.stroke()
    const vertices=shape.points.map(([x,y]):LineVertex=>[x*width,y*height])
    paintEnding(context,start,vertices[0],vertices[1],shape.stroke,shape.fill??'none',scale)
    paintEnding(context,end,vertices.at(-1)!,vertices.at(-2)!,shape.stroke,shape.fill??'none',scale)
}
