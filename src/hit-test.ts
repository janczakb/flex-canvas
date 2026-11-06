import {annotationStrokeWidth} from './stroke-width.js'
import type {Annotation,Point} from './types.js'

export function hitAnnotationGeometry(shape:Annotation,point:Point,width:number,height:number,tolerance=8,strokeScale=1):boolean {
    const [x,y]=[point[0]*width,point[1]*height]
    const vertices=shape.points.map(([u,v])=>[u*width,v*height] as const)
    const [a,b]=vertices[0]
    const strokeWidth=annotationStrokeWidth(shape,strokeScale)
    const radius=Math.max(tolerance,strokeWidth/2)
    if(shape.tool==='text-highlight')return (shape.rectangles??[]).some(([left,top,w,h])=>point[0]>=left&&point[0]<=left+w&&point[1]>=top&&point[1]<=top+h)
    if(shape.tool==='callout'){const [u,v]=vertices[1];if(x>=Math.min(a,u)&&x<=Math.max(a,u)&&y>=Math.min(b,v)&&y<=Math.max(b,v))return true}
    if(['note','pin'].includes(shape.tool))return Math.hypot(x-a,y-b)<=22
    if(['rectangle','image','link','signature'].includes(shape.tool)||shape.tool==='text'&&vertices.length===2){
        const [u,v]=vertices[1]
        return x>=Math.min(a,u)-radius&&x<=Math.max(a,u)+radius&&y>=Math.min(b,v)-radius&&y<=Math.max(b,v)+radius
    }
    if(shape.tool==='ellipse'){
        const [u,v]=vertices[1],rx=Math.abs(u-a)/2+radius,ry=Math.abs(v-b)/2+radius
        return ((x-(a+u)/2)/rx)**2+((y-(b+v)/2)/ry)**2<=1
    }
    const closed=shape.tool==='polygon'||shape.tool==='cloudy-polygon'
    if(closed){
        let inside=false
        for(let index=0,previous=vertices.length-1;index<vertices.length;previous=index++){
            const [u,v]=vertices[index],[s,t]=vertices[previous]
            if((v>y)!==(t>y)&&x<(s-u)*(y-v)/(t-v)+u)inside=!inside
        }
        if(inside)return true
    }
    if(['line','arrow','polyline'].includes(shape.tool)){
        const start=shape.startCap??'none',end=shape.endCap??(shape.tool==='arrow'?'open-arrow':'none')
        const capRadius=Math.max(radius,Math.max(10,shape.stroke*3)*strokeScale)
        if(start!=='none'&&Math.hypot(x-a,y-b)<=capRadius)return true
        if(end!=='none'&&Math.hypot(x-vertices.at(-1)![0],y-vertices.at(-1)![1])<=capRadius)return true
    }
    const strokeRadius=shape.tool==='cloudy-polygon'?Math.max(radius,strokeWidth*5*(shape.cloudIntensity??1)*.75):radius
    const count=closed?vertices.length:vertices.length-1
    for(let index=0;index<count;index++){
        const [u,v]=vertices[index],[s,t]=vertices[(index+1)%vertices.length]
        const size=(s-u)**2+(t-v)**2
        const fraction=size?Math.max(0,Math.min(1,((x-u)*(s-u)+(y-v)*(t-v))/size)):0
        if(Math.hypot(x-u-fraction*(s-u),y-v-fraction*(t-v))<=strokeRadius)return true
    }
    return false
}
